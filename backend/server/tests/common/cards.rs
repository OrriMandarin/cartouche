//! Helpers for the card and slug integration tests.

use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::PgPool;

use super::{TestApp, TestResponse, sign_test_token, test_app_with};

const ISSUER: &str = "cartouche-test-issuer";

/// An app where signups are open (every test user is approved); `boss` is an administrator.
pub async fn cards_app(pool: PgPool) -> TestApp {
    test_app_with(pool, &[("SIGNUP_MODE", "open"), ("ADMIN_USER_IDS", "boss")]).await
}

pub fn token(sub: &str) -> String {
    sign_test_token(json!({
        "iss": ISSUER,
        "sub": sub,
        "exp": 1_768_478_400i64 + 3600, // 2026-01-15 12:00 UTC + 1 h
        "email": format!("{sub}@example.com"),
        "name": format!("User {sub}"),
    }))
}

/// Creates a card named Alice Durand for `sub` and returns the `CardView`.
pub async fn create_card(app: &TestApp, sub: &str, slug: &str) -> Value {
    let res = app
        .request(
            "POST",
            "/api/cards",
            Some(&token(sub)),
            Some(json!({ "slug": slug, "first_name": "Alice", "last_name": "Durand" })),
        )
        .await;
    assert_eq!(
        res.status,
        StatusCode::CREATED,
        "create {slug}: {}",
        res.json
    );
    res.json
}

/// Recursively merges `patch` into `base`: objects merge key by key, anything else replaces.
fn merge(base: &mut Value, patch: Value) {
    match (base, patch) {
        (Value::Object(base), Value::Object(patch)) => {
            for (key, value) in patch {
                merge(base.entry(key).or_insert(Value::Null), value);
            }
        }
        (base, patch) => *base = patch,
    }
}

/// Reads the card, merges `patch` into its editable fields (media included) and sends the `PUT`.
pub async fn put_card(app: &TestApp, sub: &str, id: &str, patch: Value) -> TestResponse {
    let path = format!("/api/cards/{id}");
    let current = app.request("GET", &path, Some(&token(sub)), None).await;
    assert_eq!(
        current.status,
        StatusCode::OK,
        "read {id}: {}",
        current.json
    );
    let body = save_body(&current.json, patch);
    app.request("PUT", &path, Some(&token(sub)), Some(body))
        .await
}

/// The `PUT` body that saves `card` as it is, with `patch` merged into its editable fields.
pub fn save_body(card: &Value, patch: Value) -> Value {
    let mut content = card["content"].clone();
    content
        .as_object_mut()
        .expect("content is an object")
        .remove("phone_display");
    let mut body = json!({
        "slug": card["slug"],
        "template": card["template"],
        "settings": card["settings"],
        "theme": card["theme"],
        "content": content,
        "links": card["links"],
        // The save replaces the card's media too: keep the ones it has.
        "header_media_id": card["header"]["id"],
        "avatar_media_id": card["avatar"]["id"],
    });
    merge(&mut body, patch);
    body
}
