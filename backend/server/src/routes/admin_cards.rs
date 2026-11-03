//! Support routes on cards: read a user with their cards, read one card, and block or lift
//! a card (ADM-006, ADM-009, ADM-010, ADM-012 to ADM-015). Read-only apart from the block:
//! there is deliberately no route that edits a card's content (ADM-012).

use axum::Json;
use axum::extract::State;
use serde::Serialize;
use serde_json::json;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::AdminUser;
use crate::db::audit::{self, AuditEntry};
use crate::db::{admin_cards, media, users};
use crate::error::{ApiError, ErrorBody};
use crate::extract::ApiPath;
use crate::routes::admin_users::AdminUserView;
use crate::state::AppState;
use crate::views::CardView;

/// An account and all its cards, whatever their state.
#[derive(Debug, Serialize, ToSchema)]
pub struct AdminUserDetail {
    pub user: AdminUserView,
    /// The account's cards, oldest first.
    pub cards: Vec<CardView>,
}

/// One card with the account that owns it.
#[derive(Debug, Serialize, ToSchema)]
pub struct AdminCardDetail {
    pub card: CardView,
    pub owner: AdminUserView,
}

/// Reads an account and its cards, read-only (ADM-006, ADM-013).
#[utoipa::path(
    get,
    path = "/api/admin/users/{id}",
    summary = "Get an account with its cards",
    description = "The account and all its cards with their state, disabled ones included. Read-only.",
    tag = "admin",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the account.")),
    responses(
        (status = 200, description = "The account and its cards.", body = AdminUserDetail),
        (status = 400, description = "Malformed id (`invalid_request`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller is not an approved administrator (`forbidden`, `account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such account (`not_found`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn get_user(
    _admin: AdminUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<AdminUserDetail>, ApiError> {
    let user = users::find_by_id(&state.db, id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let owned = admin_cards::list_for_user(&state.db, id).await?;
    let ids: Vec<Uuid> = owned.iter().map(|card| card.id).collect();
    let attached = media::list_attached(&state.db, id, &ids).await?;
    let cards = owned
        .into_iter()
        .map(|card| CardView::new(card, &attached, &state.config, &state.media))
        .collect::<Result<_, _>>()?;
    Ok(Json(AdminUserDetail {
        user: AdminUserView::new(user, &state),
        cards,
    }))
}

/// Reads one card, whoever owns it, read-only (ADM-013).
#[utoipa::path(
    get,
    path = "/api/admin/cards/{id}",
    summary = "Get a card as support",
    description = "Any user's card with its full content and its owner, even disabled. Read-only: support cannot edit a card.",
    tag = "admin",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the card.")),
    responses(
        (status = 200, description = "The card and its owner.", body = AdminCardDetail),
        (status = 400, description = "Malformed id (`invalid_request`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller is not an approved administrator (`forbidden`, `account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such card (`not_found`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn get_card(
    _admin: AdminUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<AdminCardDetail>, ApiError> {
    let card = admin_cards::find(&state.db, id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let owner = users::find_by_id(&state.db, card.owner_id)
        .await?
        .ok_or_else(|| ApiError::Internal(format!("card {id} has no owner")))?;
    let attached = media::list_attached(&state.db, card.owner_id, &[id]).await?;
    Ok(Json(AdminCardDetail {
        card: CardView::new(card, &attached, &state.config, &state.media)?,
        owner: AdminUserView::new(owner, &state),
    }))
}

/// Blocks (`blocked`) or lifts support's block on a card and audits it, atomically. The
/// owner's own switch is not touched (LNK-028). A request that would not change the state
/// is refused (ADM-015); any early return drops the transaction, which rolls it back.
async fn set_support_block(
    state: &AppState,
    admin: &AdminUser,
    id: Uuid,
    blocked: bool,
) -> Result<Json<CardView>, ApiError> {
    let mut tx = state.db.begin().await?;
    let card = admin_cards::find_for_update(&mut tx, id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if card.support_disabled_at.is_some() == blocked {
        return Err(ApiError::InvalidTransition);
    }
    let at = blocked.then(|| state.clock.now());
    let updated = admin_cards::set_support_disabled(&mut tx, id, at).await?;
    audit::record(
        &mut tx,
        AuditEntry {
            actor_user_id: admin.0.user.id,
            action: if blocked {
                "card.support_disabled"
            } else {
                "card.support_enabled"
            },
            target_type: "card",
            target_id: id,
            metadata: json!({ "owner_id": card.owner_id, "slug": card.slug }),
        },
    )
    .await?;
    let attached = media::list_attached(&mut *tx, card.owner_id, &[id]).await?;
    tx.commit().await?;
    Ok(Json(CardView::new(
        updated,
        &attached,
        &state.config,
        &state.media,
    )?))
}

/// Disables a card on behalf of support (ADM-009, ADM-014).
#[utoipa::path(
    post,
    path = "/api/admin/cards/{id}/support-disable",
    summary = "Disable a card as support",
    description = "Blocks the card: its public page stops being served and its owner cannot reactivate it. The owner's own switch is kept. Recorded in the audit log.",
    tag = "admin",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the card.")),
    responses(
        (status = 200, description = "The card, now disabled by support.", body = CardView),
        (status = 400, description = "Malformed id (`invalid_request`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller is not an approved administrator (`forbidden`, `account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such card (`not_found`).", body = ErrorBody),
        (status = 409, description = "Support already disabled the card (`invalid_transition`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn support_disable_card(
    admin: AdminUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<CardView>, ApiError> {
    set_support_block(&state, &admin, id, true).await
}

/// Lifts support's block on a card (ADM-010, ADM-014).
#[utoipa::path(
    post,
    path = "/api/admin/cards/{id}/support-enable",
    summary = "Lift a card's support block",
    description = "Lifts support's block. The card then follows its owner's own choice: it stays disabled if the owner had disabled it. Recorded in the audit log.",
    tag = "admin",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the card.")),
    responses(
        (status = 200, description = "The card, no longer blocked by support.", body = CardView),
        (status = 400, description = "Malformed id (`invalid_request`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller is not an approved administrator (`forbidden`, `account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such card (`not_found`).", body = ErrorBody),
        (status = 409, description = "Support has not disabled the card (`invalid_transition`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn support_enable_card(
    admin: AdminUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<CardView>, ApiError> {
    set_support_block(&state, &admin, id, false).await
}
