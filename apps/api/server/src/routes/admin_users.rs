//! Support routes: list accounts and change their status (ADM-001 to ADM-005).

use axum::Json;
use axum::extract::State;
use cartouche_domain::{UserStatus, check_transition};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::auth::AdminUser;
use crate::db::audit::{self, AuditEntry};
use crate::db::users::{self, User};
use crate::error::ApiError;
use crate::extract::{ApiJson, ApiPath, ApiQuery};
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct AdminUserView {
    pub id: Uuid,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub subject: String,
    pub status: UserStatus,
    /// Evaluated from `ADMIN_USER_IDS`, never stored.
    pub is_admin: bool,
    pub created_at: DateTime<Utc>,
}

impl AdminUserView {
    fn new(user: User, state: &AppState) -> Self {
        AdminUserView {
            is_admin: state.config.admin_user_ids.contains(&user.subject),
            id: user.id,
            email: user.email,
            display_name: user.display_name,
            subject: user.subject,
            status: user.status,
            created_at: user.created_at,
        }
    }
}

/// Number of accounts per status; all four are always present.
#[derive(Debug, Serialize)]
pub struct StatusCounts {
    pub pending: i64,
    pub approved: i64,
    pub rejected: i64,
    pub suspended: i64,
}

#[derive(Debug, Serialize)]
pub struct AdminUserList {
    pub users: Vec<AdminUserView>,
    pub counts: StatusCounts,
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    pub status: Option<UserStatus>,
}

/// Lists accounts, newest first, optionally filtered by status (ADM-002).
pub async fn list_users(
    _admin: AdminUser,
    State(state): State<AppState>,
    ApiQuery(query): ApiQuery<ListQuery>,
) -> Result<Json<AdminUserList>, ApiError> {
    let users = users::list_by_status(&state.db, query.status).await?;
    let counts = users::count_by_status(&state.db).await?;
    let count = |status| counts.get(&status).copied().unwrap_or(0);
    Ok(Json(AdminUserList {
        users: users
            .into_iter()
            .map(|user| AdminUserView::new(user, &state))
            .collect(),
        counts: StatusCounts {
            pending: count(UserStatus::Pending),
            approved: count(UserStatus::Approved),
            rejected: count(UserStatus::Rejected),
            suspended: count(UserStatus::Suspended),
        },
    }))
}

#[derive(Debug, Deserialize)]
pub struct SetStatusBody {
    pub status: UserStatus,
}

/// Changes an account's status and records it in the audit log, atomically (ADM-003 to
/// ADM-005). Checks, in order: unknown user (404), administrator target (403), allowed
/// transition (409). Any early return drops the transaction, which rolls it back.
pub async fn set_user_status(
    AdminUser(admin): AdminUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<SetStatusBody>,
) -> Result<Json<AdminUserView>, ApiError> {
    let mut tx = state.db.begin().await?;
    // The row lock makes concurrent changes on this user validate against fresh state.
    let target = users::find_for_update(&mut tx, id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if state.config.admin_user_ids.contains(&target.subject) {
        return Err(ApiError::CannotModerateAdmin);
    }
    check_transition(target.status, body.status).map_err(|_| ApiError::InvalidTransition)?;

    let updated = users::set_status(&mut tx, id, body.status).await?;
    audit::record(
        &mut tx,
        AuditEntry {
            actor_user_id: admin.user.id,
            action: "user.status_changed",
            target_type: "user",
            target_id: id,
            metadata: json!({
                "from": target.status.as_str(),
                "to": body.status.as_str(),
            }),
        },
    )
    .await?;
    tx.commit().await?;
    Ok(Json(AdminUserView::new(updated, &state)))
}
