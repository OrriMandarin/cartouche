mod common;

use axum::http::StatusCode;
use chrono::TimeZone;
use common::cards::{cards_app, create_card, put_card, save_body, token};
use common::events::{create_event, event_body, get_leads, put_spam, send_lead};
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
    assert_eq!(card["theme"]["preset"], "craie");
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

// spec: LNK-003, LNK-013
#[sqlx::test(migrations = "./migrations")]
async fn delete_racing_a_slug_change_never_fails_with_a_server_error(pool: PgPool) {
    let app = cards_app(pool).await;
    for i in 0..30 {
        let card = create_card(&app, "alice", &format!("race-{i}")).await;
        let id = card["id"].as_str().unwrap().to_string();
        let body = save_body(&card, json!({ "slug": format!("renamed-{i}") }));
        let path = format!("/api/cards/{id}");
        let token = token("alice");
        let (saved, deleted) = futures_util::future::join(
            app.request("PUT", &path, Some(&token), Some(body)),
            app.request("DELETE", &path, Some(&token), None),
        )
        .await;
        assert!(
            [StatusCode::OK, StatusCode::NOT_FOUND].contains(&saved.status),
            "round {i}: save {} {}",
            saved.status,
            saved.json
        );
        assert!(
            [StatusCode::NO_CONTENT, StatusCode::NOT_FOUND].contains(&deleted.status),
            "round {i}: delete {} {}",
            deleted.status,
            deleted.json
        );
    }
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
            "theme": { "preset": "craie", "accent": "url(x)" },
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

// spec: EDI-013
#[sqlx::test(migrations = "./migrations")]
async fn a_new_card_takes_craie(pool: PgPool) {
    let app = cards_app(pool).await;
    let res = post_card(
        &app,
        "alice",
        json!({ "slug": "alice-durand", "first_name": "Alice" }),
    )
    .await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);
    assert_eq!(res.json["theme"], json!({ "preset": "craie" }));
}

// spec: TPL-023, EDI-015
#[sqlx::test(migrations = "./migrations")]
async fn an_unreadable_theme_is_refused_and_nothing_changes(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card["id"].as_str().unwrap();

    let res = put_card(
        &app,
        "alice",
        id,
        json!({
            "content": { "first_name": "Zoé" },
            "theme": { "preset": "terracotta", "text": "#b89580" },
        }),
    )
    .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(error_code(&res), "validation_failed");
    assert_eq!(
        res.json["error"]["fields"],
        json!([{ "field": "theme", "code": "low_contrast" }])
    );

    let after = get_card(&app, "alice", id).await;
    assert_eq!(after.json["content"]["first_name"], "Alice");
    assert_eq!(after.json["theme"], json!({ "preset": "craie" }));
}

// spec: TPL-023
#[sqlx::test(migrations = "./migrations")]
async fn a_stored_unreadable_card_is_still_served_and_duplicated(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card["id"].as_str().unwrap();
    sqlx::query("update cards set theme = '{\"preset\":\"craie\",\"text\":\"#f7f6f2\"}'::jsonb")
        .execute(&pool)
        .await
        .unwrap();

    let public = app
        .request("GET", "/api/public/cards/alice-durand", None, None)
        .await;
    assert_eq!(public.status, StatusCode::OK);
    assert_ne!(public.body.as_ref(), br#"{"state":"inactive"}"#);

    let copy = app
        .request(
            "POST",
            &format!("/api/cards/{id}/duplicate"),
            Some(&token("alice")),
            Some(json!({ "slug": "alice-copie" })),
        )
        .await;
    assert_eq!(copy.status, StatusCode::CREATED, "{}", copy.json);

    // Saving without fixing the colours is refused.
    let res = put_card(&app, "alice", id, json!({})).await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST, "{}", res.json);
    assert_eq!(
        res.json["error"]["fields"],
        json!([{ "field": "theme", "code": "low_contrast" }])
    );
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
                "theme": { "preset": "craie" },
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

/// Creates an event of the default form on the card, from `starts_at` to `ends_at`.
async fn add_event(
    app: &TestApp,
    sub: &str,
    card_id: &str,
    starts_at: &str,
    ends_at: Option<&str>,
) -> String {
    let event = create_event(app, sub, card_id, event_body(starts_at, ends_at)).await;
    event["id"].as_str().unwrap().to_string()
}

// spec: EDI-023, EVT-020
#[sqlx::test(migrations = "./migrations")]
async fn cards_count_their_events_by_phase_at_the_server_clock(pool: PgPool) {
    // The frozen clock reads 2026-01-15 12:00 UTC.
    let app = cards_app(pool).await;
    let busy = create_card(&app, "alice", "alice-busy").await;
    let busy_id = busy["id"].as_str().unwrap();
    let empty = create_card(&app, "alice", "alice-empty").await;
    add_event(&app, "alice", busy_id, "2026-01-10T08:00:00Z", None).await;
    add_event(
        &app,
        "alice",
        busy_id,
        "2026-01-15T08:00:00Z",
        Some("2026-01-15T12:30:00Z"),
    )
    .await;
    add_event(&app, "alice", busy_id, "2026-02-01T08:00:00Z", None).await;
    add_event(
        &app,
        "alice",
        busy_id,
        "2026-01-01T08:00:00Z",
        Some("2026-01-02T08:00:00Z"),
    )
    .await;

    let expected = json!({ "running": 2, "upcoming": 1, "past": 1 });
    let list = app
        .request("GET", "/api/cards", Some(&token("alice")), None)
        .await;
    assert_eq!(list.json["cards"][0]["event_counts"], expected);
    assert_eq!(
        list.json["cards"][1]["event_counts"],
        json!({ "running": 0, "upcoming": 0, "past": 0 })
    );
    assert_eq!(
        get_card(&app, "alice", busy_id).await.json["event_counts"],
        expected
    );
    assert_eq!(
        get_card(&app, "alice", empty["id"].as_str().unwrap())
            .await
            .json["event_counts"],
        json!({ "running": 0, "upcoming": 0, "past": 0 })
    );

    // The phase follows the clock.
    app.clock.set(
        chrono::Utc
            .with_ymd_and_hms(2026, 1, 15, 12, 45, 0)
            .unwrap(),
    );
    let later = get_card(&app, "alice", busy_id).await;
    assert_eq!(
        later.json["event_counts"],
        json!({ "running": 1, "upcoming": 1, "past": 2 })
    );
}

// spec: EDI-024
#[sqlx::test(migrations = "./migrations")]
async fn cards_count_their_leads_spam_included(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-leads").await;
    let other = create_card(&app, "alice", "alice-none").await;
    let card_id = card["id"].as_str().unwrap();
    let first = add_event(&app, "alice", card_id, "2026-01-10T08:00:00Z", None).await;
    let second = add_event(&app, "alice", card_id, "2026-01-11T08:00:00Z", None).await;
    send_lead(&app, "alice-leads", &first, json!({})).await;
    send_lead(
        &app,
        "alice-leads",
        &first,
        json!({ "device_id": uuid::Uuid::now_v7() }),
    )
    .await;
    send_lead(
        &app,
        "alice-leads",
        &second,
        json!({ "device_id": uuid::Uuid::now_v7() }),
    )
    .await;
    let leads = get_leads(&app, "alice", &first).await;
    let lead_id = leads.json["leads"][0]["id"].as_str().unwrap();
    assert_eq!(
        put_spam(&app, "alice", lead_id, true).await.status,
        StatusCode::OK
    );

    assert_eq!(get_card(&app, "alice", card_id).await.json["lead_count"], 3);
    let list = app
        .request("GET", "/api/cards", Some(&token("alice")), None)
        .await;
    assert_eq!(list.json["cards"][0]["lead_count"], 3);
    assert_eq!(list.json["cards"][1]["lead_count"], 0);
    assert_eq!(
        get_card(&app, "alice", other["id"].as_str().unwrap())
            .await
            .json["lead_count"],
        0
    );
}
