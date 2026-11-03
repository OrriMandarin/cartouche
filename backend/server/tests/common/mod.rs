//! Shared integration-test harness: the real router driven in-process (no socket),
//! with a frozen clock. Later tasks extend it (key source for tokens, test clock).
#![allow(dead_code)] // each test binary uses a different subset

pub mod cards;
pub mod media_fixtures;

use std::sync::{Arc, Mutex};

use axum::Router;
use axum::body::Body;
use axum::http::{HeaderMap, Method, Request, StatusCode};
use bytes::Bytes;
use cartouche_api::app::build_router;
use cartouche_api::auth::{JwtVerifier, StaticKeySource, TokenVerifier};
use cartouche_api::config::Config;
use cartouche_api::media::MediaService;
use cartouche_api::rate_limit::InMemoryRateLimiter;
use cartouche_api::state::AppState;
use cartouche_domain::{Clock, ManualClock};
use chrono::{TimeZone, Utc};
use http_body_util::BodyExt;
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header};
use sqlx::PgPool;
use tower::ServiceExt;

pub struct TestApp {
    pub router: Router,
    pub pool: PgPool,
    pub clock: Arc<ManualClock>,
    pub media: MediaService,
}

pub struct TestResponse {
    pub status: StatusCode,
    pub headers: HeaderMap,
    /// `Value::Null` unless the response is JSON.
    pub json: serde_json::Value,
    /// The raw body, for responses that are files.
    pub body: Bytes,
}

/// One part of a `multipart/form-data` request.
pub struct Part {
    pub name: String,
    pub filename: Option<String>,
    pub content_type: Option<String>,
    pub bytes: Vec<u8>,
}

impl Part {
    /// A plain form field.
    pub fn text(name: &str, value: &str) -> Part {
        Part {
            name: name.to_string(),
            filename: None,
            content_type: None,
            bytes: value.as_bytes().to_vec(),
        }
    }

    /// A file field.
    pub fn file(name: &str, filename: &str, content_type: &str, bytes: Vec<u8>) -> Part {
        Part {
            name: name.to_string(),
            filename: Some(filename.to_string()),
            content_type: Some(content_type.to_string()),
            bytes,
        }
    }
}

const MULTIPART_BOUNDARY: &str = "cartouche-test-boundary";

fn multipart_body(parts: &[Part]) -> Vec<u8> {
    let mut body = Vec::new();
    for part in parts {
        body.extend_from_slice(format!("--{MULTIPART_BOUNDARY}\r\n").as_bytes());
        let mut disposition = format!("Content-Disposition: form-data; name=\"{}\"", part.name);
        if let Some(filename) = &part.filename {
            disposition.push_str(&format!("; filename=\"{filename}\""));
        }
        body.extend_from_slice(disposition.as_bytes());
        body.extend_from_slice(b"\r\n");
        if let Some(content_type) = &part.content_type {
            body.extend_from_slice(format!("Content-Type: {content_type}\r\n").as_bytes());
        }
        body.extend_from_slice(b"\r\n");
        body.extend_from_slice(&part.bytes);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{MULTIPART_BOUNDARY}--\r\n").as_bytes());
    body
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
pub fn test_verifier(config: &Config, clock: Arc<dyn Clock>) -> Arc<dyn TokenVerifier> {
    Arc::new(JwtVerifier::new(&config.auth, test_key_source(), clock))
}

/// An empty in-memory media store whose files are served by the API under `/media/`.
pub fn test_media() -> MediaService {
    MediaService::in_memory(
        "http://localhost:3000/media/"
            .parse()
            .expect("valid base URL"),
    )
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
        media: test_media(),
        rate_limiter: Arc::new(InMemoryRateLimiter::default()),
        #[cfg(feature = "test-support")]
        test_clock: None,
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
            media: state.media.clone(),
            router: build_router(state),
            clock,
        }
    }

    /// Every key currently in the media store.
    pub async fn media_keys(&self) -> Vec<String> {
        self.media.list_keys().await
    }

    /// Seeds the named scenario through `POST /api/test/seed` (needs the `test-support` feature).
    #[cfg(feature = "test-support")]
    pub async fn seed(&self, name: &str) -> TestResponse {
        self.request(
            "POST",
            "/api/test/seed",
            None,
            Some(serde_json::json!({ "scenario": name })),
        )
        .await
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
        let body = json.map(|value| ("application/json", value.to_string().into_bytes()));
        self.send(method, path, token, body, headers).await
    }

    /// Like `request`, as seen by a reverse proxy that received it from `ip`
    /// (`x-forwarded-for: <ip>`).
    pub async fn request_from(
        &self,
        ip: &str,
        method: &str,
        path: &str,
        token: Option<&str>,
        json: Option<serde_json::Value>,
    ) -> TestResponse {
        self.request_with_headers(method, path, token, json, &[("x-forwarded-for", ip)])
            .await
    }

    /// Sends a `multipart/form-data` body made of `parts`.
    pub async fn request_multipart(
        &self,
        method: &str,
        path: &str,
        token: Option<&str>,
        parts: &[Part],
    ) -> TestResponse {
        let content_type = format!("multipart/form-data; boundary={MULTIPART_BOUNDARY}");
        let body = (content_type.as_str(), multipart_body(parts));
        self.send(method, path, token, Some(body), &[]).await
    }

    /// Sends `body` verbatim with a JSON content type (for malformed-body tests).
    pub async fn request_with_raw_body(
        &self,
        method: &str,
        path: &str,
        token: Option<&str>,
        body: &str,
    ) -> TestResponse {
        let body = ("application/json", body.as_bytes().to_vec());
        self.send(method, path, token, Some(body), &[]).await
    }

    async fn send(
        &self,
        method: &str,
        path: &str,
        token: Option<&str>,
        body: Option<(&str, Vec<u8>)>,
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
            Some((content_type, bytes)) => {
                builder = builder.header("content-type", content_type);
                Body::from(bytes)
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
        let is_json = parts
            .headers
            .get("content-type")
            .is_some_and(|value| value.as_bytes().starts_with(b"application/json"));
        let json = if bytes.is_empty() || !is_json {
            serde_json::Value::Null
        } else {
            serde_json::from_slice(&bytes).expect("JSON response body")
        };
        TestResponse {
            status: parts.status,
            headers: parts.headers,
            json,
            body: bytes,
        }
    }
}

/// Collects what the subscriber writes, as text, so a test can assert on log output.
#[derive(Clone, Default)]
pub struct LogBuffer(Arc<Mutex<Vec<u8>>>);

impl std::io::Write for LogBuffer {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for LogBuffer {
    type Writer = LogBuffer;
    fn make_writer(&'a self) -> Self::Writer {
        self.clone()
    }
}

impl LogBuffer {
    pub fn contents(&self) -> String {
        String::from_utf8(self.0.lock().unwrap().clone()).unwrap()
    }
}

/// Captures every event (down to `debug`) on the current thread until the guard is dropped.
/// Use from a current-thread runtime (the default of `#[tokio::test]`).
pub fn capture_logs() -> (LogBuffer, tracing::subscriber::DefaultGuard) {
    let logs = LogBuffer::default();
    let subscriber = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .with_ansi(false)
        .with_writer(logs.clone())
        .finish();
    (logs, tracing::subscriber::set_default(subscriber))
}
