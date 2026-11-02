//! Shared integration-test harness: the real router driven in-process (no socket),
//! with a frozen clock. Later tasks extend it (key source for tokens, test clock).
#![allow(dead_code)] // each test binary uses a different subset

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::http::{HeaderMap, Method, Request, StatusCode};
use cartouche_api::app::build_router;
use cartouche_api::config::Config;
use cartouche_api::state::AppState;
use cartouche_domain::ManualClock;
use chrono::{TimeZone, Utc};
use http_body_util::BodyExt;
use sqlx::PgPool;
use tower::ServiceExt;

pub struct TestApp {
    pub router: Router,
    pub pool: PgPool,
    pub clock: Arc<ManualClock>,
}

pub struct TestResponse {
    pub status: StatusCode,
    pub headers: HeaderMap,
    /// `Value::Null` when the body is empty.
    pub json: serde_json::Value,
}

/// Configuration used by every integration test (`APP_ENV=test`, test issuer).
pub fn test_config() -> Config {
    Config::from_vars(|name| {
        let value = match name {
            "APP_ENV" => "test",
            "AUTH_ISSUER" => "cartouche-test-issuer",
            "AUTH_JWKS_URL" => "http://localhost:0/jwks.json",
            "PUBLIC_BASE_URL" => "http://localhost:3000",
            "DATABASE_URL" => "unused",
            _ => return None,
        };
        Some(value.to_string())
    })
    .expect("valid test config")
}

/// Application state on a frozen clock. Tasks that add state fields extend this function
/// (or add a second constructor) and feed the result to `TestApp::from_state`.
pub fn test_state(pool: PgPool) -> (AppState, Arc<ManualClock>) {
    let clock = Arc::new(ManualClock::new(
        Utc.with_ymd_and_hms(2026, 1, 15, 12, 0, 0).unwrap(),
    ));
    let state = AppState {
        db: pool,
        config: Arc::new(test_config()),
        clock: clock.clone(),
    };
    (state, clock)
}

pub async fn test_app(pool: PgPool) -> TestApp {
    let (state, clock) = test_state(pool);
    TestApp::from_state(state, clock)
}

impl TestApp {
    pub fn from_state(state: AppState, clock: Arc<ManualClock>) -> TestApp {
        TestApp {
            pool: state.db.clone(),
            router: build_router(state),
            clock,
        }
    }

    pub async fn request(
        &self,
        method: &str,
        path: &str,
        token: Option<&str>,
        json: Option<serde_json::Value>,
    ) -> TestResponse {
        self.request_with_headers(method, path, token, json, &[])
            .await
    }

    pub async fn request_with_headers(
        &self,
        method: &str,
        path: &str,
        token: Option<&str>,
        json: Option<serde_json::Value>,
        headers: &[(&str, &str)],
    ) -> TestResponse {
        let mut builder = Request::builder()
            .method(Method::from_bytes(method.as_bytes()).expect("valid method"))
            .uri(path);
        if let Some(token) = token {
            builder = builder.header("authorization", format!("Bearer {token}"));
        }
        for (name, value) in headers {
            builder = builder.header(*name, *value);
        }
        let body = match json {
            Some(value) => {
                builder = builder.header("content-type", "application/json");
                Body::from(value.to_string())
            }
            None => Body::empty(),
        };
        let response = self
            .router
            .clone()
            .oneshot(builder.body(body).expect("valid request"))
            .await
            .expect("router is infallible");
        let (parts, body) = response.into_parts();
        let bytes = body.collect().await.expect("readable body").to_bytes();
        let json = if bytes.is_empty() {
            serde_json::Value::Null
        } else {
            serde_json::from_slice(&bytes).expect("JSON response body")
        };
        TestResponse {
            status: parts.status,
            headers: parts.headers,
            json,
        }
    }
}
