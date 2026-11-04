//! Media upload for a card (MED-001 to MED-008, MED-012, MED-013, MED-015, MED-018, MED-020,
//! MED-025 to MED-029). An upload only creates the media and its files; the card shows it once
//! a save attaches it.

use axum::Json;
use axum::extract::{Multipart, State};
use axum::http::StatusCode;
use bytes::{Bytes, BytesMut};
use cartouche_domain::{
    CropRect, FieldError, Framing, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, MediaKind, Slot,
    UploadRejection, VariantFormat, VideoLoop, check_loop, check_poster_time, classify_upload,
    default_loop, mp4_duration, storage_key,
};
use serde::de::DeserializeOwned;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::ApprovedUser;
use crate::db::cards;
use crate::db::media::{self, MediaRecord, SourceFile, StoredVariant};
use crate::error::{ApiError, ErrorBody};
use crate::extract::{ApiMultipart, ApiPath};
use crate::media::process::{EncodedVariant, PrepareError, PreparedImage, ProcessError};
use crate::media::{MediaService, new_source_name};
use crate::state::AppState;
use crate::views::{Audience, MediaView};

/// Largest request body of the upload route: a video, its waiting image and the framing.
pub const UPLOAD_BODY_LIMIT: usize = 36 << 20;

/// Name of the stored video file.
const VIDEO_FILE: &str = "video.mp4";

/// Longest framing field (`crop`, `loop`, `poster_time`), in bytes.
const FRAMING_FIELD_LIMIT: usize = 512;

/// Shape of the multipart form, for the API description only.
#[derive(ToSchema)]
#[allow(dead_code)]
pub struct UploadMediaBody {
    /// Where the media is shown. A video is only accepted in `header`.
    slot: Slot,
    /// A JPEG, PNG or WebP image (10 MB, 40 million pixels at most), or in `header` an MP4
    /// video (25 MB, 30 s at most). The type is read from the content.
    #[schema(value_type = String, format = Binary)]
    file: Vec<u8>,
    /// The waiting image of a video: the whole frame at `poster_time`, captured in the
    /// browser. Required for a video.
    #[schema(value_type = Option<String>, format = Binary)]
    poster: Option<Vec<u8>>,
    /// JSON `{x, y, width, height}` in proportions of the image (of the waiting image, for a
    /// video): 4:3 for the header, square for the avatar. Default: the largest centred one.
    #[schema(value_type = Option<String>)]
    crop: Option<String>,
    /// Video only. JSON `{start, end}` in seconds. Default: the whole video.
    #[schema(value_type = Option<String>, rename = "loop")]
    video_loop: Option<String>,
    /// Video only. The time of the waiting image, in seconds, as a decimal. Default: 0.
    #[schema(value_type = Option<f64>)]
    poster_time: Option<String>,
}

/// The framing fields the form carried; the absent ones take their default (MED-026, MED-028).
#[derive(Default)]
struct FramingFields {
    crop: Option<CropRect>,
    video_loop: Option<VideoLoop>,
    poster_time: Option<f64>,
}

/// What the form carried.
#[derive(Default)]
struct Form {
    slot: Option<Slot>,
    file: Option<Bytes>,
    poster: Option<Bytes>,
    framing: FramingFields,
}

/// Reads the form, refusing a field heavier than its limit as soon as it is seen to be.
async fn read_form(multipart: &mut Multipart) -> Result<Form, ApiError> {
    let mut form = Form::default();
    while let Some(mut field) = multipart.next_field().await? {
        let name = field.name().unwrap_or_default().to_string();
        let limit = match name.as_str() {
            "slot" => 16,
            "file" => MAX_VIDEO_BYTES,
            "poster" => MAX_IMAGE_BYTES,
            "crop" | "loop" | "poster_time" => FRAMING_FIELD_LIMIT,
            _ => return Err(ApiError::InvalidRequest),
        };
        let mut content = BytesMut::new();
        while let Some(chunk) = field.chunk().await? {
            if content.len() + chunk.len() > limit {
                return Err(match name.as_str() {
                    "file" | "poster" => ApiError::PayloadTooLarge,
                    _ => ApiError::InvalidRequest,
                });
            }
            content.extend_from_slice(&chunk);
        }
        let content = content.freeze();
        let duplicate = match name.as_str() {
            "slot" => form.slot.replace(parse_slot(&content)?).is_some(),
            "file" => form.file.replace(content).is_some(),
            "poster" => form.poster.replace(content).is_some(),
            "crop" => form.framing.crop.replace(parse_json(&content)?).is_some(),
            "loop" => form
                .framing
                .video_loop
                .replace(parse_json(&content)?)
                .is_some(),
            _ => form
                .framing
                .poster_time
                .replace(parse_decimal(&content)?)
                .is_some(),
        };
        if duplicate {
            return Err(ApiError::InvalidRequest);
        }
    }
    Ok(form)
}

fn parse_slot(text: &[u8]) -> Result<Slot, ApiError> {
    std::str::from_utf8(text)
        .ok()
        .and_then(|text| text.trim().parse().ok())
        .ok_or(ApiError::InvalidRequest)
}

fn parse_json<T: DeserializeOwned>(text: &[u8]) -> Result<T, ApiError> {
    serde_json::from_slice(text).map_err(|_| ApiError::InvalidRequest)
}

fn parse_decimal(text: &[u8]) -> Result<f64, ApiError> {
    std::str::from_utf8(text)
        .ok()
        .and_then(|text| text.trim().parse().ok())
        .ok_or(ApiError::InvalidRequest)
}

fn field_error(field: &str, code: &'static str) -> ApiError {
    ApiError::Validation(vec![FieldError::new(field, code)])
}

/// Maps a failed image to the error of the form field it came from; a refused crop is the
/// `crop` field's (MED-026).
fn prepare_error(error: PrepareError, field: &str) -> ApiError {
    match error {
        PrepareError::Image(ProcessError::Unsupported | ProcessError::Corrupt) => {
            ApiError::UnsupportedMediaType
        }
        PrepareError::Image(ProcessError::TooLarge) => field_error(field, "image_too_large"),
        PrepareError::Crop => field_error("crop", "invalid_crop"),
    }
}

/// An encoded variant as it is stored and recorded.
fn stored(variant: EncodedVariant) -> (String, Bytes, StoredVariant) {
    (
        variant.name.clone(),
        Bytes::from(variant.bytes),
        StoredVariant {
            name: variant.name,
            width: variant.width,
            format: variant.format,
        },
    )
}

/// What an upload stores and records: its files (name and bytes) and the media's description.
struct Prepared {
    kind: MediaKind,
    files: Vec<(String, Bytes)>,
    variants: Vec<StoredVariant>,
    source: SourceFile,
    framing: Framing,
    duration_ms: Option<u32>,
}

impl Prepared {
    /// The source (under a new random name) and the variants of a prepared image.
    fn of_image(kind: MediaKind, image: PreparedImage, framing: Framing) -> Prepared {
        let source = SourceFile {
            name: new_source_name(),
            width: image.source.width,
            height: image.source.height,
        };
        let mut files = vec![(source.name.clone(), Bytes::from(image.source.bytes))];
        let mut variants = Vec::new();
        for (name, bytes, variant) in image.variants.into_iter().map(stored) {
            files.push((name, bytes));
            variants.push(variant);
        }
        Prepared {
            kind,
            files,
            variants,
            source,
            framing,
            duration_ms: None,
        }
    }
}

/// The files to store for an upload, checked and encoded, with the framing they were cut along.
async fn prepare(
    storage: &MediaService,
    slot: Slot,
    file: Bytes,
    poster: Option<Bytes>,
    framing: FramingFields,
) -> Result<Prepared, ApiError> {
    let FramingFields {
        crop,
        video_loop,
        poster_time,
    } = framing;
    let kind = classify_upload(&file, slot).map_err(|rejection| match rejection {
        UploadRejection::Unsupported => ApiError::UnsupportedMediaType,
        UploadRejection::TooLarge => ApiError::PayloadTooLarge,
        UploadRejection::VideoTooLong => field_error("file", "video_too_long"),
    })?;
    match kind {
        MediaKind::Image => {
            // A loop and a poster time only make sense for a video.
            if video_loop.is_some() || poster_time.is_some() {
                return Err(ApiError::InvalidRequest);
            }
            let image = storage
                .prepare_image(file, slot, crop)
                .await
                .map_err(|e| prepare_error(e, "file"))?;
            let framing = Framing {
                crop: image.crop,
                video_loop: None,
                poster_time: None,
            };
            Ok(Prepared::of_image(kind, image, framing))
        }
        MediaKind::Video => {
            let duration = mp4_duration(&file).map_err(|_| ApiError::UnsupportedMediaType)?;
            let video_loop = video_loop.unwrap_or_else(|| default_loop(duration));
            let poster_time = poster_time.unwrap_or(0.0);
            let refused: Vec<FieldError> = [
                check_loop(&video_loop, duration)
                    .err()
                    .map(|code| ("loop", code)),
                check_poster_time(poster_time, duration)
                    .err()
                    .map(|code| ("poster_time", code)),
            ]
            .into_iter()
            .flatten()
            .map(|(field, code)| FieldError::new(field, code))
            .collect();
            if !refused.is_empty() {
                return Err(ApiError::Validation(refused));
            }
            let poster = poster.ok_or_else(|| field_error("poster", "poster_required"))?;
            // The waiting image is the video's source, cut along the video's crop (MED-029).
            let image = storage
                .prepare_image(poster, Slot::Header, crop)
                .await
                .map_err(|e| prepare_error(e, "poster"))?;
            let framing = Framing {
                crop: image.crop,
                video_loop: Some(video_loop),
                poster_time: Some(poster_time),
            };
            let mut prepared = Prepared::of_image(kind, image, framing);
            prepared.files.push((VIDEO_FILE.to_string(), file));
            prepared.variants.push(StoredVariant {
                name: VIDEO_FILE.to_string(),
                width: 0,
                format: VariantFormat::Mp4,
            });
            prepared.duration_ms = Some(u32::try_from(duration.as_millis()).unwrap_or(u32::MAX));
            Ok(prepared)
        }
    }
}

/// Uploads a header or avatar media of one of the caller's cards.
#[utoipa::path(
    post,
    path = "/api/cards/{id}/media",
    summary = "Upload a media",
    description = "Stores an image (or, in the header, a video with its waiting image) and returns the media with the addresses of its files and its framing. The server keeps the whole image (the waiting image, for a video) as the media's source and cuts the files shown along the crop. The media is shown on the card only once a save of the card (`PUT /api/cards/{id}`) names it as header or avatar.",
    tag = "cards",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the card.")),
    request_body(content = UploadMediaBody, content_type = "multipart/form-data"),
    responses(
        (status = 201, description = "The stored media.", body = MediaView),
        (status = 400, description = "Malformed request or form, a framing field that does not parse, or a loop or poster time sent with an image (`invalid_request`), or refused file or framing (`validation_failed`: `file` is `required`, `image_too_large` or `video_too_long`; `slot` is `required`; `poster` is `poster_required` or `image_too_large`; `crop` is `invalid_crop`; `loop` is `invalid_loop`; `poster_time` is `invalid_poster_time`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller's account is not approved (`account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such card for the caller (`not_found`).", body = ErrorBody),
        (status = 413, description = "The file is too heavy: 10 MB for an image, 25 MB for a video (`payload_too_large`).", body = ErrorBody),
        (status = 415, description = "The content is not a supported image or video (`unsupported_media_type`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn upload_media(
    ApprovedUser(me): ApprovedUser,
    State(state): State<AppState>,
    ApiPath(card_id): ApiPath<Uuid>,
    ApiMultipart(mut multipart): ApiMultipart,
) -> Result<(StatusCode, Json<MediaView>), ApiError> {
    let owner_id = me.user.id;
    // Before reading the body: another user's card is not found, whatever is sent.
    cards::find_for_owner(&state.db, owner_id, card_id)
        .await?
        .ok_or(ApiError::NotFound)?;

    let form = read_form(&mut multipart).await?;
    let mut missing = Vec::new();
    if form.slot.is_none() {
        missing.push(FieldError::new("slot", "required"));
    }
    if form.file.is_none() {
        missing.push(FieldError::new("file", "required"));
    }
    let (Some(slot), Some(file)) = (form.slot, form.file) else {
        return Err(ApiError::Validation(missing));
    };

    let prepared = prepare(&state.media, slot, file, form.poster, form.framing).await?;
    let record = MediaRecord {
        id: Uuid::now_v7(),
        card_id,
        slot,
        kind: prepared.kind,
        variants: prepared.variants,
        source: Some(prepared.source),
        framing: Some(prepared.framing),
        duration_ms: prepared.duration_ms,
    };
    for (name, bytes) in prepared.files {
        let key = storage_key(card_id, record.id, &name);
        if let Err(error) = state.media.put(&key, bytes).await {
            discard_files(&state.media, &record).await;
            return Err(error.into());
        }
    }

    let inserted = async {
        let mut conn = state.db.acquire().await?;
        media::insert(&mut conn, owner_id, record.clone()).await
    }
    .await;
    match inserted {
        Ok(Some(record)) => Ok((
            StatusCode::CREATED,
            Json(MediaView::new(
                &record,
                &state.media,
                Audience::Owner(state.clock.now()),
            )),
        )),
        // The card was deleted since it was read.
        Ok(None) => {
            discard_files(&state.media, &record).await;
            Err(ApiError::NotFound)
        }
        Err(error) => {
            discard_files(&state.media, &record).await;
            Err(error.into())
        }
    }
}

/// Removes the files of a media that could not be recorded.
async fn discard_files(storage: &MediaService, record: &MediaRecord) {
    if let Err(error) = storage.delete_media(record.card_id, record.id).await {
        tracing::warn!(media_id = %record.id, %error, "cannot delete files of a rejected upload");
    }
}
