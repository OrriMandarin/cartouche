//! Header video processing behind a trait: probing an uploaded file and transcoding it into
//! the served file, the edit copy and the poster frame (MED-003, MED-026, MED-034, MED-035,
//! MED-037, MED-038, MED-039). [`Ffmpeg`] is the adapter that runs ffmpeg and ffprobe.
//!
//! The programs only ever read a file this process wrote, as `file:<path>`, with the `file`
//! protocol alone whitelisted and the container forced to MP4; they are never run through a
//! shell and no value from the request reaches their command line: every number comes from
//! the domain's [`VideoPlan`]. Each child is killed when its future is dropped, so that a
//! deadline (MED-039) leaves no process behind.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use async_trait::async_trait;
use cartouche_domain::{PosterSeek, VideoPlan, VideoProbe};
use serde_json::Value;
use tokio::process::Command;

/// How many trailing lines of a failed program's stderr are logged.
const LOGGED_STDERR_LINES: usize = 8;
/// The highest frame rate of a served file or edit copy (MED-034).
const MAX_FRAME_RATE: &str = "30";

/// File name of the served file in a job's output directory.
const SERVED_NAME: &str = "video.mp4";
/// File name of the edit copy in a job's output directory.
const EDIT_COPY_NAME: &str = "edit-copy.mp4";
/// File name of the poster frame in a job's output directory.
const POSTER_NAME: &str = "poster.png";

/// Why a video could not be processed.
#[derive(Debug, thiserror::Error)]
pub enum VideoError {
    /// The file is not a video the programs can read (MED-039).
    #[error("unreadable video: {0}")]
    Unreadable(String),
    /// A program could not be run at all (missing binary, spawn failure).
    #[error("video tool failure: {0}")]
    Tool(String),
}

/// One transcoding job: the plan from the domain applied to `input`, written in `out_dir`.
#[derive(Debug, Clone)]
pub struct RenderJob {
    pub input: PathBuf,
    pub out_dir: PathBuf,
    pub plan: VideoPlan,
    /// Whether to write the edit copy too (MED-037).
    pub edit_copy: bool,
}

/// The files a job wrote, all inside its `out_dir`.
#[derive(Debug, Clone)]
pub struct RenderOutputs {
    pub served: PathBuf,
    pub edit_copy: Option<PathBuf>,
    /// The full displayed frame at the poster time, as a PNG (MED-003).
    pub poster_frame: PathBuf,
}

/// What the API needs from a video tool.
#[async_trait]
pub trait VideoProcessor: Send + Sync {
    /// Displayed size (rotation applied) and codec of the first video stream.
    async fn probe(&self, input: &Path) -> Result<VideoProbe, VideoError>;
    /// Writes the served file, the edit copy when asked, and the full displayed frame at the
    /// poster seek (PNG) into `job.out_dir`.
    async fn render(&self, job: &RenderJob) -> Result<RenderOutputs, VideoError>;
}

/// The adapter that runs ffmpeg and ffprobe.
#[derive(Debug, Clone)]
pub struct Ffmpeg {
    ffmpeg: PathBuf,
    ffprobe: PathBuf,
}

impl Ffmpeg {
    pub fn new(ffmpeg: impl Into<PathBuf>, ffprobe: impl Into<PathBuf>) -> Self {
        Self {
            ffmpeg: ffmpeg.into(),
            ffprobe: ffprobe.into(),
        }
    }

    /// Runs `program` with `args`; stdout is captured, stderr is logged on failure.
    async fn run(program: &Path, args: &[OsString]) -> Result<Vec<u8>, VideoError> {
        tracing::debug!(program = %program.display(), ?args, "running a video tool");
        let output = Command::new(program)
            .args(args)
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output()
            .await
            .map_err(|error| VideoError::Tool(format!("{}: {error}", program.display())))?;
        if !output.status.success() {
            if output.status.code().is_none() {
                return Err(VideoError::Tool(format!(
                    "{} was killed: {}",
                    program.display(),
                    output.status
                )));
            }
            let stderr = String::from_utf8_lossy(&output.stderr);
            let lines: Vec<&str> = stderr.lines().collect();
            let tail = lines[lines.len().saturating_sub(LOGGED_STDERR_LINES)..].join("\n");
            tracing::warn!(program = %program.display(), status = %output.status, stderr = %tail, "video tool failed");
            return Err(VideoError::Unreadable(format!(
                "{} exited with {}",
                program.display(),
                output.status
            )));
        }
        Ok(output.stdout)
    }

    /// The options every ffmpeg run starts with, up to the input file: no stdin, the `file`
    /// protocol alone, the container forced to MP4, then `input_options` (applied to the
    /// input) and the input itself.
    fn base_args(input_options: &[OsString], input: &Path) -> Vec<OsString> {
        let mut args: Vec<OsString> = [
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-protocol_whitelist",
            "file",
        ]
        .map(OsString::from)
        .into();
        args.extend(input_options.iter().cloned());
        args.extend(["-f", "mp4", "-i"].map(OsString::from));
        let mut file = OsString::from("file:");
        file.push(input);
        args.push(file);
        args
    }

    fn transcode_args(job: &RenderJob) -> Vec<OsString> {
        let plan = &job.plan;
        // The input is bounded by the duration the server read (MED-013).
        let bound = ["-t".into(), format!("{:.3}", plan.duration).into()];
        let mut args = Self::base_args(&bound, &job.input);

        let crop = plan.crop;
        let (width, height) = plan.output;
        let served_chain = format!(
            "trim=start={:.3}:duration={:.3},setpts=PTS-STARTPTS,crop={}:{}:{}:{},scale={width}:{height},setsar=1",
            plan.trim_start, plan.trim_length, crop.width, crop.height, crop.x, crop.y
        );
        let filter = if job.edit_copy {
            let (edit_width, edit_height) = plan.edit_copy;
            format!(
                "[0:v:0]split=2[s][e];[s]{served_chain}[served];[e]scale={edit_width}:{edit_height},setsar=1[edit]"
            )
        } else {
            format!("[0:v:0]{served_chain}[served]")
        };
        args.extend(["-filter_complex".into(), filter.into()]);
        Self::output_args(
            &mut args,
            "[served]",
            "26",
            "medium",
            &job.out_dir.join(SERVED_NAME),
        );
        if job.edit_copy {
            Self::output_args(
                &mut args,
                "[edit]",
                "30",
                "veryfast",
                &job.out_dir.join(EDIT_COPY_NAME),
            );
        }
        args
    }

    /// One output file: H.264 High, 8-bit 4:2:0, at most 30 fps, no sound, no metadata, index
    /// at the start of the file (MED-034, MED-037, MED-038).
    fn output_args(args: &mut Vec<OsString>, label: &str, crf: &str, preset: &str, path: &Path) {
        for arg in [
            "-map",
            label,
            "-c:v",
            "libx264",
            "-profile:v",
            "high",
            "-pix_fmt",
            "yuv420p",
            "-crf",
            crf,
            "-preset",
            preset,
            "-fpsmax",
            MAX_FRAME_RATE,
            "-an",
            "-map_metadata",
            "-1",
            "-map_chapters",
            "-1",
            "-movflags",
            "+faststart",
            "-f",
            "mp4",
        ] {
            args.push(arg.into());
        }
        args.push(path.into());
    }

    fn poster_args(job: &RenderJob) -> Vec<OsString> {
        let seek: [OsString; 2] = match job.plan.poster {
            PosterSeek::At(time) => ["-ss".into(), format!("{time:.3}").into()],
            PosterSeek::LastFrame => ["-sseof".into(), "-0.5".into()],
        };
        let mut args = Self::base_args(&seek, &job.input);
        args.extend(["-map", "0:v:0", "-an"].map(OsString::from));
        match job.plan.poster {
            PosterSeek::At(_) => args.extend(["-frames:v".into(), "1".into()]),
            // Every frame overwrites the file: the last one stays.
            PosterSeek::LastFrame => args.extend(["-update".into(), "1".into()]),
        }
        args.push(job.out_dir.join(POSTER_NAME).into());
        args
    }
}

/// `true` when `path` exists and is not empty.
async fn is_written(path: &Path) -> bool {
    tokio::fs::metadata(path)
        .await
        .is_ok_and(|metadata| metadata.len() > 0)
}

/// The rotation of a stream in ffprobe's JSON (a side data entry), in degrees.
fn rotation(stream: &Value) -> i64 {
    stream["side_data_list"]
        .as_array()
        .into_iter()
        .flatten()
        .find_map(|entry| entry["rotation"].as_f64())
        .map_or(0, |degrees| degrees.round() as i64)
}

fn parse_probe(stdout: &[u8]) -> Result<VideoProbe, VideoError> {
    let unreadable = |what: &str| VideoError::Unreadable(what.to_string());
    let report: Value =
        serde_json::from_slice(stdout).map_err(|_| unreadable("ffprobe printed no JSON"))?;
    let stream = report["streams"]
        .get(0)
        .ok_or_else(|| unreadable("no video stream"))?;
    let side = |key: &str| stream[key].as_u64().and_then(|n| u32::try_from(n).ok());
    let (width, height) = side("width")
        .zip(side("height"))
        .filter(|(width, height)| *width > 0 && *height > 0)
        .ok_or_else(|| unreadable("the video has no size"))?;
    let codec = stream["codec_name"]
        .as_str()
        .ok_or_else(|| unreadable("the video has no codec"))?
        .to_string();
    let (width, height) = if matches!(rotation(stream).rem_euclid(360), 90 | 270) {
        (height, width)
    } else {
        (width, height)
    };
    Ok(VideoProbe {
        width,
        height,
        codec,
    })
}

#[async_trait]
impl VideoProcessor for Ffmpeg {
    async fn probe(&self, input: &Path) -> Result<VideoProbe, VideoError> {
        let mut file = OsString::from("file:");
        file.push(input);
        let mut args: Vec<OsString> = [
            "-v",
            "error",
            "-hide_banner",
            "-protocol_whitelist",
            "file",
            "-f",
            "mp4",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name,width,height:stream_side_data=rotation",
            "-of",
            "json",
        ]
        .map(OsString::from)
        .into();
        args.push(file);
        parse_probe(&Self::run(&self.ffprobe, &args).await?)
    }

    async fn render(&self, job: &RenderJob) -> Result<RenderOutputs, VideoError> {
        Self::run(&self.ffmpeg, &Self::transcode_args(job)).await?;
        Self::run(&self.ffmpeg, &Self::poster_args(job)).await?;
        let served = job.out_dir.join(SERVED_NAME);
        let edit_copy = job.edit_copy.then(|| job.out_dir.join(EDIT_COPY_NAME));
        let poster_frame = job.out_dir.join(POSTER_NAME);
        for path in [Some(&served), edit_copy.as_ref(), Some(&poster_frame)]
            .into_iter()
            .flatten()
        {
            if !is_written(path).await {
                return Err(VideoError::Unreadable(format!(
                    "ffmpeg wrote no {}",
                    path.display()
                )));
            }
        }
        Ok(RenderOutputs {
            served,
            edit_copy,
            poster_frame,
        })
    }
}
