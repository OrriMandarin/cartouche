//! Axum extractors that authenticate the request and load the user's account.
//!
//! `CurrentUser` accepts any status; `ApprovedUser` requires `approved`; `AdminUser`
//! requires the `sub` to be in `ADMIN_USER_IDS`. The status is read from the database on
//! every request, never from the token.

use axum::extract::FromRequestParts;
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use cartouche_domain::{UserStatus, initial_status, normalize};

use super::VerifiedClaims;
use crate::db::users::{self, User};
use crate::error::ApiError;
use crate::state::AppState;

/// The authenticated user, whatever their status.
#[derive(Debug, Clone)]
pub struct CurrentUser {
    pub user: User,
    /// Evaluated from the configuration on this request, never stored (ACC-003).
    pub is_admin: bool,
}

/// An authenticated user whose account is `approved`.
#[derive(Debug, Clone)]
pub struct ApprovedUser(pub CurrentUser);

/// An authenticated administrator.
#[derive(Debug, Clone)]
pub struct AdminUser(pub CurrentUser);

fn bearer_token(parts: &Parts) -> Option<&str> {
    let value = parts.headers.get(AUTHORIZATION)?.to_str().ok()?;
    let (scheme, token) = value.split_once(' ')?;
    let token = token.trim();
    (scheme.eq_ignore_ascii_case("bearer") && !token.is_empty()).then_some(token)
}

/// NFC + trim; a claim that is empty once trimmed counts as absent (ACC-006).
fn normalized(value: Option<String>) -> Option<String> {
    value.map(|v| normalize(&v)).filter(|v| !v.is_empty())
}

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = bearer_token(parts).ok_or_else(|| {
            tracing::debug!("request rejected: missing or malformed Authorization header");
            ApiError::TokenInvalid
        })?;
        let claims = state.verifier.verify(token).await?;
        let claims = VerifiedClaims {
            email: normalized(claims.email),
            name: normalized(claims.name),
            ..claims
        };

        let is_admin = state.config.admin_user_ids.contains(&claims.subject);
        let status_if_new = match initial_status(state.config.signup_mode, is_admin) {
            Ok(status) => status,
            // Closed signups: only an existing account may come in, and no row is created.
            Err(_) => {
                if !users::exists(&state.db, &claims.issuer, &claims.subject).await? {
                    return Err(ApiError::SignupClosed);
                }
                // Not applied: the account exists, and the upsert never touches its status.
                UserStatus::Pending
            }
        };

        let mut user = users::upsert_on_login(&state.db, &claims, status_if_new).await?;
        if is_admin && user.status != UserStatus::Approved {
            // An account created before its owner became administrator (ACC-003).
            user = users::approve(&state.db, user.id).await?;
        }

        tracing::Span::current().record("user_id", tracing::field::display(user.id));
        Ok(CurrentUser { user, is_admin })
    }
}

impl FromRequestParts<AppState> for ApprovedUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let current = CurrentUser::from_request_parts(parts, state).await?;
        match current.user.status {
            UserStatus::Approved => Ok(ApprovedUser(current)),
            UserStatus::Pending => Err(ApiError::AccountPending),
            UserStatus::Rejected => Err(ApiError::AccountRejected),
            UserStatus::Suspended => Err(ApiError::AccountSuspended),
        }
    }
}

impl FromRequestParts<AppState> for AdminUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let current = CurrentUser::from_request_parts(parts, state).await?;
        if current.is_admin {
            Ok(AdminUser(current))
        } else {
            Err(ApiError::Forbidden)
        }
    }
}
