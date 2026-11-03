//! `GET /media/*`: the stored media files, in local storage mode (MED-010, MED-016, MED-017).
//! Not part of the OpenAPI document: files are addressed by the URLs the API hands out.

use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::Response;
use cartouche_domain::{ByteRange, parse_range, served_content_type};

use crate::error::ApiError;
use crate::extract::ApiPath;
use crate::media::CACHE_CONTROL;
use crate::state::AppState;

fn response(status: StatusCode, content_type: &'static str) -> axum::http::response::Builder {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, CACHE_CONTROL)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::ACCEPT_RANGES, "bytes")
}

fn built(response: Result<Response, axum::http::Error>) -> Result<Response, ApiError> {
    response.map_err(|e| ApiError::Internal(format!("media response: {e}")))
}

/// Serves a media file whole, or the part a `Range` header asks for.
pub async fn get_media_file(
    State(state): State<AppState>,
    ApiPath(key): ApiPath<String>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let content_type = served_content_type(&key).ok_or(ApiError::NotFound)?;
    let Some(range_header) = headers.get(header::RANGE) else {
        let file = state.media.get(&key, None).await?;
        return built(response(StatusCode::OK, content_type).body(Body::from(file.bytes)));
    };

    let size = state.media.size(&key).await?;
    let range: Option<ByteRange> = range_header
        .to_str()
        .ok()
        .and_then(|header| parse_range(header, size).ok());
    let Some(range) = range else {
        return built(
            response(StatusCode::RANGE_NOT_SATISFIABLE, content_type)
                .header(header::CONTENT_RANGE, format!("bytes */{size}"))
                .body(Body::empty()),
        );
    };
    let file = state.media.get(&key, Some(range.to_range())).await?;
    built(
        response(StatusCode::PARTIAL_CONTENT, content_type)
            .header(
                header::CONTENT_RANGE,
                format!("bytes {}-{}/{}", range.start, range.end, file.size),
            )
            .body(Body::from(file.bytes)),
    )
}
