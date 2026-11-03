//! Request-input extractors whose rejections use the API's JSON error shape.
//!
//! axum's own `Json`, `Path` and `Query` reject with plain-text bodies that carry
//! deserializer detail. These wrappers turn every malformed input into
//! `400 invalid_request` with a fixed message; the detail goes to the log only.

use axum::extract::rejection::PathRejection;
use axum::extract::{FromRequest, FromRequestParts, Path, Query, Request};
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
                tracing::debug!(error = %rejection, "invalid JSON body");
                Err(ApiError::InvalidRequest)
            }
        }
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
