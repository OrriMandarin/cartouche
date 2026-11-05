use axum::Json;
use axum::extract::State;
use cartouche_domain::UserStatus;
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::CurrentUser;
use crate::db::users;
use crate::error::{ApiError, ErrorBody};
use crate::state::AppState;

/// The authenticated user's account.
#[derive(Debug, Serialize, ToSchema)]
pub struct MeResponse {
    pub id: Uuid,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub status: UserStatus,
    /// Evaluated from `ADMIN_USER_IDS`, never stored.
    pub is_admin: bool,
    /// Events in progress at once that a card may have (EVT-019); the dashboard says when a
    /// card reaches it (EDI-032).
    pub max_simultaneous_events: u32,
    /// What the account holds, for the account deletion area (ACC-027); zeros until the
    /// account is approved.
    pub totals: AccountTotals,
}

/// Number of cards, events and leads of an account.
#[derive(Debug, Serialize, ToSchema)]
pub struct AccountTotals {
    pub cards: i64,
    pub events: i64,
    pub leads: i64,
}

/// The authenticated user's account, whatever its status (ACC-004).
#[utoipa::path(
    get,
    path = "/api/me",
    summary = "Current user",
    description = "The authenticated user's account, whatever its status. Creates the account on first visit when signups allow it.",
    tag = "account",
    security(("bearer" = [])),
    responses(
        (status = 200, description = "The caller's account.", body = MeResponse),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "Signups are closed for a new user (`signup_closed`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn me(
    current: CurrentUser,
    State(state): State<AppState>,
) -> Result<Json<MeResponse>, ApiError> {
    let totals = if current.user.status == UserStatus::Approved {
        users::totals_for_owner(&state.db, current.user.id).await?
    } else {
        users::Totals::default()
    };
    Ok(Json(MeResponse {
        id: current.user.id,
        email: current.user.email,
        display_name: current.user.display_name,
        status: current.user.status,
        is_admin: current.is_admin,
        max_simultaneous_events: u32::try_from(state.config.max_simultaneous_events)
            .map_err(|e| ApiError::Internal(e.to_string()))?,
        totals: AccountTotals {
            cards: totals.cards,
            events: totals.events,
            leads: totals.leads,
        },
    }))
}
