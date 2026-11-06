//! A video processor that runs no program: the tests of the routes and of the job limiter use
//! it instead of ffmpeg (MED-039).

use std::io::Cursor;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use cartouche_domain::VideoProbe;
use image::{ImageFormat, Rgb, RgbImage};

use crate::media::video::{RenderJob, RenderOutputs, VideoError, VideoProcessor};

/// Answers `probe` with a configured result and `render` with files whose bytes name the
/// plan, e.g. `served 1280x960 trim 1.000+2.000`. Cloning shares the recorded jobs.
#[derive(Clone)]
pub struct StubVideoProcessor {
    probe: Result<VideoProbe, String>,
    delay: Arc<Mutex<Duration>>,
    jobs: Arc<Mutex<Vec<RenderJob>>>,
}

impl Default for StubVideoProcessor {
    /// A 1920 x 1080 `h264` video, no delay.
    fn default() -> Self {
        Self {
            probe: Ok(VideoProbe {
                width: 1920,
                height: 1080,
                codec: "h264".to_string(),
            }),
            delay: Arc::default(),
            jobs: Arc::default(),
        }
    }
}

impl StubVideoProcessor {
    pub fn with_probe(mut self, probe: VideoProbe) -> Self {
        self.probe = Ok(probe);
        self
    }

    /// `probe` fails as an unreadable file with this message.
    pub fn with_unreadable(mut self, message: &str) -> Self {
        self.probe = Err(message.to_string());
        self
    }

    /// Each `probe` and `render` call sleeps this long first.
    pub fn with_delay(self, delay: Duration) -> Self {
        self.set_delay(delay);
        self
    }

    /// Changes the delay of every clone, for the calls that follow.
    pub fn set_delay(&self, delay: Duration) {
        *self.delay.lock().expect("not poisoned") = delay;
    }

    async fn wait(&self) {
        let delay = *self.delay.lock().expect("not poisoned");
        tokio::time::sleep(delay).await;
    }

    /// The jobs `render` has seen, in order.
    pub fn jobs(&self) -> Vec<RenderJob> {
        self.jobs.lock().expect("not poisoned").clone()
    }

    fn poster_png(&self) -> Result<Vec<u8>, VideoError> {
        let (width, height) = self
            .probe
            .as_ref()
            .map(|probe| (probe.width, probe.height))
            .map_err(|message| VideoError::Unreadable(message.clone()))?;
        let image = RgbImage::from_fn(width, height, |x, y| {
            Rgb([
                (x * 255 / width.max(1)) as u8,
                (y * 255 / height.max(1)) as u8,
                128,
            ])
        });
        let mut bytes = Vec::new();
        image
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .map_err(|error| VideoError::Tool(error.to_string()))?;
        Ok(bytes)
    }
}

#[async_trait]
impl VideoProcessor for StubVideoProcessor {
    async fn probe(&self, _input: &Path) -> Result<VideoProbe, VideoError> {
        self.wait().await;
        self.probe.clone().map_err(VideoError::Unreadable)
    }

    async fn render(&self, job: &RenderJob) -> Result<RenderOutputs, VideoError> {
        self.wait().await;
        self.jobs.lock().expect("not poisoned").push(job.clone());
        let plan = &job.plan;
        let write = |name: &str, bytes: Vec<u8>| {
            let path = job.out_dir.join(name);
            std::fs::write(&path, bytes)
                .map(|()| path)
                .map_err(|error| VideoError::Tool(error.to_string()))
        };
        let served = write(
            "video.mp4",
            format!(
                "served {}x{} trim {:.3}+{:.3}",
                plan.output.0, plan.output.1, plan.trim_start, plan.trim_length
            )
            .into_bytes(),
        )?;
        let edit_copy = if job.edit_copy {
            Some(write(
                "edit-copy.mp4",
                format!("edit copy {}x{}", plan.edit_copy.0, plan.edit_copy.1).into_bytes(),
            )?)
        } else {
            None
        };
        let poster_frame = write("poster.png", self.poster_png()?)?;
        Ok(RenderOutputs {
            served,
            edit_copy,
            poster_frame,
        })
    }
}
