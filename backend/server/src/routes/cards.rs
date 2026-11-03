//! Owner routes for cards: list, create, read, update (with slug change), delete, disable,
//! enable and duplicate (EDI-001, EDI-008, EDI-013, EDI-014, EDI-015, LNK-001 to LNK-003,
//! LNK-005, LNK-009, LNK-011 to LNK-014, LNK-022, LNK-025, LNK-028, ACC-017).

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use cartouche_domain::{
    CardInput, ContentInput, FieldError, LinkInput, Slot, Slug, SlugClaim, SlugClaimError, Theme,
    ValidCard, decide_claim, invalid_media_refs, storage_key, validate_card,
};
use serde::{Deserialize, Serialize};
use sqlx::PgConnection;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::ApprovedUser;
use crate::db::media::{MediaRecord, StoredVariant};
use crate::db::{cards, media, slugs};
use crate::error::{ApiError, ErrorBody};
use crate::extract::{ApiJson, ApiPath};
use crate::media::MediaService;
use crate::state::AppState;
use crate::views::CardView;

#[derive(Debug, Serialize, ToSchema)]
pub struct CardList {
    /// The caller's cards, oldest first.
    pub cards: Vec<CardView>,
}

/// Lists the caller's cards, oldest first.
#[utoipa::path(
    get,
    path = "/api/cards",
    summary = "List my cards",
    description = "The caller's cards, oldest first. Other users' cards are never listed.",
    tag = "cards",
    security(("bearer" = [])),
    responses(
        (status = 200, description = "The caller's cards.", body = CardList),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller's account is not approved (`account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn list_cards(
    ApprovedUser(me): ApprovedUser,
    State(state): State<AppState>,
) -> Result<Json<CardList>, ApiError> {
    let owned = cards::list_for_owner(&state.db, me.user.id).await?;
    let ids: Vec<Uuid> = owned.iter().map(|card| card.id).collect();
    let attached = media::list_attached(&state.db, me.user.id, &ids).await?;
    let cards = owned
        .into_iter()
        .map(|card| CardView::new(card, &attached, &state.config, &state.media))
        .collect::<Result<_, _>>()?;
    Ok(Json(CardList { cards }))
}

/// A new card: its slug and, usually, the name to show.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateCardBody {
    pub slug: String,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
}

/// Claims the slug for the card, mapping a lost race to `slug_taken` (LNK-022).
async fn claim_slug(
    tx: &mut PgConnection,
    owner_id: Uuid,
    card_id: Option<Uuid>,
    slug: &Slug,
) -> Result<SlugClaim, ApiError> {
    let existing = slugs::find_for_update(tx, slug.as_str()).await?;
    decide_claim(existing.as_ref(), owner_id, card_id).map_err(|e| match e {
        SlugClaimError::Taken => ApiError::SlugTaken,
        SlugClaimError::Reserved => ApiError::SlugReserved,
    })
}

/// A unique violation means another request inserted the same new slug first.
fn slug_race(error: sqlx::Error) -> ApiError {
    if slugs::is_unique_violation(&error) {
        ApiError::SlugTaken
    } else {
        error.into()
    }
}

/// Creates a card with the default template and theme (EDI-013).
#[utoipa::path(
    post,
    path = "/api/cards",
    summary = "Create a card",
    description = "Creates a card with the default template and theme, and claims its slug.",
    tag = "cards",
    security(("bearer" = [])),
    request_body = CreateCardBody,
    responses(
        (status = 201, description = "The new card.", body = CardView),
        (status = 400, description = "Malformed body (`invalid_request`) or invalid fields (`validation_failed`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller's account is not approved (`account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 409, description = "The slug is not available (`slug_taken`, `slug_reserved`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn create_card(
    ApprovedUser(me): ApprovedUser,
    State(state): State<AppState>,
    ApiJson(body): ApiJson<CreateCardBody>,
) -> Result<(StatusCode, Json<CardView>), ApiError> {
    let valid: ValidCard = validate_card(CardInput::new_card(
        body.slug,
        body.first_name,
        body.last_name,
    ))
    .map_err(ApiError::Validation)?;

    let owner_id = me.user.id;
    let card_id = Uuid::now_v7();
    let mut tx = state.db.begin().await?;
    let claim = claim_slug(&mut tx, owner_id, None, &valid.slug).await?;
    // The slug row references the card, so the card goes first.
    let card = cards::insert(&mut tx, owner_id, card_id, &valid)
        .await
        .map_err(slug_race)?;
    slugs::apply_claim(&mut tx, owner_id, card_id, &valid.slug, claim)
        .await
        .map_err(slug_race)?;
    tx.commit().await.map_err(slug_race)?;
    Ok((
        StatusCode::CREATED,
        Json(CardView::new(card, &[], &state.config, &state.media)?),
    ))
}

/// Reads one of the caller's cards.
#[utoipa::path(
    get,
    path = "/api/cards/{id}",
    summary = "Get a card",
    description = "One of the caller's cards. A card of another user is reported as not found.",
    tag = "cards",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the card.")),
    responses(
        (status = 200, description = "The card.", body = CardView),
        (status = 400, description = "Malformed id (`invalid_request`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller's account is not approved (`account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such card for the caller (`not_found`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn get_card(
    ApprovedUser(me): ApprovedUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<CardView>, ApiError> {
    let card = cards::find_for_owner(&state.db, me.user.id, id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let attached = media::list_attached(&state.db, me.user.id, &[id]).await?;
    Ok(Json(CardView::new(
        card,
        &attached,
        &state.config,
        &state.media,
    )?))
}

/// The whole editable content of a card; it replaces what is stored.
#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateCardBody {
    pub slug: String,
    pub template: String,
    /// Template-specific settings: a JSON object of at most 8 192 bytes.
    #[schema(value_type = Object)]
    pub settings: serde_json::Value,
    /// Received as raw JSON so that an invalid theme is a field error (`invalid_theme`).
    #[schema(value_type = Theme)]
    pub theme: serde_json::Value,
    pub content: ContentInput,
    pub links: Vec<LinkInput>,
    /// The header media: one of this card's uploads in the `header` slot. Absent or null
    /// removes it.
    pub header_media_id: Option<Uuid>,
    /// The profile photo: one of this card's uploads in the `avatar` slot. Absent or null
    /// removes it.
    pub avatar_media_id: Option<Uuid>,
}

/// Saves a card in one transaction: all validation errors first, then the slug claim (a
/// slug change keeps the old slug reserved), then the content and its media. Uploads that
/// are not kept are deleted with their files once the save is committed (MED-018). Anything
/// rejected leaves the card as it was (EDI-015).
#[utoipa::path(
    put,
    path = "/api/cards/{id}",
    summary = "Update a card",
    description = "Replaces the card's slug, template, settings, theme, content, links, header and avatar. All invalid fields are reported at once; nothing is saved unless everything is valid and the slug is available. Uploaded media that are neither the header nor the avatar are deleted.",
    tag = "cards",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the card.")),
    request_body = UpdateCardBody,
    responses(
        (status = 200, description = "The saved card.", body = CardView),
        (status = 400, description = "Malformed id or body (`invalid_request`) or invalid fields (`validation_failed`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller's account is not approved (`account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such card for the caller (`not_found`).", body = ErrorBody),
        (status = 409, description = "The slug is not available (`slug_taken`, `slug_reserved`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn update_card(
    ApprovedUser(me): ApprovedUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<UpdateCardBody>,
) -> Result<Json<CardView>, ApiError> {
    let (header_media_id, avatar_media_id) = (body.header_media_id, body.avatar_media_id);
    let validated = validate_card(CardInput {
        slug: body.slug,
        template: body.template,
        settings: body.settings,
        theme: body.theme,
        content: body.content,
        links: body.links,
    });

    let owner_id = me.user.id;
    let mut tx = state.db.begin().await?;
    // The lock keeps a concurrent deletion or upload out until this save is committed.
    if cards::lock_for_owner(&mut tx, owner_id, id)
        .await?
        .is_none()
    {
        return Err(ApiError::NotFound);
    }
    let card_media: Vec<_> = media::list_for_card(&mut *tx, owner_id, id)
        .await?
        .into_iter()
        .map(|m| (m.id, m.slot))
        .collect();
    let media_errors = invalid_media_refs(header_media_id, avatar_media_id, &card_media);
    let valid = match validated {
        Ok(valid) if media_errors.is_empty() => valid,
        Ok(_) => return Err(ApiError::Validation(media_errors)),
        Err(mut errors) => {
            errors.extend(media_errors);
            return Err(ApiError::Validation(errors));
        }
    };

    let claim = claim_slug(&mut tx, owner_id, Some(id), &valid.slug).await?;
    // Before the update, which re-reads the current slug.
    slugs::apply_claim(&mut tx, owner_id, id, &valid.slug, claim)
        .await
        .map_err(slug_race)?;
    let card = cards::update(
        &mut tx,
        owner_id,
        id,
        &valid,
        header_media_id,
        avatar_media_id,
    )
    .await?
    .ok_or(ApiError::NotFound)?;
    let removed = media::delete_unreferenced(&mut tx, owner_id, id).await?;
    let attached = media::list_attached(&mut *tx, owner_id, &[id]).await?;
    tx.commit().await?;
    remove_media_files(&state.media, &removed).await;
    Ok(Json(CardView::new(
        card,
        &attached,
        &state.config,
        &state.media,
    )?))
}

/// Deletes the files of media whose rows are gone. Rows are authoritative: a file that
/// cannot be removed is logged and left behind, the request still succeeds.
async fn remove_media_files(storage: &MediaService, removed: &[MediaRecord]) {
    for record in removed {
        if let Err(error) = storage.delete_media(record.card_id, record.id).await {
            tracing::warn!(media_id = %record.id, card_id = %record.card_id, %error, "cannot delete media files");
        }
    }
}

/// Deletes a card; its slugs stay reserved to the caller.
#[utoipa::path(
    delete,
    path = "/api/cards/{id}",
    summary = "Delete a card",
    description = "Deletes the card and its media. Its slugs stay reserved to the caller and can be reclaimed by them only.",
    tag = "cards",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the card.")),
    responses(
        (status = 204, description = "The card is deleted."),
        (status = 400, description = "Malformed id (`invalid_request`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller's account is not approved (`account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such card for the caller (`not_found`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn delete_card(
    ApprovedUser(me): ApprovedUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiError> {
    let mut tx = state.db.begin().await?;
    if !cards::delete_for_owner(&mut tx, me.user.id, id).await? {
        return Err(ApiError::NotFound);
    }
    tx.commit().await?;
    // MED-019. The card is gone whatever happens to its files.
    if let Err(error) = state.media.delete_card(id).await {
        tracing::warn!(card_id = %id, %error, "cannot delete card media files");
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Sets or clears the owner's own switch, once the card is known to be the caller's and not
/// disabled by support.
async fn set_disabled(
    state: &AppState,
    owner_id: Uuid,
    id: Uuid,
    disabled: bool,
) -> Result<Json<CardView>, ApiError> {
    let mut tx = state.db.begin().await?;
    let locked = cards::lock_for_owner(&mut tx, owner_id, id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if locked.support_disabled {
        return Err(ApiError::CardDisabledBySupport);
    }
    let at = disabled.then(|| state.clock.now());
    let card = cards::set_owner_disabled(&mut tx, owner_id, id, at)
        .await?
        .ok_or(ApiError::NotFound)?;
    let attached = media::list_attached(&mut *tx, owner_id, &[id]).await?;
    tx.commit().await?;
    Ok(Json(CardView::new(
        card,
        &attached,
        &state.config,
        &state.media,
    )?))
}

/// Disables a card: its public page stops being served (LNK-005).
#[utoipa::path(
    post,
    path = "/api/cards/{id}/disable",
    summary = "Disable a card",
    description = "Turns the card off. Its link, content and media are kept and it stays in the list. Idempotent. Refused while support has disabled the card.",
    tag = "cards",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the card.")),
    responses(
        (status = 200, description = "The card, now disabled.", body = CardView),
        (status = 400, description = "Malformed id (`invalid_request`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller's account is not approved (`account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such card for the caller (`not_found`).", body = ErrorBody),
        (status = 409, description = "Support disabled the card (`card_disabled_by_support`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn disable_card(
    ApprovedUser(me): ApprovedUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<CardView>, ApiError> {
    set_disabled(&state, me.user.id, id, true).await
}

/// Enables a card again (LNK-009).
#[utoipa::path(
    post,
    path = "/api/cards/{id}/enable",
    summary = "Enable a card",
    description = "Turns the card back on with its link, content and media unchanged. Idempotent. Refused while support has disabled the card.",
    tag = "cards",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the card.")),
    responses(
        (status = 200, description = "The card, now active.", body = CardView),
        (status = 400, description = "Malformed id (`invalid_request`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller's account is not approved (`account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such card for the caller (`not_found`).", body = ErrorBody),
        (status = 409, description = "Support disabled the card (`card_disabled_by_support`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn enable_card(
    ApprovedUser(me): ApprovedUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<CardView>, ApiError> {
    set_disabled(&state, me.user.id, id, false).await
}

/// The slug of a duplicate.
#[derive(Debug, Deserialize, ToSchema)]
pub struct DuplicateCardBody {
    pub slug: String,
}

/// A media of the source card and its copy on the new card.
struct MediaCopy {
    source: MediaRecord,
    copy: MediaRecord,
}

/// Storage keys of every variant of `source` and of its `copy`.
fn variant_keys<'a>(
    source: &'a MediaRecord,
    copy: &'a MediaRecord,
) -> impl Iterator<Item = (String, String)> + 'a {
    source
        .variants
        .iter()
        .map(move |StoredVariant { name, .. }| {
            (
                storage_key(source.card_id, source.id, name),
                storage_key(copy.card_id, copy.id, name),
            )
        })
}

/// Copies the files of every media of `copies`; when one fails, removes what was copied.
async fn copy_files(storage: &MediaService, copies: &[MediaCopy]) -> Result<(), ApiError> {
    for MediaCopy { source, copy } in copies {
        for (from, to) in variant_keys(source, copy) {
            if let Err(error) = storage.copy(&from, &to).await {
                remove_copied_files(storage, copies).await;
                return Err(error.into());
            }
        }
    }
    Ok(())
}

/// Best effort: removes the files of the copies after a failure.
async fn remove_copied_files(storage: &MediaService, copies: &[MediaCopy]) {
    for MediaCopy { copy, .. } in copies {
        if let Err(error) = storage.delete_media(copy.card_id, copy.id).await {
            tracing::warn!(media_id = %copy.id, card_id = %copy.card_id, %error, "cannot delete copied media files");
        }
    }
}

/// Records the new card, its slug and its media in the transaction, and commits it.
async fn record_duplicate(
    mut tx: sqlx::Transaction<'_, sqlx::Postgres>,
    owner_id: Uuid,
    source_id: Uuid,
    new_id: Uuid,
    slug: &Slug,
    claim: SlugClaim,
    copies: &[MediaCopy],
) -> Result<(cards::Card, Vec<MediaRecord>), ApiError> {
    let card = cards::duplicate(&mut tx, owner_id, source_id, new_id, slug.as_str())
        .await
        .map_err(slug_race)?
        .ok_or(ApiError::NotFound)?;
    slugs::apply_claim(&mut tx, owner_id, new_id, slug, claim)
        .await
        .map_err(slug_race)?;
    let mut attached = Vec::new();
    let (mut header_id, mut avatar_id) = (None, None);
    for MediaCopy { source, copy } in copies {
        let recorded = media::insert(&mut tx, owner_id, copy.clone())
            .await?
            .ok_or(ApiError::NotFound)?;
        match source.slot {
            Slot::Header => header_id = Some(recorded.id),
            Slot::Avatar => avatar_id = Some(recorded.id),
        }
        attached.push(recorded);
    }
    let card = if attached.is_empty() {
        card
    } else {
        cards::set_media(&mut tx, owner_id, new_id, header_id, avatar_id)
            .await?
            .ok_or(ApiError::NotFound)?
    };
    tx.commit().await.map_err(slug_race)?;
    Ok((card, attached))
}

/// Duplicates a card under a new slug (EDI-001, EDI-014).
#[utoipa::path(
    post,
    path = "/api/cards/{id}/duplicate",
    summary = "Duplicate a card",
    description = "Creates an active card with the source's template, settings, theme, content and links under a new slug, and a copy of its header and avatar. Slug history and uploads that are not attached are not copied. Refused while support has disabled the source.",
    tag = "cards",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the card to copy.")),
    request_body = DuplicateCardBody,
    responses(
        (status = 201, description = "The new card.", body = CardView),
        (status = 400, description = "Malformed id or body (`invalid_request`) or invalid slug (`validation_failed`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller's account is not approved (`account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such card for the caller (`not_found`).", body = ErrorBody),
        (status = 409, description = "The slug is not available (`slug_taken`, `slug_reserved`) or support disabled the source (`card_disabled_by_support`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn duplicate_card(
    ApprovedUser(me): ApprovedUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<DuplicateCardBody>,
) -> Result<(StatusCode, Json<CardView>), ApiError> {
    let slug = Slug::parse(&body.slug)
        .map_err(|_| ApiError::Validation(vec![FieldError::new("slug", "invalid_slug")]))?;

    let owner_id = me.user.id;
    let mut tx = state.db.begin().await?;
    let locked = cards::lock_for_owner(&mut tx, owner_id, id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if locked.support_disabled {
        return Err(ApiError::CardDisabledBySupport);
    }
    let claim = claim_slug(&mut tx, owner_id, None, &slug).await?;

    let new_id = Uuid::now_v7();
    let copies: Vec<MediaCopy> = media::list_attached(&mut *tx, owner_id, &[id])
        .await?
        .into_iter()
        .map(|source| {
            let copy = MediaRecord {
                id: Uuid::now_v7(),
                card_id: new_id,
                ..source.clone()
            };
            MediaCopy { source, copy }
        })
        .collect();
    // Files first: the new rows only ever point at files that exist.
    copy_files(&state.media, &copies).await?;
    match record_duplicate(tx, owner_id, id, new_id, &slug, claim, &copies).await {
        Ok((card, attached)) => Ok((
            StatusCode::CREATED,
            Json(CardView::new(card, &attached, &state.config, &state.media)?),
        )),
        Err(error) => {
            remove_copied_files(&state.media, &copies).await;
            Err(error)
        }
    }
}
