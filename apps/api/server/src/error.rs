use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

use crate::request_id;

pub use crate::request_id::RequestId;

/// Every error the API returns. Rendered as
/// `{"error":{"code","message","request_id"}}`, with the id of the current request.
#[derive(Debug)]
pub enum ApiError {
    NotFound,
    MethodNotAllowed,
    /// Unexpected failure: the detail is logged, never sent to the client.
    Internal(String),
}

impl ApiError {
    pub fn code(&self) -> &'static str {
        match self {
            ApiError::NotFound => "not_found",
            ApiError::MethodNotAllowed => "method_not_allowed",
            ApiError::Internal(_) => "internal_error",
        }
    }

    pub fn status(&self) -> StatusCode {
        match self {
            ApiError::NotFound => StatusCode::NOT_FOUND,
            ApiError::MethodNotAllowed => StatusCode::METHOD_NOT_ALLOWED,
            ApiError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    fn message(&self) -> &'static str {
        match self {
            ApiError::NotFound => "The requested resource was not found.",
            ApiError::MethodNotAllowed => "This method is not allowed on this resource.",
            ApiError::Internal(_) => "An internal error occurred.",
        }
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        ApiError::Internal(format!("database error: {e}"))
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
}
