//! Media vocabulary: where a media sits on a card, what it is, and the shape of its variants.

use std::str::FromStr;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Where a media is shown on a card.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub enum Slot {
    Header,
    Avatar,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub enum MediaKind {
    Image,
    Video,
}

/// File format of one stored variant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub enum VariantFormat {
    Webp,
    Jpeg,
    Mp4,
}

/// A stored media word that is not one of the known values.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("unknown media value: {0:?}")]
pub struct ParseMediaError(pub String);

impl Slot {
    pub fn as_str(self) -> &'static str {
        match self {
            Slot::Header => "header",
            Slot::Avatar => "avatar",
        }
    }
}

impl FromStr for Slot {
    type Err = ParseMediaError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "header" => Ok(Slot::Header),
            "avatar" => Ok(Slot::Avatar),
            other => Err(ParseMediaError(other.to_string())),
        }
    }
}

impl MediaKind {
    pub fn as_str(self) -> &'static str {
        match self {
            MediaKind::Image => "image",
            MediaKind::Video => "video",
        }
    }
}

impl FromStr for MediaKind {
    type Err = ParseMediaError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "image" => Ok(MediaKind::Image),
            "video" => Ok(MediaKind::Video),
            other => Err(ParseMediaError(other.to_string())),
        }
    }
}

/// Largest accepted image upload, in bytes (MED-012).
pub const MAX_IMAGE_BYTES: usize = 10 << 20;
/// Largest accepted video upload, in bytes (MED-002).
pub const MAX_VIDEO_BYTES: usize = 25 << 20;
/// Largest accepted image, in pixels (MED-012).
pub const MAX_IMAGE_PIXELS: u64 = 40_000_000;
/// Longest accepted video: 30 s plus a 100 ms tolerance for container rounding (MED-002).
pub const MAX_VIDEO_DURATION: Duration = Duration::from_millis(30_100);

/// File format recognized from the content of an upload.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaFormat {
    Jpeg,
    Png,
    Webp,
    Mp4,
}

/// Recognizes a file from its leading bytes, never from its name or declared type (MED-008).
pub fn sniff(bytes: &[u8]) -> Option<MediaFormat> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(MediaFormat::Jpeg)
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some(MediaFormat::Png)
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(MediaFormat::Webp)
    } else if bytes.len() >= 8 && &bytes[4..8] == b"ftyp" {
        Some(MediaFormat::Mp4)
    } else {
        None
    }
}

/// Why the duration of an MP4 file could not be read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum Mp4Error {
    #[error("no moov box")]
    MissingMoov,
    #[error("no mvhd box in moov")]
    MissingMvhd,
    #[error("malformed MP4 box")]
    Malformed,
}

/// Reads the duration declared by the movie header (`moov` / `mvhd`), without decoding anything.
pub fn mp4_duration(bytes: &[u8]) -> Result<Duration, Mp4Error> {
    let moov = find_box(bytes, b"moov")?.ok_or(Mp4Error::MissingMoov)?;
    let mvhd = find_box(moov, b"mvhd")?.ok_or(Mp4Error::MissingMvhd)?;
    let (timescale, duration) = match mvhd.first() {
        Some(0) => (read_u32(mvhd, 12)?, u64::from(read_u32(mvhd, 16)?)),
        Some(1) => (read_u32(mvhd, 20)?, read_u64(mvhd, 24)?),
        _ => return Err(Mp4Error::Malformed),
    };
    if timescale == 0 {
        return Err(Mp4Error::Malformed);
    }
    let nanos = u128::from(duration) * 1_000_000_000 / u128::from(timescale);
    let nanos = u64::try_from(nanos).map_err(|_| Mp4Error::Malformed)?;
    Ok(Duration::from_nanos(nanos))
}

/// The payload of the first box of type `kind` among the sibling boxes of `data`.
fn find_box<'a>(data: &'a [u8], kind: &[u8; 4]) -> Result<Option<&'a [u8]>, Mp4Error> {
    let mut rest = data;
    while !rest.is_empty() {
        let size = u64::from(read_u32(rest, 0)?);
        let box_kind = rest.get(4..8).ok_or(Mp4Error::Malformed)?;
        let (header_len, size) = match size {
            0 => (8, rest.len() as u64),
            1 => (16, read_u64(rest, 8)?),
            n => (8, n),
        };
        let size = usize::try_from(size).map_err(|_| Mp4Error::Malformed)?;
        if size < header_len || size > rest.len() {
            return Err(Mp4Error::Malformed);
        }
        if box_kind == kind {
            return Ok(Some(&rest[header_len..size]));
        }
        rest = &rest[size..];
    }
    Ok(None)
}

fn read_u32(data: &[u8], at: usize) -> Result<u32, Mp4Error> {
    let raw = data.get(at..at + 4).ok_or(Mp4Error::Malformed)?;
    Ok(u32::from_be_bytes(raw.try_into().expect("4 bytes")))
}

fn read_u64(data: &[u8], at: usize) -> Result<u64, Mp4Error> {
    let raw = data.get(at..at + 8).ok_or(Mp4Error::Malformed)?;
    Ok(u64::from_be_bytes(raw.try_into().expect("8 bytes")))
}

/// One image file to produce from an upload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedVariant {
    /// File name inside the media folder: `s256.webp`, `w1080.webp`, ...
    pub name: String,
    /// Width of the produced image (its side, for a square avatar).
    pub width: u32,
    pub format: VariantFormat,
}

const AVATAR_WEBP_SIDES: [u32; 3] = [128, 256, 512];
const AVATAR_JPEG_SIDES: [u32; 2] = [256, 512];
const HEADER_WIDTHS: [u32; 3] = [640, 1080, 1920];

/// The variants to produce for an image of `width` × `height` pixels, never upscaling (MED-015):
/// each target size is capped at the original and duplicates are dropped.
pub fn plan_image_variants(slot: Slot, width: u32, height: u32) -> Vec<PlannedVariant> {
    match slot {
        Slot::Avatar => {
            let side = width.min(height);
            let mut planned = capped("s", "webp", &AVATAR_WEBP_SIDES, side, VariantFormat::Webp);
            planned.extend(capped(
                "s",
                "jpg",
                &AVATAR_JPEG_SIDES,
                side,
                VariantFormat::Jpeg,
            ));
            planned
        }
        Slot::Header => capped("w", "webp", &HEADER_WIDTHS, width, VariantFormat::Webp),
    }
}

fn capped(
    prefix: &str,
    extension: &str,
    targets: &[u32],
    original: u32,
    format: VariantFormat,
) -> Vec<PlannedVariant> {
    let mut planned: Vec<PlannedVariant> = Vec::new();
    for width in targets.iter().map(|&t| t.min(original)) {
        if width > 0 && planned.last().is_none_or(|last| last.width != width) {
            planned.push(PlannedVariant {
                name: format!("{prefix}{width}.{extension}"),
                width,
                format,
            });
        }
    }
    planned
}

#[cfg(test)]
mod tests {
    use super::*;

    fn boxed(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut out = ((payload.len() + 8) as u32).to_be_bytes().to_vec();
        out.extend_from_slice(kind);
        out.extend_from_slice(payload);
        out
    }

    fn mvhd_v1(timescale: u32, duration: u64) -> Vec<u8> {
        let mut payload = vec![1, 0, 0, 0];
        payload.extend_from_slice(&0u64.to_be_bytes());
        payload.extend_from_slice(&0u64.to_be_bytes());
        payload.extend_from_slice(&timescale.to_be_bytes());
        payload.extend_from_slice(&duration.to_be_bytes());
        payload.resize(112, 0);
        boxed(b"mvhd", &payload)
    }

    // spec: MED-013
    #[test]
    fn version_1_header_has_a_64_bit_duration() {
        let file = boxed(b"moov", &mvhd_v1(600, 6_000_000_000));
        assert_eq!(mp4_duration(&file), Ok(Duration::from_secs(10_000_000)));
    }

    // spec: MED-013
    #[test]
    fn moov_after_a_large_mdat_is_found() {
        let mut file = boxed(b"ftyp", b"isom\0\0\0\0isom");
        file.extend(boxed(b"mdat", &[0; 4096]));
        file.extend(boxed(b"moov", &mvhd_v1(1000, 1_500)));
        assert_eq!(mp4_duration(&file), Ok(Duration::from_millis(1_500)));
    }

    // spec: MED-013
    #[test]
    fn broken_boxes_are_errors_not_panics() {
        assert_eq!(mp4_duration(b""), Err(Mp4Error::MissingMoov));
        assert_eq!(
            mp4_duration(&boxed(b"moov", b"")),
            Err(Mp4Error::MissingMvhd)
        );
        // A box declaring more bytes than the file holds.
        assert_eq!(
            mp4_duration(b"\0\0\xFF\xFFmoovxxxx"),
            Err(Mp4Error::Malformed)
        );
        // A box smaller than its own header, which would loop forever if trusted.
        assert_eq!(mp4_duration(b"\0\0\0\x04moov"), Err(Mp4Error::Malformed));
        // A timescale of zero cannot give a duration.
        assert_eq!(
            mp4_duration(&boxed(b"moov", &mvhd_v1(0, 10))),
            Err(Mp4Error::Malformed)
        );
        // Truncated mvhd.
        assert_eq!(
            mp4_duration(&boxed(b"moov", &boxed(b"mvhd", &[0, 0, 0, 0, 1]))),
            Err(Mp4Error::Malformed)
        );
    }
}
