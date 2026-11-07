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
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use cartouche_domain::{PosterSeek, VideoPlan, VideoProbe};
use futures_util::future::BoxFuture;
use serde_json::Value;
use tokio::process::Command;
use tokio::sync::{Semaphore, oneshot};

/// How many trailing lines of a failed program's stderr are logged.
const LOGGED_STDERR_LINES: usize = 8;
/// The formats the video tool decodes, as ffmpeg's `-codec_whitelist` lists them (MED-040).
const CODEC_WHITELIST: &str = "h264,hevc,vp9,av1";
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

    /// Checks that both programs run and that ffmpeg has an H.264 encoder (MED-041). The error
    /// names the variables and says how to install the tools. Returns ffmpeg's version line.
    pub async fn check(&self) -> Result<String, String> {
        let advice = "install ffmpeg: brew install ffmpeg (macOS) or apt-get install ffmpeg \
                      (Debian/Ubuntu), or set FFMPEG_PATH and FFPROBE_PATH";
        let version = [OsString::from("-version")];
        let mut ffmpeg_version = None;
        for (variable, program) in [
            ("FFMPEG_PATH", &self.ffmpeg),
            ("FFPROBE_PATH", &self.ffprobe),
        ] {
            let output = Self::run(program, &version).await.map_err(|error| {
                format!(
                    "cannot run {} (${variable}): {error}; {advice}",
                    program.display()
                )
            })?;
            ffmpeg_version.get_or_insert_with(|| {
                String::from_utf8_lossy(&output)
                    .lines()
                    .next()
                    .unwrap_or_default()
                    .to_string()
            });
        }
        let encoders = ["-hide_banner", "-encoders"].map(OsString::from);
        let listing = Self::run(&self.ffmpeg, &encoders).await.map_err(|error| {
            format!("cannot list the encoders of ffmpeg (FFMPEG_PATH): {error}")
        })?;
        if !String::from_utf8_lossy(&listing).contains("libx264") {
            return Err(format!(
                "{} (FFMPEG_PATH) has no libx264 encoder; {advice}",
                self.ffmpeg.display()
            ));
        }
        Ok(ffmpeg_version.unwrap_or_default())
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
    /// protocol alone, the four accepted codecs alone (no other stream of the file is ever
    /// decoded, MED-040), the container forced to MP4, then `input_options` (applied to the
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
            "-codec_whitelist",
            CODEC_WHITELIST,
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

    /// ffprobe reads the container's headers alone (`-nofind_stream_info`): it opens no
    /// decoder, so no stream of the file is decoded, whatever its codec (MED-040). The
    /// codec, the size and the rotation of the first video stream are in those headers.
    fn probe_args(input: &Path) -> Vec<OsString> {
        let mut file = OsString::from("file:");
        file.push(input);
        let mut args: Vec<OsString> = [
            "-v",
            "error",
            "-hide_banner",
            "-protocol_whitelist",
            "file",
            "-nofind_stream_info",
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
    // A codec the tool does not decode has no size in the headers (MED-040): its size is 0
    // here and the codec check refuses it before anything reads the size.
    let (width, height) = (side("width").unwrap_or(0), side("height").unwrap_or(0));
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
        let args = Self::probe_args(input);
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

/// Why a video job produced nothing (MED-039).
#[derive(Debug, thiserror::Error)]
pub enum VideoJobError {
    /// The job, waiting for its turn included, ran past the deadline.
    #[error("video processing timed out")]
    Timeout,
    #[error(transparent)]
    Video(#[from] VideoError),
}

/// Runs video jobs one at a time, each under one deadline that starts when the job is
/// submitted, so waiting for the previous job counts (MED-039).
#[derive(Clone)]
pub struct VideoService {
    processor: Arc<dyn VideoProcessor>,
    permits: Arc<Semaphore>,
    deadline: Duration,
}

impl VideoService {
    pub fn new(processor: Arc<dyn VideoProcessor>, permits: usize, deadline: Duration) -> Self {
        Self {
            processor,
            permits: Arc::new(Semaphore::new(permits)),
            deadline,
        }
    }

    /// Runs `work` once a permit is free. The work lives in a spawned task that owns the
    /// permit, so a request that goes away does not cancel a running job: it ends by itself
    /// or at the deadline, when the task drops the work, which kills its child processes
    /// (they are `kill_on_drop`; tokio reaps them in the background). A job whose caller is
    /// gone before its turn comes is not started.
    pub async fn run<T>(
        &self,
        work: impl FnOnce(Arc<dyn VideoProcessor>) -> BoxFuture<'static, Result<T, VideoError>>
        + Send
        + 'static,
    ) -> Result<T, VideoJobError>
    where
        T: Send + 'static,
    {
        let (sender, receiver) = oneshot::channel();
        let processor = self.processor.clone();
        let permits = self.permits.clone();
        let deadline = self.deadline;
        tokio::spawn(async move {
            let job = async {
                let _permit = permits.acquire_owned().await.expect("never closed");
                if sender.is_closed() {
                    return Err(VideoError::Tool("the caller is gone".to_string()));
                }
                work(processor).await
            };
            let outcome = match tokio::time::timeout(deadline, job).await {
                Ok(result) => result.map_err(VideoJobError::Video),
                Err(_) => Err(VideoJobError::Timeout),
            };
            // The caller may be gone.
            let _ = sender.send(outcome);
        });
        // The sender is dropped without a value only if the task panicked.
        receiver.await.unwrap_or_else(|_| {
            Err(VideoJobError::Video(VideoError::Tool(
                "the video task failed".to_string(),
            )))
        })
    }

    #[cfg(all(test, feature = "test-support"))]
    fn available_permits(&self) -> usize {
        self.permits.available_permits()
    }
}

#[cfg(all(test, feature = "test-support"))]
mod tests {
    use super::*;
    use crate::test_support::video::StubVideoProcessor;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn service(deadline: Duration) -> VideoService {
        VideoService::new(Arc::new(StubVideoProcessor::default()), 1, deadline)
    }

    type Job = Box<
        dyn FnOnce(
                Arc<dyn VideoProcessor>,
            ) -> BoxFuture<'static, Result<(usize, usize), VideoError>>
            + Send,
    >;

    /// A job that takes `delay` and notes when it started and ended.
    fn job(delay: Duration, clock: &Arc<AtomicUsize>) -> Job {
        let clock = clock.clone();
        Box::new(move |_| {
            Box::pin(async move {
                let started = clock.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(delay).await;
                let ended = clock.fetch_add(1, Ordering::SeqCst);
                Ok((started, ended))
            })
        })
    }

    // spec: MED-039
    #[tokio::test]
    async fn a_second_job_waits_for_the_first() {
        let service = service(Duration::from_secs(5));
        let clock = Arc::new(AtomicUsize::new(0));
        let (first, second) = tokio::join!(
            service.run(job(Duration::from_millis(200), &clock)),
            service.run(job(Duration::from_millis(10), &clock)),
        );
        let ((first_start, first_end), (second_start, _)) = (first.unwrap(), second.unwrap());
        assert_eq!((first_start, first_end), (0, 1), "the first runs alone");
        assert_eq!(second_start, 2, "the second starts after the first ended");
    }

    // spec: MED-039
    #[tokio::test]
    async fn a_job_past_the_deadline_is_a_timeout_and_frees_its_permit() {
        let service = service(Duration::from_millis(100));
        let clock = Arc::new(AtomicUsize::new(0));
        let result = service.run(job(Duration::from_secs(1), &clock)).await;
        assert!(matches!(result, Err(VideoJobError::Timeout)), "{result:?}");
        assert_eq!(service.available_permits(), 1);
    }

    // spec: MED-039
    #[tokio::test]
    async fn the_wait_counts_in_the_deadline() {
        // Each job fits in the deadline alone; the second does not once it has waited.
        let service = service(Duration::from_millis(300));
        let clock = Arc::new(AtomicUsize::new(0));
        let (first, second) = tokio::join!(
            service.run(job(Duration::from_millis(200), &clock)),
            service.run(job(Duration::from_millis(200), &clock)),
        );
        assert!(first.is_ok(), "{first:?}");
        assert!(matches!(second, Err(VideoJobError::Timeout)), "{second:?}");
        assert_eq!(service.available_permits(), 1);
    }

    // spec: MED-039
    #[tokio::test]
    async fn a_queued_job_whose_caller_is_gone_does_not_run() {
        let service = service(Duration::from_secs(5));
        let clock = Arc::new(AtomicUsize::new(0));
        let ran = Arc::new(AtomicUsize::new(0));
        let abandoned: Job = {
            let ran = ran.clone();
            Box::new(move |_| {
                Box::pin(async move {
                    ran.fetch_add(1, Ordering::SeqCst);
                    Ok((0, 0))
                })
            })
        };
        let first = service.run(job(Duration::from_millis(200), &clock));
        // The second request is dropped while it waits for the permit.
        let second = tokio::time::timeout(Duration::from_millis(50), service.run(abandoned));
        let (first, second) = tokio::join!(first, second);
        assert!(first.is_ok(), "{first:?}");
        assert!(second.is_err(), "the second request was dropped");
        // Give the queued task its turn.
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(ran.load(Ordering::SeqCst), 0, "the abandoned job ran");
        assert_eq!(service.available_permits(), 1);
    }

    fn has_pair(args: &[OsString], option: &str, value: &str) -> bool {
        args.windows(2)
            .any(|pair| pair[0] == option && pair[1] == value)
    }

    // spec: MED-040
    #[test]
    fn every_ffmpeg_run_decodes_the_four_accepted_codecs_only() {
        let input = Path::new("input.mp4");
        let args = Ffmpeg::base_args(&[], input);
        assert!(has_pair(&args, "-codec_whitelist", "h264,hevc,vp9,av1"));
        // An input option, so before the input.
        let whitelist = args.iter().position(|arg| arg == "-codec_whitelist");
        let file = args.iter().position(|arg| arg == "-i");
        assert!(whitelist < file, "{args:?}");
    }

    // spec: MED-040
    #[test]
    fn ffprobe_opens_no_decoder() {
        let args = Ffmpeg::probe_args(Path::new("input.mp4"));
        assert!(
            args.iter().any(|arg| arg == "-nofind_stream_info"),
            "{args:?}"
        );
    }

    // spec: MED-039
    #[tokio::test]
    async fn a_panicking_job_is_an_error_and_frees_its_permit() {
        let service = service(Duration::from_secs(5));
        let panicking: Job = Box::new(|_| Box::pin(async { panic!("the work panics") }));
        let result = service.run(panicking).await;
        assert!(
            matches!(result, Err(VideoJobError::Video(VideoError::Tool(_)))),
            "{result:?}"
        );
        assert_eq!(service.available_permits(), 1);
    }

    // spec: MED-041
    #[tokio::test]
    async fn the_check_names_a_missing_ffmpeg() {
        let ffmpeg = Ffmpeg::new("/nonexistent/ffmpeg", "ffprobe");
        let message = ffmpeg.check().await.unwrap_err();
        assert!(message.contains("FFMPEG_PATH"), "{message}");
        assert!(message.contains("brew install ffmpeg"), "{message}");
    }

    // spec: MED-041
    #[tokio::test]
    async fn the_check_accepts_the_installed_ffmpeg() {
        let program = |variable: &str, default: &str| {
            std::env::var(variable).unwrap_or_else(|_| default.to_string())
        };
        let ffmpeg = Ffmpeg::new(
            program("FFMPEG_PATH", "ffmpeg"),
            program("FFPROBE_PATH", "ffprobe"),
        );
        ffmpeg
            .check()
            .await
            .expect("install ffmpeg with libx264 (brew install ffmpeg / apt-get install ffmpeg)");
    }
}
