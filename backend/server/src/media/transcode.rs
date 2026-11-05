//! One header video, from the uploaded bytes to the files a media keeps: the served file, the
//! edit copy and the frame the placeholder is cut from (MED-003, MED-034, MED-037, MED-039,
//! MED-040). The checks and the plan come from the domain; the work is run by the
//! [`VideoService`] on its [`VideoProcessor`](super::video::VideoProcessor).

use std::path::Path;
use std::time::Duration;

use bytes::Bytes;
use cartouche_domain::{CropRect, PlanError, ProbeRejection, VideoLoop, check_probe, plan_video};

use super::video::{RenderJob, VideoError, VideoJobError, VideoProcessor, VideoService};

/// What to make of a video.
#[derive(Debug, Clone)]
pub struct TranscodeRequest {
    /// The duration the server read from the file (MED-013).
    pub duration: Duration,
    /// Proportions of the displayed frame; the largest centred 4:3 one when absent.
    pub crop: Option<CropRect>,
    pub video_loop: VideoLoop,
    pub poster_time: f64,
    /// Whether to make the edit copy too (an upload does, a re-frame does not).
    pub edit_copy: bool,
}

/// The edit copy of a video and its size.
#[derive(Debug, Clone)]
pub struct EditCopy {
    pub bytes: Bytes,
    pub width: u32,
    pub height: u32,
}

/// The files of a transcoded video.
#[derive(Debug, Clone)]
pub struct Transcoded {
    pub served: Bytes,
    pub edit_copy: Option<EditCopy>,
    /// The whole displayed frame at the poster time, as a PNG.
    pub poster_frame: Bytes,
    /// The crop actually used, to be stored with the media.
    pub crop: CropRect,
}

/// What the domain refuses about a probed video or its crop, decided inside the job.
#[derive(Debug, Clone, Copy)]
enum Refusal {
    UnsupportedCodec,
    TooLarge,
    Crop,
}

/// Why a video was not transcoded.
#[derive(Debug, thiserror::Error)]
pub enum TranscodeError {
    /// A codec the server does not accept (MED-040).
    #[error("unsupported video codec")]
    UnsupportedCodec,
    /// A side longer than the server accepts (MED-039).
    #[error("video too large")]
    TooLarge,
    /// The crop is not 4:3, outside the frame, or too narrow (MED-026, MED-035).
    #[error("invalid crop")]
    Crop,
    /// The file is not a video the tools can read (MED-039).
    #[error("unreadable video: {0}")]
    Unreadable(String),
    /// The job ran past its deadline (MED-039).
    #[error("video processing timed out")]
    Timeout,
    /// The tools failed for a reason that is not the file's.
    #[error("video processing failed: {0}")]
    Failed(String),
}

impl From<Refusal> for TranscodeError {
    fn from(refusal: Refusal) -> Self {
        match refusal {
            Refusal::UnsupportedCodec => TranscodeError::UnsupportedCodec,
            Refusal::TooLarge => TranscodeError::TooLarge,
            Refusal::Crop => TranscodeError::Crop,
        }
    }
}

impl From<VideoJobError> for TranscodeError {
    fn from(error: VideoJobError) -> Self {
        match error {
            VideoJobError::Timeout => TranscodeError::Timeout,
            VideoJobError::Video(VideoError::Unreadable(message)) => {
                TranscodeError::Unreadable(message)
            }
            VideoJobError::Video(VideoError::Tool(message)) => TranscodeError::Failed(message),
        }
    }
}

/// Probes, checks and plans `input`, transcodes it and reads the outputs back, in a temp dir
/// that goes with the job. Runs under the service's permit and deadline.
pub async fn transcode(
    service: &VideoService,
    input: Bytes,
    request: TranscodeRequest,
) -> Result<Transcoded, TranscodeError> {
    let outcome = service
        .run(move |processor| {
            Box::pin(async move { run_job(processor.as_ref(), input, request).await })
        })
        .await?;
    Ok(outcome?)
}

async fn run_job(
    processor: &dyn VideoProcessor,
    input: Bytes,
    request: TranscodeRequest,
) -> Result<Result<Transcoded, Refusal>, VideoError> {
    let dir = tempfile::tempdir().map_err(tool_failure)?;
    let input_path = dir.path().join("input.mp4");
    tokio::fs::write(&input_path, &input)
        .await
        .map_err(tool_failure)?;

    let probe = processor.probe(&input_path).await?;
    if let Err(rejection) = check_probe(&probe) {
        return Ok(Err(match rejection {
            ProbeRejection::UnsupportedCodec => Refusal::UnsupportedCodec,
            ProbeRejection::TooLarge => Refusal::TooLarge,
        }));
    }
    let planned = plan_video(
        &probe,
        request.duration,
        request.crop,
        request.video_loop,
        request.poster_time,
    );
    let (plan, crop) = match planned {
        Ok(planned) => planned,
        Err(PlanError::Crop) => return Ok(Err(Refusal::Crop)),
    };

    let edit_copy_size = plan.edit_copy;
    let outputs = processor
        .render(&RenderJob {
            input: input_path,
            out_dir: dir.path().to_path_buf(),
            plan,
            edit_copy: request.edit_copy,
        })
        .await?;

    let edit_copy = match outputs.edit_copy {
        Some(path) => Some(EditCopy {
            bytes: read(&path).await?,
            width: edit_copy_size.0,
            height: edit_copy_size.1,
        }),
        None => None,
    };
    Ok(Ok(Transcoded {
        served: read(&outputs.served).await?,
        edit_copy,
        poster_frame: read(&outputs.poster_frame).await?,
        crop,
    }))
}

async fn read(path: &Path) -> Result<Bytes, VideoError> {
    tokio::fs::read(path)
        .await
        .map(Bytes::from)
        .map_err(tool_failure)
}

fn tool_failure(error: std::io::Error) -> VideoError {
    VideoError::Tool(error.to_string())
}
