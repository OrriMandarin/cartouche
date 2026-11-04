//! In-memory media files for tests: real images built with the `image` crate, plus hand-made
//! containers (EXIF segment, lying PNG header, MP4 movie header).

use std::io::Cursor;

use image::codecs::jpeg::JpegEncoder;
use image::{ExtendedColorType, ImageEncoder, ImageFormat, Rgb, RgbImage};

/// A smooth gradient: compresses well and shows resizing artefacts if the pixels are wrong.
fn gradient(width: u32, height: u32) -> RgbImage {
    RgbImage::from_fn(width, height, |x, y| {
        Rgb([
            (x * 255 / width.max(1)) as u8,
            (y * 255 / height.max(1)) as u8,
            128,
        ])
    })
}

pub fn jpeg(width: u32, height: u32) -> Vec<u8> {
    let image = gradient(width, height);
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, 90)
        .write_image(image.as_raw(), width, height, ExtendedColorType::Rgb8)
        .expect("encodable JPEG");
    out
}

pub fn png(width: u32, height: u32) -> Vec<u8> {
    let mut out = Cursor::new(Vec::new());
    gradient(width, height)
        .write_to(&mut out, ImageFormat::Png)
        .expect("encodable PNG");
    out.into_inner()
}

/// A JPEG whose EXIF block declares `orientation` and, with `gps`, a GPS latitude reference.
/// The block is a little-endian TIFF structure in an APP1 segment right after SOI.
pub fn jpeg_with_exif(width: u32, height: u32, orientation: u16, gps: bool) -> Vec<u8> {
    let entry_count: u16 = if gps { 2 } else { 1 };
    let ifd0_len = 2 + usize::from(entry_count) * 12 + 4;
    let gps_ifd_offset = (8 + ifd0_len) as u32;

    let mut tiff = Vec::new();
    tiff.extend_from_slice(b"II*\0");
    tiff.extend_from_slice(&8u32.to_le_bytes());
    tiff.extend_from_slice(&entry_count.to_le_bytes());
    // Orientation (0x0112), SHORT, one value.
    tiff.extend_from_slice(&0x0112u16.to_le_bytes());
    tiff.extend_from_slice(&3u16.to_le_bytes());
    tiff.extend_from_slice(&1u32.to_le_bytes());
    tiff.extend_from_slice(&orientation.to_le_bytes());
    tiff.extend_from_slice(&[0, 0]);
    if gps {
        // GPSInfo (0x8825), LONG: offset of the GPS IFD.
        tiff.extend_from_slice(&0x8825u16.to_le_bytes());
        tiff.extend_from_slice(&4u16.to_le_bytes());
        tiff.extend_from_slice(&1u32.to_le_bytes());
        tiff.extend_from_slice(&gps_ifd_offset.to_le_bytes());
    }
    tiff.extend_from_slice(&0u32.to_le_bytes()); // no next IFD
    if gps {
        // GPS IFD with GPSLatitudeRef (0x0001), ASCII "N\0".
        tiff.extend_from_slice(&1u16.to_le_bytes());
        tiff.extend_from_slice(&1u16.to_le_bytes());
        tiff.extend_from_slice(&2u16.to_le_bytes());
        tiff.extend_from_slice(&2u32.to_le_bytes());
        tiff.extend_from_slice(b"N\0\0\0");
        tiff.extend_from_slice(&0u32.to_le_bytes());
    }

    let mut app1 = Vec::new();
    app1.extend_from_slice(b"Exif\0\0");
    app1.extend_from_slice(&tiff);

    let plain = jpeg(width, height);
    let mut out = Vec::with_capacity(plain.len() + app1.len() + 4);
    out.extend_from_slice(&plain[..2]); // SOI
    out.extend_from_slice(&[0xFF, 0xE1]);
    out.extend_from_slice(&((app1.len() + 2) as u16).to_be_bytes());
    out.extend_from_slice(&app1);
    out.extend_from_slice(&plain[2..]);
    out
}

/// A valid 1 × 1 PNG whose IHDR claims `width` × `height` (a decompression bomb in miniature).
pub fn png_claiming(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = png(1, 1);
    // Signature (8) + length (4) + "IHDR" (4), then width and height, then the chunk CRC.
    bytes[16..20].copy_from_slice(&width.to_be_bytes());
    bytes[20..24].copy_from_slice(&height.to_be_bytes());
    let crc = crc32(&bytes[12..29]);
    bytes[29..33].copy_from_slice(&crc.to_be_bytes());
    bytes
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &byte in data {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

/// An `ftyp` + `moov`/`mvhd` (version 0, timescale 1000) skeleton declaring `duration_ms`.
pub fn mp4(duration_ms: u32) -> Vec<u8> {
    mp4_with_brands(b"isom", &[b"isom", b"mp41"], duration_ms)
}

/// Like [`mp4`], with the given major and compatible brands in the `ftyp` box.
pub fn mp4_with_brands(major: &[u8; 4], compatible: &[&[u8; 4]], duration_ms: u32) -> Vec<u8> {
    let mut mvhd = Vec::new();
    mvhd.extend_from_slice(&[0, 0, 0, 0]); // version 0, flags
    mvhd.extend_from_slice(&0u32.to_be_bytes()); // creation time
    mvhd.extend_from_slice(&0u32.to_be_bytes()); // modification time
    mvhd.extend_from_slice(&1000u32.to_be_bytes()); // timescale
    mvhd.extend_from_slice(&duration_ms.to_be_bytes());
    mvhd.resize(100, 0); // rate, volume, matrix, next track id: unused

    let mut out = Vec::new();
    out.extend_from_slice(&((16 + 4 * compatible.len()) as u32).to_be_bytes());
    out.extend_from_slice(b"ftyp");
    out.extend_from_slice(major);
    out.extend_from_slice(&0u32.to_be_bytes()); // minor version
    for brand in compatible {
        out.extend_from_slice(*brand);
    }
    out.extend_from_slice(&((8 + 8 + mvhd.len()) as u32).to_be_bytes());
    out.extend_from_slice(b"moov");
    out.extend_from_slice(&((8 + mvhd.len()) as u32).to_be_bytes());
    out.extend_from_slice(b"mvhd");
    out.extend_from_slice(&mvhd);
    out
}

/// A PNG in four flat quadrants: red top left, green top right, blue bottom left, yellow
/// bottom right. A crop shows which quadrant a variant was cut from.
pub fn quadrants_png(width: u32, height: u32) -> Vec<u8> {
    let image = RgbImage::from_fn(width, height, |x, y| {
        match (x < width / 2, y < height / 2) {
            (true, true) => Rgb([255, 0, 0]),
            (false, true) => Rgb([0, 255, 0]),
            (true, false) => Rgb([0, 0, 255]),
            (false, false) => Rgb([255, 255, 0]),
        }
    });
    let mut out = Cursor::new(Vec::new());
    image
        .write_to(&mut out, ImageFormat::Png)
        .expect("encodable PNG");
    out.into_inner()
}

/// A real two-second H.264 clip (the e2e fixture); its container says a little more than 2 s.
pub fn header_clip() -> Vec<u8> {
    include_bytes!("../../../../frontend/e2e/fixtures/header-2s.mp4").to_vec()
}
