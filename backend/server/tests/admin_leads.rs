mod common;

use axum::http::StatusCode;
use common::cards::{cards_app, create_card, merge, token};
use common::events::{
    create_event, delete_lead, event_body, get_leads, list_events, put_spam, send_lead,
};
use common::{TestApp, TestResponse};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

const ADMIN: &str = "boss";
const SLUG: &str = "alice-durand";

fn id_of(value: &Value) -> &str {
    value["id"].as_str().expect("an id")
}

fn error_code(res: &TestResponse) -> &str {
    res.json["error"]["code"].as_str().unwrap_or_default()
}

async fn admin_get(app: &TestApp, sub: &str, path: &str) -> TestResponse {
    app.request("GET", path, Some(&token(sub)), None).await
}

fn events_path(card: &Value) -> String {
    format!("/api/admin/cards/{}/events", id_of(card))
}

fn event_leads_path(event: &Value) -> String {
    format!("/api/admin/events/{}/leads", id_of(event))
}

fn card_leads_path(card: &Value) -> String {
    format!("/api/admin/cards/{}/leads", id_of(card))
}

/// An event of the card running since 10:00 without end (the clock is at 12:00) with the title.
async fn running_event(app: &TestApp, sub: &str, card: &Value, title: &str) -> Value {
    let mut body = event_body("2026-01-15T10:00:00Z", None);
    merge(&mut body, json!({ "title": title }));
    create_event(app, sub, id_of(card), body).await
}

/// Sends a lead with a distinct e-mail address, one second after the previous one.
async fn send_to(app: &TestApp, slug: &str, event: &Value, email: &str) {
    send_lead(
        app,
        slug,
        id_of(event),
        json!({ "answers": { "email": email } }),
    )
    .await;
    app.clock.advance(chrono::Duration::seconds(1));
}

/// Alice's card with an event of three leads, the last one marked as spam.
async fn alice_with_three_leads(app: &TestApp) -> (Value, Value) {
    let card = create_card(app, "alice", SLUG).await;
    let event = running_event(app, "alice", &card, "Salon du Mariage Clermont 2027").await;
    for email in ["eloise@example.com", "zoe@example.com", "pub@example.com"] {
        send_to(app, SLUG, &event, email).await;
    }
    let listed = get_leads(app, "alice", id_of(&event)).await;
    let newest = listed.json["leads"][0]["id"].as_str().unwrap().to_string();
    let marked = put_spam(app, "alice", &newest, true).await;
    assert_eq!(marked.status, StatusCode::OK, "{}", marked.json);
    (card, event)
}

async fn user_id(pool: &PgPool, sub: &str) -> Uuid {
    sqlx::query_scalar("select id from users where subject = $1")
        .bind(sub)
        .fetch_one(pool)
        .await
        .unwrap()
}

type AuditRow = (Uuid, String, String, Uuid, Value);

async fn audit_rows(pool: &PgPool) -> Vec<AuditRow> {
    sqlx::query_as(
        "select actor_user_id, action, target_type, target_id, metadata from audit_log \
         order by created_at, id",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

fn ids(leads: &Value) -> Vec<(String, bool)> {
    leads
        .as_array()
        .expect("leads")
        .iter()
        .map(|lead| (id_of(lead).to_string(), lead["spam"].as_bool().unwrap()))
        .collect()
}

// spec: ADM-007, ADM-016
#[sqlx::test(migrations = "./migrations")]
async fn support_lists_a_cards_events(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let (card, event) = alice_with_three_leads(&app).await;
    let later = running_event(&app, "alice", &card, "Salon du Mariage Lyon 2027").await;

    let res = admin_get(&app, ADMIN, &events_path(&card)).await;

    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    let owner = list_events(&app, "alice", id_of(&card)).await;
    assert_eq!(res.json, owner.json);
    let events = res.json["events"].as_array().unwrap();
    assert_eq!(events.len(), 2);
    assert_eq!(events[0]["id"], event["id"]);
    assert_eq!(events[0]["lead_count"], 3);
    assert_eq!(events[1]["id"], later["id"]);
    assert_eq!(events[1]["lead_count"], 0);
    // Viewing events is not audited.
    assert!(audit_rows(&pool).await.is_empty());

    let unknown = admin_get(
        &app,
        ADMIN,
        &format!("/api/admin/cards/{}/events", Uuid::now_v7()),
    )
    .await;
    assert_eq!(unknown.status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&unknown), "not_found");
}

// spec: ADM-007, ADM-008, ADM-019
#[sqlx::test(migrations = "./migrations")]
async fn viewing_an_events_leads_is_audited(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let (card, event) = alice_with_three_leads(&app).await;

    let res = admin_get(&app, ADMIN, &event_leads_path(&event)).await;

    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    let owner = get_leads(&app, "alice", id_of(&event)).await;
    assert_eq!(ids(&res.json["leads"]), ids(&owner.json["leads"]));
    assert_eq!(res.json, owner.json);
    assert!(ids(&res.json["leads"])[0].1, "the newest lead is spam");
    let rows = audit_rows(&pool).await;
    let admin = user_id(&pool, ADMIN).await;
    let alice = user_id(&pool, "alice").await;
    assert_eq!(rows.len(), 1);
    let (actor, action, target_type, target_id, metadata) = &rows[0];
    assert_eq!(*actor, admin);
    assert_eq!(action, "leads.viewed");
    assert_eq!(target_type, "event");
    assert_eq!(target_id.to_string(), id_of(&event));
    assert_eq!(
        *metadata,
        json!({ "owner_id": alice, "card_id": id_of(&card), "lead_count": 3 })
    );

    let again = admin_get(&app, ADMIN, &event_leads_path(&event)).await;
    assert_eq!(again.status, StatusCode::OK);
    assert_eq!(audit_rows(&pool).await.len(), 2);

    let unknown = admin_get(
        &app,
        ADMIN,
        &format!("/api/admin/events/{}/leads", Uuid::now_v7()),
    )
    .await;
    assert_eq!(unknown.status, StatusCode::NOT_FOUND);
    assert_eq!(audit_rows(&pool).await.len(), 2);
}

// spec: ADM-019
#[sqlx::test(migrations = "./migrations")]
async fn viewing_a_whole_card_is_audited_on_the_card(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let (card, _) = alice_with_three_leads(&app).await;
    let second = running_event(&app, "alice", &card, "Salon du Mariage Lyon 2027").await;
    send_to(&app, SLUG, &second, "noel@example.com").await;

    let res = admin_get(&app, ADMIN, &card_leads_path(&card)).await;

    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    let owner = app
        .request(
            "GET",
            &format!("/api/cards/{}/leads", id_of(&card)),
            Some(&token("alice")),
            None,
        )
        .await;
    assert_eq!(res.json, owner.json);
    assert_eq!(res.json["leads"].as_array().unwrap().len(), 4);
    let rows = audit_rows(&pool).await;
    assert_eq!(rows.len(), 1);
    let (actor, action, target_type, target_id, metadata) = &rows[0];
    assert_eq!(*actor, user_id(&pool, ADMIN).await);
    assert_eq!(action, "leads.viewed");
    assert_eq!(target_type, "card");
    assert_eq!(target_id.to_string(), id_of(&card));
    assert_eq!(
        *metadata,
        json!({
            "owner_id": user_id(&pool, "alice").await,
            "card_id": id_of(&card),
            "lead_count": 4,
        })
    );

    let unknown = admin_get(
        &app,
        ADMIN,
        &format!("/api/admin/cards/{}/leads", Uuid::now_v7()),
    )
    .await;
    assert_eq!(unknown.status, StatusCode::NOT_FOUND);
    assert_eq!(audit_rows(&pool).await.len(), 1);
}

// spec: ADM-019
#[sqlx::test(migrations = "./migrations")]
async fn own_leads_are_audited_too(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, ADMIN, "boss-durand").await;
    let event = running_event(&app, ADMIN, &card, "Salon interne").await;
    send_to(&app, "boss-durand", &event, "eloise@example.com").await;

    let res = admin_get(&app, ADMIN, &event_leads_path(&event)).await;

    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    assert_eq!(res.json["leads"].as_array().unwrap().len(), 1);
    let rows = audit_rows(&pool).await;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].1, "leads.viewed");
    assert_eq!(rows[0].4["owner_id"], rows[0].0.to_string());
}

// spec: ADM-019
#[sqlx::test(migrations = "./migrations")]
async fn no_leads_without_an_audit_entry(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let (card, event) = alice_with_three_leads(&app).await;
    sqlx::query(
        "alter table audit_log add constraint audit_blocked check (action <> 'leads.viewed')",
    )
    .execute(&pool)
    .await
    .unwrap();

    for path in [event_leads_path(&event), card_leads_path(&card)] {
        let res = admin_get(&app, ADMIN, &path).await;

        assert_eq!(res.status, StatusCode::INTERNAL_SERVER_ERROR, "{path}");
        assert_eq!(error_code(&res), "internal_error", "{path}");
        assert!(res.json.get("leads").is_none(), "{path}");
        let text = String::from_utf8_lossy(&res.body);
        assert!(!text.contains("example.com"), "{path}: {text}");
    }
    assert!(audit_rows(&pool).await.is_empty());
}

// spec: ADM-020
#[sqlx::test(migrations = "./migrations")]
async fn audit_metadata_holds_no_prospect_data(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let (card, event) = alice_with_three_leads(&app).await;
    admin_get(&app, ADMIN, &event_leads_path(&event)).await;
    admin_get(&app, ADMIN, &card_leads_path(&card)).await;

    let rows = audit_rows(&pool).await;

    assert_eq!(rows.len(), 2);
    for (.., metadata) in &rows {
        let mut keys: Vec<&str> = metadata
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(keys, ["card_id", "lead_count", "owner_id"]);
        let text = metadata.to_string();
        for personal in ["example.com", "Éloïse", "Aubigné", "12 rue"] {
            assert!(!text.contains(personal), "{text}");
        }
    }
}

// spec: ADM-001
#[sqlx::test(migrations = "./migrations")]
async fn non_admins_are_refused(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let (card, event) = alice_with_three_leads(&app).await;

    for path in [
        events_path(&card),
        event_leads_path(&event),
        card_leads_path(&card),
    ] {
        let res = admin_get(&app, "alice", &path).await;
        assert_eq!(res.status, StatusCode::FORBIDDEN, "{path}");
        assert_eq!(error_code(&res), "forbidden", "{path}");
        assert!(res.json.get("leads").is_none(), "{path}");
        let anonymous = app.request("GET", &path, None, None).await;
        assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED, "{path}");
    }
    assert!(audit_rows(&pool).await.is_empty());
}

// spec: ADM-012, ADM-018, ACC-017
#[sqlx::test(migrations = "./migrations")]
async fn support_cannot_change_or_export_leads(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let (card, event) = alice_with_three_leads(&app).await;
    let listed = get_leads(&app, "alice", id_of(&event)).await;
    let lead = listed.json["leads"][1].clone();
    let before = serde_json::to_value(&listed.json).unwrap();

    let admin = token(ADMIN);
    let lead_id = id_of(&lead);
    for (method, path) in [
        ("PUT", format!("/api/admin/leads/{lead_id}/spam")),
        ("DELETE", format!("/api/admin/leads/{lead_id}")),
        (
            "GET",
            format!("/api/admin/events/{}/leads/export", id_of(&event)),
        ),
        (
            "GET",
            format!("/api/admin/cards/{}/leads/export", id_of(&card)),
        ),
    ] {
        let body = (method == "PUT").then(|| json!({ "spam": true }));
        let res = app.request(method, &path, Some(&admin), body).await;
        assert_eq!(res.status, StatusCode::NOT_FOUND, "{method} {path}");
        assert_eq!(error_code(&res), "not_found", "{method} {path}");
    }
    // The owner routes are filtered by owner: the administrator is not Alice.
    let marked = put_spam(&app, ADMIN, lead_id, true).await;
    assert_eq!(marked.status, StatusCode::NOT_FOUND);
    let deleted = delete_lead(&app, ADMIN, lead_id).await;
    assert_eq!(deleted.status, StatusCode::NOT_FOUND);

    let after = get_leads(&app, "alice", id_of(&event)).await;
    assert_eq!(after.json, before);
    assert!(audit_rows(&pool).await.is_empty());
}

// spec: LNK-008
#[sqlx::test(migrations = "./migrations")]
async fn support_disabled_card_leads_are_visible_to_support(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let (card, event) = alice_with_three_leads(&app).await;
    let blocked = app
        .request(
            "POST",
            &format!("/api/admin/cards/{}/support-disable", id_of(&card)),
            Some(&token(ADMIN)),
            None,
        )
        .await;
    assert_eq!(blocked.status, StatusCode::OK, "{}", blocked.json);

    let events = admin_get(&app, ADMIN, &events_path(&card)).await;
    let by_event = admin_get(&app, ADMIN, &event_leads_path(&event)).await;
    let by_card = admin_get(&app, ADMIN, &card_leads_path(&card)).await;

    assert_eq!(events.status, StatusCode::OK, "{}", events.json);
    assert_eq!(by_event.status, StatusCode::OK, "{}", by_event.json);
    assert_eq!(by_card.status, StatusCode::OK, "{}", by_card.json);
    assert_eq!(by_card.json["leads"].as_array().unwrap().len(), 3);
}
