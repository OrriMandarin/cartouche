mod common;

use axum::http::StatusCode;
use common::{TestApp, sign_test_token, test_app, test_app_with};
use serde_json::{Value, json};
use sqlx::PgPool;

const ISSUER: &str = "cartouche-test-issuer";

/// A valid token for `sub` (frozen test clock: 2026-01-15 12:00 UTC).
fn token_for(sub: &str, email: Option<&str>, name: Option<&str>) -> String {
    let mut claims = json!({
        "iss": ISSUER,
        "sub": sub,
        "exp": 1_768_478_400i64 + 3600, // 2026-01-15 12:00 UTC + 1 h
    });
    if let Some(email) = email {
        claims["email"] = json!(email);
    }
    if let Some(name) = name {
        claims["name"] = json!(name);
    }
    sign_test_token(claims)
}

fn token(sub: &str) -> String {
    token_for(sub, Some("ada@example.com"), Some("Ada Lovelace"))
}

async fn me(app: &TestApp, token: &str) -> common::TestResponse {
    app.request("GET", "/api/me", Some(token), None).await
}

async fn user_count(pool: &PgPool) -> i64 {
    sqlx::query_scalar("select count(*) from users")
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn stored_status(pool: &PgPool, sub: &str) -> String {
    sqlx::query_scalar("select status from users where subject = $1")
        .bind(sub)
        .fetch_one(pool)
        .await
        .unwrap()
}

fn error_code(res: &common::TestResponse) -> &str {
    res.json["error"]["code"].as_str().unwrap_or_default()
}

// spec: ACC-001, ACC-002
#[sqlx::test(migrations = "./migrations")]
async fn first_request_creates_pending_account(pool: PgPool) {
    let app = test_app(pool.clone()).await;
    let res = me(&app, &token("u1")).await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json["status"], "pending");
    assert_eq!(res.json["is_admin"], false);
    assert_eq!(res.json["email"], "ada@example.com");
    assert_eq!(res.json["display_name"], "Ada Lovelace");
    assert!(res.json["id"].as_str().is_some());
    assert_eq!(user_count(&pool).await, 1);
    let issuer: String = sqlx::query_scalar("select issuer from users")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(issuer, ISSUER);
}

// spec: ACC-001
#[sqlx::test(migrations = "./migrations")]
async fn second_request_reuses_the_account(pool: PgPool) {
    let app = test_app(pool.clone()).await;
    let first = me(&app, &token("u1")).await;
    let second = me(&app, &token("u1")).await;
    assert_eq!(first.json["id"], second.json["id"]);
    assert_eq!(user_count(&pool).await, 1);
}

// spec: ACC-002
#[sqlx::test(migrations = "./migrations")]
async fn open_mode_creates_approved_account(pool: PgPool) {
    let app = test_app_with(pool.clone(), &[("SIGNUP_MODE", "open")]).await;
    let res = me(&app, &token("u1")).await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json["status"], "approved");
    assert_eq!(res.json["is_admin"], false);
}

// spec: ACC-002
#[sqlx::test(migrations = "./migrations")]
async fn closed_mode_refuses_new_user_without_creating_row(pool: PgPool) {
    let app = test_app_with(pool.clone(), &[("SIGNUP_MODE", "closed")]).await;
    let res = me(&app, &token("u1")).await;
    assert_eq!(res.status, StatusCode::FORBIDDEN);
    assert_eq!(error_code(&res), "signup_closed");
    assert_eq!(user_count(&pool).await, 0);
}

// spec: ACC-002
#[sqlx::test(migrations = "./migrations")]
async fn closed_mode_still_lets_existing_user_in(pool: PgPool) {
    let open = test_app_with(pool.clone(), &[("SIGNUP_MODE", "open")]).await;
    assert_eq!(me(&open, &token("u1")).await.status, StatusCode::OK);

    let closed = test_app_with(pool.clone(), &[("SIGNUP_MODE", "closed")]).await;
    let res = me(&closed, &token("u1")).await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json["status"], "approved");
    assert_eq!(user_count(&pool).await, 1);
}

// spec: ACC-002, ACC-003
#[sqlx::test(migrations = "./migrations")]
async fn closed_mode_still_creates_admin(pool: PgPool) {
    let app = test_app_with(
        pool.clone(),
        &[("SIGNUP_MODE", "closed"), ("ADMIN_USER_IDS", "boss")],
    )
    .await;
    let res = me(&app, &token("boss")).await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json["status"], "approved");
    assert_eq!(res.json["is_admin"], true);
}

// spec: ACC-003
#[sqlx::test(migrations = "./migrations")]
async fn admin_is_created_approved_and_flagged(pool: PgPool) {
    let app = test_app_with(pool.clone(), &[("ADMIN_USER_IDS", " other , boss ,")]).await;
    let res = me(&app, &token("boss")).await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json["status"], "approved");
    assert_eq!(res.json["is_admin"], true);
    assert_eq!(stored_status(&pool, "boss").await, "approved");
}

// spec: ACC-003
#[sqlx::test(migrations = "./migrations")]
async fn admin_flag_follows_config_not_db(pool: PgPool) {
    let as_admin = test_app_with(pool.clone(), &[("ADMIN_USER_IDS", "boss")]).await;
    assert_eq!(me(&as_admin, &token("boss")).await.json["is_admin"], true);

    let not_admin = test_app(pool.clone()).await;
    let res = me(&not_admin, &token("boss")).await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json["is_admin"], false);
    // The stored status is untouched by losing the admin flag.
    assert_eq!(res.json["status"], "approved");
}

// spec: ACC-003
#[sqlx::test(migrations = "./migrations")]
async fn admin_with_stale_status_is_promoted(pool: PgPool) {
    // Signs up as a regular user: pending.
    let regular = test_app(pool.clone()).await;
    assert_eq!(me(&regular, &token("boss")).await.json["status"], "pending");
    assert_eq!(stored_status(&pool, "boss").await, "pending");

    // Later made admin: promoted and persisted on the next request.
    let admin = test_app_with(pool.clone(), &[("ADMIN_USER_IDS", "boss")]).await;
    let res = me(&admin, &token("boss")).await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json["status"], "approved");
    assert_eq!(res.json["is_admin"], true);
    assert_eq!(stored_status(&pool, "boss").await, "approved");
    assert_eq!(user_count(&pool).await, 1);
}

// spec: ACC-006
#[sqlx::test(migrations = "./migrations")]
async fn claims_are_normalized_and_refreshed(pool: PgPool) {
    let app = test_app(pool.clone()).await;

    let res = me(
        &app,
        &token_for(
            "u1",
            Some("  ada@example.com "),
            Some("  Carole Lefe\u{0300}vre "),
        ),
    )
    .await;
    assert_eq!(res.json["display_name"], "Carole Lef\u{e8}vre");
    assert_eq!(res.json["email"], "ada@example.com");

    // A new email replaces the old one.
    let res = me(&app, &token_for("u1", Some("new@example.com"), None)).await;
    assert_eq!(res.json["email"], "new@example.com");
    assert_eq!(res.json["display_name"], "Carole Lef\u{e8}vre");

    // A request without email claim keeps the stored one.
    let res = me(&app, &token_for("u1", None, None)).await;
    assert_eq!(res.json["email"], "new@example.com");
    assert_eq!(res.json["display_name"], "Carole Lef\u{e8}vre");

    // A claim that is empty once trimmed counts as absent.
    let res = me(&app, &token_for("u1", Some("   "), Some(""))).await;
    assert_eq!(res.json["email"], "new@example.com");
    assert_eq!(res.json["display_name"], "Carole Lef\u{e8}vre");
}

// spec: ACC-006
#[sqlx::test(migrations = "./migrations")]
async fn user_without_email_or_name_is_stored_with_nulls(pool: PgPool) {
    let app = test_app(pool.clone()).await;
    let res = me(&app, &token_for("u1", None, None)).await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json["email"], Value::Null);
    assert_eq!(res.json["display_name"], Value::Null);
}

// spec: ACC-001 (Review Focus 3)
#[sqlx::test(migrations = "./migrations")]
async fn concurrent_first_requests_create_one_account(pool: PgPool) {
    let app = test_app(pool.clone()).await;
    let t = token("u1");
    let responses = futures_util::future::join_all(
        (0..10).map(|_| app.request("GET", "/api/me", Some(&t), None)),
    )
    .await;
    let first_id = responses[0].json["id"].clone();
    for res in &responses {
        assert_eq!(res.status, StatusCode::OK, "{:?}", res.json);
        assert_eq!(res.json["id"], first_id);
    }
    assert_eq!(user_count(&pool).await, 1);
}

// spec: ACC-004
// Needs the `/api/test/approved-check` probe, mounted only with `test-support`.
#[cfg(feature = "test-support")]
#[sqlx::test(migrations = "./migrations")]
async fn pending_user_is_blocked_from_approved_routes(pool: PgPool) {
    let app = test_app(pool.clone()).await;
    let t = token("u1");
    // /api/me works whatever the status.
    assert_eq!(me(&app, &t).await.status, StatusCode::OK);
    let res = app
        .request("GET", "/api/test/approved-check", Some(&t), None)
        .await;
    assert_eq!(res.status, StatusCode::FORBIDDEN);
    assert_eq!(error_code(&res), "account_pending");
}

// spec: ACC-004
// Needs the `/api/test/approved-check` probe, mounted only with `test-support`.
#[cfg(feature = "test-support")]
#[sqlx::test(migrations = "./migrations")]
async fn rejected_and_suspended_users_are_blocked_with_their_own_code(pool: PgPool) {
    let app = test_app(pool.clone()).await;
    let t = token("u1");
    me(&app, &t).await;
    for (status, code) in [
        ("rejected", "account_rejected"),
        ("suspended", "account_suspended"),
    ] {
        sqlx::query("update users set status = $1")
            .bind(status)
            .execute(&pool)
            .await
            .unwrap();
        let res = app
            .request("GET", "/api/test/approved-check", Some(&t), None)
            .await;
        assert_eq!(res.status, StatusCode::FORBIDDEN);
        assert_eq!(error_code(&res), code);
        // /api/me stays reachable and reports the status.
        let res = me(&app, &t).await;
        assert_eq!(res.status, StatusCode::OK);
        assert_eq!(res.json["status"], status);
    }
}

// spec: ACC-004
// Needs the `/api/test/approved-check` probe, mounted only with `test-support`.
#[cfg(feature = "test-support")]
#[sqlx::test(migrations = "./migrations")]
async fn approved_user_passes_the_approved_check(pool: PgPool) {
    let app = test_app_with(pool.clone(), &[("SIGNUP_MODE", "open")]).await;
    let res = app
        .request("GET", "/api/test/approved-check", Some(&token("u1")), None)
        .await;
    assert_eq!(res.status, StatusCode::NO_CONTENT);
}

// spec: ACC-005 (Review Focus 5)
// Needs the `/api/test/approved-check` probe, mounted only with `test-support`.
#[cfg(feature = "test-support")]
#[sqlx::test(migrations = "./migrations")]
async fn suspension_applies_on_next_request(pool: PgPool) {
    let app = test_app_with(pool.clone(), &[("SIGNUP_MODE", "open")]).await;
    let t = token("u1");
    let check = || app.request("GET", "/api/test/approved-check", Some(&t), None);
    assert_eq!(check().await.status, StatusCode::NO_CONTENT);

    sqlx::query("update users set status = 'suspended' where subject = 'u1'")
        .execute(&pool)
        .await
        .unwrap();

    let res = check().await;
    assert_eq!(res.status, StatusCode::FORBIDDEN);
    assert_eq!(error_code(&res), "account_suspended");
}

// spec: ACC-007
#[sqlx::test(migrations = "./migrations")]
async fn missing_token_is_401(pool: PgPool) {
    let app = test_app(pool.clone()).await;
    let res = app.request("GET", "/api/me", None, None).await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);
    assert_eq!(error_code(&res), "token_invalid");
    assert_eq!(user_count(&pool).await, 0);
}

// spec: ACC-007
#[sqlx::test(migrations = "./migrations")]
async fn malformed_authorization_header_is_401(pool: PgPool) {
    let app = test_app(pool.clone()).await;
    for header in ["Basic abc", "Bearer", "Bearer ", "token"] {
        let res = app
            .request_with_headers("GET", "/api/me", None, None, &[("authorization", header)])
            .await;
        assert_eq!(res.status, StatusCode::UNAUTHORIZED, "{header:?}");
        assert_eq!(error_code(&res), "token_invalid", "{header:?}");
    }
    let res = app.request("GET", "/api/me", Some("garbage"), None).await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);
    assert_eq!(user_count(&pool).await, 0);
}

// spec: ACC-007
#[sqlx::test(migrations = "./migrations")]
async fn invalid_token_never_creates_an_account(pool: PgPool) {
    let app = test_app(pool.clone()).await;
    let expired = sign_test_token(json!({
        "iss": ISSUER, "sub": "u1", "exp": 1_768_478_400i64 - 3600,
    }));
    let res = me(&app, &expired).await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);
    assert_eq!(error_code(&res), "token_expired");
    assert_eq!(user_count(&pool).await, 0);
}
