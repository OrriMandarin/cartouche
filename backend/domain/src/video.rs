//! Planning of a header video's transcoding: what the server checks on the probe of an
//! uploaded file, the sizes of the served file and of the edit copy, and the part of the video
//! kept (MED-002, MED-003, MED-026, MED-034, MED-035, MED-037, MED-039, MED-040). This module
//! knows nothing of ffmpeg: the adapter turns a [`VideoPlan`] into a command line.

use std::time::Duration;

use crate::framing::{CropRect, PixelRect, VideoLoop, check_crop, crop_pixels, default_crop};
use crate::media::Slot;

/// Longest side of a video accepted, as displayed, in pixels (MED-039).
pub const MAX_VIDEO_SIDE: u32 = 4096;
/// Widest served file, in pixels (MED-035).
pub const SERVED_MAX_WIDTH: u32 = 1280;
/// Longest side of the edit copy, in pixels (MED-037).
pub const EDIT_COPY_MAX_SIDE: u32 = 960;
/// Narrowest crop of a video's frame, in pixels (MED-035).
pub const MIN_VIDEO_CROP_WIDTH: u32 = 16;
/// How long the processing of a video, waiting included, may last (MED-039).
pub const VIDEO_PROCESSING_DEADLINE: Duration = Duration::from_secs(120);

/// The codecs of a video's first video stream that are accepted, as ffprobe names them
/// (MED-040).
const ACCEPTED_CODECS: [&str; 4] = ["h264", "hevc", "vp9", "av1"];
/// A poster time this close to the end, or past it, is the video's last frame (MED-003).
const LAST_FRAME_WINDOW: f64 = 0.05;

/// What the probe of an uploaded video reports about its first video stream. `width` and
/// `height` are those of the frame as displayed: the adapter has applied the rotation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VideoProbe {
    pub width: u32,
    pub height: u32,
    pub codec: String,
}

/// Why a probed video is refused (MED-039, MED-040).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbeRejection {
    /// A codec other than H.264, H.265, VP9 or AV1.
    UnsupportedCodec,
    /// A side, as displayed, longer than [`MAX_VIDEO_SIDE`].
    TooLarge,
}

/// Checks the codec and the size of a probed video. A zero side never gets here: the adapter
/// reports such a file unreadable.
pub fn check_probe(probe: &VideoProbe) -> Result<(), ProbeRejection> {
    if !ACCEPTED_CODECS.contains(&probe.codec.as_str()) {
        return Err(ProbeRejection::UnsupportedCodec);
    }
    if probe.width > MAX_VIDEO_SIDE || probe.height > MAX_VIDEO_SIDE {
        return Err(ProbeRejection::TooLarge);
    }
    Ok(())
}

/// Size of the served file for a crop `crop_width_px` wide: 4:3, the width rounded down to a
/// multiple of 8 and at most [`SERVED_MAX_WIDTH`], never enlarged. `None` when the crop is
/// narrower than [`MIN_VIDEO_CROP_WIDTH`] (MED-035).
pub fn served_size(crop_width_px: u32) -> Option<(u32, u32)> {
    if crop_width_px < MIN_VIDEO_CROP_WIDTH {
        return None;
    }
    let width = crop_width_px.min(SERVED_MAX_WIDTH) / 8 * 8;
    Some((width, width * 3 / 4))
}

/// Size of the edit copy of a `width` × `height` video: the longer side reduced to
/// [`EDIT_COPY_MAX_SIDE`] when it is longer, the other side in proportion, both rounded
/// down to an even number (MED-037). The source dimensions must be non-zero.
pub fn edit_copy_size(width: u32, height: u32) -> (u32, u32) {
    let longer = width.max(height);
    let scale = |side: u32| {
        if longer <= EDIT_COPY_MAX_SIDE {
            side
        } else {
            let scaled = u64::from(side) * u64::from(EDIT_COPY_MAX_SIDE) + u64::from(longer) / 2;
            (scaled / u64::from(longer)) as u32
        }
    };
    let even = |side: u32| (side & !1).max(2);
    (even(scale(width)), even(scale(height)))
}

/// Where the placeholder image is taken in the video (MED-003).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PosterSeek {
    /// The frame at this time, in seconds.
    At(f64),
    /// The video's last frame.
    LastFrame,
}

/// The frame to extract for `poster_time` in a video lasting `duration` seconds (MED-003).
pub fn poster_seek(poster_time: f64, duration: f64) -> PosterSeek {
    if poster_time >= duration - LAST_FRAME_WINDOW {
        PosterSeek::LastFrame
    } else {
        PosterSeek::At(poster_time)
    }
}

/// Everything the adapter needs to transcode one video (MED-034, MED-035, MED-037).
#[derive(Debug, Clone, PartialEq)]
pub struct VideoPlan {
    /// The area kept, in pixels of the frame as displayed.
    pub crop: PixelRect,
    /// Size of the served file.
    pub output: (u32, u32),
    /// Start of the part kept, in seconds, and its length (the loop, MED-028).
    pub trim_start: f64,
    pub trim_length: f64,
    /// The frame of the placeholder image.
    pub poster: PosterSeek,
    /// Size of the edit copy.
    pub edit_copy: (u32, u32),
    /// The uploaded video's duration, in seconds.
    pub duration: f64,
}

/// A crop that cannot give a served file (MED-026, MED-035).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanError {
    /// Not 4:3 or outside the frame, or narrower than [`MIN_VIDEO_CROP_WIDTH`] pixels.
    Crop,
}

/// Plans the transcoding of a probed video. The crop is measured on the frame as displayed:
/// without one, the largest centred 4:3 rectangle is taken. `video_loop` and `poster_time`
/// are already checked against `duration` (MED-028). Returns the crop actually used, to be
/// stored with the media.
pub fn plan_video(
    probe: &VideoProbe,
    duration: Duration,
    crop: Option<CropRect>,
    video_loop: VideoLoop,
    poster_time: f64,
) -> Result<(VideoPlan, CropRect), PlanError> {
    let (width, height) = (probe.width, probe.height);
    let crop = crop.unwrap_or_else(|| default_crop(Slot::Header, width, height));
    check_crop(&crop, Slot::Header, width, height).map_err(|_| PlanError::Crop)?;
    let pixels = crop_pixels(&crop, Slot::Header, width, height);
    let output = served_size(pixels.width).ok_or(PlanError::Crop)?;
    let duration = duration.as_secs_f64();
    let plan = VideoPlan {
        crop: pixels,
        output,
        trim_start: video_loop.start,
        trim_length: video_loop.end - video_loop.start,
        poster: poster_seek(poster_time, duration),
        edit_copy: edit_copy_size(width, height),
        duration,
    };
    Ok((plan, crop))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn probe(width: u32, height: u32) -> VideoProbe {
        VideoProbe {
            width,
            height,
            codec: "h264".to_string(),
        }
    }

    fn whole(seconds: f64) -> VideoLoop {
        VideoLoop {
            start: 0.0,
            end: seconds,
        }
    }

    // spec: MED-035
    #[test]
    fn the_served_file_is_4_3_multiple_of_8_and_never_enlarged() {
        assert_eq!(served_size(1440), Some((1280, 960)));
        assert_eq!(served_size(480), Some((480, 360)));
        assert_eq!(served_size(1000), Some((1000, 750)));
        assert_eq!(served_size(17), Some((16, 12)));
        assert_eq!(served_size(16), Some((16, 12)));
        assert_eq!(served_size(15), None);
        assert_eq!(served_size(0), None);
    }

    // spec: MED-037
    #[test]
    fn the_edit_copy_long_side_is_at_most_960_with_even_sides() {
        assert_eq!(edit_copy_size(1920, 1080), (960, 540));
        assert_eq!(edit_copy_size(1080, 1920), (540, 960));
        assert_eq!(edit_copy_size(1366, 768), (960, 540));
        assert_eq!(edit_copy_size(640, 360), (640, 360));
        assert_eq!(edit_copy_size(641, 361), (640, 360));
    }

    // spec: MED-040
    #[test]
    fn only_h264_hevc_vp9_and_av1_are_accepted() {
        for codec in ["h264", "hevc", "vp9", "av1"] {
            let accepted = VideoProbe {
                codec: codec.to_string(),
                ..probe(640, 480)
            };
            assert_eq!(check_probe(&accepted), Ok(()), "{codec}");
        }
        for codec in ["mpeg4", "prores", ""] {
            let refused = VideoProbe {
                codec: codec.to_string(),
                ..probe(640, 480)
            };
            assert_eq!(
                check_probe(&refused),
                Err(ProbeRejection::UnsupportedCodec),
                "{codec:?}"
            );
        }
    }

    // spec: MED-039
    #[test]
    fn a_side_longer_than_4096_is_too_large() {
        assert_eq!(check_probe(&probe(4096, 2160)), Ok(()));
        assert_eq!(
            check_probe(&probe(4097, 2160)),
            Err(ProbeRejection::TooLarge)
        );
        assert_eq!(
            check_probe(&probe(2160, 4097)),
            Err(ProbeRejection::TooLarge)
        );
    }

    // spec: MED-026
    #[test]
    fn a_video_crop_is_checked_on_the_displayed_frame() {
        let crop = CropRect {
            x: 0.0,
            y: 0.25,
            width: 1.0,
            height: 0.421875,
        };
        // A rotated clip: stored 1920 × 1080, displayed 1080 × 1920.
        let (plan, used) = plan_video(
            &probe(1080, 1920),
            Duration::from_secs(4),
            Some(crop),
            whole(4.0),
            0.0,
        )
        .expect("4:3 on the displayed frame");
        assert_eq!(used, crop);
        assert_eq!(plan.crop.width, 1080);
        assert_eq!(plan.output, (1080, 810));
        // The same crop on the stored frame would not be 4:3.
        assert_eq!(
            plan_video(
                &probe(1920, 1080),
                Duration::from_secs(4),
                Some(crop),
                whole(4.0),
                0.0
            )
            .map(|(plan, _)| plan),
            Err(PlanError::Crop)
        );
    }

    // spec: MED-026
    #[test]
    fn without_a_crop_the_video_takes_the_largest_centred_4_3() {
        let (plan, crop) = plan_video(
            &probe(1920, 1080),
            Duration::from_secs(4),
            None,
            whole(4.0),
            0.0,
        )
        .unwrap();
        assert_eq!(
            plan.crop,
            PixelRect {
                x: 240,
                y: 0,
                width: 1440,
                height: 1080
            }
        );
        assert_eq!(plan.output, (1280, 960));
        assert_eq!(plan.edit_copy, (960, 540));
        assert_eq!(crop, default_crop(Slot::Header, 1920, 1080));
    }

    // spec: MED-035
    #[test]
    fn a_crop_narrower_than_16_pixels_is_refused() {
        let crop = CropRect {
            x: 0.0,
            y: 0.0,
            width: 15.0 / 1920.0,
            height: 11.25 / 1080.0,
        };
        assert_eq!(
            plan_video(
                &probe(1920, 1080),
                Duration::from_secs(4),
                Some(crop),
                whole(4.0),
                0.0
            )
            .map(|(plan, _)| plan),
            Err(PlanError::Crop)
        );
    }

    // spec: MED-003
    #[test]
    fn the_poster_at_or_past_the_end_is_the_last_frame() {
        assert_eq!(poster_seek(2.0, 2.0), PosterSeek::LastFrame);
        assert_eq!(poster_seek(1.96, 2.0), PosterSeek::LastFrame);
        assert_eq!(poster_seek(1.9, 2.0), PosterSeek::At(1.9));
        assert_eq!(poster_seek(0.0, 2.0), PosterSeek::At(0.0));
    }

    // spec: MED-034
    #[test]
    fn the_trim_is_the_loop() {
        let video_loop = VideoLoop {
            start: 1.0,
            end: 3.0,
        };
        let (plan, _) = plan_video(
            &probe(1920, 1080),
            Duration::from_secs(4),
            None,
            video_loop,
            1.5,
        )
        .unwrap();
        assert_eq!(plan.trim_start, 1.0);
        assert_eq!(plan.trim_length, 2.0);
        assert_eq!(plan.poster, PosterSeek::At(1.5));
        assert_eq!(plan.duration, 4.0);
    }
}
