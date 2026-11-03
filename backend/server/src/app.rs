use std::any::Any;
use std::time::Duration;

use axum::Router;
use axum::extract::DefaultBodyLimit;
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
use crate::routes::admin_cards::{
    get_card as admin_get_card, get_user as admin_get_user, support_disable_card,
    support_enable_card,
};
use crate::routes::admin_users::{list_users, set_user_status};
use crate::routes::card_media::{UPLOAD_BODY_LIMIT, upload_media};
use crate::routes::cards::{
    create_card, delete_card, disable_card, duplicate_card, enable_card, get_card, list_cards,
    update_card,
};
use crate::routes::health::health;
use crate::routes::me::me;
use crate::routes::media_files::get_media_file;
use crate::routes::public_cards::{get_public_card, get_public_vcard};
use crate::routes::slugs::{slug_availability, suggest_slug};
use crate::state::AppState;

pub fn build_router(state: AppState) -> Router {
    let router = Router::new()
        .route("/api/openapi.json", get(openapi_json))
        .route("/api/health", get(health))
        .route("/api/me", get(me))
        .route("/api/cards", get(list_cards).post(create_card))
        .route(
            "/api/cards/{id}",
            get(get_card).put(update_card).delete(delete_card),
        )
        .route("/api/cards/{id}/disable", post(disable_card))
        .route("/api/cards/{id}/enable", post(enable_card))
        .route("/api/cards/{id}/duplicate", post(duplicate_card))
        .route(
            "/api/cards/{id}/media",
            post(upload_media).layer(DefaultBodyLimit::max(UPLOAD_BODY_LIMIT)),
        )
        .route("/api/slugs/suggestion", get(suggest_slug))
        .route("/api/slugs/availability", get(slug_availability))
        .route("/api/public/cards/{slug}", get(get_public_card))
        .route("/api/public/cards/{slug}/vcard", get(get_public_vcard))
        .route("/api/admin/users", get(list_users))
        .route("/api/admin/users/{id}", get(admin_get_user))
        .route("/api/admin/users/{id}/status", post(set_user_status))
        .route("/api/admin/cards/{id}", get(admin_get_card))
        .route(
            "/api/admin/cards/{id}/support-disable",
            post(support_disable_card),
        )
        .route(
            "/api/admin/cards/{id}/support-enable",
            post(support_enable_card),
        );
    // In S3 mode the bucket serves the files.
    let router = if state.media.serves_locally() {
        router.route("/media/{*key}", get(get_media_file))
    } else {
        router
    };
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

/// The public contract; also committed as `frontend/api-client/openapi.json`.
async fn openapi_json() -> impl IntoResponse {
    (
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        crate::openapi::document_json(),
    )
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
/// Layers added last are outermost: id handling, then the trace span, then panic catching,
/// so a panic is reported and answered inside the request span (request_id on its log line).
pub(crate) fn with_request_context(router: Router) -> Router {
    router
        // Innermost: turns a panic into a JSON 500 while still inside the request span.
        .layer(CatchPanicLayer::custom(panic_to_response))
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
    use std::sync::{Arc, Mutex};
    use tower::ServiceExt;
    use tracing_subscriber::fmt::MakeWriter;

    /// Collects everything the subscriber writes, one JSON object per line.
    #[derive(Clone, Default)]
    struct LogBuffer(Arc<Mutex<Vec<u8>>>);

    impl std::io::Write for LogBuffer {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl<'a> MakeWriter<'a> for LogBuffer {
        type Writer = LogBuffer;
        fn make_writer(&'a self) -> Self::Writer {
            self.clone()
        }
    }

    impl LogBuffer {
        fn lines(&self) -> Vec<serde_json::Value> {
            String::from_utf8(self.0.lock().unwrap().clone())
                .unwrap()
                .lines()
                .map(|line| serde_json::from_str(line).unwrap())
                .collect()
        }
    }

    // Silence the default panic hook output for the deliberate panic below.
    #[tokio::test]
    async fn a_panicking_handler_yields_a_json_500_with_request_id() {
        async fn boom() -> &'static str {
            panic!("kaboom")
        }
        let logs = LogBuffer::default();
        let subscriber = tracing_subscriber::fmt()
            .json()
            .with_current_span(true)
            .with_span_list(false)
            .with_writer(logs.clone())
            .finish();
        // A current-thread runtime: the default subscriber covers the whole request.
        let _guard = tracing::subscriber::set_default(subscriber);
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

        // Every log line of the request, the panic report included, carries its request_id.
        let lines = logs.lines();
        let error_line = lines
            .iter()
            .find(|line| line["level"] == "ERROR")
            .expect("the panic is logged at error level");
        assert_eq!(error_line["span"]["request_id"], "req-1");
        assert!(
            lines
                .iter()
                .any(|line| line["fields"]["message"] == "request completed"
                    && line["span"]["request_id"] == "req-1"
                    && line["span"]["status"] == 500),
            "the request-completed line is emitted for a panicking request: {lines:?}"
        );
    }
}
