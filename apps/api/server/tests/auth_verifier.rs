//! Token verification (no database). The verifier is driven directly with a frozen clock.

mod common;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use cartouche_api::auth::{
    AuthError, JwksKeySource, JwtVerifier, StaticKeySource, TokenVerifier, VerifiedClaims,
};
use cartouche_api::config::AuthConfig;
use cartouche_api::startup::TEST_ISSUER;
use cartouche_domain::{Clock, ManualClock};
use chrono::{TimeZone, Utc};
use common::{
    TEST_KID, TEST_PRIVATE_KEY_PEM, TEST_PUBLIC_KEY_PEM, UNTRUSTED_PRIVATE_KEY_PEM,
    sign_test_token, sign_with, test_key_source,
};
use jsonwebtoken::{Algorithm, EncodingKey};
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use url::Url;

const TEST_JWKS: &str = include_str!("../test-keys/jwks.json");
const RSA_PRIVATE_KEY_PEM: &str = include_str!("../test-keys/rsa-test-private.pem");
const RSA_JWKS: &str = include_str!("../test-keys/rsa-jwks.json");
const RSA_KID: &str = "cartouche-test-rsa-1";

/// A JWKS holding both the ES256 test key and the RSA test key.
fn mixed_jwks() -> String {
    let mut keys = Vec::new();
    for set in [TEST_JWKS, RSA_JWKS] {
        let set: Value = serde_json::from_str(set).unwrap();
        keys.extend(set["keys"].as_array().unwrap().clone());
    }
    json!({ "keys": keys }).to_string()
}

fn auth_config(audience: Option<&str>) -> AuthConfig {
    AuthConfig {
        issuer: TEST_ISSUER.to_string(),
        jwks_url: Url::parse("http://localhost:0/jwks.json").unwrap(),
        audience: audience.map(str::to_string),
    }
}

fn clock() -> Arc<ManualClock> {
    Arc::new(ManualClock::new(
        Utc.with_ymd_and_hms(2026, 1, 15, 12, 0, 0).unwrap(),
    ))
}

fn now_ts(clock: &ManualClock) -> i64 {
    clock.now().timestamp()
}

fn verifier(audience: Option<&str>) -> (JwtVerifier<StaticKeySource>, Arc<ManualClock>) {
    let clock = clock();
    (
        JwtVerifier::new(&auth_config(audience), test_key_source(), clock.clone()),
        clock,
    )
}

fn claims(clock: &ManualClock) -> Value {
    json!({
        "iss": TEST_ISSUER,
        "sub": "u1",
        "email": "ada@example.com",
        "name": "Ada Lovelace",
        "exp": now_ts(clock) + 3600,
    })
}

fn with(mut base: Value, key: &str, value: Value) -> Value {
    base[key] = value;
    base
}

fn without(mut base: Value, key: &str) -> Value {
    base.as_object_mut().unwrap().remove(key);
    base
}

fn b64(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

// spec: ACC-007
#[tokio::test]
async fn valid_token_yields_claims() {
    let (verifier, clock) = verifier(None);
    let token = sign_test_token(claims(&clock));
    assert_eq!(
        verifier.verify(&token).await,
        Ok(VerifiedClaims {
            issuer: TEST_ISSUER.to_string(),
            subject: "u1".to_string(),
            email: Some("ada@example.com".to_string()),
            name: Some("Ada Lovelace".to_string()),
        })
    );
}

// spec: ACC-007
#[tokio::test]
async fn email_and_name_are_optional() {
    let (verifier, clock) = verifier(None);
    let token = sign_test_token(without(without(claims(&clock), "email"), "name"));
    let verified = verifier.verify(&token).await.unwrap();
    assert_eq!(verified.email, None);
    assert_eq!(verified.name, None);
}

// spec: ACC-007
#[tokio::test]
async fn expired_token_is_rejected_after_leeway() {
    let (verifier, clock) = verifier(None);
    let now = now_ts(&clock);
    let expired = |exp: i64| sign_test_token(with(claims(&clock), "exp", json!(exp)));
    assert_eq!(
        verifier.verify(&expired(now - 61)).await,
        Err(AuthError::Expired)
    );
    assert!(verifier.verify(&expired(now - 60)).await.is_ok());
    assert!(verifier.verify(&expired(now - 30)).await.is_ok());
}

// spec: ACC-007
#[tokio::test]
async fn expiry_follows_the_injected_clock() {
    let (verifier, clock) = verifier(None);
    let token = sign_test_token(claims(&clock));
    assert!(verifier.verify(&token).await.is_ok());
    clock.advance(chrono::Duration::seconds(3600 + 61));
    assert_eq!(verifier.verify(&token).await, Err(AuthError::Expired));
}

// spec: ACC-007
#[tokio::test]
async fn not_yet_valid_token_is_rejected() {
    let (verifier, clock) = verifier(None);
    let now = now_ts(&clock);
    let with_nbf = |nbf: i64| sign_test_token(with(claims(&clock), "nbf", json!(nbf)));
    assert_eq!(
        verifier.verify(&with_nbf(now + 120)).await,
        Err(AuthError::Invalid)
    );
    assert_eq!(
        verifier.verify(&with_nbf(now + 61)).await,
        Err(AuthError::Invalid)
    );
    assert!(verifier.verify(&with_nbf(now + 30)).await.is_ok());
    assert!(verifier.verify(&with_nbf(now - 10)).await.is_ok());
}

// spec: ACC-007, ACC-013
#[tokio::test]
async fn wrong_issuer_is_rejected() {
    let (verifier, clock) = verifier(None);
    for iss in [json!("https://evil.example.com"), json!(""), json!(42)] {
        let token = sign_test_token(with(claims(&clock), "iss", iss));
        assert_eq!(verifier.verify(&token).await, Err(AuthError::Invalid));
    }
    let token = sign_test_token(without(claims(&clock), "iss"));
    assert_eq!(verifier.verify(&token).await, Err(AuthError::Invalid));
}

// spec: ACC-007
#[tokio::test]
async fn wrong_issuer_is_invalid_even_when_expired() {
    let (verifier, clock) = verifier(None);
    let token = sign_test_token(with(
        with(claims(&clock), "iss", json!("https://evil.example.com")),
        "exp",
        json!(now_ts(&clock) - 3600),
    ));
    assert_eq!(verifier.verify(&token).await, Err(AuthError::Invalid));
}

// spec: ACC-007
#[tokio::test]
async fn wrong_audience_is_rejected_when_configured() {
    let (verifier, clock) = verifier(Some("cartouche-api"));
    let wrong = sign_test_token(with(claims(&clock), "aud", json!("someone-else")));
    assert_eq!(verifier.verify(&wrong).await, Err(AuthError::Invalid));
    let wrong_list = sign_test_token(with(claims(&clock), "aud", json!(["a", "b"])));
    assert_eq!(verifier.verify(&wrong_list).await, Err(AuthError::Invalid));
    let missing = sign_test_token(claims(&clock));
    assert_eq!(verifier.verify(&missing).await, Err(AuthError::Invalid));
    let wrong_type = sign_test_token(with(claims(&clock), "aud", json!(42)));
    assert_eq!(verifier.verify(&wrong_type).await, Err(AuthError::Invalid));
}

// spec: ACC-007
#[tokio::test]
async fn matching_audience_is_accepted_as_string_or_array() {
    let (verifier, clock) = verifier(Some("cartouche-api"));
    let single = sign_test_token(with(claims(&clock), "aud", json!("cartouche-api")));
    assert!(verifier.verify(&single).await.is_ok());
    let list = sign_test_token(with(
        claims(&clock),
        "aud",
        json!(["other", "cartouche-api"]),
    ));
    assert!(verifier.verify(&list).await.is_ok());
}

// spec: ACC-007
#[tokio::test]
async fn audience_is_ignored_when_not_configured() {
    let (verifier, clock) = verifier(None);
    for aud in [json!("anything"), json!(["x", "y"]), json!(42)] {
        let token = sign_test_token(with(claims(&clock), "aud", aud));
        assert!(verifier.verify(&token).await.is_ok());
    }
    assert!(
        verifier
            .verify(&sign_test_token(claims(&clock)))
            .await
            .is_ok()
    );
}

// spec: ACC-007
#[tokio::test]
async fn unknown_kid_is_rejected() {
    let (verifier, clock) = verifier(None);
    let key = EncodingKey::from_ec_pem(TEST_PRIVATE_KEY_PEM.as_bytes()).unwrap();
    let token = sign_with(
        Algorithm::ES256,
        Some("rotated-away"),
        &key,
        &claims(&clock),
    );
    assert_eq!(verifier.verify(&token).await, Err(AuthError::Invalid));
}

// spec: ACC-007
#[tokio::test]
async fn missing_kid_is_rejected() {
    let (verifier, clock) = verifier(None);
    let key = EncodingKey::from_ec_pem(TEST_PRIVATE_KEY_PEM.as_bytes()).unwrap();
    let token = sign_with(Algorithm::ES256, None, &key, &claims(&clock));
    assert_eq!(verifier.verify(&token).await, Err(AuthError::Invalid));
}

// spec: ACC-007
#[tokio::test]
async fn garbage_token_is_rejected() {
    let (verifier, _) = verifier(None);
    for garbage in [
        "",
        "   ",
        "garbage",
        "a.b.c",
        "a.b",
        "....",
        "Bearer abc.def.ghi",
        "\u{0}\u{1}",
        "é.é.é",
    ] {
        assert_eq!(
            verifier.verify(garbage).await,
            Err(AuthError::Invalid),
            "token {garbage:?}"
        );
    }
}

// spec: ACC-007
#[tokio::test]
async fn tampered_payload_is_rejected() {
    let (verifier, clock) = verifier(None);
    let token = sign_test_token(claims(&clock));
    let mut parts: Vec<&str> = token.split('.').collect();
    let forged = b64(claims_json(&with(claims(&clock), "sub", json!("admin"))).as_bytes());
    parts[1] = &forged;
    assert_eq!(
        verifier.verify(&parts.join(".")).await,
        Err(AuthError::Invalid)
    );
}

fn claims_json(value: &Value) -> String {
    value.to_string()
}

// spec: ACC-007
#[tokio::test]
async fn token_signed_by_an_untrusted_key_is_rejected_even_with_a_known_kid() {
    let (verifier, clock) = verifier(None);
    let attacker = EncodingKey::from_ec_pem(UNTRUSTED_PRIVATE_KEY_PEM.as_bytes()).unwrap();
    let token = sign_with(Algorithm::ES256, Some(TEST_KID), &attacker, &claims(&clock));
    assert_eq!(verifier.verify(&token).await, Err(AuthError::Invalid));
}

// spec: ACC-007
#[tokio::test]
async fn bad_signature_wins_over_expiry() {
    let (verifier, clock) = verifier(None);
    let attacker = EncodingKey::from_ec_pem(UNTRUSTED_PRIVATE_KEY_PEM.as_bytes()).unwrap();
    let expired = with(claims(&clock), "exp", json!(now_ts(&clock) - 3600));
    let token = sign_with(Algorithm::ES256, Some(TEST_KID), &attacker, &expired);
    assert_eq!(verifier.verify(&token).await, Err(AuthError::Invalid));
}

// spec: ACC-007
#[tokio::test]
async fn unsigned_alg_none_token_is_rejected() {
    let (verifier, clock) = verifier(None);
    let header = json!({"alg": "none", "typ": "JWT", "kid": TEST_KID}).to_string();
    let payload = claims(&clock).to_string();
    for token in [
        format!("{}.{}.", b64(header.as_bytes()), b64(payload.as_bytes())),
        format!("{}.{}", b64(header.as_bytes()), b64(payload.as_bytes())),
    ] {
        assert_eq!(verifier.verify(&token).await, Err(AuthError::Invalid));
    }
    // ES256 header but an empty signature.
    let header = json!({"alg": "ES256", "typ": "JWT", "kid": TEST_KID}).to_string();
    let token = format!("{}.{}.", b64(header.as_bytes()), b64(payload.as_bytes()));
    assert_eq!(verifier.verify(&token).await, Err(AuthError::Invalid));
}

// spec: ACC-007
#[tokio::test]
async fn hs256_token_signed_with_the_public_key_as_secret_is_rejected() {
    let (verifier, clock) = verifier(None);
    for secret in [
        TEST_PUBLIC_KEY_PEM.as_bytes().to_vec(),
        // the raw DER-ish bytes an attacker might also try
        TEST_PUBLIC_KEY_PEM.trim().as_bytes().to_vec(),
    ] {
        let token = sign_with(
            Algorithm::HS256,
            Some(TEST_KID),
            &EncodingKey::from_secret(&secret),
            &claims(&clock),
        );
        assert_eq!(verifier.verify(&token).await, Err(AuthError::Invalid));
    }
}

// spec: ACC-007
#[tokio::test]
async fn unsupported_algorithms_are_rejected_before_any_key_lookup() {
    // The failing key source would answer Unavailable if it were consulted.
    let clock = clock();
    let verifier = JwtVerifier::new(
        &auth_config(None),
        StaticKeySource::failing(),
        clock.clone(),
    );
    let token = sign_with(
        Algorithm::HS384,
        Some(TEST_KID),
        &EncodingKey::from_secret(b"secret"),
        &claims(&clock),
    );
    assert_eq!(verifier.verify(&token).await, Err(AuthError::Invalid));
    let header = json!({"alg": "none", "kid": TEST_KID}).to_string();
    let token = format!("{}.{}.", b64(header.as_bytes()), b64(b"{}"));
    assert_eq!(verifier.verify(&token).await, Err(AuthError::Invalid));
}

// spec: ACC-007
#[tokio::test]
async fn token_without_expiry_or_subject_is_rejected() {
    let (verifier, clock) = verifier(None);
    let no_exp = sign_test_token(without(claims(&clock), "exp"));
    assert_eq!(verifier.verify(&no_exp).await, Err(AuthError::Invalid));
    for sub in [json!(""), json!(7), Value::Null] {
        let token = sign_test_token(with(claims(&clock), "sub", sub));
        assert_eq!(verifier.verify(&token).await, Err(AuthError::Invalid));
    }
    let no_sub = sign_test_token(without(claims(&clock), "sub"));
    assert_eq!(verifier.verify(&no_sub).await, Err(AuthError::Invalid));
}

// spec: ACC-007
#[tokio::test]
async fn key_source_failure_is_unavailable() {
    let clock = clock();
    let verifier = JwtVerifier::new(
        &auth_config(None),
        StaticKeySource::failing(),
        clock.clone(),
    );
    let token = sign_test_token(claims(&clock));
    assert_eq!(verifier.verify(&token).await, Err(AuthError::Unavailable));
}

// ---- JWKS key source -----------------------------------------------------------------

/// A one-route HTTP server. `respond` receives the request number (from 0) and returns
/// `(status line, body)`; `None` accepts the connection and never answers.
async fn serve(
    respond: impl Fn(usize) -> Option<(&'static str, String)> + Send + Sync + 'static,
) -> (Url, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = Url::parse(&format!(
        "http://{}/jwks.json",
        listener.local_addr().unwrap()
    ))
    .unwrap();
    let hits = Arc::new(AtomicUsize::new(0));
    let counter = hits.clone();
    tokio::spawn(async move {
        let mut held = Vec::new();
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            let n = counter.fetch_add(1, Ordering::SeqCst);
            match respond(n) {
                Some((status, body)) => {
                    tokio::spawn(async move {
                        let mut buf = [0u8; 4096];
                        let _ = socket.read(&mut buf).await;
                        let response = format!(
                            "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                            body.len()
                        );
                        let _ = socket.write_all(response.as_bytes()).await;
                        let _ = socket.shutdown().await;
                    });
                }
                None => held.push(socket), // never answer, never close
            }
        }
    });
    (url, hits)
}

fn jwks_verifier(source: JwksKeySource, clock: Arc<ManualClock>) -> JwtVerifier<JwksKeySource> {
    JwtVerifier::new(&auth_config(None), source, clock)
}

fn jwks_source(url: Url) -> JwksKeySource {
    JwksKeySource::new(url, reqwest::Client::new(), Duration::from_secs(3600))
}

// spec: ACC-007
#[tokio::test]
async fn jwks_endpoint_timeout_is_unavailable_within_6s() {
    let (url, hits) = serve(|_| None).await;
    let clock = clock();
    let verifier = jwks_verifier(jwks_source(url), clock.clone());
    let token = sign_test_token(claims(&clock));
    let result = tokio::time::timeout(Duration::from_secs(6), verifier.verify(&token)).await;
    assert_eq!(result, Ok(Err(AuthError::Unavailable)));
    assert!(hits.load(Ordering::SeqCst) >= 1);
}

// spec: ACC-007
#[tokio::test]
async fn concurrent_requests_during_an_outage_all_fail_within_6s() {
    let (url, _) = serve(|_| None).await;
    let clock = clock();
    let verifier = Arc::new(jwks_verifier(jwks_source(url), clock.clone()));
    let token = sign_test_token(claims(&clock));
    let tasks: Vec<_> = (0..5)
        .map(|_| {
            let (verifier, token) = (verifier.clone(), token.clone());
            tokio::spawn(async move { verifier.verify(&token).await })
        })
        .collect();
    let all = tokio::time::timeout(Duration::from_secs(6), async {
        let mut results = Vec::new();
        for task in tasks {
            results.push(task.await.unwrap());
        }
        results
    })
    .await
    .expect("every request answers within 6 s");
    assert!(all.iter().all(|r| *r == Err(AuthError::Unavailable)));
}

// spec: ACC-007
#[tokio::test]
async fn jwks_error_responses_are_unavailable() {
    let clock = clock();
    let token = sign_test_token(claims(&clock));
    for (status, body) in [
        ("500 Internal Server Error", "oops".to_string()),
        ("404 Not Found", "{}".to_string()),
        ("200 OK", "not json".to_string()),
        ("200 OK", r#"{"keys": "nope"}"#.to_string()),
    ] {
        let (url, _) = serve(move |_| Some((status, body.clone()))).await;
        let verifier = jwks_verifier(jwks_source(url), clock.clone());
        assert_eq!(
            verifier.verify(&token).await,
            Err(AuthError::Unavailable),
            "{status}"
        );
    }
}

// spec: ACC-007
#[tokio::test]
async fn unreachable_jwks_endpoint_is_unavailable() {
    // Bind then drop: nothing listens on this port any more.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = Url::parse(&format!(
        "http://{}/jwks.json",
        listener.local_addr().unwrap()
    ))
    .unwrap();
    drop(listener);
    let clock = clock();
    let verifier = jwks_verifier(jwks_source(url), clock.clone());
    let token = sign_test_token(claims(&clock));
    assert_eq!(verifier.verify(&token).await, Err(AuthError::Unavailable));
}

// spec: ACC-007, ACC-013
#[tokio::test]
async fn jwks_keys_are_fetched_and_cached() {
    let (url, hits) = serve(|_| Some(("200 OK", TEST_JWKS.to_string()))).await;
    let clock = clock();
    let verifier = jwks_verifier(jwks_source(url), clock.clone());
    let token = sign_test_token(claims(&clock));
    for _ in 0..3 {
        assert!(verifier.verify(&token).await.is_ok());
    }
    assert_eq!(hits.load(Ordering::SeqCst), 1, "one fetch serves all calls");
}

// spec: ACC-007, ACC-013
#[tokio::test]
async fn unknown_kid_refetches_at_most_once_per_30s() {
    let (url, hits) = serve(|_| Some(("200 OK", TEST_JWKS.to_string()))).await;
    let clock = clock();
    let verifier = jwks_verifier(jwks_source(url), clock.clone());
    let key = EncodingKey::from_ec_pem(TEST_PRIVATE_KEY_PEM.as_bytes()).unwrap();
    let unknown = sign_with(Algorithm::ES256, Some("nope"), &key, &claims(&clock));
    for _ in 0..5 {
        assert_eq!(verifier.verify(&unknown).await, Err(AuthError::Invalid));
    }
    assert_eq!(hits.load(Ordering::SeqCst), 1, "refetches are rate limited");
    // The known key keeps working from the cache.
    assert!(
        verifier
            .verify(&sign_test_token(claims(&clock)))
            .await
            .is_ok()
    );
    assert_eq!(hits.load(Ordering::SeqCst), 1);
}

// spec: ACC-007
#[tokio::test]
async fn a_rotated_in_key_is_picked_up_after_the_refetch_interval() {
    // First answer: no keys. Later answers: the test key.
    let (url, hits) = serve(|n| {
        let body = if n == 0 {
            r#"{"keys":[]}"#.to_string()
        } else {
            TEST_JWKS.to_string()
        };
        Some(("200 OK", body))
    })
    .await;
    let clock = clock();
    let source = jwks_source(url).with_min_refetch_interval(Duration::from_millis(100));
    let verifier = jwks_verifier(source, clock.clone());
    let token = sign_test_token(claims(&clock));
    assert_eq!(verifier.verify(&token).await, Err(AuthError::Invalid));
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert!(verifier.verify(&token).await.is_ok());
    assert_eq!(hits.load(Ordering::SeqCst), 2);
}

// spec: ACC-007, ACC-013
#[tokio::test]
async fn cached_keys_are_reloaded_after_the_ttl() {
    let (url, hits) = serve(|_| Some(("200 OK", TEST_JWKS.to_string()))).await;
    let clock = clock();
    let source = JwksKeySource::new(url, reqwest::Client::new(), Duration::from_millis(100));
    let verifier = jwks_verifier(source, clock.clone());
    let token = sign_test_token(claims(&clock));
    assert!(verifier.verify(&token).await.is_ok());
    assert!(verifier.verify(&token).await.is_ok());
    assert_eq!(hits.load(Ordering::SeqCst), 1);
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert!(verifier.verify(&token).await.is_ok());
    assert_eq!(hits.load(Ordering::SeqCst), 2);
}

// spec: ACC-007
#[tokio::test]
async fn symmetric_and_unusable_jwks_entries_are_never_trusted() {
    // A JWKS that lists an HMAC key under the test kid must not let HS256 tokens through.
    let secret = b64(TEST_PUBLIC_KEY_PEM.as_bytes());
    let jwks = json!({"keys": [
        {"kty": "oct", "kid": TEST_KID, "alg": "HS256", "k": secret},
        {"kty": "EC", "crv": "P-256", "kid": "broken", "x": "!!", "y": "!!"},
        {"kty": "whatever", "kid": "weird"},
        {"kid": "no-kty"},
    ]})
    .to_string();
    let (url, _) = serve(move |_| Some(("200 OK", jwks.clone()))).await;
    let clock = clock();
    let verifier = jwks_verifier(jwks_source(url), clock.clone());
    let forged = sign_with(
        Algorithm::HS256,
        Some(TEST_KID),
        &EncodingKey::from_secret(TEST_PUBLIC_KEY_PEM.as_bytes()),
        &claims(&clock),
    );
    assert_eq!(verifier.verify(&forged).await, Err(AuthError::Invalid));
    // And the token the legitimate key would sign is unknown here.
    let token = sign_test_token(claims(&clock));
    assert_eq!(verifier.verify(&token).await, Err(AuthError::Invalid));
}

// spec: ACC-007
#[tokio::test]
async fn rs256_token_is_verified_through_a_jwks() {
    let jwks = mixed_jwks();
    let (url, _) = serve(move |_| Some(("200 OK", jwks.clone()))).await;
    let clock = clock();
    let verifier = jwks_verifier(jwks_source(url), clock.clone());
    let rsa = EncodingKey::from_rsa_pem(RSA_PRIVATE_KEY_PEM.as_bytes()).unwrap();
    let token = sign_with(Algorithm::RS256, Some(RSA_KID), &rsa, &claims(&clock));
    let verified = verifier.verify(&token).await.unwrap();
    assert_eq!(verified.subject, "u1");
    assert_eq!(verified.issuer, TEST_ISSUER);
    // The EC key in the same set still works.
    assert!(
        verifier
            .verify(&sign_test_token(claims(&clock)))
            .await
            .is_ok()
    );
    // An expired RS256 token is Expired, a tampered one is Invalid.
    let expired = sign_with(
        Algorithm::RS256,
        Some(RSA_KID),
        &rsa,
        &with(claims(&clock), "exp", json!(now_ts(&clock) - 3600)),
    );
    assert_eq!(verifier.verify(&expired).await, Err(AuthError::Expired));
    let mut parts: Vec<&str> = token.split('.').collect();
    let forged = b64(with(claims(&clock), "sub", json!("admin"))
        .to_string()
        .as_bytes());
    parts[1] = &forged;
    assert_eq!(
        verifier.verify(&parts.join(".")).await,
        Err(AuthError::Invalid)
    );
}

// spec: ACC-007
#[tokio::test]
async fn rs256_header_with_a_kid_of_an_ec_key_is_rejected() {
    let jwks = mixed_jwks();
    let (url, _) = serve(move |_| Some(("200 OK", jwks.clone()))).await;
    let clock = clock();
    let verifier = jwks_verifier(jwks_source(url), clock.clone());
    let rsa = EncodingKey::from_rsa_pem(RSA_PRIVATE_KEY_PEM.as_bytes()).unwrap();
    let token = sign_with(Algorithm::RS256, Some(TEST_KID), &rsa, &claims(&clock));
    assert_eq!(verifier.verify(&token).await, Err(AuthError::Invalid));
}

// spec: ACC-007
#[tokio::test]
async fn es256_header_with_a_kid_of_an_rsa_key_is_rejected() {
    let jwks = mixed_jwks();
    let (url, _) = serve(move |_| Some(("200 OK", jwks.clone()))).await;
    let clock = clock();
    let verifier = jwks_verifier(jwks_source(url), clock.clone());
    let ec = EncodingKey::from_ec_pem(TEST_PRIVATE_KEY_PEM.as_bytes()).unwrap();
    let token = sign_with(Algorithm::ES256, Some(RSA_KID), &ec, &claims(&clock));
    assert_eq!(verifier.verify(&token).await, Err(AuthError::Invalid));
}
