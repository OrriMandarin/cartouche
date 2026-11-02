//! Shared integration-test harness: the real router driven in-process (no socket),
//! with a frozen clock. Later tasks extend it (key source for tokens, test clock).
#![allow(dead_code)] // each test binary uses a different subset

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::http::{HeaderMap, Method, Request, StatusCode};
use cartouche_api::app::build_router;
use cartouche_api::auth::{JwtVerifier, StaticKeySource, TokenVerifier};
use cartouche_api::config::Config;
use cartouche_api::state::AppState;
use cartouche_domain::ManualClock;
use chrono::{TimeZone, Utc};
use http_body_util::BodyExt;
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header};
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
    test_config_with(&[])
}

/// Like `test_config`, with environment variables overridden (e.g. `SIGNUP_MODE`,
/// `ADMIN_USER_IDS`).
pub fn test_config_with(overrides: &[(&str, &str)]) -> Config {
    Config::from_vars(|name| {
        if let Some((_, value)) = overrides.iter().find(|(key, _)| *key == name) {
            return Some((*value).to_string());
        }
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

/// Key id of the test signing key. Always this value, in tokens and in the key source.
pub const TEST_KID: &str = "cartouche-test-1";
/// Test only, never trusted in production: see `test-keys/README.md`.
pub const TEST_PRIVATE_KEY_PEM: &str = include_str!("../../test-keys/es256-private.pem");
pub const TEST_PUBLIC_KEY_PEM: &str = include_str!("../../test-keys/es256-public.pem");
/// A key no verifier trusts.
pub const UNTRUSTED_PRIVATE_KEY_PEM: &str =
    include_str!("../../test-keys/untrusted-es256-private.pem");

pub fn test_decoding_key() -> DecodingKey {
    DecodingKey::from_ec_pem(TEST_PUBLIC_KEY_PEM.as_bytes()).expect("valid test public key")
}

/// A key source that only knows the test key, under `TEST_KID`.
pub fn test_key_source() -> StaticKeySource {
    StaticKeySource::new(vec![(TEST_KID.to_string(), test_decoding_key())])
}

/// Signs `claims` with the ES256 test key and `kid` = `TEST_KID`.
pub fn sign_test_token(claims: serde_json::Value) -> String {
    sign_with(
        Algorithm::ES256,
        Some(TEST_KID),
        &EncodingKey::from_ec_pem(TEST_PRIVATE_KEY_PEM.as_bytes()).expect("valid test key"),
        &claims,
    )
}

/// Signs with an arbitrary algorithm, key and `kid` (for negative tests).
pub fn sign_with(
    alg: Algorithm,
    kid: Option<&str>,
    key: &EncodingKey,
    claims: &serde_json::Value,
) -> String {
    let mut header = Header::new(alg);
    header.kid = kid.map(str::to_string);
    jsonwebtoken::encode(&header, claims, key).expect("signable claims")
}

/// A verifier backed by the static test key, validating against `config.auth` on `clock`.
pub fn test_verifier(config: &Config, clock: Arc<ManualClock>) -> Arc<dyn TokenVerifier> {
    Arc::new(JwtVerifier::new(&config.auth, test_key_source(), clock))
}

/// Application state on a frozen clock. Tasks that add state fields extend this function
/// (or add a second constructor) and feed the result to `TestApp::from_state`.
pub fn test_state(pool: PgPool) -> (AppState, Arc<ManualClock>) {
    test_state_with(pool, &[])
}

/// `test_state` with configuration overrides (see `test_config_with`).
pub fn test_state_with(pool: PgPool, overrides: &[(&str, &str)]) -> (AppState, Arc<ManualClock>) {
    let clock = Arc::new(ManualClock::new(
        Utc.with_ymd_and_hms(2026, 1, 15, 12, 0, 0).unwrap(),
    ));
    let config = test_config_with(overrides);
    let state = AppState {
        db: pool,
        verifier: test_verifier(&config, clock.clone()),
        config: Arc::new(config),
        clock: clock.clone(),
    };
    (state, clock)
}

pub async fn test_app(pool: PgPool) -> TestApp {
    let (state, clock) = test_state(pool);
    TestApp::from_state(state, clock)
}

/// A test app whose configuration differs from `test_config` by `overrides`.
pub async fn test_app_with(pool: PgPool, overrides: &[(&str, &str)]) -> TestApp {
    let (state, clock) = test_state_with(pool, overrides);
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
        let body = json.map(|value| value.to_string());
        self.send(method, path, token, body, headers).await
    }

    /// Sends `body` verbatim with a JSON content type (for malformed-body tests).
    pub async fn request_with_raw_body(
        &self,
        method: &str,
        path: &str,
        token: Option<&str>,
        body: &str,
    ) -> TestResponse {
        self.send(method, path, token, Some(body.to_string()), &[])
            .await
    }

    async fn send(
        &self,
        method: &str,
        path: &str,
        token: Option<&str>,
        body: Option<String>,
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
        let body = match body {
            Some(text) => {
                builder = builder.header("content-type", "application/json");
                Body::from(text)
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
