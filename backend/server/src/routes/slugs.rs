//! Slug suggestion and availability for the signed-in owner (LNK-019, LNK-020).

use axum::Json;
use axum::extract::State;
use cartouche_domain::{Slug, SlugClaim, SlugClaimError, decide_claim, suggest_base, with_suffix};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::auth::ApprovedUser;
use crate::db::{blocked_slugs, slugs};
use crate::error::{ApiError, ErrorBody};
use crate::extract::ApiQuery;
use crate::state::AppState;

/// Highest numeric suffix tried by the suggestion (`base`, `base-2`, ..., `base-100`).
const MAX_SUGGESTION_SUFFIX: u32 = 100;

/// Number of alternatives proposed when a slug is taken (LNK-035).
const ALTERNATIVES: usize = 3;

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct SuggestionQuery {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SlugSuggestion {
    /// A free slug derived from the name, or `null` when the name gives nothing usable.
    pub slug: Option<String>,
}

/// Suggests the first free slug derived from a name.
#[utoipa::path(
    get,
    path = "/api/slugs/suggestion",
    summary = "Suggest a slug",
    description = "The first free slug among the name's base form, then the base with the suffixes `-2` to `-100`. `null` when the name gives no usable base or all are taken.",
    tag = "cards",
    security(("bearer" = [])),
    params(SuggestionQuery),
    responses(
        (status = 200, description = "The suggestion.", body = SlugSuggestion),
        (status = 400, description = "Malformed query (`invalid_request`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller's account is not approved (`account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn suggest_slug(
    ApprovedUser(me): ApprovedUser,
    State(state): State<AppState>,
    ApiQuery(query): ApiQuery<SuggestionQuery>,
) -> Result<Json<SlugSuggestion>, ApiError> {
    let first_name = query.first_name.unwrap_or_default();
    let last_name = query.last_name.unwrap_or_default();
    let Some(base) = suggest_base(&first_name, &last_name) else {
        return Ok(Json(SlugSuggestion { slug: None }));
    };
    let candidates = std::iter::once(base.clone())
        .chain((2..=MAX_SUGGESTION_SUFFIX).map(|n| with_suffix(&base, n)));
    for candidate in candidates {
        let existing = slugs::find(&state.db, candidate.as_str()).await?;
        let blocked = blocked_slugs::is_blocked(&state.db, candidate.as_str()).await?;
        if decide_claim(existing.as_ref(), blocked, me.user.id, None).is_ok() {
            return Ok(Json(SlugSuggestion {
                slug: Some(candidate.as_str().to_owned()),
            }));
        }
    }
    Ok(Json(SlugSuggestion { slug: None }))
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct AvailabilityQuery {
    /// The slug to check, in any case.
    #[serde(default)]
    pub slug: String,
    /// The card being edited, if any.
    pub card_id: Option<Uuid>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SlugAvailabilityStatus {
    /// Can be claimed.
    Free,
    /// It is the current slug of the card being edited.
    Current,
    /// An old slug of another card of the caller.
    Reserved,
    /// Held by someone else.
    Taken,
    /// Not a valid slug.
    Invalid,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SlugAvailability {
    /// The slug as normalized; `null` when it is invalid.
    pub slug: Option<String>,
    pub status: SlugAvailabilityStatus,
    /// When the slug is taken or reserved: the first three available slugs of `<slug>-2`,
    /// `<slug>-3`, ... (blocked slugs skipped, LNK-035); empty otherwise.
    pub suggestions: Vec<String>,
}

/// The first `ALTERNATIVES` slugs among `<slug>-2`, `<slug>-3`, ... that the caller can claim.
async fn alternatives(
    state: &AppState,
    owner_id: Uuid,
    slug: &Slug,
    card_id: Option<Uuid>,
) -> Result<Vec<String>, ApiError> {
    let mut found = Vec::with_capacity(ALTERNATIVES);
    for n in 2..=MAX_SUGGESTION_SUFFIX {
        let candidate = with_suffix(slug, n);
        let existing = slugs::find(&state.db, candidate.as_str()).await?;
        let blocked = blocked_slugs::is_blocked(&state.db, candidate.as_str()).await?;
        if decide_claim(existing.as_ref(), blocked, owner_id, card_id).is_ok() {
            found.push(candidate.as_str().to_owned());
            if found.len() == ALTERNATIVES {
                break;
            }
        }
    }
    Ok(found)
}

/// Tells whether the caller can use a slug on a card.
#[utoipa::path(
    get,
    path = "/api/slugs/availability",
    summary = "Check a slug",
    description = "Whether the slug can be claimed by the caller for the card being edited (`card_id`), or for a new card when omitted. When it is taken or reserved, three available alternatives are proposed. Never says who holds a taken slug.",
    tag = "cards",
    security(("bearer" = [])),
    params(AvailabilityQuery),
    responses(
        (status = 200, description = "The slug's normalized form and status.", body = SlugAvailability),
        (status = 400, description = "Malformed query (`invalid_request`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller's account is not approved (`account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn slug_availability(
    ApprovedUser(me): ApprovedUser,
    State(state): State<AppState>,
    ApiQuery(query): ApiQuery<AvailabilityQuery>,
) -> Result<Json<SlugAvailability>, ApiError> {
    let Ok(slug) = Slug::parse(&query.slug) else {
        return Ok(Json(SlugAvailability {
            slug: None,
            status: SlugAvailabilityStatus::Invalid,
            suggestions: Vec::new(),
        }));
    };
    let existing = slugs::find(&state.db, slug.as_str()).await?;
    let blocked = blocked_slugs::is_blocked(&state.db, slug.as_str()).await?;
    let status = match decide_claim(existing.as_ref(), blocked, me.user.id, query.card_id) {
        Ok(SlugClaim::AlreadyCurrent) => SlugAvailabilityStatus::Current,
        Ok(_) => SlugAvailabilityStatus::Free,
        Err(SlugClaimError::Reserved) => SlugAvailabilityStatus::Reserved,
        Err(SlugClaimError::Taken) => SlugAvailabilityStatus::Taken,
    };
    let suggestions = match status {
        SlugAvailabilityStatus::Taken | SlugAvailabilityStatus::Reserved => {
            alternatives(&state, me.user.id, &slug, query.card_id).await?
        }
        _ => Vec::new(),
    };
    Ok(Json(SlugAvailability {
        slug: Some(slug.as_str().to_owned()),
        status,
        suggestions,
    }))
}
