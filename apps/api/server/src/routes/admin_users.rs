//! Support routes: list accounts and change their status (ADM-001 to ADM-005).

use axum::Json;
use axum::extract::State;
use cartouche_domain::{UserStatus, check_transition};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::auth::AdminUser;
use crate::db::audit::{self, AuditEntry};
use crate::db::users::{self, User};
use crate::error::{ApiError, ErrorBody};
use crate::extract::{ApiJson, ApiPath, ApiQuery};
use crate::state::AppState;

/// An account as seen by an administrator.
#[derive(Debug, Serialize, ToSchema)]
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
#[derive(Debug, Serialize, ToSchema)]
pub struct StatusCounts {
    pub pending: i64,
    pub approved: i64,
    pub rejected: i64,
    pub suspended: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AdminUserList {
    pub users: Vec<AdminUserView>,
    pub counts: StatusCounts,
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ListQuery {
    /// Only accounts in this status.
    pub status: Option<UserStatus>,
}

/// Lists accounts, newest first, optionally filtered by status (ADM-002).
#[utoipa::path(
    get,
    path = "/api/admin/users",
    summary = "List accounts",
    description = "Lists accounts, newest first, optionally filtered by status, with the number of accounts per status.",
    tag = "admin",
    security(("bearer" = [])),
    params(ListQuery),
    responses(
        (status = 200, description = "Accounts and per-status counts.", body = AdminUserList),
        (status = 400, description = "Unknown `status` filter (`invalid_request`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller is not an approved administrator (`forbidden`, `account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
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

/// The status to move an account to.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SetStatusBody {
    pub status: UserStatus,
}

/// Changes an account's status and records it in the audit log, atomically (ADM-003 to
/// ADM-005). Checks, in order: unknown user (404), administrator target (403), allowed
/// transition (409). Any early return drops the transaction, which rolls it back.
#[utoipa::path(
    post,
    path = "/api/admin/users/{id}/status",
    summary = "Change an account's status",
    description = "Changes an account's status and records it in the audit log. Administrators cannot be moderated, and only allowed transitions succeed.",
    tag = "admin",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the account to moderate.")),
    request_body = SetStatusBody,
    responses(
        (status = 200, description = "The account with its new status.", body = AdminUserView),
        (status = 400, description = "Malformed id or body (`invalid_request`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller is not an approved administrator, or the target is an administrator (`forbidden`, `cannot_moderate_admin`, `account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such account (`not_found`).", body = ErrorBody),
        (status = 409, description = "The status change is not an allowed transition (`invalid_transition`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
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
