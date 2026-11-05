//! `GET /media/*`: the stored media files, in local storage mode (MED-010, MED-016, MED-017,
//! MED-023). Not part of the OpenAPI document: files are addressed by the URLs the API hands
//! out. A plain address is read only while its card is served; a signed one, handed to the
//! dashboard and the support page, whatever the card's state. A media's source is only read
//! through a signed address (MED-031).

use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::Response;
use cartouche_domain::{
    ByteRange, MediaCache, card_of_key, is_source_key, media_access, parse_range,
    served_content_type,
};
use serde::Deserialize;

use crate::db::public_cards;
use crate::error::ApiError;
use crate::extract::{ApiPath, ApiQuery};
use crate::media::{CACHE_CONTROL, PRIVATE_CACHE_CONTROL};
use crate::state::AppState;

/// The signature of a dashboard address (MED-023).
#[derive(Debug, Deserialize)]
pub struct MediaQuery {
    /// Expiry, in Unix seconds.
    exp: Option<i64>,
    sig: Option<String>,
}

fn response(
    status: StatusCode,
    content_type: &'static str,
    cache: MediaCache,
) -> axum::http::response::Builder {
    let cache_control = match cache {
        MediaCache::Immutable => CACHE_CONTROL,
        MediaCache::Private => PRIVATE_CACHE_CONTROL,
    };
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, cache_control)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::ACCEPT_RANGES, "bytes")
}

fn built(response: Result<Response, axum::http::Error>) -> Result<Response, ApiError> {
    response.map_err(|e| ApiError::Internal(format!("media response: {e}")))
}

/// Serves a media file whole, or the part a `Range` header asks for, when the address is
/// signed or the file's card is served; `404 not_found` otherwise (MED-023).
pub async fn get_media_file(
    State(state): State<AppState>,
    ApiPath(key): ApiPath<String>,
    ApiQuery(query): ApiQuery<MediaQuery>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let content_type = served_content_type(&key).ok_or(ApiError::NotFound)?;
    let signed = match (query.exp, query.sig.as_deref()) {
        (Some(exp), Some(sig)) => state
            .media
            .verify_signature(&key, exp, sig, state.clock.now()),
        _ => false,
    };
    let is_source = is_source_key(&key);
    let served = match (signed || is_source, card_of_key(&key)) {
        (false, Some(card_id)) => public_cards::card_is_served(&state.db, card_id).await?,
        _ => None,
    };
    let cache = media_access(signed, served, is_source).ok_or(ApiError::NotFound)?;

    let Some(range_header) = headers.get(header::RANGE) else {
        let file = state.media.get(&key, None).await?;
        return built(response(StatusCode::OK, content_type, cache).body(Body::from(file.bytes)));
    };

    let size = state.media.size(&key).await?;
    let range: Option<ByteRange> = range_header
        .to_str()
        .ok()
        .and_then(|header| parse_range(header, size).ok());
    let Some(range) = range else {
        return built(
            response(StatusCode::RANGE_NOT_SATISFIABLE, content_type, cache)
                .header(header::CONTENT_RANGE, format!("bytes */{size}"))
                .body(Body::empty()),
        );
    };
    let file = state.media.get(&key, Some(range.to_range())).await?;
    built(
        response(StatusCode::PARTIAL_CONTENT, content_type, cache)
            .header(
                header::CONTENT_RANGE,
                format!("bytes {}-{}/{}", range.start, range.end, file.size),
            )
            .body(Body::from(file.bytes)),
    )
}
