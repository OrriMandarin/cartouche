use std::any::Any;
use std::time::Duration;

use axum::Router;
use axum::http::{Request, Response};
use axum::middleware::from_fn;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use tower_http::catch_panic::CatchPanicLayer;
use tower_http::request_id::{PropagateRequestIdLayer, SetRequestIdLayer};
use tower_http::trace::TraceLayer;
use tracing::{Span, field};

use crate::error::ApiError;
use crate::request_id::{self, MakeUuidV7, REQUEST_ID_HEADER};
use crate::routes::admin_users::{list_users, set_user_status};
use crate::routes::health::health;
use crate::routes::me::me;
use crate::state::AppState;

pub fn build_router(state: AppState) -> Router {
    let router = Router::new()
        .route("/api/health", get(health))
        .route("/api/me", get(me))
        .route("/api/admin/users", get(list_users))
        .route("/api/admin/users/{id}/status", post(set_user_status));
    // Every `/api/test/*` route lives in `test_support::routes`; one guard mounts them.
    #[cfg(feature = "test-support")]
    let router = if crate::startup::test_routes_enabled(&state.config) {
        router.merge(crate::test_support::routes::routes())
    } else {
        router
    };
    let router = router
        .method_not_allowed_fallback(method_not_allowed)
        .fallback(not_found)
        .with_state(state);
    with_request_context(router)
}

async fn not_found() -> ApiError {
    ApiError::NotFound
}

async fn method_not_allowed() -> ApiError {
    ApiError::MethodNotAllowed
}

fn panic_to_response(panic: Box<dyn Any + Send + 'static>) -> Response<axum::body::Body> {
    let detail = panic
        .downcast_ref::<&str>()
        .map(|s| (*s).to_string())
        .or_else(|| panic.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "unknown panic".to_string());
    ApiError::Internal(format!("handler panicked: {detail}")).into_response()
}

/// Wraps a router with the request-id layers, the request span and panic-to-JSON conversion.
/// Layers run top to bottom on the way in.
pub(crate) fn with_request_context(router: Router) -> Router {
    router
        // Innermost first: layers added last are outermost.
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(|request: &Request<_>| {
                    let id = request
                        .extensions()
                        .get::<request_id::RequestId>()
                        .map(|id| id.0.as_str())
                        .unwrap_or_default();
                    tracing::info_span!(
                        "request",
                        request_id = %id,
                        method = %request.method(),
                        path = %request.uri().path(),
                        user_id = field::Empty,
                        status = field::Empty,
                        latency_ms = field::Empty,
                    )
                })
                .on_request(())
                .on_failure(())
                .on_response(|response: &Response<_>, latency: Duration, span: &Span| {
                    let status = response.status();
                    span.record("status", status.as_u16());
                    span.record("latency_ms", latency.as_millis() as u64);
                    if status.is_server_error() {
                        tracing::error!("request completed");
                    } else {
                        tracing::info!("request completed");
                    }
                }),
        )
        .layer(CatchPanicLayer::custom(panic_to_response))
        .layer(from_fn(request_id::expose))
        .layer(PropagateRequestIdLayer::new(
            REQUEST_ID_HEADER.parse().expect("static header name"),
        ))
        .layer(SetRequestIdLayer::new(
            REQUEST_ID_HEADER.parse().expect("static header name"),
            MakeUuidV7,
        ))
        .layer(from_fn(request_id::discard_invalid))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::StatusCode;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    // Silence the default panic hook output for the deliberate panic below.
    #[tokio::test]
    async fn a_panicking_handler_yields_a_json_500_with_request_id() {
        async fn boom() -> &'static str {
            panic!("kaboom")
        }
        let router = with_request_context(Router::new().route("/boom", get(boom)));
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/boom")
                    .header("x-request-id", "req-1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(response.headers()["x-request-id"], "req-1");
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["error"]["code"], "internal_error");
        assert_eq!(json["error"]["request_id"], "req-1");
        assert!(!json.to_string().contains("kaboom"));
    }
}
