//! Media upload for a card (MED-001 to MED-008, MED-012, MED-013, MED-015, MED-018, MED-020,
//! MED-025 to MED-029, MED-034 to MED-040). An upload only creates the media and its files; the card shows it once
//! a save attaches it.

use std::time::Duration;

use axum::Json;
use axum::extract::{Multipart, State};
use axum::http::StatusCode;
use bytes::{Bytes, BytesMut};
use cartouche_domain::{
    CropRect, FieldError, Framing, MAX_VIDEO_BYTES, MediaKind, ORIGINAL_FILE, Slot,
    UploadRejection, VIDEO_FILE, VariantFormat, VideoLoop, check_video_framing, classify_upload,
    mp4_duration, storage_key,
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
use crate::media::transcode::{TranscodeError, TranscodeRequest, Transcoded, transcode};
use crate::media::video::VideoService;
use crate::media::{MediaService, new_edit_copy_name, new_source_name};
use crate::state::AppState;
use crate::views::{Audience, MediaView};

/// Largest request body of the upload route: a video and the framing.
pub const UPLOAD_BODY_LIMIT: usize = 52 << 20;

/// Longest framing field (`crop`, `loop`, `poster_time`), in bytes.
const FRAMING_FIELD_LIMIT: usize = 512;

/// Shape of the multipart form, for the API description only.
#[derive(ToSchema)]
#[allow(dead_code)]
pub struct UploadMediaBody {
    /// Where the media is shown. A video is only accepted in `header`.
    slot: Slot,
    /// A JPEG, PNG or WebP image (10 MB, 40 million pixels at most), or in `header` an MP4
    /// video (50 MB, 30 s at most). The type is read from the content.
    #[schema(value_type = String, format = Binary)]
    file: Vec<u8>,
    /// JSON `{x, y, width, height}` in proportions of the image (of the displayed frame, for a
    /// video): 4:3 for the header, square for the avatar. Default: the largest centred one.
    #[schema(value_type = Option<String>)]
    crop: Option<String>,
    /// Video only. JSON `{start, end}` in seconds. Default: the whole video.
    #[schema(value_type = Option<String>, rename = "loop")]
    video_loop: Option<String>,
    /// Video only. The time of the placeholder image the server extracts, in seconds, as a
    /// decimal. Default: 0.
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
            "crop" | "loop" | "poster_time" => FRAMING_FIELD_LIMIT,
            _ => return Err(ApiError::InvalidRequest),
        };
        let mut content = BytesMut::new();
        while let Some(chunk) = field.chunk().await? {
            if content.len() + chunk.len() > limit {
                return Err(match name.as_str() {
                    "file" => ApiError::PayloadTooLarge,
                    _ => ApiError::InvalidRequest,
                });
            }
            content.extend_from_slice(&chunk);
        }
        let content = content.freeze();
        let duplicate = match name.as_str() {
            "slot" => form.slot.replace(parse_slot(&content)?).is_some(),
            "file" => form.file.replace(content).is_some(),
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
    /// Files for the private store (a video's original, MED-036): name and bytes.
    private_files: Vec<(String, Bytes)>,
    /// Files of another media of the card to copy under a name of the new one: (storage key of
    /// the original, name of the copy).
    copies: Vec<(String, String)>,
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
            private_files: Vec::new(),
            copies: Vec::new(),
        }
    }

    /// A video: the served file, the edit copy as the source, the placeholder variants and the
    /// uploaded bytes kept as the private original (MED-004, MED-034, MED-036, MED-037).
    fn of_video(
        original: Bytes,
        transcoded: Transcoded,
        placeholder: Vec<EncodedVariant>,
        framing: Framing,
        duration: Duration,
    ) -> Result<Prepared, ApiError> {
        let edit_copy = transcoded
            .edit_copy
            .ok_or_else(|| ApiError::Internal("the video job produced no edit copy".to_string()))?;
        let source = SourceFile {
            name: new_edit_copy_name(),
            width: edit_copy.width,
            height: edit_copy.height,
        };
        let mut files = vec![
            (VIDEO_FILE.to_string(), transcoded.served),
            (source.name.clone(), edit_copy.bytes),
        ];
        let mut variants = Vec::new();
        for (name, bytes, variant) in placeholder.into_iter().map(stored) {
            files.push((name, bytes));
            variants.push(variant);
        }
        let prepared = Prepared {
            kind: MediaKind::Video,
            files,
            variants,
            source,
            framing,
            duration_ms: None,
            private_files: vec![(ORIGINAL_FILE.to_string(), original)],
            copies: Vec::new(),
        };
        Ok(prepared.with_video(duration))
    }

    /// Records the video: its variant and duration. Its file is stored or copied by the caller.
    fn with_video(mut self, duration: Duration) -> Prepared {
        self.variants.push(StoredVariant {
            name: VIDEO_FILE.to_string(),
            width: 0,
            format: VariantFormat::Mp4,
        });
        self.duration_ms = Some(u32::try_from(duration.as_millis()).unwrap_or(u32::MAX));
        self
    }

    /// Keeps the stored source as it is instead of the one just encoded (which would lose
    /// quality again): the source is copied from `from_key` under its new name. The source of
    /// `of_image` is the first of the files.
    fn keep_source(&mut self, from_key: String) {
        self.files.remove(0);
        self.copies.push((from_key, self.source.name.clone()));
    }
}

/// The loop and the poster time of a video, or the fields refused (MED-028).
fn video_framing(
    video_loop: Option<VideoLoop>,
    poster_time: Option<f64>,
    duration: Duration,
) -> Result<(VideoLoop, f64), ApiError> {
    check_video_framing(video_loop, poster_time, duration).map_err(|refused| {
        ApiError::Validation(
            refused
                .into_iter()
                .map(|(field, code)| FieldError::new(field, code))
                .collect(),
        )
    })
}

/// The files to store for an upload, checked and encoded, with the framing they were cut along.
async fn prepare(
    storage: &MediaService,
    video: &VideoService,
    slot: Slot,
    file: Bytes,
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
            let (video_loop, poster_time) = video_framing(video_loop, poster_time, duration)?;
            let request = TranscodeRequest {
                duration,
                crop,
                video_loop,
                poster_time,
                edit_copy: true,
            };
            let transcoded = transcode(video, file.clone(), request).await?;
            let crop = transcoded.crop;
            // The placeholder is the frame at the poster time, cut along the video's crop.
            let placeholder = storage
                .prepare_variants(transcoded.poster_frame.clone(), Slot::Header, crop)
                .await
                .map_err(|error| ApiError::Internal(format!("placeholder: {error}")))?;
            let framing = Framing {
                crop,
                video_loop: Some(video_loop),
                poster_time: Some(poster_time),
            };
            Prepared::of_video(file, transcoded, placeholder, framing, duration)
        }
    }
}

impl From<TranscodeError> for ApiError {
    fn from(error: TranscodeError) -> Self {
        match error {
            TranscodeError::UnsupportedCodec => ApiError::UnsupportedMediaType,
            TranscodeError::TooLarge => field_error("file", "video_too_large"),
            TranscodeError::Crop => field_error("crop", "invalid_crop"),
            TranscodeError::Unreadable(message) => {
                tracing::info!(%message, "unreadable video refused");
                field_error("file", "video_unreadable")
            }
            TranscodeError::Timeout => ApiError::VideoProcessingTimeout,
            TranscodeError::Failed(message) => ApiError::Internal(message),
        }
    }
}

/// Uploads a header or avatar media of one of the caller's cards.
#[utoipa::path(
    post,
    path = "/api/cards/{id}/media",
    summary = "Upload a media",
    description = "Stores an image or, in the header, a video, and returns the media with the addresses of its files and its framing. For an image, the server keeps the whole image as the media's source and cuts the files shown along the crop. For a video, the server transcodes the part kept (crop and loop applied) into the file shown, extracts the placeholder image itself, keeps a lighter copy of the whole video as the media's source for the editor and the uploaded file privately, never served. The media is shown on the card only once a save of the card (`PUT /api/cards/{id}`) names it as header or avatar. Refused while support has disabled the card.",
    tag = "cards",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the card.")),
    request_body(content = UploadMediaBody, content_type = "multipart/form-data"),
    responses(
        (status = 201, description = "The stored media.", body = MediaView),
        (status = 400, description = "Malformed request or form, a framing field that does not parse, or a loop or poster time sent with an image, or a `poster` part (`invalid_request`), or refused file or framing (`validation_failed`: `file` is `required`, `image_too_large`, `video_too_long`, `video_unreadable` or `video_too_large`; `slot` is `required`; `crop` is `invalid_crop`; `loop` is `invalid_loop`; `poster_time` is `invalid_poster_time`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller's account is not approved (`account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such card for the caller (`not_found`).", body = ErrorBody),
        (status = 409, description = "Support disabled the card (`card_disabled_by_support`).", body = ErrorBody),
        (status = 413, description = "The file is too heavy: 10 MB for an image, 50 MB for a video (`payload_too_large`).", body = ErrorBody),
        (status = 415, description = "The content is not a supported image or video, or the video codec is not supported (`unsupported_media_type`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`), or the video could not be processed in time (`video_processing_timeout`).", body = ErrorBody),
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
    let card = cards::find_for_owner(&state.db, owner_id, card_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if card.support_disabled_at.is_some() {
        return Err(ApiError::CardDisabledBySupport);
    }

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

    let prepared = prepare(&state.media, &state.video, slot, file, form.framing).await?;
    store(&state, owner_id, card_id, slot, prepared).await
}

/// Stores the files of a prepared media under a new id and records it. If anything fails after
/// the first file, the files already stored are removed from both stores.
async fn store(
    state: &AppState,
    owner_id: Uuid,
    card_id: Uuid,
    slot: Slot,
    prepared: Prepared,
) -> Result<(StatusCode, Json<MediaView>), ApiError> {
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
    for (name, bytes) in prepared.private_files {
        let key = storage_key(card_id, record.id, &name);
        if let Err(error) = state.media.put_private(&key, bytes).await {
            discard_files(&state.media, &record).await;
            return Err(error.into());
        }
    }
    for (from, name) in prepared.copies {
        let to = storage_key(card_id, record.id, &name);
        if let Err(error) = state.media.copy(&from, &to).await {
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

/// Shape of the re-framing form, for the API description only.
#[derive(ToSchema)]
#[allow(dead_code)]
pub struct ReframeMediaBody {
    /// JSON `{x, y, width, height}` in proportions of the source: 4:3 for the header, square
    /// for the avatar.
    #[schema(value_type = String)]
    crop: String,
    /// Video only. JSON `{start, end}` in seconds. Default: the whole video.
    #[schema(value_type = Option<String>, rename = "loop")]
    video_loop: Option<String>,
    /// Video only. The time of the waiting image, in seconds, as a decimal. Default: 0.
    #[schema(value_type = Option<f64>)]
    poster_time: Option<String>,
}

/// The files of a re-framed media: cut along `framing` from the source of `previous`.
async fn prepare_reframed(
    storage: &MediaService,
    previous: &MediaRecord,
    source: &SourceFile,
    framing: FramingFields,
) -> Result<Prepared, ApiError> {
    let FramingFields {
        crop,
        video_loop,
        poster_time,
    } = framing;
    let source_key = storage_key(previous.card_id, previous.id, &source.name);
    // A video is re-framed from its private original (MED-030).
    if previous.kind == MediaKind::Video {
        return Err(ApiError::MediaNotReframable);
    }
    // A loop and a poster time only make sense for a video.
    if video_loop.is_some() || poster_time.is_some() {
        return Err(ApiError::InvalidRequest);
    }
    let stored = storage.get(&source_key, None).await?;
    let image = storage
        .prepare_image(stored.bytes, previous.slot, crop)
        .await
        .map_err(|e| prepare_error(e, "crop"))?;
    let framing = Framing {
        crop: image.crop,
        video_loop: None,
        poster_time: None,
    };
    let mut prepared = Prepared::of_image(previous.kind, image, framing);
    prepared.keep_source(source_key);
    Ok(prepared)
}

/// Makes a new media of a card from the source of one of its media, cut along a new crop.
#[utoipa::path(
    post,
    path = "/api/cards/{id}/media/{media_id}/reframe",
    summary = "Re-frame a media",
    description = "Creates a new media of the same slot and kind from the source of an existing one, cut along a new crop (and, for a video, a new loop and poster time). The previous media and its files are not modified. Like an upload, the new media is shown on the card only once a save of the card (`PUT /api/cards/{id}`) names it, which deletes the previous one if it is no longer used. Refused while support has disabled the card.",
    tag = "cards",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Id of the card."),
        ("media_id" = Uuid, Path, description = "Id of the media of this card to re-frame."),
    ),
    request_body(content = ReframeMediaBody, content_type = "multipart/form-data"),
    responses(
        (status = 201, description = "The new media.", body = MediaView),
        (status = 400, description = "Malformed request or form, a framing field that does not parse, or a loop or poster time sent for an image, or a `poster` part (`invalid_request`), or refused framing (`validation_failed`: `crop` is `required` or `invalid_crop`; `loop` is `invalid_loop`; `poster_time` is `invalid_poster_time`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller's account is not approved (`account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such card or media of this card for the caller (`not_found`).", body = ErrorBody),
        (status = 409, description = "Support disabled the card (`card_disabled_by_support`), or the media was uploaded before plan 6 and has no source: it must be replaced (`media_not_reframable`).", body = ErrorBody),
        (status = 413, description = "The request is too heavy (`payload_too_large`).", body = ErrorBody),
        (status = 415, description = "The source is not a supported image (`unsupported_media_type`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn reframe_media(
    ApprovedUser(me): ApprovedUser,
    State(state): State<AppState>,
    ApiPath((card_id, media_id)): ApiPath<(Uuid, Uuid)>,
    ApiMultipart(mut multipart): ApiMultipart,
) -> Result<(StatusCode, Json<MediaView>), ApiError> {
    let owner_id = me.user.id;
    // Before reading the body: another user's card or media is not found, whatever is sent.
    let card = cards::find_for_owner(&state.db, owner_id, card_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if card.support_disabled_at.is_some() {
        return Err(ApiError::CardDisabledBySupport);
    }
    let previous = media::find_for_owner(&state.db, owner_id, media_id)
        .await?
        .filter(|media| media.card_id == card_id)
        .ok_or(ApiError::NotFound)?;
    let source = previous
        .source
        .clone()
        .ok_or(ApiError::MediaNotReframable)?;

    let form = read_form(&mut multipart).await?;
    // The slot and the kind are those of the previous media.
    if form.slot.is_some() || form.file.is_some() {
        return Err(ApiError::InvalidRequest);
    }
    if form.framing.crop.is_none() {
        return Err(field_error("crop", "required"));
    }

    let prepared = prepare_reframed(&state.media, &previous, &source, form.framing).await?;
    store(&state, owner_id, card_id, previous.slot, prepared).await
}

/// Removes the files of a media that could not be recorded.
async fn discard_files(storage: &MediaService, record: &MediaRecord) {
    if let Err(error) = storage.delete_media(record.card_id, record.id).await {
        tracing::warn!(media_id = %record.id, %error, "cannot delete files of a rejected upload");
    }
}
