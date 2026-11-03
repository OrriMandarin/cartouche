//! Media upload for a card (MED-001 to MED-008, MED-012, MED-013, MED-015, MED-018, MED-020).
//! An upload only creates the media and its files; the card shows it once a save attaches it.

use axum::Json;
use axum::extract::{Multipart, State};
use axum::http::StatusCode;
use bytes::{Bytes, BytesMut};
use cartouche_domain::{
    FieldError, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, MediaKind, Slot, UploadRejection, VariantFormat,
    classify_upload, storage_key,
};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::ApprovedUser;
use crate::db::cards;
use crate::db::media::{self, MediaRecord, StoredVariant};
use crate::error::{ApiError, ErrorBody};
use crate::extract::{ApiMultipart, ApiPath};
use crate::media::MediaService;
use crate::media::process::{EncodedVariant, ProcessError};
use crate::state::AppState;
use crate::views::{Audience, MediaView};

/// Largest request body of the upload route: a video, its waiting image and the framing.
pub const UPLOAD_BODY_LIMIT: usize = 36 << 20;

/// Name of the stored video file.
const VIDEO_FILE: &str = "video.mp4";

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
    /// The waiting image of a video, captured in the browser. Required for a video.
    #[schema(value_type = Option<String>, format = Binary)]
    poster: Option<Vec<u8>>,
}

/// What the form carried.
struct Form {
    slot: Option<Slot>,
    file: Option<Bytes>,
    poster: Option<Bytes>,
}

/// Reads the form, refusing a field heavier than its limit as soon as it is seen to be.
async fn read_form(multipart: &mut Multipart) -> Result<Form, ApiError> {
    let mut form = Form {
        slot: None,
        file: None,
        poster: None,
    };
    while let Some(mut field) = multipart.next_field().await? {
        let name = field.name().unwrap_or_default().to_string();
        let limit = match name.as_str() {
            "slot" => 16,
            "file" => MAX_VIDEO_BYTES,
            "poster" => MAX_IMAGE_BYTES,
            _ => return Err(ApiError::InvalidRequest),
        };
        let mut content = BytesMut::new();
        while let Some(chunk) = field.chunk().await? {
            if content.len() + chunk.len() > limit {
                return Err(match name.as_str() {
                    "slot" => ApiError::InvalidRequest,
                    _ => ApiError::PayloadTooLarge,
                });
            }
            content.extend_from_slice(&chunk);
        }
        let content = content.freeze();
        let duplicate = match name.as_str() {
            "slot" => form.slot.replace(parse_slot(&content)?).is_some(),
            "file" => form.file.replace(content).is_some(),
            _ => form.poster.replace(content).is_some(),
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

fn field_error(field: &str, code: &'static str) -> ApiError {
    ApiError::Validation(vec![FieldError::new(field, code)])
}

/// Maps a failed image to the error of the form field it came from.
fn image_error(error: ProcessError, field: &str) -> ApiError {
    match error {
        ProcessError::Unsupported | ProcessError::Corrupt => ApiError::UnsupportedMediaType,
        ProcessError::TooLarge => field_error(field, "image_too_large"),
    }
}

/// An encoded variant as it is stored and recorded.
fn stored(variant: EncodedVariant) -> (StoredVariant, Bytes) {
    (
        StoredVariant {
            name: variant.name,
            width: variant.width,
            format: variant.format,
        },
        Bytes::from(variant.bytes),
    )
}

/// The files to store for an upload, checked and encoded, with the kind of media they make.
async fn prepare(
    storage: &MediaService,
    slot: Slot,
    file: Bytes,
    poster: Option<Bytes>,
) -> Result<(MediaKind, Vec<(StoredVariant, Bytes)>), ApiError> {
    let kind = classify_upload(&file, slot).map_err(|rejection| match rejection {
        UploadRejection::Unsupported => ApiError::UnsupportedMediaType,
        UploadRejection::TooLarge => ApiError::PayloadTooLarge,
        UploadRejection::VideoTooLong => field_error("file", "video_too_long"),
    })?;
    match kind {
        MediaKind::Image => {
            let variants = storage
                .process_image(file, slot)
                .await
                .map_err(|e| image_error(e, "file"))?;
            Ok((kind, variants.into_iter().map(stored).collect()))
        }
        MediaKind::Video => {
            let poster = poster.ok_or_else(|| field_error("poster", "poster_required"))?;
            let variants = storage
                .process_image(poster, Slot::Header)
                .await
                .map_err(|e| image_error(e, "poster"))?;
            let video = StoredVariant {
                name: VIDEO_FILE.to_string(),
                width: 0,
                format: VariantFormat::Mp4,
            };
            let mut files: Vec<_> = variants.into_iter().map(stored).collect();
            files.push((video, file));
            Ok((kind, files))
        }
    }
}

/// Uploads a header or avatar media of one of the caller's cards.
#[utoipa::path(
    post,
    path = "/api/cards/{id}/media",
    summary = "Upload a media",
    description = "Stores an image (or, in the header, a video with its waiting image) and returns the media with the addresses of its files. The media is shown on the card only once a save of the card (`PUT /api/cards/{id}`) names it as header or avatar.",
    tag = "cards",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the card.")),
    request_body(content = UploadMediaBody, content_type = "multipart/form-data"),
    responses(
        (status = 201, description = "The stored media.", body = MediaView),
        (status = 400, description = "Malformed request or form (`invalid_request`) or refused file (`validation_failed`: `file` is `required`, `image_too_large` or `video_too_long`; `slot` is `required`; `poster` is `poster_required` or `image_too_large`).", body = ErrorBody),
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

    let (kind, files) = prepare(&state.media, slot, file, form.poster).await?;
    let record = MediaRecord {
        id: Uuid::now_v7(),
        card_id,
        slot,
        kind,
        variants: files.iter().map(|(variant, _)| variant.clone()).collect(),
    };
    for (variant, bytes) in files {
        let key = storage_key(card_id, record.id, &variant.name);
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
                Audience::Dashboard(state.clock.now()),
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
