//! Content sniffing, MP4 duration, variant planning and the image pipeline (Task 7).

mod common;

use std::io::Cursor;
use std::time::{Duration, Instant};

use cartouche_api::media::process::{ProcessError, process_image};
use cartouche_domain::{
    MediaFormat, Slot, VariantFormat, mp4_duration, plan_image_variants, sniff,
};
use common::media_fixtures::{jpeg, jpeg_with_exif, mp4, png, png_claiming};
use image::{ImageDecoder, ImageFormat, ImageReader, metadata::Orientation};

fn names(slot: Slot, width: u32, height: u32, format: VariantFormat) -> Vec<String> {
    plan_image_variants(slot, width, height)
        .into_iter()
        .filter(|v| v.format == format)
        .map(|v| v.name)
        .collect()
}

fn dimensions(bytes: &[u8]) -> (u32, u32) {
    ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .unwrap()
        .into_dimensions()
        .unwrap()
}

// spec: MED-008
#[test]
fn sniff_reads_content_not_extension() {
    assert_eq!(sniff(&png(4, 4)), Some(MediaFormat::Png));
    assert_eq!(sniff(&jpeg(4, 4)), Some(MediaFormat::Jpeg));
    assert_eq!(sniff(b"RIFF\x24\0\0\0WEBPVP8 "), Some(MediaFormat::Webp));
    assert_eq!(sniff(&mp4(1_000)), Some(MediaFormat::Mp4));
    assert_eq!(sniff(b"GIF89a\x01\0\x01\0"), None);
    assert_eq!(sniff(b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>"), None);
    assert_eq!(sniff(b"RIFF\x24\0\0\0WAVEfmt "), None);
    assert_eq!(sniff(b""), None);
}

// spec: MED-002, MED-013
#[test]
fn mp4_duration_is_read_from_mvhd() {
    assert_eq!(mp4_duration(&mp4(2_000)).unwrap(), Duration::from_secs(2));
    assert_eq!(
        mp4_duration(&mp4(30_100)).unwrap(),
        Duration::from_millis(30_100)
    );
    // No moov box: nothing to read.
    let ftyp_only = &mp4(2_000)[..20];
    assert!(mp4_duration(ftyp_only).is_err());
    assert!(mp4_duration(&png(4, 4)).is_err());
}

// spec: MED-015
#[test]
fn variants_never_upscale() {
    assert_eq!(
        names(Slot::Header, 800, 600, VariantFormat::Webp),
        ["w640.webp", "w800.webp"]
    );
    assert_eq!(
        names(Slot::Header, 3000, 2000, VariantFormat::Webp),
        ["w640.webp", "w1080.webp", "w1920.webp"]
    );
    assert_eq!(
        names(Slot::Avatar, 300, 500, VariantFormat::Webp),
        ["s128.webp", "s256.webp", "s300.webp"]
    );
    assert_eq!(
        names(Slot::Avatar, 300, 500, VariantFormat::Jpeg),
        ["s256.jpg", "s300.jpg"]
    );
    // A tiny original yields a single file per format.
    assert_eq!(
        names(Slot::Avatar, 100, 100, VariantFormat::Webp),
        ["s100.webp"]
    );
}

// spec: MED-006, MED-015
#[test]
fn avatar_variants_are_square_webp_and_jpeg() {
    let variants = process_image(&jpeg(900, 600), Slot::Avatar).unwrap();
    let listing: Vec<_> = variants.iter().map(|v| v.name.as_str()).collect();
    assert_eq!(
        listing,
        [
            "s128.webp",
            "s256.webp",
            "s512.webp",
            "s256.jpg",
            "s512.jpg"
        ]
    );
    for variant in &variants {
        assert_eq!(dimensions(&variant.bytes), (variant.width, variant.width));
        match variant.format {
            VariantFormat::Webp => {
                assert_eq!(&variant.bytes[..4], b"RIFF");
                assert_eq!(&variant.bytes[8..12], b"WEBP");
            }
            VariantFormat::Jpeg => assert_eq!(&variant.bytes[..2], &[0xFF, 0xD8]),
            VariantFormat::Mp4 => unreachable!("images never produce video"),
        }
    }
}

// spec: MED-006, MED-015
#[test]
fn header_variants_are_webp_scaled_to_width() {
    let variants = process_image(&png(2000, 1000), Slot::Header).unwrap();
    let sizes: Vec<_> = variants
        .iter()
        .map(|v| (v.name.clone(), dimensions(&v.bytes)))
        .collect();
    assert_eq!(
        sizes,
        [
            ("w640.webp".to_string(), (640, 320)),
            ("w1080.webp".to_string(), (1080, 540)),
            ("w1920.webp".to_string(), (1920, 960)),
        ]
    );
}

#[test]
fn exif_fixture_is_read_by_the_image_crate() {
    let bytes = jpeg_with_exif(120, 80, 6, true);
    let mut decoder = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .unwrap()
        .into_decoder()
        .unwrap();
    assert_eq!(decoder.orientation().unwrap(), Orientation::Rotate90);
}

// spec: MED-007, MED-014
#[test]
fn orientation_applied_and_exif_removed() {
    let upload = jpeg_with_exif(1200, 800, 6, true);
    assert!(upload.windows(4).any(|w| w == b"Exif"));

    let variants = process_image(&upload, Slot::Header).unwrap();
    let w640 = variants.iter().find(|v| v.name == "w640.webp").unwrap();
    // Rotated a quarter turn: the landscape upload is shown as a portrait.
    assert_eq!(dimensions(&w640.bytes), (640, 960));
    for variant in &variants {
        assert!(!variant.bytes.windows(4).any(|w| w == b"Exif"));
        assert!(!variant.bytes.windows(3).any(|w| w == b"GPS"));
    }
}

// spec: MED-007
#[test]
fn avatar_jpeg_variants_carry_no_exif() {
    let variants = process_image(&jpeg_with_exif(600, 600, 3, true), Slot::Avatar).unwrap();
    assert!(variants.iter().any(|v| v.format == VariantFormat::Jpeg));
    for variant in &variants {
        assert!(!variant.bytes.windows(4).any(|w| w == b"Exif"));
        assert!(!variant.bytes.windows(3).any(|w| w == b"GPS"));
    }
}

// spec: MED-012, MED-008
#[test]
fn unsupported_and_corrupt_files_are_rejected() {
    assert!(matches!(
        process_image(b"GIF89a\x01\0\x01\0\0\0\0;", Slot::Avatar),
        Err(ProcessError::Unsupported)
    ));
    assert!(matches!(
        process_image(&mp4(1_000), Slot::Header),
        Err(ProcessError::Unsupported)
    ));
    let truncated = &jpeg(400, 400)[..300];
    assert!(matches!(
        process_image(truncated, Slot::Header),
        Err(ProcessError::Corrupt)
    ));
    assert!(matches!(
        process_image(b"\x89PNG\r\n\x1a\ngarbage", Slot::Header),
        Err(ProcessError::Corrupt)
    ));
}

// spec: MED-012, Review Focus 5
#[test]
fn pixel_bomb_is_rejected_before_decoding() {
    let bomb = png_claiming(20_000, 20_000);
    let started = Instant::now();
    assert!(matches!(
        process_image(&bomb, Slot::Header),
        Err(ProcessError::TooLarge)
    ));
    assert!(started.elapsed() < Duration::from_millis(100));
}

// spec: MED-012
#[test]
fn image_at_the_pixel_limit_is_accepted_by_the_dimension_check() {
    // 40 000 000 pixels exactly (8000 x 5000) passes the check; one more row would not.
    assert!(matches!(
        process_image(&png_claiming(8_000, 5_001), Slot::Header),
        Err(ProcessError::TooLarge)
    ));
    assert!(!matches!(
        process_image(&png_claiming(8_000, 5_000), Slot::Header),
        Err(ProcessError::TooLarge)
    ));
}

#[test]
fn webp_uploads_are_accepted() {
    let produced = process_image(&jpeg(300, 300), Slot::Avatar).unwrap();
    let webp = produced
        .iter()
        .find(|v| v.name == "s300.webp")
        .unwrap()
        .bytes
        .clone();
    assert_eq!(sniff(&webp), Some(MediaFormat::Webp));
    let variants = process_image(&webp, Slot::Header).unwrap();
    assert_eq!(variants[0].name, "w300.webp");
    let decoded = image::load_from_memory_with_format(&variants[0].bytes, ImageFormat::WebP);
    assert!(decoded.is_ok());
}
