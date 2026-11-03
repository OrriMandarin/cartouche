//! The image pipeline: validate, decode, orient, crop or resize, re-encode (MED-006, MED-007,
//! MED-012, MED-014, MED-015). Re-encoding drops every metadata block, and the uploaded bytes
//! are never stored.

use std::io::Cursor;

use cartouche_domain::{
    MAX_IMAGE_PIXELS, MediaFormat, Slot, VariantFormat, plan_image_variants, sniff,
};
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{
    DynamicImage, ExtendedColorType, GenericImageView, ImageDecoder, ImageEncoder, ImageReader,
    Limits, RgbImage,
};
use thiserror::Error;

const WEBP_QUALITY: f32 = 80.0;
const JPEG_QUALITY: u8 = 85;
/// Memory the decoder may allocate for one image.
const MAX_DECODE_ALLOC: u64 = 512 << 20;

/// One produced file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncodedVariant {
    /// File name in the media folder (`s256.webp`, `w640.webp`...).
    pub name: String,
    /// Width in pixels (the side, for an avatar).
    pub width: u32,
    pub format: VariantFormat,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum ProcessError {
    /// Not a JPEG, PNG or WebP image.
    #[error("unsupported image format")]
    Unsupported,
    /// More than 40 million pixels.
    #[error("image has too many pixels")]
    TooLarge,
    /// Recognized but unreadable.
    #[error("image is corrupt")]
    Corrupt,
}

/// Turns an uploaded image into the variants planned for `slot` (MED-015).
pub fn process_image(bytes: &[u8], slot: Slot) -> Result<Vec<EncodedVariant>, ProcessError> {
    if !matches!(
        sniff(bytes),
        Some(MediaFormat::Jpeg | MediaFormat::Png | MediaFormat::Webp)
    ) {
        return Err(ProcessError::Unsupported);
    }

    // The size comes from the header: a decompression bomb is refused before any decoding.
    let (width, height) = reader(bytes)?
        .into_dimensions()
        .map_err(|_| ProcessError::Corrupt)?;
    if u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS {
        return Err(ProcessError::TooLarge);
    }

    let mut limits = Limits::default();
    limits.max_alloc = Some(MAX_DECODE_ALLOC);
    let mut reader = reader(bytes)?;
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(|_| ProcessError::Corrupt)?;
    let orientation = decoder
        .orientation()
        .unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut image = DynamicImage::from_decoder(decoder).map_err(|_| ProcessError::Corrupt)?;
    image.apply_orientation(orientation);

    let (width, height) = image.dimensions();
    let source = match slot {
        Slot::Avatar => center_square(&image),
        Slot::Header => image,
    };
    plan_image_variants(slot, width, height)
        .into_iter()
        .map(|planned| {
            let resized = resize_to_width(&source, planned.width);
            Ok(EncodedVariant {
                bytes: encode(&resized, planned.format)?,
                name: planned.name,
                width: planned.width,
                format: planned.format,
            })
        })
        .collect()
}

fn reader(bytes: &[u8]) -> Result<ImageReader<Cursor<&[u8]>>, ProcessError> {
    ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| ProcessError::Corrupt)
}

/// The largest centered square of `image`.
fn center_square(image: &DynamicImage) -> DynamicImage {
    let (width, height) = image.dimensions();
    let side = width.min(height);
    image.crop_imm((width - side) / 2, (height - side) / 2, side, side)
}

/// Scales to `width`, keeping the aspect ratio. A square stays square.
fn resize_to_width(image: &DynamicImage, width: u32) -> DynamicImage {
    let (current_width, current_height) = image.dimensions();
    if width == current_width {
        return image.clone();
    }
    let height = (u64::from(current_height) * u64::from(width) / u64::from(current_width)).max(1);
    image.resize_exact(width, height as u32, FilterType::Lanczos3)
}

fn encode(image: &DynamicImage, format: VariantFormat) -> Result<Vec<u8>, ProcessError> {
    match format {
        VariantFormat::Webp => encode_webp(image),
        VariantFormat::Jpeg => encode_jpeg(image),
        VariantFormat::Mp4 => unreachable!("images are never encoded as video"),
    }
}

fn encode_webp(image: &DynamicImage) -> Result<Vec<u8>, ProcessError> {
    let (width, height) = image.dimensions();
    let encoded = if image.color().has_alpha() {
        let pixels = image.to_rgba8();
        webp::Encoder::from_rgba(pixels.as_raw(), width, height).encode_simple(false, WEBP_QUALITY)
    } else {
        let pixels = image.to_rgb8();
        webp::Encoder::from_rgb(pixels.as_raw(), width, height).encode_simple(false, WEBP_QUALITY)
    };
    // WebP cannot hold more than 16383 pixels on a side: an extreme panorama fails here.
    encoded
        .map(|data| data.to_vec())
        .map_err(|_| ProcessError::Corrupt)
}

fn encode_jpeg(image: &DynamicImage) -> Result<Vec<u8>, ProcessError> {
    let pixels = flatten_on_white(image);
    let (width, height) = pixels.dimensions();
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY)
        .write_image(pixels.as_raw(), width, height, ExtendedColorType::Rgb8)
        .map_err(|_| ProcessError::Corrupt)?;
    Ok(out)
}

/// JPEG has no transparency: transparent pixels become white rather than black.
fn flatten_on_white(image: &DynamicImage) -> RgbImage {
    if !image.color().has_alpha() {
        return image.to_rgb8();
    }
    let rgba = image.to_rgba8();
    let mut flat = RgbImage::new(rgba.width(), rgba.height());
    for (target, source) in flat.pixels_mut().zip(rgba.pixels()) {
        let alpha = u32::from(source[3]);
        for channel in 0..3 {
            let blended = (u32::from(source[channel]) * alpha + 255 * (255 - alpha) + 127) / 255;
            target[channel] = blended as u8;
        }
    }
    flat
}
