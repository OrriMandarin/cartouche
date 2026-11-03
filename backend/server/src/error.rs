use axum::Json;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use cartouche_domain::FieldError;
use serde::Serialize;
use utoipa::ToSchema;

use crate::auth::AuthError;
use crate::media::MediaError;
use crate::request_id;

pub use crate::request_id::RequestId;

/// Body of every error response: `{"error":{"code","message","request_id"}}`.
#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorBody {
    pub error: ErrorDetail,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorDetail {
    /// Stable machine-readable code, snake_case (e.g. `account_pending`).
    pub code: &'static str,
    /// Human-readable English explanation; clients should switch on `code`.
    pub message: &'static str,
    /// Id of the failed request, also sent in the `x-request-id` response header.
    pub request_id: String,
    /// The invalid fields; present only for `validation_failed`.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub fields: Vec<FieldError>,
}

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
    /// An administrator tried to change the status of an administrator (ADM-004).
    CannotModerateAdmin,
    /// The request is malformed: unparsable body, invalid path or query parameter.
    InvalidRequest,
    /// The body is well-formed but some fields are invalid (`400 validation_failed`).
    Validation(Vec<FieldError>),
    /// The request body exceeds the size limit.
    PayloadTooLarge,
    /// The request body has a content type the route does not accept.
    UnsupportedMediaType,
    /// The requested status change is not an allowed transition (ADM-003).
    InvalidTransition,
    /// The slug belongs to someone else (LNK-022).
    SlugTaken,
    /// The slug is an old slug of another card of the same owner (LNK-025).
    SlugReserved,
    /// Support disabled the card: its owner can neither toggle nor duplicate it (LNK-028).
    CardDisabledBySupport,
    /// The card is not publicly served: disabled, deleted or its owner is suspended
    /// (LNK-007, LNK-026). Says nothing of the reason (LNK-027).
    CardInactive,
    /// The caller's address used up a rate limit (ABU-006, ABU-007).
    RateLimited {
        retry_after_secs: u64,
    },
    /// `POST /api/test/seed` named a scenario that does not exist.
    #[cfg(feature = "test-support")]
    UnknownScenario,
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
            ApiError::CannotModerateAdmin => "cannot_moderate_admin",
            ApiError::InvalidRequest => "invalid_request",
            ApiError::Validation(_) => "validation_failed",
            ApiError::PayloadTooLarge => "payload_too_large",
            ApiError::UnsupportedMediaType => "unsupported_media_type",
            ApiError::InvalidTransition => "invalid_transition",
            ApiError::SlugTaken => "slug_taken",
            ApiError::SlugReserved => "slug_reserved",
            ApiError::CardDisabledBySupport => "card_disabled_by_support",
            ApiError::CardInactive => "card_inactive",
            ApiError::RateLimited { .. } => "rate_limited",
            #[cfg(feature = "test-support")]
            ApiError::UnknownScenario => "unknown_scenario",
            ApiError::Internal(_) => "internal_error",
        }
    }

    pub fn status(&self) -> StatusCode {
        match self {
            ApiError::NotFound => StatusCode::NOT_FOUND,
            #[cfg(feature = "test-support")]
            ApiError::UnknownScenario => StatusCode::NOT_FOUND,
            ApiError::MethodNotAllowed => StatusCode::METHOD_NOT_ALLOWED,
            ApiError::TokenInvalid | ApiError::TokenExpired => StatusCode::UNAUTHORIZED,
            ApiError::AuthUnavailable => StatusCode::SERVICE_UNAVAILABLE,
            ApiError::SignupClosed
            | ApiError::AccountPending
            | ApiError::AccountRejected
            | ApiError::AccountSuspended
            | ApiError::Forbidden
            | ApiError::CannotModerateAdmin => StatusCode::FORBIDDEN,
            ApiError::InvalidRequest | ApiError::Validation(_) => StatusCode::BAD_REQUEST,
            ApiError::PayloadTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            ApiError::UnsupportedMediaType => StatusCode::UNSUPPORTED_MEDIA_TYPE,
            ApiError::InvalidTransition
            | ApiError::SlugTaken
            | ApiError::SlugReserved
            | ApiError::CardDisabledBySupport => StatusCode::CONFLICT,
            ApiError::CardInactive => StatusCode::GONE,
            ApiError::RateLimited { .. } => StatusCode::TOO_MANY_REQUESTS,
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
            ApiError::CannotModerateAdmin => {
                "Administrators cannot change an administrator's status."
            }
            ApiError::InvalidRequest => "The request is malformed.",
            ApiError::Validation(_) => "Some fields are invalid.",
            ApiError::PayloadTooLarge => "The request body is too large.",
            ApiError::UnsupportedMediaType => "The content type is not supported.",
            ApiError::InvalidTransition => "This status change is not allowed.",
            ApiError::SlugTaken => "This link is already taken.",
            ApiError::SlugReserved => "This link was used by another of your cards.",
            ApiError::CardDisabledBySupport => "This card was disabled by support.",
            ApiError::CardInactive => "This card is no longer active.",
            ApiError::RateLimited { .. } => "Too many requests. Try again later.",
            #[cfg(feature = "test-support")]
            ApiError::UnknownScenario => "This seed scenario does not exist.",
            ApiError::Internal(_) => "An internal error occurred.",
        }
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        ApiError::Internal(format!("database error: {e}"))
    }
}

impl From<MediaError> for ApiError {
    fn from(e: MediaError) -> Self {
        match e {
            MediaError::NotFound => ApiError::NotFound,
            MediaError::Storage(detail) => ApiError::Internal(format!("media storage: {detail}")),
        }
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
        let (code, message, status) = (self.code(), self.message(), self.status());
        let retry_after = match &self {
            ApiError::RateLimited { retry_after_secs } => Some(*retry_after_secs),
            _ => None,
        };
        let fields = match self {
            ApiError::Validation(fields) => fields,
            _ => Vec::new(),
        };
        let body = ErrorBody {
            error: ErrorDetail {
                code,
                message,
                request_id,
                fields,
            },
        };
        let mut response = (status, Json(body)).into_response();
        if let Some(seconds) = retry_after {
            response
                .headers_mut()
                .insert(header::RETRY_AFTER, HeaderValue::from(seconds));
        }
        response
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
            (ApiError::CannotModerateAdmin, "cannot_moderate_admin"),
        ] {
            assert_eq!(error.code(), code);
            assert_eq!(error.status(), StatusCode::FORBIDDEN);
        }
    }

    // spec: ADM-003
    #[test]
    fn request_and_transition_errors() {
        assert_eq!(ApiError::InvalidRequest.code(), "invalid_request");
        assert_eq!(ApiError::InvalidRequest.status(), StatusCode::BAD_REQUEST);
        assert_eq!(ApiError::InvalidTransition.code(), "invalid_transition");
        assert_eq!(ApiError::InvalidTransition.status(), StatusCode::CONFLICT);
    }

    async fn body_json(error: ApiError) -> (StatusCode, serde_json::Value) {
        let response = error.into_response();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    // spec: ABU-006
    #[tokio::test]
    async fn rate_limited_is_429_with_retry_after() {
        let error = ApiError::RateLimited {
            retry_after_secs: 42,
        };
        let response = error.into_response();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(response.headers()["retry-after"], "42");
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["error"]["code"], "rate_limited");
        assert!(body["error"].get("fields").is_none());
    }

    #[tokio::test]
    async fn validation_error_lists_fields() {
        let error = ApiError::Validation(vec![FieldError::new("content.email", "invalid_email")]);
        let (status, body) = body_json(error).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"]["code"], "validation_failed");
        assert_eq!(
            body["error"]["fields"],
            serde_json::json!([{"field": "content.email", "code": "invalid_email"}])
        );
    }

    #[tokio::test]
    async fn other_errors_have_no_fields_key() {
        let (_, body) = body_json(ApiError::NotFound).await;
        assert!(body["error"].get("fields").is_none());
    }

    #[test]
    fn payload_and_media_type_errors() {
        assert_eq!(ApiError::PayloadTooLarge.code(), "payload_too_large");
        assert_eq!(
            ApiError::PayloadTooLarge.status(),
            StatusCode::PAYLOAD_TOO_LARGE
        );
        assert_eq!(
            ApiError::UnsupportedMediaType.code(),
            "unsupported_media_type"
        );
        assert_eq!(
            ApiError::UnsupportedMediaType.status(),
            StatusCode::UNSUPPORTED_MEDIA_TYPE
        );
    }

    // spec: LNK-022, LNK-025
    #[test]
    fn slug_errors_are_409() {
        assert_eq!(ApiError::SlugTaken.code(), "slug_taken");
        assert_eq!(ApiError::SlugTaken.status(), StatusCode::CONFLICT);
        assert_eq!(ApiError::SlugReserved.code(), "slug_reserved");
        assert_eq!(ApiError::SlugReserved.status(), StatusCode::CONFLICT);
    }

    // spec: LNK-007, LNK-027
    #[test]
    fn inactive_card_is_410() {
        assert_eq!(ApiError::CardInactive.code(), "card_inactive");
        assert_eq!(ApiError::CardInactive.status(), StatusCode::GONE);
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
