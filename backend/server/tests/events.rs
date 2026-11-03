mod common;

use axum::http::StatusCode;
use common::cards::{cards_app, create_card, put_card, token};
use common::events::{create_event, event_body, get_event, list_events, post_event, put_event};
use common::{TestApp, TestResponse, test_app_with};
use futures_util::future::join_all;
use serde_json::{Value, json};
use sqlx::PgPool;

fn error_code(res: &TestResponse) -> &str {
    res.json["error"]["code"].as_str().unwrap_or_default()
}

fn id_of(value: &Value) -> &str {
    value["id"].as_str().unwrap()
}

async fn count_events(pool: &PgPool) -> i64 {
    sqlx::query_scalar("select count(*) from events")
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn post_end(app: &TestApp, sub: &str, id: &str) -> TestResponse {
    app.request(
        "POST",
        &format!("/api/events/{id}/end"),
        Some(&token(sub)),
        None,
    )
    .await
}

// spec: EVT-001, EVT-009, EDI-009
#[sqlx::test(migrations = "./migrations")]
async fn owner_creates_reads_updates_and_deletes_an_event(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice").await;
    let card_id = id_of(&card);

    let created = create_event(
        &app,
        "alice",
        card_id,
        event_body("2027-03-01T08:00:00Z", Some("2027-03-01T18:00:00Z")),
    )
    .await;
    let id = id_of(&created);
    assert_eq!(created["card_id"], card_id);
    assert_eq!(created["title"], "Salon du Mariage Clermont 2027");
    assert_eq!(created["device_limit"], 1);
    assert_eq!(created["custom_fields"][0]["label"], "Formule");
    assert_eq!(created["lead_count"], 0);

    let list = list_events(&app, "alice", card_id).await;
    assert_eq!(list.status, StatusCode::OK);
    assert_eq!(list.json["events"].as_array().unwrap().len(), 1);
    assert_eq!(list.json["events"][0]["id"], id);

    let renamed = put_event(&app, "alice", id, json!({ "title": "Salon Été 2027" })).await;
    assert_eq!(renamed.status, StatusCode::OK, "{}", renamed.json);
    assert_eq!(renamed.json["title"], "Salon Été 2027");
    assert_eq!(
        get_event(&app, "alice", id).await.json["title"],
        "Salon Été 2027"
    );

    let deleted = app
        .request(
            "DELETE",
            &format!("/api/events/{id}"),
            Some(&token("alice")),
            None,
        )
        .await;
    assert_eq!(deleted.status, StatusCode::NO_CONTENT);
    let gone = get_event(&app, "alice", id).await;
    assert_eq!(gone.status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&gone), "not_found");
    assert_eq!(
        list_events(&app, "alice", card_id).await.json["events"],
        json!([])
    );
}

// spec: EVT-009
#[sqlx::test(migrations = "./migrations")]
async fn the_list_is_sorted_by_start(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice").await;
    let card_id = id_of(&card);
    for start in [
        "2027-05-01T08:00:00Z",
        "2027-03-01T08:00:00Z",
        "2027-04-01T08:00:00Z",
    ] {
        create_event(&app, "alice", card_id, event_body(start, None)).await;
    }
    let list = list_events(&app, "alice", card_id).await;
    let starts: Vec<&str> = list.json["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["starts_at"].as_str().unwrap())
        .collect();
    assert_eq!(
        starts,
        [
            "2027-03-01T08:00:00Z",
            "2027-04-01T08:00:00Z",
            "2027-05-01T08:00:00Z"
        ]
    );
}

// spec: EVT-007, EVT-022
#[sqlx::test(migrations = "./migrations")]
async fn dates_are_exchanged_in_utc(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice").await;
    let created = create_event(
        &app,
        "alice",
        id_of(&card),
        event_body(
            "2026-01-15T13:00:00+01:00",
            Some("2026-01-15T16:30:00+01:00"),
        ),
    )
    .await;
    let read = get_event(&app, "alice", id_of(&created)).await;
    assert_eq!(read.json["starts_at"], "2026-01-15T12:00:00Z");
    assert_eq!(read.json["ends_at"], "2026-01-15T15:30:00Z");
}

// spec: EVT-020, EDI-018
#[sqlx::test(migrations = "./migrations")]
async fn phase_follows_the_server_clock(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice").await;
    // The frozen clock reads 2026-01-15 12:00 UTC.
    let created = create_event(
        &app,
        "alice",
        id_of(&card),
        event_body("2026-01-15T12:30:00Z", Some("2026-01-15T12:45:00Z")),
    )
    .await;
    let id = id_of(&created);
    assert_eq!(created["phase"], "upcoming");
    assert_eq!(created["lead_count"], 0);

    app.clock.advance(chrono::TimeDelta::minutes(40));
    assert_eq!(get_event(&app, "alice", id).await.json["phase"], "running");
    let list = list_events(&app, "alice", id_of(&card)).await;
    assert_eq!(list.json["events"][0]["phase"], "running");

    app.clock.advance(chrono::TimeDelta::minutes(10));
    assert_eq!(get_event(&app, "alice", id).await.json["phase"], "past");
}

// spec: EVT-004, EVT-005, EVT-018
#[sqlx::test(migrations = "./migrations")]
async fn a_fourth_simultaneous_event_is_refused(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, "alice", "alice").await;
    let card_id = id_of(&card);
    for _ in 0..3 {
        create_event(
            &app,
            "alice",
            card_id,
            event_body("2027-03-01T08:00:00Z", Some("2027-03-01T18:00:00Z")),
        )
        .await;
    }

    let refused = post_event(
        &app,
        "alice",
        card_id,
        event_body("2027-03-01T10:00:00Z", None),
    )
    .await;
    assert_eq!(refused.status, StatusCode::CONFLICT);
    assert_eq!(error_code(&refused), "too_many_simultaneous_events");
    assert_eq!(count_events(&pool).await, 3);

    // Starting when the others end is not simultaneous.
    let touching = create_event(
        &app,
        "alice",
        card_id,
        event_body("2027-03-01T18:00:00Z", Some("2027-03-01T20:00:00Z")),
    )
    .await;
    assert_eq!(count_events(&pool).await, 4);

    // Moving it back into the overlap is refused and changes nothing.
    let id = id_of(&touching);
    let moved = put_event(
        &app,
        "alice",
        id,
        json!({ "starts_at": "2027-03-01T17:00:00Z" }),
    )
    .await;
    assert_eq!(moved.status, StatusCode::CONFLICT);
    assert_eq!(error_code(&moved), "too_many_simultaneous_events");
    assert_eq!(
        get_event(&app, "alice", id).await.json["starts_at"],
        "2027-03-01T18:00:00Z"
    );

    // The edited event does not count against itself.
    let renamed = put_event(&app, "alice", id, json!({ "title": "Après-midi" })).await;
    assert_eq!(renamed.status, StatusCode::OK, "{}", renamed.json);

    // Another card has its own limit.
    let other = create_card(&app, "alice", "alice-bis").await;
    create_event(
        &app,
        "alice",
        id_of(&other),
        event_body("2027-03-01T10:00:00Z", None),
    )
    .await;
}

// spec: EVT-018, Review Focus 1
#[sqlx::test(migrations = "./migrations")]
async fn concurrent_creations_cannot_exceed_the_limit(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, "alice", "alice").await;
    let card_id = id_of(&card);
    let responses = join_all((0..6).map(|_| {
        post_event(
            &app,
            "alice",
            card_id,
            event_body("2027-03-01T08:00:00Z", None),
        )
    }))
    .await;
    let created = responses
        .iter()
        .filter(|r| r.status == StatusCode::CREATED)
        .count();
    let refused = responses
        .iter()
        .filter(|r| {
            r.status == StatusCode::CONFLICT && error_code(r) == "too_many_simultaneous_events"
        })
        .count();
    assert_eq!(
        (created, refused),
        (3, 3),
        "{:?}",
        responses.iter().map(|r| r.status).collect::<Vec<_>>()
    );
    assert_eq!(count_events(&pool).await, 3);
}

// spec: EVT-018, Review Focus 1
#[sqlx::test(migrations = "./migrations")]
async fn concurrent_updates_cannot_exceed_the_limit(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, "alice", "alice").await;
    let card_id = id_of(&card);
    // Two events running together, and two later ones that each fit alone.
    for _ in 0..2 {
        create_event(
            &app,
            "alice",
            card_id,
            event_body("2027-03-01T08:00:00Z", Some("2027-03-01T18:00:00Z")),
        )
        .await;
    }
    let mut later = Vec::new();
    for _ in 0..2 {
        later.push(
            create_event(
                &app,
                "alice",
                card_id,
                event_body("2027-04-01T08:00:00Z", Some("2027-04-01T18:00:00Z")),
            )
            .await,
        );
    }
    // Moving both onto the first day would make four events run together.
    let responses = join_all(later.iter().map(|event| {
        put_event(
            &app,
            "alice",
            id_of(event),
            json!({ "starts_at": "2027-03-01T08:00:00Z", "ends_at": "2027-03-01T18:00:00Z" }),
        )
    }))
    .await;
    let ok = responses
        .iter()
        .filter(|r| r.status == StatusCode::OK)
        .count();
    let refused = responses
        .iter()
        .filter(|r| {
            r.status == StatusCode::CONFLICT && error_code(r) == "too_many_simultaneous_events"
        })
        .count();
    assert_eq!((ok, refused), (1, 1));
}

// spec: EVT-019
#[sqlx::test(migrations = "./migrations")]
async fn the_limit_comes_from_the_configuration(pool: PgPool) {
    let app = test_app_with(
        pool,
        &[("SIGNUP_MODE", "open"), ("MAX_SIMULTANEOUS_EVENTS", "1")],
    )
    .await;
    let card = create_card(&app, "alice", "alice").await;
    let card_id = id_of(&card);
    create_event(
        &app,
        "alice",
        card_id,
        event_body("2027-03-01T08:00:00Z", None),
    )
    .await;
    let second = post_event(
        &app,
        "alice",
        card_id,
        event_body("2027-03-02T08:00:00Z", None),
    )
    .await;
    assert_eq!(second.status, StatusCode::CONFLICT);
    assert_eq!(error_code(&second), "too_many_simultaneous_events");
}

// spec: EVT-006, EVT-021, EVT-008
#[sqlx::test(migrations = "./migrations")]
async fn end_now(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice").await;
    let card_id = id_of(&card);
    // The frozen clock reads 2026-01-15 12:00 UTC.
    let running = create_event(
        &app,
        "alice",
        card_id,
        event_body("2026-01-15T11:00:00Z", None),
    )
    .await;
    let ended = post_end(&app, "alice", id_of(&running)).await;
    assert_eq!(ended.status, StatusCode::OK, "{}", ended.json);
    assert_eq!(ended.json["ends_at"], "2026-01-15T12:00:00Z");
    assert_eq!(ended.json["phase"], "past");
    assert_eq!(
        get_event(&app, "alice", id_of(&running)).await.json["ends_at"],
        "2026-01-15T12:00:00Z"
    );

    // Already over now.
    let again = post_end(&app, "alice", id_of(&running)).await;
    assert_eq!(again.status, StatusCode::CONFLICT);
    assert_eq!(error_code(&again), "event_not_running");

    let upcoming = create_event(
        &app,
        "alice",
        card_id,
        event_body("2026-01-15T14:00:00Z", None),
    )
    .await;
    let refused = post_end(&app, "alice", id_of(&upcoming)).await;
    assert_eq!(refused.status, StatusCode::CONFLICT);
    assert_eq!(error_code(&refused), "event_not_running");

    let past = create_event(
        &app,
        "alice",
        card_id,
        event_body("2026-01-15T09:00:00Z", Some("2026-01-15T10:00:00Z")),
    )
    .await;
    let refused = post_end(&app, "alice", id_of(&past)).await;
    assert_eq!(refused.status, StatusCode::CONFLICT);
    assert_eq!(error_code(&refused), "event_not_running");
    assert_eq!(
        get_event(&app, "alice", id_of(&past)).await.json["ends_at"],
        "2026-01-15T10:00:00Z"
    );
}

// spec: EVT-010
#[sqlx::test(migrations = "./migrations")]
async fn the_owner_sees_the_access_code(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice").await;
    let mut body = event_body("2027-03-01T08:00:00Z", None);
    body["access_code"] = json!("Château");
    let created = create_event(&app, "alice", id_of(&card), body).await;
    assert_eq!(created["access_code"], "Château");
    assert_eq!(
        get_event(&app, "alice", id_of(&created)).await.json["access_code"],
        "Château"
    );
    let list = list_events(&app, "alice", id_of(&card)).await;
    assert_eq!(list.json["events"][0]["access_code"], "Château");
}

// spec: EVT-016, EVT-017, EVT-030, FRM-031, FRM-032
#[sqlx::test(migrations = "./migrations")]
async fn invalid_events_list_field_errors(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, "alice", "alice").await;
    let mut body = event_body("2027-03-01T08:00:00Z", Some("2027-03-01T07:00:00Z"));
    body["title"] = json!("   ");
    body["custom_fields"][0]["options"] = json!(["Oui", "Oui"]);
    let res = post_event(&app, "alice", id_of(&card), body).await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(error_code(&res), "validation_failed");
    let fields = res.json["error"]["fields"].as_array().unwrap();
    for (field, code) in [
        ("title", "required"),
        ("ends_at", "end_before_start"),
        ("custom_fields[0].options[1]", "duplicate_option"),
    ] {
        assert!(
            fields
                .iter()
                .any(|f| f["field"] == field && f["code"] == code),
            "{field} {code} in {fields:?}"
        );
    }
    assert_eq!(count_events(&pool).await, 0);
}

// spec: EVT-030
#[sqlx::test(migrations = "./migrations")]
async fn device_limit_outside_1_to_100_is_refused(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice").await;
    for limit in [json!(0), json!(101), json!(-1), json!(5_000_000_000i64)] {
        let mut body = event_body("2027-03-01T08:00:00Z", None);
        body["device_limit"] = limit.clone();
        let res = post_event(&app, "alice", id_of(&card), body).await;
        assert_eq!(res.status, StatusCode::BAD_REQUEST, "{limit}");
        assert_eq!(error_code(&res), "validation_failed", "{limit}");
        assert_eq!(
            res.json["error"]["fields"],
            json!([{ "field": "device_limit", "code": "out_of_range" }]),
            "{limit}"
        );
    }
    let mut body = event_body("2027-03-01T08:00:00Z", None);
    body["device_limit"] = json!(100);
    assert_eq!(
        create_event(&app, "alice", id_of(&card), body).await["device_limit"],
        100
    );
}

// spec: FRM-021
#[sqlx::test(migrations = "./migrations")]
async fn a_field_that_is_not_a_choice_needs_no_options(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice").await;
    let mut body = event_body("2027-03-01T08:00:00Z", None);
    body["custom_fields"] = json!([{
        "id": "0190c9a0-0000-7000-8000-00000000f002",
        "label": "Société",
        "kind": "text",
        "required": false,
        "help": null,
    }]);
    let created = create_event(&app, "alice", id_of(&card), body).await;
    assert_eq!(created["custom_fields"][0]["options"], json!([]));
}

// spec: FRM-029, FRM-026
#[sqlx::test(migrations = "./migrations")]
async fn the_view_carries_the_default_consent_text(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice").await;
    let card_id = id_of(&card);
    let saved = put_card(
        &app,
        "alice",
        card_id,
        json!({ "content": { "email": "alice@example.com" } }),
    )
    .await;
    assert_eq!(saved.status, StatusCode::OK, "{}", saved.json);
    let created = create_event(
        &app,
        "alice",
        card_id,
        event_body("2027-03-01T08:00:00Z", None),
    )
    .await;
    let text = created["default_consent_text"].as_str().unwrap();
    assert!(text.contains("Alice Durand"), "{text}");
    assert!(text.contains("alice@example.com"), "{text}");
    assert!(text.contains("Salon du Mariage Clermont 2027"), "{text}");
    assert!(created["consent_text"].is_null());
}

// spec: FRM-029, FRM-026
#[sqlx::test(migrations = "./migrations")]
async fn consent_preview_gives_the_default_text_for_a_title(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice").await;
    let path = format!("/api/cards/{}/consent-preview", id_of(&card));
    let res = app
        .request(
            "POST",
            &path,
            Some(&token("alice")),
            Some(json!({ "title": "  Salon d’Été ✨ " })),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    let text = res.json["text"].as_str().unwrap();
    assert!(text.contains("Alice Durand"), "{text}");
    assert!(text.contains("« Salon d’Été ✨ »"), "{text}");

    // The same text as the one carried by an event with that title.
    let mut body = event_body("2027-03-01T08:00:00Z", None);
    body["title"] = json!("Salon d’Été ✨");
    let created = create_event(&app, "alice", id_of(&card), body).await;
    assert_eq!(created["default_consent_text"], text);

    // ACC-017: another user's card is not found.
    let other = app
        .request(
            "POST",
            &path,
            Some(&token("bob")),
            Some(json!({ "title": "x" })),
        )
        .await;
    assert_eq!(other.status, StatusCode::NOT_FOUND);
}

// spec: EVT-025, LNK-008
#[sqlx::test(migrations = "./migrations")]
async fn events_of_a_disabled_card_stay_editable(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, "alice", "alice").await;
    let card_id = id_of(&card);
    let event = create_event(
        &app,
        "alice",
        card_id,
        event_body("2027-03-01T08:00:00Z", None),
    )
    .await;

    let disabled = app
        .request(
            "POST",
            &format!("/api/cards/{card_id}/disable"),
            Some(&token("alice")),
            None,
        )
        .await;
    assert_eq!(disabled.status, StatusCode::OK);
    sqlx::query("update cards set support_disabled_at = now() where id = $1::uuid")
        .bind(card_id)
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(
        list_events(&app, "alice", card_id).await.status,
        StatusCode::OK
    );
    assert_eq!(
        get_event(&app, "alice", id_of(&event)).await.status,
        StatusCode::OK
    );
    let renamed = put_event(&app, "alice", id_of(&event), json!({ "title": "Renommé" })).await;
    assert_eq!(renamed.status, StatusCode::OK, "{}", renamed.json);
    let created = post_event(
        &app,
        "alice",
        card_id,
        event_body("2027-04-01T08:00:00Z", None),
    )
    .await;
    assert_eq!(created.status, StatusCode::CREATED, "{}", created.json);
}

// spec: ACC-017
#[sqlx::test(migrations = "./migrations")]
async fn other_users_events_are_404(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, "alice", "alice").await;
    let card_id = id_of(&card);
    let event = create_event(
        &app,
        "alice",
        card_id,
        event_body("2026-01-15T11:00:00Z", None),
    )
    .await;
    let id = id_of(&event);
    let bob_card = create_card(&app, "bob", "bob").await;

    let list = list_events(&app, "bob", card_id).await;
    assert_eq!(list.status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&list), "not_found");
    let created = post_event(
        &app,
        "bob",
        card_id,
        event_body("2027-03-01T08:00:00Z", None),
    )
    .await;
    assert_eq!(created.status, StatusCode::NOT_FOUND);
    assert_eq!(
        get_event(&app, "bob", id).await.status,
        StatusCode::NOT_FOUND
    );
    let put = put_event_raw(&app, "bob", id, event_body("2027-03-01T08:00:00Z", None)).await;
    assert_eq!(put.status, StatusCode::NOT_FOUND);
    assert_eq!(
        post_end(&app, "bob", id).await.status,
        StatusCode::NOT_FOUND
    );
    let delete = app
        .request(
            "DELETE",
            &format!("/api/events/{id}"),
            Some(&token("bob")),
            None,
        )
        .await;
    assert_eq!(delete.status, StatusCode::NOT_FOUND);

    // Bob's own list does not show it, and Alice's event is untouched.
    assert_eq!(
        list_events(&app, "bob", id_of(&bob_card)).await.json["events"],
        json!([])
    );
    let intact = get_event(&app, "alice", id).await;
    assert_eq!(intact.json["title"], "Salon du Mariage Clermont 2027");
    assert!(intact.json["ends_at"].is_null());
    assert_eq!(count_events(&pool).await, 1);
}

async fn put_event_raw(app: &TestApp, sub: &str, id: &str, body: Value) -> TestResponse {
    app.request(
        "PUT",
        &format!("/api/events/{id}"),
        Some(&token(sub)),
        Some(body),
    )
    .await
}

// spec: EDI-014
#[sqlx::test(migrations = "./migrations")]
async fn duplicating_a_card_copies_no_event(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice").await;
    let card_id = id_of(&card);
    for start in ["2027-03-01T08:00:00Z", "2027-04-01T08:00:00Z"] {
        create_event(&app, "alice", card_id, event_body(start, None)).await;
    }
    let copy = app
        .request(
            "POST",
            &format!("/api/cards/{card_id}/duplicate"),
            Some(&token("alice")),
            Some(json!({ "slug": "alice-copie" })),
        )
        .await;
    assert_eq!(copy.status, StatusCode::CREATED, "{}", copy.json);
    let list = list_events(&app, "alice", id_of(&copy.json)).await;
    assert_eq!(list.status, StatusCode::OK);
    assert_eq!(list.json["events"], json!([]));
    assert_eq!(
        list_events(&app, "alice", card_id).await.json["events"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}
