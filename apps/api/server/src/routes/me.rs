use axum::Json;
use cartouche_domain::UserStatus;
use serde::Serialize;
use uuid::Uuid;

use crate::auth::CurrentUser;

#[derive(Debug, Serialize)]
pub struct MeResponse {
    pub id: Uuid,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub status: UserStatus,
    pub is_admin: bool,
}

/// The authenticated user's account, whatever its status (ACC-004).
pub async fn me(current: CurrentUser) -> Json<MeResponse> {
    Json(MeResponse {
        id: current.user.id,
        email: current.user.email,
        display_name: current.user.display_name,
        status: current.user.status,
        is_admin: current.is_admin,
    })
}
