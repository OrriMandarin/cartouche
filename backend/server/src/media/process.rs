//! The image pipeline: validate, decode, orient, keep a source, cut the variants along a crop
//! and re-encode (MED-006, MED-007, MED-012, MED-014, MED-015, MED-025 to MED-027).
//! Re-encoding drops every metadata block, and the uploaded bytes are never stored.

use std::io::Cursor;

use cartouche_domain::{
    CropRect, MAX_IMAGE_PIXELS, MediaFormat, Slot, VariantFormat, check_crop, crop_pixels,
    default_crop, plan_image_variants, sniff, source_size,
};
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{
    DynamicImage, ExtendedColorType, GenericImageView, ImageDecoder, ImageEncoder, ImageReader,
    Limits, RgbImage,
};
use thiserror::Error;

const WEBP_QUALITY: f32 = 80.0;
/// The source is re-framed later: it is kept at a higher quality than the files shown.
const SOURCE_WEBP_QUALITY: f32 = 90.0;
const JPEG_QUALITY: u8 = 85;
/// Memory the decoder may allocate for one image.
const MAX_DECODE_ALLOC: u64 = 512 << 20;

/// One produced file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncodedVariant {
    /// File name in the media folder (`s256.webp`, `w750.webp`...).
    pub name: String,
    /// Width in pixels (the side, for an avatar).
    pub width: u32,
    pub format: VariantFormat,
    pub bytes: Vec<u8>,
}

/// The source of a media as it is stored: WebP, oriented, without metadata (MED-025).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncodedSource {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
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

/// Why an uploaded image could not be prepared.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum PrepareError {
    #[error(transparent)]
    Image(#[from] ProcessError),
    /// The crop is outside the source or not of the slot's shape (MED-026).
    #[error("invalid crop")]
    Crop,
}

/// What an uploaded image becomes: its source, the crop it was cut along (the default one when
/// none was given) and the files shown on the card.
#[derive(Debug, Clone, PartialEq)]
pub struct PreparedImage {
    pub source: EncodedSource,
    pub crop: CropRect,
    pub variants: Vec<EncodedVariant>,
}

/// Turns an uploaded image into its source and the variants of `slot` cut along `crop`, which
/// is checked against the source (MED-025 to MED-027). Without a crop, the largest centred
/// rectangle of the slot's shape is taken.
pub fn prepare_image(
    bytes: &[u8],
    slot: Slot,
    crop: Option<CropRect>,
) -> Result<PreparedImage, PrepareError> {
    let source = fit_source(decode(bytes)?);
    let (width, height) = source.dimensions();
    let crop = crop.unwrap_or_else(|| default_crop(slot, width, height));
    check_crop(&crop, slot, width, height).map_err(|_| PrepareError::Crop)?;
    Ok(PreparedImage {
        variants: cut_variants(&source, slot, &crop)?,
        source: encode_source(&source)?,
        crop,
    })
}

/// Decodes an uploaded JPEG, PNG or WebP image and turns it the right way up (MED-012,
/// MED-014). A decompression bomb is refused from its header, before any decoding.
pub fn decode(bytes: &[u8]) -> Result<DynamicImage, ProcessError> {
    if !matches!(
        sniff(bytes),
        Some(MediaFormat::Jpeg | MediaFormat::Png | MediaFormat::Webp)
    ) {
        return Err(ProcessError::Unsupported);
    }

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
    Ok(image)
}

/// The image at the size of its stored source: its longer side reduced to 4,096 pixels, never
/// enlarged (MED-025).
pub fn fit_source(image: DynamicImage) -> DynamicImage {
    let (width, height) = image.dimensions();
    let (target_width, target_height) = source_size(width, height);
    if (target_width, target_height) == (width, height) {
        return image;
    }
    image.resize_exact(target_width, target_height, FilterType::Lanczos3)
}

/// Encodes a source (already at its size, see [`fit_source`]) in WebP (MED-025).
pub fn encode_source(source: &DynamicImage) -> Result<EncodedSource, ProcessError> {
    let (width, height) = source.dimensions();
    Ok(EncodedSource {
        bytes: encode_webp(source, SOURCE_WEBP_QUALITY)?,
        width,
        height,
    })
}

/// The files of `slot`, cut from `source` along `crop` (in proportions of `source`), at the
/// planned sizes (MED-015, MED-027).
pub fn cut_variants(
    source: &DynamicImage,
    slot: Slot,
    crop: &CropRect,
) -> Result<Vec<EncodedVariant>, ProcessError> {
    let (width, height) = source.dimensions();
    let area = crop_pixels(crop, slot, width, height);
    let cropped = source.crop_imm(area.x, area.y, area.width, area.height);
    plan_image_variants(slot, area.width, area.height)
        .into_iter()
        .map(|planned| {
            let resized = if (planned.width, planned.height) == (area.width, area.height) {
                cropped.clone()
            } else {
                cropped.resize_exact(planned.width, planned.height, FilterType::Lanczos3)
            };
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

fn encode(image: &DynamicImage, format: VariantFormat) -> Result<Vec<u8>, ProcessError> {
    match format {
        VariantFormat::Webp => encode_webp(image, WEBP_QUALITY),
        VariantFormat::Jpeg => encode_jpeg(image),
        VariantFormat::Mp4 => unreachable!("images are never encoded as video"),
    }
}

fn encode_webp(image: &DynamicImage, quality: f32) -> Result<Vec<u8>, ProcessError> {
    let (width, height) = image.dimensions();
    let encoded = if image.color().has_alpha() {
        let pixels = image.to_rgba8();
        webp::Encoder::from_rgba(pixels.as_raw(), width, height).encode_simple(false, quality)
    } else {
        let pixels = image.to_rgb8();
        webp::Encoder::from_rgb(pixels.as_raw(), width, height).encode_simple(false, quality)
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
