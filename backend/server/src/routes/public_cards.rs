//! Public routes, open to anyone: resolve a slug to what the visitor should see, and download
//! the vCard (LNK-003, LNK-006, LNK-007, LNK-021, LNK-023, LNK-024, LNK-026, LNK-027,
//! PUB-011, PUB-014, PUB-025, PUB-027).

use axum::Json;
use axum::extract::State;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Redirect, Response};
use cartouche_domain::{VCard, is_served, render_vcard, storage_key};
use serde::Serialize;
use utoipa::ToSchema;

use crate::db::cards::Card;
use crate::db::media::{self, MediaRecord};
use crate::db::public_cards::{self, Resolution};
use crate::error::{ApiError, ErrorBody};
use crate::extract::ApiPath;
use crate::state::AppState;
use crate::views::PublicCard;

/// What a visitor gets for a slug.
#[derive(Debug, Serialize, ToSchema)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum PublicCardResponse {
    /// The card is served.
    Active { card: Box<PublicCard> },
    /// The card is not served, whatever the reason (disabled, deleted, owner suspended):
    /// nothing else is said (LNK-027).
    Inactive,
    /// The address is not the canonical one: an old slug or capitals (LNK-003, LNK-021).
    Redirect {
        /// The slug to go to.
        slug: String,
    },
}

/// The outcome of looking a slug up, shared by the page and the vCard.
enum Lookup {
    Serve(Box<Card>),
    Inactive,
    Redirect(String),
}

/// Looks up the slug as typed in the address: stored slugs are lowercase, so a differing
/// input or an old slug is a redirect. A card that is not served is neutral from every
/// address, so that nothing tells why, nor where its current slug is (LNK-027).
async fn lookup(state: &AppState, input: &str) -> Result<Lookup, ApiError> {
    let lowered = input.to_lowercase();
    let (card, owner, moved) = match public_cards::resolve(&state.db, &lowered).await? {
        None => return Err(ApiError::NotFound),
        Some(Resolution::Deleted) => return Ok(Lookup::Inactive),
        Some(Resolution::Old { card, owner }) => (card, owner, true),
        Some(Resolution::Current(card, owner)) => (card, owner, lowered != input),
    };
    Ok(if !is_served(card.status(), owner) {
        Lookup::Inactive
    } else if moved {
        Lookup::Redirect(card.slug)
    } else {
        Lookup::Serve(Box::new(card))
    })
}

/// Resolves a slug to the card to show, a redirect or the neutral state.
#[utoipa::path(
    get,
    path = "/api/public/cards/{slug}",
    summary = "Resolve a public card",
    description = "No token needed. `active` carries the card; `inactive` carries nothing (the card is disabled, deleted or its owner suspended); `redirect` names the current slug for an old slug or a slug written with capitals. A slug never attributed is a 404.",
    tag = "public",
    params(("slug" = String, Path, description = "The slug, in any case.")),
    responses(
        (status = 200, description = "The card, the neutral state or a redirect.", body = PublicCardResponse),
        (status = 404, description = "The slug was never attributed (`not_found`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn get_public_card(
    State(state): State<AppState>,
    ApiPath(slug): ApiPath<String>,
) -> Result<Json<PublicCardResponse>, ApiError> {
    let response = match lookup(&state, &slug).await? {
        Lookup::Inactive => PublicCardResponse::Inactive,
        Lookup::Redirect(slug) => PublicCardResponse::Redirect { slug },
        Lookup::Serve(card) => {
            let attached = media::list_attached(&state.db, card.owner_id, &[card.id]).await?;
            PublicCardResponse::Active {
                card: Box::new(PublicCard::new(
                    *card,
                    &attached,
                    &state.config,
                    &state.media,
                )?),
            }
        }
    };
    Ok(Json(response))
}

/// The bytes of the avatar's smallest JPEG, or `None` (with a warning) when it cannot be read:
/// a missing photo must not fail the download.
async fn avatar_photo(state: &AppState, card: &Card, attached: &[MediaRecord]) -> Option<Vec<u8>> {
    let avatar = attached
        .iter()
        .find(|m| Some(m.id) == card.avatar_media_id)?;
    let variant = avatar.smallest_jpeg()?;
    let key = storage_key(card.id, avatar.id, &variant.name);
    match state.media.get(&key, None).await {
        Ok(file) => Some(file.bytes.to_vec()),
        Err(error) => {
            tracing::warn!(%error, key, "vCard photo unreadable, serving the vCard without it");
            None
        }
    }
}

/// Downloads the card's contact as a vCard.
#[utoipa::path(
    get,
    path = "/api/public/cards/{slug}/vcard",
    summary = "Download the vCard",
    description = "No token needed. A vCard 3.0 with the card's content, one `URL` per link and the profile photo (the smallest JPEG). An old slug or a slug with capitals answers 308 towards the current address; a card that is not served is `410 card_inactive`.",
    tag = "public",
    params(("slug" = String, Path, description = "The slug, in any case.")),
    responses(
        (status = 200, description = "The vCard, as an attachment named `<slug>.vcf`.", content_type = "text/vcard", body = String),
        (status = 308, description = "Permanent redirect to the vCard of the current slug.", headers(("Location" = String, description = "`/api/public/cards/<current>/vcard`"))),
        (status = 404, description = "The slug was never attributed (`not_found`).", body = ErrorBody),
        (status = 410, description = "The card is not served (`card_inactive`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn get_public_vcard(
    State(state): State<AppState>,
    ApiPath(slug): ApiPath<String>,
) -> Result<Response, ApiError> {
    let card = match lookup(&state, &slug).await? {
        Lookup::Inactive => return Err(ApiError::CardInactive),
        Lookup::Redirect(current) => {
            return Ok(
                Redirect::permanent(&format!("/api/public/cards/{current}/vcard")).into_response(),
            );
        }
        Lookup::Serve(card) => card,
    };
    let attached = media::list_attached(&state.db, card.owner_id, &[card.id]).await?;
    let photo = avatar_photo(&state, &card, &attached).await;
    let body = render_vcard(&VCard {
        content: &card.content,
        urls: card.links.iter().map(|link| link.url.as_str()).collect(),
        photo_jpeg: photo.as_deref(),
    });
    let disposition = HeaderValue::from_str(&format!("attachment; filename=\"{}.vcf\"", card.slug))
        .map_err(|e| ApiError::Internal(format!("vCard file name: {e}")))?;
    Ok((
        StatusCode::OK,
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("text/vcard; charset=utf-8"),
            ),
            (header::CONTENT_DISPOSITION, disposition),
        ],
        body,
    )
        .into_response())
}
