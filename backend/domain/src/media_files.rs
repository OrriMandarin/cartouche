//! How stored media files are addressed and served: storage keys, the keys `/media/*`
//! accepts, their content types, who may read them, and `Range` requests (MED-010, MED-016,
//! MED-017, MED-023, MED-031).

use std::ops::Range;

use uuid::Uuid;

/// File name of a video's served file (MED-034).
pub const VIDEO_FILE: &str = "video.mp4";
/// File name of a video's private original (MED-036). It is not a served name.
pub const ORIGINAL_FILE: &str = "original.mp4";

/// Storage key of one file of a media: `cards/{card_id}/{media_id}/{name}`.
pub fn storage_key(card_id: Uuid, media_id: Uuid, name: &str) -> String {
    format!("cards/{card_id}/{media_id}/{name}")
}

/// File name of a media's source (MED-025, MED-031): `source-<token>.webp`, where `token` is
/// drawn at random for each media so that the name cannot be guessed.
pub fn source_name(token: &str) -> String {
    format!("source-{token}.webp")
}

/// File name of a video's edit copy (MED-037, MED-031): `source-<token>.mp4`.
pub fn edit_copy_name(token: &str) -> String {
    format!("source-{token}.mp4")
}

/// Whether `name` is the file name of a source: `source-`, 32 lowercase hexadecimal
/// characters, then `.webp` (an image's source) or `.mp4` (a video's edit copy) (MED-031).
pub fn is_source_name(name: &str) -> bool {
    source_extension(name).is_some()
}

/// Whether `name` is the file name of a video's edit copy (MED-037).
pub fn is_video_source_name(name: &str) -> bool {
    source_extension(name) == Some("mp4")
}

/// The extension of a source name, when `name` is one.
fn source_extension(name: &str) -> Option<&'static str> {
    let rest = name.strip_prefix("source-")?;
    let (token, extension) = rest.split_at_checked(32)?;
    let is_token = token
        .bytes()
        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
    match extension {
        ".webp" if is_token => Some("webp"),
        ".mp4" if is_token => Some("mp4"),
        _ => None,
    }
}

/// Whether `key` is the storage key of a media's source (MED-031).
pub fn is_source_key(key: &str) -> bool {
    served_content_type(key).is_some() && key.rsplit('/').next().is_some_and(is_source_name)
}

/// The content type of a file served under `/media/*`, or `None` when `key` is not the key
/// of a media file: `cards/{uuid}/{uuid}/` then `s|w`, 2 to 4 digits and `.webp` or `.jpg`,
/// `video.mp4`, or a source name. Nothing else is ever read from the store, so a path cannot
/// leave it.
pub fn served_content_type(key: &str) -> Option<&'static str> {
    let mut segments = key.split('/');
    let (cards, card, media, name) = (
        segments.next()?,
        segments.next()?,
        segments.next()?,
        segments.next()?,
    );
    if cards != "cards" || segments.next().is_some() || !is_uuid_text(card) || !is_uuid_text(media)
    {
        return None;
    }
    if name == VIDEO_FILE || is_video_source_name(name) {
        return Some("video/mp4");
    }
    if is_source_name(name) {
        return Some("image/webp");
    }
    let (stem, extension) = name.split_once('.')?;
    let (kind, digits) = stem.split_at_checked(1)?;
    let sized = matches!(kind, "s" | "w")
        && (2..=4).contains(&digits.len())
        && digits.bytes().all(|b| b.is_ascii_digit());
    match (sized, extension) {
        (true, "webp") => Some("image/webp"),
        (true, "jpg") => Some("image/jpeg"),
        _ => None,
    }
}

/// The card a storage key belongs to: the first segment after `cards/`, when it is a
/// lowercase UUID.
pub fn card_of_key(key: &str) -> Option<Uuid> {
    let card = key.strip_prefix("cards/")?.split('/').next()?;
    if !is_uuid_text(card) {
        return None;
    }
    card.parse().ok()
}

/// How a media file that may be read is cached.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaCache {
    /// By anyone, for good: a file never changes under its name (MED-016).
    Immutable,
    /// By the reader's browser only: a signed address of the dashboard or the support page,
    /// readable even when the card is not served (MED-023).
    Private,
}

/// Whether a file under `/media/*` may be read, and how it is cached. `signed` tells whether
/// the request carries a valid signature; `served` whether the file's card is publicly
/// served (`None`: no such card); `is_source` whether the file is a media's source. Without a
/// signature, only a served card's files are read, and never a source (MED-023, MED-031).
pub fn media_access(signed: bool, served: Option<bool>, is_source: bool) -> Option<MediaCache> {
    match (signed, served) {
        (true, _) => Some(MediaCache::Private),
        (false, _) if is_source => None,
        (false, Some(true)) => Some(MediaCache::Immutable),
        (false, Some(false) | None) => None,
    }
}

/// 36 characters made of lowercase hexadecimal digits and dashes.
fn is_uuid_text(text: &str) -> bool {
    text.len() == 36
        && text
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b) || b == b'-')
}

/// A satisfiable part of a file; both ends are inclusive and inside the file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ByteRange {
    pub start: u64,
    pub end: u64,
}

impl ByteRange {
    /// The same bytes as a half-open range, as storage reads take it.
    pub fn to_range(self) -> Range<u64> {
        self.start..self.end + 1
    }
}

/// The `Range` header is malformed, asks for several parts, or lies outside the file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RangeNotSatisfiable;

/// Reads a `Range: bytes=a-b | a- | -n` header against a file of `size` bytes. An end past
/// the file is cut short; a single part only (MED-017).
pub fn parse_range(header: &str, size: u64) -> Result<ByteRange, RangeNotSatisfiable> {
    let spec = header
        .trim()
        .strip_prefix("bytes=")
        .ok_or(RangeNotSatisfiable)?;
    let (first, last) = spec.split_once('-').ok_or(RangeNotSatisfiable)?;
    let last_byte = size.checked_sub(1).ok_or(RangeNotSatisfiable)?;
    let range = match (digits(first)?, digits(last)?) {
        // `-n`: the last n bytes.
        (None, Some(n)) if n > 0 => ByteRange {
            start: size.saturating_sub(n),
            end: last_byte,
        },
        // `a-`: from a to the end.
        (Some(start), None) => ByteRange {
            start,
            end: last_byte,
        },
        (Some(start), Some(end)) if start <= end => ByteRange {
            start,
            end: end.min(last_byte),
        },
        _ => return Err(RangeNotSatisfiable),
    };
    if range.start > last_byte {
        return Err(RangeNotSatisfiable);
    }
    Ok(range)
}

/// `None` for an empty text, an error for anything but plain decimal digits.
fn digits(text: &str) -> Result<Option<u64>, RangeNotSatisfiable> {
    if text.is_empty() {
        return Ok(None);
    }
    if !text.bytes().all(|b| b.is_ascii_digit()) {
        return Err(RangeNotSatisfiable);
    }
    text.parse().map(Some).map_err(|_| RangeNotSatisfiable)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CARD: &str = "0197c8c0-0000-7000-8000-000000000001";
    const MEDIA: &str = "0197c8c0-0000-7000-8000-000000000002";

    fn key(name: &str) -> String {
        format!("cards/{CARD}/{MEDIA}/{name}")
    }

    // spec: MED-010, MED-016
    #[test]
    fn only_media_file_keys_are_served() {
        assert_eq!(served_content_type(&key("s128.webp")), Some("image/webp"));
        assert_eq!(served_content_type(&key("w1920.webp")), Some("image/webp"));
        assert_eq!(served_content_type(&key("s512.jpg")), Some("image/jpeg"));
        assert_eq!(served_content_type(&key("video.mp4")), Some("video/mp4"));
        let id = Uuid::from_u128(7);
        assert_eq!(
            storage_key(id, id, "video.mp4"),
            format!("cards/{id}/{id}/video.mp4")
        );

        for bad in [
            key("s1.webp"),
            key("s12345.webp"),
            key("x128.webp"),
            key("s128.gif"),
            key("s128"),
            key("S128.webp"),
            key("s128.webp.txt"),
            key("s12a.webp"),
            key("../s128.webp"),
            key("video.mp4/"),
            format!("{}/extra", key("video.mp4")),
            format!("cards/{CARD}/video.mp4"),
            format!("cards/x/y/{}", "z.txt"),
            format!("cards/{}/{MEDIA}/video.mp4", CARD.to_uppercase()),
            format!("files/{CARD}/{MEDIA}/video.mp4"),
            "../../etc/passwd".to_string(),
            String::new(),
        ] {
            assert_eq!(served_content_type(&bad), None, "{bad}");
        }
    }

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    // spec: MED-031
    #[test]
    fn an_edit_copy_name_is_a_source_name_served_as_mp4() {
        assert_eq!(edit_copy_name(TOKEN), format!("source-{TOKEN}.mp4"));
        assert!(is_source_name(&edit_copy_name(TOKEN)));
        assert!(is_video_source_name(&edit_copy_name(TOKEN)));
        assert!(!is_video_source_name(&source_name(TOKEN)));
        assert_eq!(
            served_content_type(&key(&edit_copy_name(TOKEN))),
            Some("video/mp4")
        );
        assert!(is_source_key(&key(&edit_copy_name(TOKEN))));
        for bad in [
            format!("source-{TOKEN}.mov"),
            format!("source-{}.mp4", &TOKEN[1..]),
            format!("source-{}.mp4", TOKEN.to_uppercase()),
            format!("source-{TOKEN}0.mp4"),
        ] {
            assert_eq!(served_content_type(&key(&bad)), None, "{bad}");
        }
    }

    // spec: MED-036
    #[test]
    fn the_original_is_never_a_served_name() {
        assert_eq!(ORIGINAL_FILE, "original.mp4");
        assert_eq!(served_content_type(&key(ORIGINAL_FILE)), None);
        assert!(!is_source_name(ORIGINAL_FILE));
    }

    // spec: MED-031
    #[test]
    fn source_names_carry_a_random_token() {
        assert_eq!(source_name(TOKEN), format!("source-{TOKEN}.webp"));
        assert!(is_source_name(&source_name(TOKEN)));
        for bad in [
            "source.webp".to_string(),
            "source-.webp".to_string(),
            format!("source-{}.webp", &TOKEN[1..]),
            format!("source-{TOKEN}0.webp"),
            format!("source-{}.webp", TOKEN.to_uppercase()),
            format!("source-{}g.webp", &TOKEN[1..]),
            format!("source-{TOKEN}.jpg"),
            format!("source-{TOKEN}.webp.x"),
            format!("xsource-{TOKEN}.webp"),
        ] {
            assert!(!is_source_name(&bad), "{bad}");
        }
        assert_eq!(
            served_content_type(&key(&source_name(TOKEN))),
            Some("image/webp")
        );
        assert_eq!(served_content_type(&key("source.webp")), None);
        assert!(is_source_key(&key(&source_name(TOKEN))));
        assert!(!is_source_key(&key("w750.webp")));
        assert!(!is_source_key(&format!(
            "cards/{CARD}/{}",
            source_name(TOKEN)
        )));
    }

    // spec: MED-031, MED-023
    #[test]
    fn a_source_needs_a_signature_even_on_a_served_card() {
        for served in [Some(true), Some(false), None] {
            assert_eq!(media_access(false, served, true), None, "{served:?}");
            assert_eq!(
                media_access(true, served, true),
                Some(MediaCache::Private),
                "{served:?}"
            );
        }
    }

    fn range(header: &str, size: u64) -> Option<(u64, u64)> {
        parse_range(header, size).ok().map(|r| (r.start, r.end))
    }

    // spec: MED-023
    #[test]
    fn media_access_decisions() {
        for served in [Some(true), Some(false), None] {
            assert_eq!(
                media_access(true, served, false),
                Some(MediaCache::Private),
                "{served:?}"
            );
        }
        assert_eq!(
            media_access(false, Some(true), false),
            Some(MediaCache::Immutable)
        );
        assert_eq!(media_access(false, Some(false), false), None);
        assert_eq!(media_access(false, None, false), None);
    }

    // spec: MED-023
    #[test]
    fn card_id_is_read_from_the_key() {
        let card = Uuid::from_u128(1);
        let media = Uuid::from_u128(2);
        assert_eq!(
            card_of_key(&storage_key(card, media, "s128.webp")),
            Some(card)
        );
        assert_eq!(card_of_key(&key("video.mp4")), Some(CARD.parse().unwrap()));
        for bad in [
            format!("cards/x/{MEDIA}/s128.webp"),
            format!("cards/{}/{MEDIA}/s128.webp", CARD.to_uppercase()),
            format!("files/{CARD}/{MEDIA}/s128.webp"),
            "cards/".to_string(),
            String::new(),
        ] {
            assert_eq!(card_of_key(&bad), None, "{bad}");
        }
    }

    // spec: MED-017
    #[test]
    fn ranges_are_read_against_the_file_size() {
        assert_eq!(range("bytes=0-1", 100), Some((0, 1)));
        assert_eq!(range("bytes=10-", 100), Some((10, 99)));
        assert_eq!(range("bytes=-4", 100), Some((96, 99)));
        assert_eq!(range("bytes=90-5000", 100), Some((90, 99)));
        assert_eq!(range("bytes=-500", 100), Some((0, 99)));
        assert_eq!(range("bytes=99-99", 100), Some((99, 99)));
        assert_eq!(parse_range("bytes=2-4", 100).unwrap().to_range(), 2..5);
    }

    // spec: MED-017
    #[test]
    fn unsatisfiable_or_unreadable_ranges_are_refused() {
        for header in [
            "bytes=100-",
            "bytes=150-160",
            "bytes=5-2",
            "bytes=-0",
            "bytes=-",
            "bytes=",
            "bytes=a-b",
            "bytes=+1-2",
            "bytes=0-1,5-6",
            "bytes 0-1",
            "items=0-1",
            "0-1",
            "bytes=99999999999999999999-",
        ] {
            assert_eq!(range(header, 100), None, "{header}");
        }
        assert_eq!(range("bytes=0-", 0), None);
    }
}
