//! Request-input extractors whose rejections use the API's JSON error shape.
//!
//! axum's own `Json`, `Path` and `Query` reject with plain-text bodies that carry
//! deserializer detail. These wrappers turn every malformed input into
//! `400 invalid_request` with a fixed message; the detail goes to the log only.

use axum::extract::multipart::{MultipartError, MultipartRejection};
use axum::extract::rejection::PathRejection;
use axum::extract::{FromRequest, FromRequestParts, Multipart, Path, Query, Request};
use axum::http::StatusCode;
use axum::http::request::Parts;
use serde::de::DeserializeOwned;

use crate::error::ApiError;

/// JSON request body.
pub struct ApiJson<T>(pub T);

impl<S, T> FromRequest<S> for ApiJson<T>
where
    S: Send + Sync,
    T: DeserializeOwned,
{
    type Rejection = ApiError;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        match axum::Json::<T>::from_request(req, state).await {
            Ok(axum::Json(value)) => Ok(ApiJson(value)),
            Err(rejection) => {
                // The rejection text can quote submitted values (answers, access code): only
                // the status is logged.
                tracing::debug!(status = %rejection.status(), "invalid JSON body");
                Err(match rejection.status() {
                    StatusCode::PAYLOAD_TOO_LARGE => ApiError::PayloadTooLarge,
                    StatusCode::UNSUPPORTED_MEDIA_TYPE => ApiError::UnsupportedMediaType,
                    _ => ApiError::InvalidRequest,
                })
            }
        }
    }
}

/// A `multipart/form-data` body; read it field by field with `next_field`.
pub struct ApiMultipart(pub Multipart);

fn upload_error(status: StatusCode, detail: &dyn std::fmt::Display) -> ApiError {
    tracing::debug!(error = %detail, "invalid multipart body");
    match status {
        StatusCode::PAYLOAD_TOO_LARGE => ApiError::PayloadTooLarge,
        StatusCode::UNSUPPORTED_MEDIA_TYPE => ApiError::UnsupportedMediaType,
        _ => ApiError::InvalidRequest,
    }
}

impl From<MultipartRejection> for ApiError {
    fn from(rejection: MultipartRejection) -> ApiError {
        upload_error(rejection.status(), &rejection)
    }
}

impl From<MultipartError> for ApiError {
    fn from(error: MultipartError) -> ApiError {
        upload_error(error.status(), &error)
    }
}

impl<S: Send + Sync> FromRequest<S> for ApiMultipart {
    type Rejection = ApiError;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        Ok(ApiMultipart(Multipart::from_request(req, state).await?))
    }
}

/// Path parameters.
pub struct ApiPath<T>(pub T);

impl<S, T> FromRequestParts<S> for ApiPath<T>
where
    S: Send + Sync,
    T: DeserializeOwned + Send,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        match Path::<T>::from_request_parts(parts, state).await {
            Ok(Path(value)) => Ok(ApiPath(value)),
            // The route declares fewer parameters than the handler expects: a bug of ours.
            Err(rejection @ PathRejection::MissingPathParams(_)) => {
                Err(ApiError::Internal(format!("path parameters: {rejection}")))
            }
            Err(rejection) => {
                tracing::debug!(error = %rejection, "invalid path parameter");
                Err(ApiError::InvalidRequest)
            }
        }
    }
}

/// Query-string parameters.
pub struct ApiQuery<T>(pub T);

impl<S, T> FromRequestParts<S> for ApiQuery<T>
where
    S: Send + Sync,
    T: DeserializeOwned,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        match Query::<T>::from_request_parts(parts, state).await {
            Ok(Query(value)) => Ok(ApiQuery(value)),
            Err(rejection) => {
                tracing::debug!(error = %rejection, "invalid query string");
                Err(ApiError::InvalidRequest)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use axum::Router;
    use axum::body::Body;
    use axum::extract::DefaultBodyLimit;
    use axum::http::{Request, StatusCode, header};
    use axum::routing::post;
    use tower::ServiceExt;

    use super::{ApiJson, ApiMultipart};

    async fn echo(ApiJson(value): ApiJson<serde_json::Value>) -> axum::Json<serde_json::Value> {
        axum::Json(value)
    }

    fn app() -> Router {
        Router::new()
            .route("/", post(echo))
            .layer(DefaultBodyLimit::max(16))
    }

    async fn error_code(response: axum::response::Response) -> String {
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        body["error"]["code"].as_str().unwrap().to_string()
    }

    /// Reads every field to the end, like an upload handler.
    async fn drain(
        ApiMultipart(mut multipart): ApiMultipart,
    ) -> Result<String, crate::error::ApiError> {
        let mut names = Vec::new();
        while let Some(field) = multipart.next_field().await? {
            names.push(field.name().unwrap_or_default().to_string());
            field.bytes().await?;
        }
        Ok(names.join(","))
    }

    fn multipart_request(value_len: usize) -> Request<Body> {
        let body = format!(
            "--b\r\nContent-Disposition: form-data; name=\"a\"\r\n\r\n{}\r\n--b--\r\n",
            "x".repeat(value_len)
        );
        Request::post("/")
            .header(header::CONTENT_TYPE, "multipart/form-data; boundary=b")
            .body(Body::from(body))
            .unwrap()
    }

    #[tokio::test]
    async fn oversized_multipart_body_is_413() {
        let app = Router::new()
            .route("/", post(drain))
            .layer(DefaultBodyLimit::max(64));
        let response = app.clone().oneshot(multipart_request(1)).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let response = app.oneshot(multipart_request(200)).await.unwrap();
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
        assert_eq!(error_code(response).await, "payload_too_large");
    }

    #[tokio::test]
    async fn non_multipart_body_is_400() {
        let request = Request::post("/")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from("{}"))
            .unwrap();
        let response = Router::new()
            .route("/", post(drain))
            .oneshot(request)
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(error_code(response).await, "invalid_request");
    }

    #[tokio::test]
    async fn oversized_json_body_is_413() {
        let request = Request::post("/")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(format!("\"{}\"", "a".repeat(62))))
            .unwrap();
        let response = app().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
        assert_eq!(error_code(response).await, "payload_too_large");
    }

    #[tokio::test]
    async fn json_without_content_type_is_415() {
        let request = Request::post("/").body(Body::from("{}")).unwrap();
        let response = app().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
        assert_eq!(error_code(response).await, "unsupported_media_type");
    }

    #[tokio::test]
    async fn malformed_json_is_still_400() {
        let request = Request::post("/")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from("{"))
            .unwrap();
        let response = app().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(error_code(response).await, "invalid_request");
    }
}
