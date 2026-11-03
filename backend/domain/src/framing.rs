//! Framing of a media: the crop rectangle, a header video's loop and poster time, and the
//! pixel rectangle cut from the source (MED-015, MED-026, MED-028, MED-033).

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::media::Slot;

/// Tolerance on the crop's shape, as a fraction of the target ratio (MED-026).
const RATIO_TOLERANCE: f64 = 0.01;
/// Slack on the edges of the unit square and on the end of a video, for rounding.
const EDGE_EPSILON: f64 = 1e-9;
const DURATION_TOLERANCE: f64 = 0.05;
/// Shortest loop, unless it is the whole video (MED-028).
const MIN_LOOP_SECONDS: f64 = 1.0;

/// A rectangle in proportions of the source image, from 0 to 1 (MED-026).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub struct CropRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// The part of a header video that plays in a loop, in seconds (MED-028).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub struct VideoLoop {
    pub start: f64,
    pub end: f64,
}

/// How a media is framed: its crop and, for a header video, its loop and poster time.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub struct Framing {
    pub crop: CropRect,
    #[serde(rename = "loop", skip_serializing_if = "Option::is_none")]
    pub video_loop: Option<VideoLoop>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub poster_time: Option<f64>,
}

/// A rectangle in pixels of the source.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PixelRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// Width over height of the crop of `slot`: 4:3 for the header, square for the avatar.
fn target_ratio(slot: Slot) -> f64 {
    match slot {
        Slot::Header => 4.0 / 3.0,
        Slot::Avatar => 1.0,
    }
}

/// The largest centered rectangle of the shape of `slot` in a `width` × `height` source
/// (MED-026, MED-033).
pub fn default_crop(slot: Slot, width: u32, height: u32) -> CropRect {
    let (width_px, height_px) = (f64::from(width), f64::from(height));
    let ratio = target_ratio(slot);
    if width_px / height_px > ratio {
        let crop_width = height_px * ratio / width_px;
        CropRect {
            x: (1.0 - crop_width) / 2.0,
            y: 0.0,
            width: crop_width,
            height: 1.0,
        }
    } else {
        let crop_height = width_px / ratio / height_px;
        CropRect {
            x: 0.0,
            y: (1.0 - crop_height) / 2.0,
            width: 1.0,
            height: crop_height,
        }
    }
}

/// Checks a crop against the unit square and the shape of `slot`, measured in pixels of the
/// `width` × `height` source (MED-026).
pub fn check_crop(
    crop: &CropRect,
    slot: Slot,
    width: u32,
    height: u32,
) -> Result<(), &'static str> {
    let values = [crop.x, crop.y, crop.width, crop.height];
    let inside = values.iter().all(|v| v.is_finite())
        && crop.x >= 0.0
        && crop.y >= 0.0
        && crop.width > 0.0
        && crop.height > 0.0
        && crop.x + crop.width <= 1.0 + EDGE_EPSILON
        && crop.y + crop.height <= 1.0 + EDGE_EPSILON;
    if !inside {
        return Err("invalid_crop");
    }
    let ratio = (crop.width * f64::from(width)) / (crop.height * f64::from(height));
    if (ratio / target_ratio(slot) - 1.0).abs() > RATIO_TOLERANCE {
        return Err("invalid_crop");
    }
    Ok(())
}

/// The crop in whole pixels, always inside the source; exactly square for an avatar (MED-026).
pub fn crop_pixels(crop: &CropRect, width: u32, height: u32) -> PixelRect {
    let scaled = |proportion: f64, size: u32| (proportion * f64::from(size)).round() as u32;
    let x = scaled(crop.x, width).min(width - 1);
    let y = scaled(crop.y, height).min(height - 1);
    PixelRect {
        x,
        y,
        width: scaled(crop.width, width).clamp(1, width - x),
        height: scaled(crop.height, height).clamp(1, height - y),
    }
}

/// The loop of a video must lie inside it and last a second, unless it is the whole video
/// (MED-028).
pub fn check_loop(lp: &VideoLoop, duration: Duration) -> Result<(), &'static str> {
    let d = duration.as_secs_f64();
    let sane = lp.start.is_finite()
        && lp.end.is_finite()
        && lp.start >= 0.0
        && lp.start < lp.end
        && lp.end <= d + DURATION_TOLERANCE;
    let long_enough = lp.end - lp.start >= MIN_LOOP_SECONDS
        || (lp.start == 0.0 && lp.end >= d - DURATION_TOLERANCE);
    if sane && long_enough {
        Ok(())
    } else {
        Err("invalid_loop")
    }
}

/// The poster time must lie inside the video (MED-028).
pub fn check_poster_time(t: f64, duration: Duration) -> Result<(), &'static str> {
    if t.is_finite() && t >= 0.0 && t <= duration.as_secs_f64() + DURATION_TOLERANCE {
        Ok(())
    } else {
        Err("invalid_poster_time")
    }
}

/// The whole video (MED-028, MED-033).
pub fn default_loop(duration: Duration) -> VideoLoop {
    VideoLoop {
        start: 0.0,
        end: duration.as_secs_f64(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn crop(x: f64, y: f64, width: f64, height: f64) -> CropRect {
        CropRect {
            x,
            y,
            width,
            height,
        }
    }

    // spec: MED-026
    #[test]
    fn the_default_crop_is_the_largest_centered_rectangle() {
        let header = default_crop(Slot::Header, 1600, 900);
        assert_eq!(header, crop(0.125, 0.0, 0.75, 1.0));

        let avatar = default_crop(Slot::Avatar, 900, 1600);
        assert_eq!(avatar, crop(0.0, 0.21875, 1.0, 0.5625));

        // Already the right shape: the whole image.
        assert_eq!(
            default_crop(Slot::Header, 800, 600),
            crop(0.0, 0.0, 1.0, 1.0)
        );
        assert_eq!(check_crop(&header, Slot::Header, 1600, 900), Ok(()));
        assert_eq!(check_crop(&avatar, Slot::Avatar, 900, 1600), Ok(()));
    }

    // spec: MED-026
    #[test]
    fn invalid_crops_are_refused() {
        let refused = Err("invalid_crop");
        let header = |c: CropRect| check_crop(&c, Slot::Header, 1200, 1200);
        // 0.5 × 0.375 of a square source is 4:3.
        assert_eq!(header(crop(0.0, 0.0, 0.5, 0.375)), Ok(()));
        assert_eq!(header(crop(0.6, 0.0, 0.5, 0.375)), refused);
        assert_eq!(header(crop(0.0, 0.7, 0.5, 0.375)), refused);
        assert_eq!(header(crop(-0.1, 0.0, 0.5, 0.375)), refused);
        assert_eq!(header(crop(0.0, -0.1, 0.5, 0.375)), refused);
        assert_eq!(header(crop(0.0, 0.0, 0.0, 0.0)), refused);
        assert_eq!(header(crop(0.0, 0.0, f64::NAN, 0.375)), refused);
        assert_eq!(header(crop(0.0, 0.0, f64::INFINITY, 0.375)), refused);
        // 2 % off the ratio is refused, 0.9 % off passes.
        assert_eq!(header(crop(0.0, 0.0, 0.5 * 1.02, 0.375)), refused);
        assert_eq!(header(crop(0.0, 0.0, 0.5 * 1.009, 0.375)), Ok(()));
        // The ratio is measured in pixels: a square crop of a wide source is not 4:3.
        assert_eq!(
            check_crop(&crop(0.0, 0.0, 0.5, 0.5), Slot::Avatar, 1200, 1200),
            Ok(())
        );
        assert_eq!(
            check_crop(&crop(0.0, 0.0, 0.5, 0.5), Slot::Avatar, 1600, 900),
            refused
        );
    }

    // spec: MED-026
    #[test]
    fn pixel_crop_rounds_and_stays_inside() {
        assert_eq!(
            crop_pixels(&crop(0.0, 0.0, 0.5, 0.5), 1600, 1200),
            PixelRect {
                x: 0,
                y: 0,
                width: 800,
                height: 600
            }
        );
        let edge = crop_pixels(&crop(0.3333, 0.0, 0.6667, 1.0), 1001, 751);
        assert!(edge.x + edge.width <= 1001);
        assert!(edge.y + edge.height <= 751);
        assert!(edge.width >= 1 && edge.height >= 1);
        // Rounding up past the edge is pulled back.
        let touching = crop_pixels(&crop(0.5004, 0.0, 0.4996, 1.0), 1000, 100);
        assert_eq!(touching.x + touching.width, 1000);
        // An avatar is exactly square.
        let square = crop_pixels(&crop(0.0, 0.0, 0.5003, 0.5), 999, 1000);
        assert_eq!(square.width, square.height);
    }

    // spec: MED-028
    #[test]
    fn loops_and_poster_times_are_checked_against_the_duration() {
        let ten = Duration::from_secs(10);
        let refused = Err("invalid_loop");
        assert_eq!(
            check_loop(
                &VideoLoop {
                    start: 0.0,
                    end: 10.0
                },
                ten
            ),
            Ok(())
        );
        assert_eq!(
            check_loop(
                &VideoLoop {
                    start: 5.0,
                    end: 5.5
                },
                ten
            ),
            refused
        );
        assert_eq!(
            check_loop(
                &VideoLoop {
                    start: 9.0,
                    end: 10.04
                },
                ten
            ),
            Ok(())
        );
        assert_eq!(
            check_loop(
                &VideoLoop {
                    start: 0.0,
                    end: 10.2
                },
                ten
            ),
            refused
        );
        assert_eq!(
            check_loop(
                &VideoLoop {
                    start: 3.0,
                    end: 3.0
                },
                ten
            ),
            refused
        );
        assert_eq!(
            check_loop(
                &VideoLoop {
                    start: -1.0,
                    end: 4.0
                },
                ten
            ),
            refused
        );
        assert_eq!(
            check_loop(
                &VideoLoop {
                    start: 0.0,
                    end: f64::NAN
                },
                ten
            ),
            refused
        );
        // A video shorter than a second loops over its whole length.
        let short = Duration::from_millis(600);
        assert_eq!(
            check_loop(
                &VideoLoop {
                    start: 0.0,
                    end: 0.6
                },
                short
            ),
            Ok(())
        );
        assert_eq!(
            check_loop(
                &VideoLoop {
                    start: 0.1,
                    end: 0.6
                },
                short
            ),
            refused
        );

        assert_eq!(check_poster_time(0.0, ten), Ok(()));
        assert_eq!(check_poster_time(10.04, ten), Ok(()));
        assert_eq!(check_poster_time(12.0, ten), Err("invalid_poster_time"));
        assert_eq!(check_poster_time(-0.1, ten), Err("invalid_poster_time"));
        assert_eq!(check_poster_time(f64::NAN, ten), Err("invalid_poster_time"));

        assert_eq!(
            default_loop(ten),
            VideoLoop {
                start: 0.0,
                end: 10.0
            }
        );
    }

    // spec: MED-028
    #[test]
    fn framing_serializes_the_loop_key_and_skips_absent_parts() {
        let framing = Framing {
            crop: crop(0.0, 0.0, 1.0, 1.0),
            video_loop: Some(VideoLoop {
                start: 1.0,
                end: 4.0,
            }),
            poster_time: None,
        };
        let json = serde_json::to_value(framing).unwrap();
        assert_eq!(json["loop"]["end"], 4.0);
        assert!(json.get("poster_time").is_none());
        assert!(json.get("video_loop").is_none());
    }
}
