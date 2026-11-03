//! Media vocabulary: where a media sits on a card, what it is, and the shape of its variants.

use std::str::FromStr;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

use crate::validation::FieldError;

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
    } else if is_mp4_ftyp(bytes) {
        Some(MediaFormat::Mp4)
    } else {
        None
    }
}

/// Brands of the `ftyp` box that mark an MP4 video (MED-022).
const MP4_BRANDS: [&[u8; 4]; 11] = [
    b"isom", b"iso2", b"iso3", b"iso4", b"iso5", b"iso6", b"mp41", b"mp42", b"avc1", b"M4V ",
    b"dash",
];

/// Whether a main brand belongs to another format that shares the `ftyp` box: QuickTime, 3GP,
/// audio-only MP4, HEIF images (MED-022).
fn is_other_format_brand(brand: &[u8; 4]) -> bool {
    brand.starts_with(b"3gp")
        || brand.starts_with(b"3g2")
        || [
            b"qt  ", b"M4A ", b"M4B ", b"heic", b"heix", b"mif1", b"msf1", b"avif",
        ]
        .contains(&brand)
}

/// Reads the leading `ftyp` box: true when its main brand or one of its compatible brands is an
/// MP4 one and its main brand is not that of another format (MED-022).
pub fn is_mp4_ftyp(bytes: &[u8]) -> bool {
    let Some(size) = bytes
        .get(..4)
        .map(|raw| u32::from_be_bytes(raw.try_into().expect("4 bytes")) as usize)
    else {
        return false;
    };
    if bytes.get(4..8) != Some(b"ftyp") || size < 16 || size > bytes.len() {
        return false;
    }
    let major: &[u8; 4] = bytes[8..12].try_into().expect("4 bytes");
    if is_other_format_brand(major) {
        return false;
    }
    let (compatible, _) = bytes[16..size].as_chunks::<4>();
    std::iter::once(major)
        .chain(compatible)
        .any(|brand| MP4_BRANDS.contains(&brand))
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

/// Why an uploaded file is refused before any processing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UploadRejection {
    /// Not a JPEG, PNG, WebP or usable MP4 file, or a video for a slot that takes images only.
    Unsupported,
    /// Heavier than the limit of its kind.
    TooLarge,
    /// A video longer than [`MAX_VIDEO_DURATION`].
    VideoTooLong,
}

/// Decides what an uploaded file is for `slot` from its content alone (MED-002, MED-008,
/// MED-012, MED-013). An `ftyp` file is a video only if it has a readable movie header: HEIC
/// and AVIF photos share the `ftyp` box but have none.
pub fn classify_upload(bytes: &[u8], slot: Slot) -> Result<MediaKind, UploadRejection> {
    match sniff(bytes) {
        Some(MediaFormat::Jpeg | MediaFormat::Png | MediaFormat::Webp) => {
            if bytes.len() > MAX_IMAGE_BYTES {
                return Err(UploadRejection::TooLarge);
            }
            Ok(MediaKind::Image)
        }
        Some(MediaFormat::Mp4) if slot == Slot::Header => {
            let duration = mp4_duration(bytes).map_err(|_| UploadRejection::Unsupported)?;
            if bytes.len() > MAX_VIDEO_BYTES {
                Err(UploadRejection::TooLarge)
            } else if duration > MAX_VIDEO_DURATION {
                Err(UploadRejection::VideoTooLong)
            } else {
                Ok(MediaKind::Video)
            }
        }
        _ => Err(UploadRejection::Unsupported),
    }
}

/// Field errors (`invalid_media`) for a header or avatar that is not one of the card's own
/// media in the matching slot (MED-018, MED-020). `card_media` lists the card's media.
pub fn invalid_media_refs(
    header: Option<Uuid>,
    avatar: Option<Uuid>,
    card_media: &[(Uuid, Slot)],
) -> Vec<FieldError> {
    [
        ("header_media_id", header, Slot::Header),
        ("avatar_media_id", avatar, Slot::Avatar),
    ]
    .into_iter()
    .filter(|(_, id, slot)| id.is_some_and(|id| !card_media.contains(&(id, *slot))))
    .map(|(field, _, _)| FieldError::new(field, "invalid_media"))
    .collect()
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

    fn mp4_of(duration_ms: u32) -> Vec<u8> {
        let mut mvhd = vec![0, 0, 0, 0];
        mvhd.extend_from_slice(&[0; 8]);
        mvhd.extend_from_slice(&1000u32.to_be_bytes());
        mvhd.extend_from_slice(&duration_ms.to_be_bytes());
        mvhd.resize(100, 0);
        let mut file = boxed(b"ftyp", b"isom\0\0\0\0isom");
        file.extend(boxed(b"moov", &boxed(b"mvhd", &mvhd)));
        file
    }

    fn ftyp(major: &[u8; 4], compatible: &[&[u8; 4]]) -> Vec<u8> {
        let mut payload = major.to_vec();
        payload.extend_from_slice(&[0; 4]);
        for brand in compatible {
            payload.extend_from_slice(*brand);
        }
        boxed(b"ftyp", &payload)
    }

    // spec: MED-008, MED-022
    #[test]
    fn only_mp4_brands_are_videos() {
        for major in [b"isom", b"mp42", b"M4V ", b"dash", b"iso6", b"avc1"] {
            assert_eq!(
                sniff(&ftyp(major, &[])),
                Some(MediaFormat::Mp4),
                "{major:?}"
            );
        }
        // An unknown major brand is fine when a compatible brand is an MP4 one.
        assert_eq!(
            sniff(&ftyp(b"abcd", &[b"zzzz", b"mp41"])),
            Some(MediaFormat::Mp4)
        );
        assert_eq!(sniff(&ftyp(b"abcd", &[b"zzzz"])), None);
        // Other formats are refused, even when they list an MP4 brand as compatible.
        for major in [
            b"qt  ", b"3gp4", b"3g2a", b"M4A ", b"M4B ", b"heic", b"mif1", b"avif",
        ] {
            assert_eq!(sniff(&ftyp(major, &[b"isom"])), None, "{major:?}");
        }
        // A truncated box: the declared size exceeds the file.
        let whole = ftyp(b"isom", &[b"mp41"]);
        assert_eq!(sniff(&whole[..whole.len() - 2]), None);
        assert_eq!(sniff(&whole[..10]), None);
    }

    // spec: MED-002, MED-008, MED-012, MED-013
    #[test]
    fn uploads_are_classified_from_their_content() {
        let jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0, 0];
        assert_eq!(classify_upload(&jpeg, Slot::Avatar), Ok(MediaKind::Image));
        assert_eq!(classify_upload(&jpeg, Slot::Header), Ok(MediaKind::Image));
        assert_eq!(
            classify_upload(b"plain text", Slot::Header),
            Err(UploadRejection::Unsupported)
        );

        let clip = mp4_of(30_100);
        assert_eq!(classify_upload(&clip, Slot::Header), Ok(MediaKind::Video));
        assert_eq!(
            classify_upload(&clip, Slot::Avatar),
            Err(UploadRejection::Unsupported)
        );
        assert_eq!(
            classify_upload(&mp4_of(30_101), Slot::Header),
            Err(UploadRejection::VideoTooLong)
        );
        // `ftyp` without a movie header: a HEIC photo, not a video.
        let heic = boxed(b"ftyp", b"heic\0\0\0\0mif1");
        assert_eq!(
            classify_upload(&heic, Slot::Header),
            Err(UploadRejection::Unsupported)
        );
    }

    // spec: MED-002, MED-012
    #[test]
    fn upload_size_limits_depend_on_the_kind() {
        let mut image = vec![0xFF, 0xD8, 0xFF];
        image.resize(MAX_IMAGE_BYTES, 0);
        assert_eq!(classify_upload(&image, Slot::Header), Ok(MediaKind::Image));
        image.push(0);
        assert_eq!(
            classify_upload(&image, Slot::Header),
            Err(UploadRejection::TooLarge)
        );

        let mut clip = mp4_of(1_000);
        clip.resize(MAX_VIDEO_BYTES, 0);
        assert_eq!(classify_upload(&clip, Slot::Header), Ok(MediaKind::Video));
        clip.push(0);
        assert_eq!(
            classify_upload(&clip, Slot::Header),
            Err(UploadRejection::TooLarge)
        );
    }

    // spec: MED-018, MED-020
    #[test]
    fn media_refs_must_be_the_cards_own_in_the_right_slot() {
        let (header, avatar, stranger) =
            (Uuid::from_u128(1), Uuid::from_u128(2), Uuid::from_u128(3));
        let media = [(header, Slot::Header), (avatar, Slot::Avatar)];
        assert!(invalid_media_refs(Some(header), Some(avatar), &media).is_empty());
        assert!(invalid_media_refs(None, None, &media).is_empty());
        assert_eq!(
            invalid_media_refs(Some(avatar), Some(header), &media),
            vec![
                FieldError::new("header_media_id", "invalid_media"),
                FieldError::new("avatar_media_id", "invalid_media"),
            ]
        );
        assert_eq!(
            invalid_media_refs(Some(stranger), None, &media),
            vec![FieldError::new("header_media_id", "invalid_media")]
        );
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
