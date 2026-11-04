use crate::common;

use axum::http::StatusCode;
use common::cards::{cards_app, create_card, put_card, token};
use common::media_fixtures::{jpeg, png};
use common::{Part, TestApp, TestResponse};
use serde_json::{Value, json};
use sqlx::PgPool;

const BASE: &str = "http://localhost:3000";

fn error_code(res: &TestResponse) -> &str {
    res.json["error"]["code"].as_str().unwrap_or_default()
}

fn card_id(card: &Value) -> &str {
    card["id"].as_str().unwrap()
}

async fn act(app: &TestApp, sub: &str, id: &str, action: &str) -> TestResponse {
    app.request(
        "POST",
        &format!("/api/cards/{id}/{action}"),
        Some(&token(sub)),
        None,
    )
    .await
}

async fn duplicate(app: &TestApp, sub: &str, id: &str, slug: &str) -> TestResponse {
    app.request(
        "POST",
        &format!("/api/cards/{id}/duplicate"),
        Some(&token(sub)),
        Some(json!({ "slug": slug })),
    )
    .await
}

/// Uploads an image in `slot` and attaches it to the card with a save.
async fn attach(app: &TestApp, sub: &str, id: &str, slot: &str, bytes: Vec<u8>) -> Value {
    let res = app
        .request_multipart(
            "POST",
            &format!("/api/cards/{id}/media"),
            Some(&token(sub)),
            &[
                Part::text("slot", slot),
                Part::file("file", "photo.png", "image/png", bytes),
            ],
        )
        .await;
    assert_eq!(res.status, StatusCode::CREATED, "upload: {}", res.json);
    let patch = json!({ format!("{slot}_media_id"): res.json["id"] });
    let saved = put_card(app, sub, id, patch).await;
    assert_eq!(saved.status, StatusCode::OK, "attach: {}", saved.json);
    saved.json
}

async fn support_disable(pool: &PgPool, id: &str) {
    sqlx::query("update cards set support_disabled_at = now() where id = $1::uuid")
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
}

// spec: LNK-005, LNK-009
#[sqlx::test(migrations = "./migrations")]
async fn disable_then_enable_keeps_everything(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice").await;
    let id = card_id(&card);
    let before = attach(&app, "alice", id, "avatar", png(400, 400)).await;
    assert_eq!(before["status"], "active");

    let disabled = act(&app, "alice", id, "disable").await;
    assert_eq!(disabled.status, StatusCode::OK, "{}", disabled.json);
    assert_eq!(disabled.json["status"], "disabled");
    // Idempotent.
    let again = act(&app, "alice", id, "disable").await;
    assert_eq!(again.status, StatusCode::OK);
    assert_eq!(again.json["status"], "disabled");

    let enabled = act(&app, "alice", id, "enable").await;
    assert_eq!(enabled.status, StatusCode::OK, "{}", enabled.json);
    assert_eq!(enabled.json["status"], "active");
    assert_eq!(enabled.json["slug"], before["slug"]);
    assert_eq!(enabled.json["content"], before["content"]);
    assert_eq!(enabled.json["avatar"], before["avatar"]);
    let again = act(&app, "alice", id, "enable").await;
    assert_eq!(again.status, StatusCode::OK);
    assert_eq!(again.json["status"], "active");
}

// spec: LNK-008
#[sqlx::test(migrations = "./migrations")]
async fn disabled_card_stays_listed(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice").await;
    let id = card_id(&card);
    assert_eq!(
        act(&app, "alice", id, "disable").await.status,
        StatusCode::OK
    );

    let list = app
        .request("GET", "/api/cards", Some(&token("alice")), None)
        .await;
    assert_eq!(list.status, StatusCode::OK);
    let cards = list.json["cards"].as_array().unwrap();
    assert_eq!(cards.len(), 1);
    assert_eq!(cards[0]["id"], card["id"]);
    assert_eq!(cards[0]["status"], "disabled");
}

// spec: LNK-011, LNK-028
#[sqlx::test(migrations = "./migrations")]
async fn owner_cannot_toggle_a_support_disabled_card(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, "alice", "alice").await;
    let id = card_id(&card);
    support_disable(&pool, id).await;

    for action in ["disable", "enable"] {
        let res = act(&app, "alice", id, action).await;
        assert_eq!(res.status, StatusCode::CONFLICT, "{action}: {}", res.json);
        assert_eq!(error_code(&res), "card_disabled_by_support");
    }
    // Neither call touched the owner's own switch.
    let owner_switch: Option<chrono::DateTime<chrono::Utc>> =
        sqlx::query_scalar("select owner_disabled_at from cards where id = $1::uuid")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(owner_switch.is_none());
}

// spec: EDI-001, EDI-014
#[sqlx::test(migrations = "./migrations")]
async fn duplicate_copies_content_and_media_not_history(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, "alice", "alice").await;
    let id = card_id(&card);
    let saved = put_card(
        &app,
        "alice",
        id,
        json!({
            "slug": "alice-new",
            "template": "classique",
            "theme": card["theme"],
            "content": { "first_name": "Éloïse", "job_title": "Ingénieure ✨" },
            "links": [{ "kind": "website", "url": "https://example.com/éloïse", "label": "Site" }],
        }),
    )
    .await;
    assert_eq!(saved.status, StatusCode::OK, "{}", saved.json);
    let source = attach(&app, "alice", id, "avatar", jpeg(600, 600)).await;
    // The owner disables the source: the copy starts active anyway.
    assert_eq!(
        act(&app, "alice", id, "disable").await.status,
        StatusCode::OK
    );

    let res = duplicate(&app, "alice", id, "alice-bis").await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);
    let copy = res.json;
    assert_ne!(copy["id"], source["id"]);
    assert_eq!(copy["slug"], "alice-bis");
    assert_eq!(copy["status"], "active");
    assert_eq!(copy["template"], source["template"]);
    assert_eq!(copy["settings"], source["settings"]);
    assert_eq!(copy["theme"], source["theme"]);
    assert_eq!(copy["content"], source["content"]);
    assert_eq!(copy["links"], source["links"]);
    assert_eq!(copy["header"], Value::Null);
    assert_ne!(copy["avatar"]["id"], source["avatar"]["id"]);
    assert_eq!(
        copy["avatar"]["images"].as_array().unwrap().len(),
        source["avatar"]["images"].as_array().unwrap().len()
    );
    assert!(copy["avatar"]["jpeg_url"].is_string());

    let slugs: Vec<String> =
        sqlx::query_scalar("select slug from card_slugs where card_id = $1::uuid")
            .bind(copy["id"].as_str().unwrap())
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(slugs, vec!["alice-bis".to_string()]);

    // Deleting the source leaves the copy's files in place.
    let deleted = app
        .request(
            "DELETE",
            &format!("/api/cards/{id}"),
            Some(&token("alice")),
            None,
        )
        .await;
    assert_eq!(deleted.status, StatusCode::NO_CONTENT);
    let url = copy["avatar"]["jpeg_url"].as_str().unwrap();
    let file = app
        .request("GET", url.strip_prefix(BASE).unwrap(), None, None)
        .await;
    assert_eq!(file.status, StatusCode::OK);
    let prefix = format!("cards/{}/", copy["id"].as_str().unwrap());
    assert!(
        app.media_keys()
            .await
            .iter()
            .any(|key| key.starts_with(&prefix))
    );
}

// spec: EDI-001
#[sqlx::test(migrations = "./migrations")]
async fn duplicate_rejects_bad_and_taken_slugs_without_copying_files(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice").await;
    let id = card_id(&card);
    attach(&app, "alice", id, "avatar", png(400, 400)).await;
    create_card(&app, "bob", "bobby").await;
    let keys = app.media_keys().await;

    let invalid = duplicate(&app, "alice", id, "Not A Slug!").await;
    assert_eq!(invalid.status, StatusCode::BAD_REQUEST);
    assert_eq!(error_code(&invalid), "validation_failed");
    assert_eq!(
        invalid.json["error"]["fields"],
        json!([{ "field": "slug", "code": "invalid_slug" }])
    );

    let taken = duplicate(&app, "alice", id, "bobby").await;
    assert_eq!(taken.status, StatusCode::CONFLICT);
    assert_eq!(error_code(&taken), "slug_taken");

    assert_eq!(app.media_keys().await.len(), keys.len());
    let list = app
        .request("GET", "/api/cards", Some(&token("alice")), None)
        .await;
    assert_eq!(list.json["cards"].as_array().unwrap().len(), 1);
}

// spec: LNK-028
#[sqlx::test(migrations = "./migrations")]
async fn support_disabled_card_cannot_be_duplicated(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, "alice", "alice").await;
    let id = card_id(&card);
    support_disable(&pool, id).await;

    let res = duplicate(&app, "alice", id, "alice-bis").await;
    assert_eq!(res.status, StatusCode::CONFLICT, "{}", res.json);
    assert_eq!(error_code(&res), "card_disabled_by_support");
}

// spec: ACC-017
#[sqlx::test(migrations = "./migrations")]
async fn actions_on_other_users_cards_are_404(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice").await;
    let id = card_id(&card);
    create_card(&app, "bob", "bobby").await;

    for action in ["disable", "enable"] {
        let res = act(&app, "bob", id, action).await;
        assert_eq!(res.status, StatusCode::NOT_FOUND, "{action}");
        assert_eq!(error_code(&res), "not_found");
    }
    let res = duplicate(&app, "bob", id, "bob-copy").await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&res), "not_found");

    let untouched = app
        .request(
            "GET",
            &format!("/api/cards/{id}"),
            Some(&token("alice")),
            None,
        )
        .await;
    assert_eq!(untouched.json["status"], "active");
}
