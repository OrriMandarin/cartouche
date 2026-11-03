//! `x-request-id` handling: an incoming id is kept if it is 1 to 64 characters of
//! `[A-Za-z0-9-]`, otherwise a UUID v7 is generated. The id is returned in the response,
//! stored in the request extensions, attached to the request span and to Sentry events.

use axum::extract::Request;
use axum::http::HeaderValue;
use axum::middleware::Next;
use axum::response::Response;
use sentry::SentryFutureExt;
use tower_http::request_id::{MakeRequestId, RequestId as HeaderRequestId};

pub const REQUEST_ID_HEADER: &str = "x-request-id";

/// Identifier of the current request, available in the request extensions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestId(pub String);

tokio::task_local! {
    /// Id of the request being handled, so error responses can embed it.
    static CURRENT: RequestId;
}

/// The id of the request being handled, if called from within the request-id layer.
pub fn current() -> Option<RequestId> {
    CURRENT.try_with(Clone::clone).ok()
}

pub fn is_valid(value: &str) -> bool {
    (1..=64).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// Generates UUID v7 identifiers.
#[derive(Clone, Copy, Default)]
pub struct MakeUuidV7;

impl MakeRequestId for MakeUuidV7 {
    fn make_request_id<B>(&mut self, _request: &axum::http::Request<B>) -> Option<HeaderRequestId> {
        let id = uuid::Uuid::now_v7().to_string();
        HeaderValue::from_str(&id).ok().map(HeaderRequestId::new)
    }
}

/// Removes an incoming `x-request-id` that does not follow the rule, so that the
/// request-id layer generates a fresh one (it only generates when the header is absent).
pub async fn discard_invalid(mut request: Request, next: Next) -> Response {
    let valid = request
        .headers()
        .get(REQUEST_ID_HEADER)
        .is_some_and(|v| v.to_str().is_ok_and(is_valid));
    if !valid {
        request.headers_mut().remove(REQUEST_ID_HEADER);
    }
    next.run(request).await
}

/// Publishes the (now guaranteed valid) id to handlers, error responses and Sentry.
pub async fn expose(mut request: Request, next: Next) -> Response {
    let id = request
        .headers()
        .get(REQUEST_ID_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(|v| RequestId(v.to_string()))
        .unwrap_or_else(|| RequestId(uuid::Uuid::now_v7().to_string()));
    request.extensions_mut().insert(id.clone());

    // Tag Sentry events with the request id on a per-request hub (no-op without a client).
    let hub = sentry::Hub::current();
    if hub.client().is_some() {
        let request_hub = std::sync::Arc::new(sentry::Hub::new_from_top(hub));
        request_hub.configure_scope(|scope| scope.set_tag("request_id", &id.0));
        CURRENT
            .scope(id, next.run(request).bind_hub(request_hub))
            .await
    } else {
        CURRENT.scope(id, next.run(request)).await
    }
}

#[cfg(test)]
mod tests {
    use super::is_valid;

    #[test]
    fn accepts_one_to_64_alphanumerics_and_dashes() {
        assert!(is_valid("a"));
        assert!(is_valid("abc-123"));
        assert!(is_valid(&"A".repeat(64)));
    }

    #[test]
    fn rejects_everything_else() {
        assert!(!is_valid(""));
        assert!(!is_valid(&"a".repeat(65)));
        assert!(!is_valid("bad id!"));
        assert!(!is_valid("under_score"));
        assert!(!is_valid("caf\u{e9}"));
    }
}
