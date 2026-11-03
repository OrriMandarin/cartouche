//! The feature-gated test support: token issuer, JWKS, reset, seed and controllable clock.
#![cfg(feature = "test-support")]

mod common;

use std::sync::Arc;

use axum::http::StatusCode;
use cartouche_api::app::build_router;
use cartouche_api::state::AppState;
use cartouche_domain::{Clock, ManualClock, OverridableClock};
use chrono::{Duration, TimeZone, Utc};
use common::{TestApp, test_app, test_app_with, test_config_with, test_verifier};
use serde_json::{Value, json};
use sqlx::PgPool;

async fn issue(app: &TestApp, body: Value) -> common::TestResponse {
    app.request("POST", "/api/test/token", None, Some(body))
        .await
}

async fn token_for(app: &TestApp, body: Value) -> String {
    let response = issue(app, body).await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.json);
    response.json["token"].as_str().unwrap().to_string()
}

async fn user_count(pool: &PgPool) -> i64 {
    sqlx::query_scalar("select count(*) from users")
        .fetch_one(pool)
        .await
        .unwrap()
}

// spec: ACC-008
#[sqlx::test]
async fn token_from_test_issuer_authenticates(pool: PgPool) {
    let app = test_app(pool).await;
    let token = token_for(
        &app,
        json!({"subject": "x", "email": "x@example.test", "name": "Xavier"}),
    )
    .await;
    let me = app.request("GET", "/api/me", Some(&token), None).await;
    assert_eq!(me.status, StatusCode::OK, "{}", me.json);
    assert_eq!(me.json["email"], "x@example.test");
    assert_eq!(me.json["display_name"], "Xavier");
}

// spec: ACC-008
#[sqlx::test]
async fn token_requires_a_non_blank_subject(pool: PgPool) {
    let app = test_app(pool).await;
    for body in [json!({"subject": ""}), json!({"subject": "  \t"})] {
        let response = issue(&app, body).await;
        assert_eq!(response.status, StatusCode::BAD_REQUEST);
        assert_eq!(response.json["error"]["code"], "invalid_request");
    }
    let missing = issue(&app, json!({})).await;
    assert_eq!(missing.status, StatusCode::BAD_REQUEST);
    assert_eq!(missing.json["error"]["code"], "invalid_request");
}

// spec: ACC-008
#[sqlx::test]
async fn token_lifetime_is_bounded(pool: PgPool) {
    let app = test_app(pool).await;
    let too_long = issue(&app, json!({"subject": "x", "expires_in_secs": 86_401})).await;
    assert_eq!(too_long.status, StatusCode::BAD_REQUEST);
    assert_eq!(too_long.json["error"]["code"], "invalid_request");
    let max = issue(&app, json!({"subject": "x", "expires_in_secs": 86_400})).await;
    assert_eq!(max.status, StatusCode::OK);
}

// spec: ACC-008
#[sqlx::test]
async fn token_claims_come_from_the_state_clock(pool: PgPool) {
    use base64::Engine;
    let app = test_app(pool).await;
    let token = token_for(&app, json!({"subject": "x"})).await;
    let payload = token.split('.').nth(1).unwrap();
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .unwrap();
    let claims: Value = serde_json::from_slice(&bytes).unwrap();
    let now = app.clock.now().timestamp();
    assert_eq!(claims["iss"], "cartouche-test-issuer");
    assert_eq!(claims["sub"], "x");
    assert_eq!(claims["iat"], now);
    assert_eq!(claims["exp"], now + 3600);
}

// spec: ACC-008
#[sqlx::test]
async fn jwks_exposes_test_key(pool: PgPool) {
    let app = test_app(pool).await;
    let response = app.request("GET", "/api/test/jwks.json", None, None).await;
    assert_eq!(response.status, StatusCode::OK);
    let keys = response.json["keys"].as_array().unwrap();
    assert_eq!(keys.len(), 1);
    assert_eq!(keys[0]["kid"], "cartouche-test-1");
    assert_eq!(keys[0]["alg"], "ES256");
    assert!(
        keys[0].get("d").is_none(),
        "the private part must not be served"
    );
}

// spec: ACC-008
#[sqlx::test]
async fn seed_base_creates_expected_users(pool: PgPool) {
    let app = test_app(pool.clone()).await;
    let response = app.seed("base").await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.json);
    let users: Vec<(&str, &str)> = response.json["users"]
        .as_array()
        .unwrap()
        .iter()
        .map(|u| {
            (
                u["subject"].as_str().unwrap(),
                u["status"].as_str().unwrap(),
            )
        })
        .collect();
    let expected = [
        ("seed-admin", "approved"),
        ("seed-alice", "approved"),
        ("seed-bob", "approved"),
        ("seed-carol", "pending"),
        ("seed-dan", "suspended"),
        ("seed-erin", "rejected"),
    ];
    assert_eq!(users, expected);

    let rows: Vec<(String, String, String, String, String)> = sqlx::query_as(
        "select subject, issuer, display_name, email, status from users order by subject",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 6);
    assert!(rows.iter().all(|r| r.1 == "cartouche-test-issuer"));
    let erin = rows.iter().find(|r| r.0 == "seed-erin").unwrap();
    assert_eq!(erin.2, "Érin D'Aubigné-Müller");
    assert_eq!(erin.3, "erin@example.test");
    assert_eq!(
        rows.iter().find(|r| r.0 == "seed-carol").unwrap().2,
        "Carole Lefèvre"
    );
}

// spec: ACC-008
#[sqlx::test]
async fn seeded_user_can_sign_in_with_a_test_token(pool: PgPool) {
    let app = test_app(pool.clone()).await;
    app.seed("base").await;
    let token = token_for(&app, json!({"subject": "seed-dan"})).await;
    let me = app.request("GET", "/api/me", Some(&token), None).await;
    assert_eq!(me.status, StatusCode::OK);
    assert_eq!(me.json["status"], "suspended");
    assert_eq!(
        user_count(&pool).await,
        6,
        "signing in created no duplicate"
    );
}

// spec: ACC-008
#[sqlx::test]
async fn seeding_twice_resets_the_seeded_users(pool: PgPool) {
    let app = test_app(pool.clone()).await;
    assert_eq!(app.seed("base").await.status, StatusCode::OK);
    sqlx::query(
        "update users set status = 'rejected', display_name = 'x' where subject = 'seed-alice'",
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(app.seed("base").await.status, StatusCode::OK);
    assert_eq!(user_count(&pool).await, 6);
    let (status, name): (String, String) =
        sqlx::query_as("select status, display_name from users where subject = 'seed-alice'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        (status.as_str(), name.as_str()),
        ("approved", "Alice Durand")
    );
}

// spec: ACC-008
#[sqlx::test]
async fn reset_empties_tables(pool: PgPool) {
    let app = test_app(pool.clone()).await;
    app.seed("base").await;
    let admin: uuid::Uuid = sqlx::query_scalar("select id from users where subject = 'seed-admin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    sqlx::query(
        "insert into audit_log (actor_user_id, action, target_type, target_id) \
         values ($1, 'user.approve', 'user', $1)",
    )
    .bind(admin)
    .execute(&pool)
    .await
    .unwrap();

    let response = app.request("POST", "/api/test/reset", None, None).await;
    assert_eq!(response.status, StatusCode::NO_CONTENT);
    assert_eq!(user_count(&pool).await, 0);
    let audits: i64 = sqlx::query_scalar("select count(*) from audit_log")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(audits, 0);
}

// spec: ACC-008
#[sqlx::test]
async fn unknown_scenario_is_404(pool: PgPool) {
    let app = test_app(pool.clone()).await;
    let response = app.seed("nope").await;
    assert_eq!(response.status, StatusCode::NOT_FOUND);
    assert_eq!(response.json["error"]["code"], "unknown_scenario");
    assert_eq!(user_count(&pool).await, 0);
}

// spec: ACC-008
#[sqlx::test]
async fn clock_controls_token_expiry(pool: PgPool) {
    // A state whose clock is the overridable one, shared with the clock route.
    let clock = Arc::new(OverridableClock::new());
    let config = test_config_with(&[]);
    let state = AppState {
        db: pool.clone(),
        verifier: test_verifier(&config, clock.clone()),
        config: Arc::new(config),
        clock: clock.clone(),
        media: common::test_media(),
        test_clock: Some(clock),
    };
    let app = TestApp {
        media: state.media.clone(),
        router: build_router(state),
        pool,
        // Unused here: time is driven through `/api/test/clock`.
        clock: Arc::new(ManualClock::new(Utc::now())),
    };

    let t0 = Utc.with_ymd_and_hms(2030, 5, 1, 9, 0, 0).unwrap();
    let set = |at: Option<chrono::DateTime<Utc>>| {
        app.request("POST", "/api/test/clock", None, Some(json!({ "now": at })))
    };
    let frozen = set(Some(t0)).await;
    assert_eq!(frozen.status, StatusCode::OK, "{}", frozen.json);
    assert_eq!(frozen.json["now"], "2030-05-01T09:00:00Z");

    let token = token_for(&app, json!({"subject": "x", "expires_in_secs": 60})).await;
    let ok = app.request("GET", "/api/me", Some(&token), None).await;
    assert_eq!(ok.status, StatusCode::OK, "{}", ok.json);

    set(Some(t0 + Duration::minutes(10))).await;
    let expired = app.request("GET", "/api/me", Some(&token), None).await;
    assert_eq!(expired.status, StatusCode::UNAUTHORIZED);
    assert_eq!(expired.json["error"]["code"], "token_expired");

    // `null` goes back to the system time (2030 is in the future of the real clock).
    let reset = set(None).await;
    assert_eq!(reset.status, StatusCode::OK);
    let now: chrono::DateTime<Utc> = reset.json["now"].as_str().unwrap().parse().unwrap();
    assert!((Utc::now() - now).num_seconds().abs() < 5);
}

// spec: ACC-008
#[sqlx::test]
async fn clock_body_must_carry_now(pool: PgPool) {
    let app = test_app(pool).await;
    for body in [json!({}), json!({"now": "yesterday"})] {
        let response = app
            .request("POST", "/api/test/clock", None, Some(body))
            .await;
        assert_eq!(response.status, StatusCode::BAD_REQUEST);
        assert_eq!(response.json["error"]["code"], "invalid_request");
    }
}

// spec: ACC-008
#[sqlx::test]
async fn clock_route_without_overridable_clock_is_404(pool: PgPool) {
    // The default test state has a frozen manual clock and no overridable one.
    let app = test_app(pool).await;
    let response = app
        .request("POST", "/api/test/clock", None, Some(json!({"now": null})))
        .await;
    assert_eq!(response.status, StatusCode::NOT_FOUND);
    assert_eq!(response.json["error"]["code"], "not_found");
}

// spec: ACC-008
#[sqlx::test]
async fn test_routes_absent_in_production_env(pool: PgPool) {
    let app = test_app_with(pool, &[("APP_ENV", "production")]).await;
    let probes = [
        ("POST", "/api/test/token", Some(json!({"subject": "x"}))),
        ("GET", "/api/test/jwks.json", None),
        ("POST", "/api/test/reset", None),
        ("POST", "/api/test/seed", Some(json!({"scenario": "base"}))),
        ("POST", "/api/test/clock", Some(json!({"now": null}))),
        ("GET", "/api/test/approved-check", None),
    ];
    for (method, path, body) in probes {
        let response = app.request(method, path, None, body).await;
        assert_eq!(response.status, StatusCode::NOT_FOUND, "{method} {path}");
        assert_eq!(response.json["error"]["code"], "not_found", "{path}");
    }
}
