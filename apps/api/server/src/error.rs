use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

use crate::auth::AuthError;
use crate::request_id;

pub use crate::request_id::RequestId;

/// Every error the API returns. Rendered as
/// `{"error":{"code","message","request_id"}}`, with the id of the current request.
#[derive(Debug)]
pub enum ApiError {
    NotFound,
    MethodNotAllowed,
    /// No token, or a token that is not valid.
    TokenInvalid,
    /// An authentic token past its expiry.
    TokenExpired,
    /// The identity provider's keys cannot be fetched.
    AuthUnavailable,
    /// Signups are closed and this user has no account.
    SignupClosed,
    /// The account awaits approval.
    AccountPending,
    /// The account was rejected.
    AccountRejected,
    /// The account was suspended.
    AccountSuspended,
    /// The caller is authenticated but not allowed (e.g. not an administrator).
    Forbidden,
    /// Unexpected failure: the detail is logged, never sent to the client.
    Internal(String),
}

impl ApiError {
    pub fn code(&self) -> &'static str {
        match self {
            ApiError::NotFound => "not_found",
            ApiError::MethodNotAllowed => "method_not_allowed",
            ApiError::TokenInvalid => "token_invalid",
            ApiError::TokenExpired => "token_expired",
            ApiError::AuthUnavailable => "auth_unavailable",
            ApiError::SignupClosed => "signup_closed",
            ApiError::AccountPending => "account_pending",
            ApiError::AccountRejected => "account_rejected",
            ApiError::AccountSuspended => "account_suspended",
            ApiError::Forbidden => "forbidden",
            ApiError::Internal(_) => "internal_error",
        }
    }

    pub fn status(&self) -> StatusCode {
        match self {
            ApiError::NotFound => StatusCode::NOT_FOUND,
            ApiError::MethodNotAllowed => StatusCode::METHOD_NOT_ALLOWED,
            ApiError::TokenInvalid | ApiError::TokenExpired => StatusCode::UNAUTHORIZED,
            ApiError::AuthUnavailable => StatusCode::SERVICE_UNAVAILABLE,
            ApiError::SignupClosed
            | ApiError::AccountPending
            | ApiError::AccountRejected
            | ApiError::AccountSuspended
            | ApiError::Forbidden => StatusCode::FORBIDDEN,
            ApiError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    fn message(&self) -> &'static str {
        match self {
            ApiError::NotFound => "The requested resource was not found.",
            ApiError::MethodNotAllowed => "This method is not allowed on this resource.",
            ApiError::TokenInvalid => "The access token is missing or invalid.",
            ApiError::TokenExpired => "The access token has expired.",
            ApiError::AuthUnavailable => "Authentication is temporarily unavailable.",
            ApiError::SignupClosed => "Signups are closed.",
            ApiError::AccountPending => "Your account is awaiting approval.",
            ApiError::AccountRejected => "Your account was rejected.",
            ApiError::AccountSuspended => "Your account is suspended.",
            ApiError::Forbidden => "You are not allowed to do this.",
            ApiError::Internal(_) => "An internal error occurred.",
        }
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        ApiError::Internal(format!("database error: {e}"))
    }
}

impl From<AuthError> for ApiError {
    fn from(e: AuthError) -> Self {
        match e {
            AuthError::Missing | AuthError::Invalid => ApiError::TokenInvalid,
            AuthError::Expired => ApiError::TokenExpired,
            AuthError::Unavailable => ApiError::AuthUnavailable,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        if let ApiError::Internal(detail) = &self {
            tracing::error!(error = %detail, "internal error");
        }
        let request_id = request_id::current().map(|id| id.0).unwrap_or_default();
        let body = json!({
            "error": {
                "code": self.code(),
                "message": self.message(),
                "request_id": request_id,
            }
        });
        (self.status(), Json(body)).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_and_statuses() {
        assert_eq!(ApiError::NotFound.code(), "not_found");
        assert_eq!(ApiError::NotFound.status(), StatusCode::NOT_FOUND);
        let internal = ApiError::Internal("boom".into());
        assert_eq!(internal.code(), "internal_error");
        assert_eq!(internal.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    // spec: ACC-002, ACC-004
    #[test]
    fn account_errors_are_403_with_their_own_code() {
        for (error, code) in [
            (ApiError::SignupClosed, "signup_closed"),
            (ApiError::AccountPending, "account_pending"),
            (ApiError::AccountRejected, "account_rejected"),
            (ApiError::AccountSuspended, "account_suspended"),
            (ApiError::Forbidden, "forbidden"),
        ] {
            assert_eq!(error.code(), code);
            assert_eq!(error.status(), StatusCode::FORBIDDEN);
        }
    }

    // spec: ACC-007
    #[test]
    fn auth_errors_map_to_distinct_codes_and_statuses() {
        let cases = [
            (
                AuthError::Missing,
                "token_invalid",
                StatusCode::UNAUTHORIZED,
            ),
            (
                AuthError::Invalid,
                "token_invalid",
                StatusCode::UNAUTHORIZED,
            ),
            (
                AuthError::Expired,
                "token_expired",
                StatusCode::UNAUTHORIZED,
            ),
            (
                AuthError::Unavailable,
                "auth_unavailable",
                StatusCode::SERVICE_UNAVAILABLE,
            ),
        ];
        for (auth, code, status) in cases {
            let api = ApiError::from(auth);
            assert_eq!((api.code(), api.status()), (code, status), "{auth:?}");
        }
    }
}
