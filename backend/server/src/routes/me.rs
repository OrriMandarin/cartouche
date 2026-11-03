use axum::Json;
use cartouche_domain::UserStatus;
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::CurrentUser;
use crate::error::ErrorBody;

/// The authenticated user's account.
#[derive(Debug, Serialize, ToSchema)]
pub struct MeResponse {
    pub id: Uuid,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub status: UserStatus,
    /// Evaluated from `ADMIN_USER_IDS`, never stored.
    pub is_admin: bool,
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
pub async fn me(current: CurrentUser) -> Json<MeResponse> {
    Json(MeResponse {
        id: current.user.id,
        email: current.user.email,
        display_name: current.user.display_name,
        status: current.user.status,
        is_admin: current.is_admin,
    })
}
