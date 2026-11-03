mod common;

use axum::http::StatusCode;
use common::cards::{cards_app, create_card, put_card, token};
use common::{TestApp, TestResponse, test_app_with};
use futures_util::future::join_all;
use serde_json::{Value, json};
use sqlx::PgPool;

fn error_code(res: &TestResponse) -> &str {
    res.json["error"]["code"].as_str().unwrap_or_default()
}

async fn get_card(app: &TestApp, sub: &str, id: &str) -> TestResponse {
    app.request("GET", &format!("/api/cards/{id}"), Some(&token(sub)), None)
        .await
}

async fn post_card(app: &TestApp, sub: &str, body: Value) -> TestResponse {
    app.request("POST", "/api/cards", Some(&token(sub)), Some(body))
        .await
}

// spec: EDI-001, EDI-013, LNK-001
#[sqlx::test(migrations = "./migrations")]
async fn create_card_with_defaults(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    assert_eq!(card["slug"], "alice-durand");
    assert_eq!(card["status"], "active");
    assert_eq!(card["template"], "classique");
    assert_eq!(card["theme"]["preset"], "clair");
    assert_eq!(card["settings"], json!({}));
    assert_eq!(card["links"], json!([]));
    assert_eq!(card["content"]["first_name"], "Alice");
    assert_eq!(card["content"]["last_name"], "Durand");
    assert_eq!(card["public_url"], "http://localhost:3000/c/alice-durand");

    let list = app
        .request("GET", "/api/cards", Some(&token("alice")), None)
        .await;
    assert_eq!(list.status, StatusCode::OK);
    assert_eq!(list.json["cards"].as_array().unwrap().len(), 1);
    assert_eq!(list.json["cards"][0]["id"], card["id"]);
}

// spec: LNK-002, LNK-022
#[sqlx::test(migrations = "./migrations")]
async fn slug_of_another_user_is_taken(pool: PgPool) {
    let app = cards_app(pool).await;
    create_card(&app, "alice", "alice-durand").await;
    let res = post_card(
        &app,
        "bob",
        json!({ "slug": "alice-durand", "first_name": "Bob" }),
    )
    .await;
    assert_eq!(res.status, StatusCode::CONFLICT);
    assert_eq!(error_code(&res), "slug_taken");
    // Nothing about the owner leaks.
    let body = res.json.to_string();
    assert!(!body.contains("alice@example.com") && !body.contains("User alice"));
}

// spec: LNK-022, Review Focus 3
#[sqlx::test(migrations = "./migrations")]
async fn concurrent_creations_of_one_slug(pool: PgPool) {
    let app = cards_app(pool).await;
    let subs: Vec<String> = (0..10).map(|i| format!("user{i}")).collect();
    // Create the accounts first so the race is on the slug only.
    for sub in &subs {
        let me = app.request("GET", "/api/me", Some(&token(sub)), None).await;
        assert_eq!(me.status, StatusCode::OK);
    }
    let responses = join_all(subs.iter().map(|sub| {
        post_card(
            &app,
            sub,
            json!({ "slug": "same-slug", "first_name": "Alice" }),
        )
    }))
    .await;
    let created = responses
        .iter()
        .filter(|r| r.status == StatusCode::CREATED)
        .count();
    let taken = responses
        .iter()
        .filter(|r| r.status == StatusCode::CONFLICT && error_code(r) == "slug_taken")
        .count();
    assert_eq!(
        (created, taken),
        (1, 9),
        "{:?}",
        responses.iter().map(|r| r.status).collect::<Vec<_>>()
    );
}

// spec: LNK-018
#[sqlx::test(migrations = "./migrations")]
async fn invalid_slug_is_a_field_error(pool: PgPool) {
    let app = cards_app(pool).await;
    let res = post_card(
        &app,
        "alice",
        json!({ "slug": "Al--ice", "first_name": "Alice" }),
    )
    .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(error_code(&res), "validation_failed");
    assert_eq!(
        res.json["error"]["fields"],
        json!([{ "field": "slug", "code": "invalid_slug" }])
    );
}

// spec: EDI-008, PUB-018, PUB-019, PUB-020, PUB-022, TPL-017
#[sqlx::test(migrations = "./migrations")]
async fn update_validates_and_normalizes(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card["id"].as_str().unwrap();

    let res = put_card(
        &app,
        "alice",
        id,
        json!({ "content": {
            "first_name": "  E\u{301}loïse ",
            "phone": "06 12 34 56 78",
            "description": "✨ Designer d'intérieur ✨",
        } }),
    )
    .await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    assert_eq!(res.json["content"]["first_name"], "Éloïse");
    assert_eq!(res.json["content"]["phone"], "+33612345678");
    assert_eq!(res.json["content"]["phone_display"], "+33 6 12 34 56 78");
    assert_eq!(
        res.json["content"]["description"],
        "✨ Designer d'intérieur ✨"
    );

    let res = put_card(
        &app,
        "alice",
        id,
        json!({
            "links": [{ "kind": "website", "url": "javascript:alert(1)", "label": null }],
            "theme": { "preset": "clair", "accent": "url(x)" },
        }),
    )
    .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(error_code(&res), "validation_failed");
    let fields = &res.json["error"]["fields"];
    assert!(
        fields
            .as_array()
            .unwrap()
            .contains(&json!({ "field": "links[0].url", "code": "invalid_url" }))
    );
    assert!(
        fields
            .as_array()
            .unwrap()
            .contains(&json!({ "field": "theme", "code": "invalid_theme" }))
    );
}

// spec: EDI-015
#[sqlx::test(migrations = "./migrations")]
async fn rejected_update_changes_nothing(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    create_card(&app, "bob", "bob-martin").await;
    let id = card["id"].as_str().unwrap();

    let res = put_card(
        &app,
        "alice",
        id,
        json!({ "slug": "bob-martin", "content": { "job_title": "Directrice" } }),
    )
    .await;
    assert_eq!(res.status, StatusCode::CONFLICT);
    assert_eq!(error_code(&res), "slug_taken");

    let after = get_card(&app, "alice", id).await;
    assert_eq!(after.json["slug"], "alice-durand");
    assert_eq!(after.json["content"]["job_title"], Value::Null);
}

// spec: LNK-003, LNK-025
#[sqlx::test(migrations = "./migrations")]
async fn slug_change_keeps_history_and_allows_reclaim(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice").await;
    let id = card["id"].as_str().unwrap();

    let res = put_card(&app, "alice", id, json!({ "slug": "alice-durand" })).await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    assert_eq!(res.json["slug"], "alice-durand");
    assert_eq!(
        res.json["public_url"],
        "http://localhost:3000/c/alice-durand"
    );

    // The old slug is kept for its owner: someone else cannot take it.
    let other = post_card(&app, "bob", json!({ "slug": "alice", "first_name": "Bob" })).await;
    assert_eq!(error_code(&other), "slug_taken");

    let back = put_card(&app, "alice", id, json!({ "slug": "alice" })).await;
    assert_eq!(back.status, StatusCode::OK, "{}", back.json);
    assert_eq!(back.json["slug"], "alice");
    assert_eq!(get_card(&app, "alice", id).await.json["slug"], "alice");
}

// spec: LNK-025
#[sqlx::test(migrations = "./migrations")]
async fn old_slug_of_a_live_card_is_reserved(pool: PgPool) {
    let app = cards_app(pool).await;
    let first = create_card(&app, "alice", "alice").await;
    let second = create_card(&app, "alice", "alice-pro").await;

    let moved = put_card(
        &app,
        "alice",
        first["id"].as_str().unwrap(),
        json!({ "slug": "alice-perso" }),
    )
    .await;
    assert_eq!(moved.status, StatusCode::OK);

    let res = put_card(
        &app,
        "alice",
        second["id"].as_str().unwrap(),
        json!({ "slug": "alice" }),
    )
    .await;
    assert_eq!(res.status, StatusCode::CONFLICT);
    assert_eq!(error_code(&res), "slug_reserved");
}

// spec: LNK-012, LNK-013, LNK-014
#[sqlx::test(migrations = "./migrations")]
async fn deleted_card_slug_stays_with_its_owner(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card["id"].as_str().unwrap();

    let res = app
        .request(
            "DELETE",
            &format!("/api/cards/{id}"),
            Some(&token("alice")),
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::NO_CONTENT);
    assert_eq!(
        get_card(&app, "alice", id).await.status,
        StatusCode::NOT_FOUND
    );

    let bob = post_card(
        &app,
        "bob",
        json!({ "slug": "alice-durand", "first_name": "Bob" }),
    )
    .await;
    assert_eq!(bob.status, StatusCode::CONFLICT);
    assert_eq!(error_code(&bob), "slug_taken");

    let again = post_card(
        &app,
        "alice",
        json!({ "slug": "alice-durand", "first_name": "Alice" }),
    )
    .await;
    assert_eq!(again.status, StatusCode::CREATED, "{}", again.json);
    assert_eq!(again.json["slug"], "alice-durand");
}

// spec: TPL-005, TPL-007, TPL-015
#[sqlx::test(migrations = "./migrations")]
async fn any_well_formed_template_is_stored(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card["id"].as_str().unwrap();

    let res = put_card(&app, "alice", id, json!({ "template": "futur-template" })).await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    assert_eq!(res.json["template"], "futur-template");
    assert_eq!(
        get_card(&app, "alice", id).await.json["template"],
        "futur-template"
    );

    let bad = put_card(&app, "alice", id, json!({ "template": "Bad Id" })).await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        bad.json["error"]["fields"],
        json!([{ "field": "template", "code": "invalid_template" }])
    );
}

// spec: ACC-017
#[sqlx::test(migrations = "./migrations")]
async fn other_users_cards_are_404(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card["id"].as_str().unwrap();
    // Make sure bob has an account.
    create_card(&app, "bob", "bob-martin").await;

    let get = get_card(&app, "bob", id).await;
    assert_eq!(
        (get.status, error_code(&get)),
        (StatusCode::NOT_FOUND, "not_found")
    );

    let put = app
        .request(
            "PUT",
            &format!("/api/cards/{id}"),
            Some(&token("bob")),
            Some(json!({
                "slug": "bob-hijack", "template": "classique", "settings": {},
                "theme": { "preset": "clair" },
                "content": { "first_name": "Bob" }, "links": [],
            })),
        )
        .await;
    assert_eq!(
        (put.status, error_code(&put)),
        (StatusCode::NOT_FOUND, "not_found")
    );

    let delete = app
        .request(
            "DELETE",
            &format!("/api/cards/{id}"),
            Some(&token("bob")),
            None,
        )
        .await;
    assert_eq!(
        (delete.status, error_code(&delete)),
        (StatusCode::NOT_FOUND, "not_found")
    );

    let list = app
        .request("GET", "/api/cards", Some(&token("bob")), None)
        .await;
    let ids: Vec<&Value> = list.json["cards"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| &c["id"])
        .collect();
    assert!(!ids.contains(&&card["id"]));

    // Alice's card is untouched, and bob's rejected PUT did not take its slug.
    assert_eq!(
        get_card(&app, "alice", id).await.json["slug"],
        "alice-durand"
    );
    let free = post_card(
        &app,
        "alice",
        json!({ "slug": "bob-hijack", "first_name": "A" }),
    )
    .await;
    assert_eq!(free.status, StatusCode::CREATED);
}

// spec: ACC-004, ACC-011
#[sqlx::test(migrations = "./migrations")]
async fn pending_user_cannot_create(pool: PgPool) {
    let app: TestApp = test_app_with(pool, &[("SIGNUP_MODE", "approval")]).await;
    // The first request creates the account, pending.
    let me = app
        .request("GET", "/api/me", Some(&token("alice")), None)
        .await;
    assert_eq!(me.json["status"], "pending");

    let res = post_card(
        &app,
        "alice",
        json!({ "slug": "alice-durand", "first_name": "Alice" }),
    )
    .await;
    assert_eq!(res.status, StatusCode::FORBIDDEN);
    assert_eq!(error_code(&res), "account_pending");

    let anonymous = app
        .request(
            "POST",
            "/api/cards",
            None,
            Some(json!({ "slug": "alice-durand", "first_name": "Alice" })),
        )
        .await;
    assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED);
}
