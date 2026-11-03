mod common;

use axum::http::StatusCode;
use common::cards::{cards_app, create_card, put_card, token};
use common::events::{create_event, event_body};
use common::{TestApp, TestResponse, capture_logs};
use serde_json::{Value, json};
use sqlx::PgPool;

/// The access code of the coded events; the tests run on a clock frozen at 2026-01-15 12:00 UTC.
const CODE: &str = "Château";

fn error_code(res: &TestResponse) -> &str {
    res.json["error"]["code"].as_str().unwrap_or_default()
}

fn id_of(value: &Value) -> &str {
    value["id"].as_str().expect("an id")
}

async fn public(app: &TestApp, path: &str) -> TestResponse {
    app.request("GET", path, None, None).await
}

async fn get_form(app: &TestApp, slug: &str, event_id: &str) -> TestResponse {
    public(app, &format!("/api/public/cards/{slug}/events/{event_id}")).await
}

async fn unlock_from(
    app: &TestApp,
    ip: &str,
    slug: &str,
    event_id: &str,
    code: &str,
) -> TestResponse {
    app.request_from(
        ip,
        "POST",
        &format!("/api/public/cards/{slug}/events/{event_id}/unlock"),
        None,
        Some(json!({ "access_code": code })),
    )
    .await
}

async fn unlock(app: &TestApp, slug: &str, event_id: &str, code: &str) -> TestResponse {
    unlock_from(app, "203.0.113.50", slug, event_id, code).await
}

/// An event on `card` that runs from `starts_at` to `ends_at`, titled `title`.
async fn event_on(
    app: &TestApp,
    sub: &str,
    card: &Value,
    title: &str,
    starts_at: &str,
    ends_at: Option<&str>,
) -> Value {
    let mut body = event_body(starts_at, ends_at);
    body["title"] = json!(title);
    create_event(app, sub, id_of(card), body).await
}

/// A running event with a secret code, a description and an optional phone.
async fn coded_event(app: &TestApp, sub: &str, card: &Value) -> Value {
    let mut body = event_body("2026-01-15T10:00:00Z", Some("2026-01-15T18:00:00Z"));
    body["title"] = json!("Soirée VIP");
    body["description"] = json!("Programme confidentiel de la soirée");
    body["access_code"] = json!(CODE);
    create_event(app, sub, id_of(card), body).await
}

async fn set_owner_status(pool: &PgPool, sub: &str, status: &str) {
    sqlx::query("update users set status = $1 where subject = $2")
        .bind(status)
        .bind(sub)
        .execute(pool)
        .await
        .unwrap();
}

async fn support_disable(pool: &PgPool, id: &str) {
    sqlx::query("update cards set support_disabled_at = now() where id = $1::uuid")
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
}

// spec: PUB-008, PUB-009, PUB-010, PUB-029, EVT-002
#[sqlx::test(migrations = "./migrations")]
async fn public_card_lists_running_events_in_order(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let empty = public(&app, "/api/public/cards/alice-durand").await;
    assert_eq!(empty.json["card"]["events"], json!([]));

    // Created out of order: two start together ("Brocante" is created first).
    let brocante = event_on(
        &app,
        "alice",
        &card,
        "Brocante",
        "2026-01-15T10:00:00Z",
        Some("2026-01-15T18:00:00Z"),
    )
    .await;
    let aube = event_on(&app, "alice", &card, "Aube", "2026-01-15T08:00:00Z", None).await;
    let atelier = event_on(
        &app,
        "alice",
        &card,
        "Atelier",
        "2026-01-15T10:00:00Z",
        Some("2026-01-15T17:00:00Z"),
    )
    .await;
    event_on(
        &app,
        "alice",
        &card,
        "À venir",
        "2026-01-16T10:00:00Z",
        None,
    )
    .await;
    event_on(
        &app,
        "alice",
        &card,
        "Terminé",
        "2026-01-14T10:00:00Z",
        Some("2026-01-14T12:00:00Z"),
    )
    .await;

    let res = public(&app, "/api/public/cards/alice-durand").await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    let expected: Vec<Value> = [(&aube, "Aube"), (&atelier, "Atelier"), (&brocante, "Brocante")]
        .iter()
        .map(|(event, title)| {
            json!({ "id": event["id"], "title": title, "starts_at": event["starts_at"] })
        })
        .collect();
    assert_eq!(res.json["card"]["events"], json!(expected));

    // After every end, only the event without an end is left; a minute after the first end,
    // the one that ended is gone.
    app.clock.set(
        "2026-01-15T17:30:00Z"
            .parse::<chrono::DateTime<chrono::Utc>>()
            .unwrap(),
    );
    let later = public(&app, "/api/public/cards/alice-durand").await;
    let titles: Vec<&str> = later.json["card"]["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["title"].as_str().unwrap())
        .collect();
    assert_eq!(titles, ["Aube", "Brocante"]);
}

// spec: PUB-010, EVT-002
#[sqlx::test(migrations = "./migrations")]
async fn no_event_ends_the_list_when_all_have_ended(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    event_on(
        &app,
        "alice",
        &card,
        "Brocante",
        "2026-01-15T10:00:00Z",
        Some("2026-01-15T18:00:00Z"),
    )
    .await;
    app.clock.set(
        "2026-01-15T18:00:00Z"
            .parse::<chrono::DateTime<chrono::Utc>>()
            .unwrap(),
    );
    let res = public(&app, "/api/public/cards/alice-durand").await;
    assert_eq!(res.json["card"]["events"], json!([]));
}

// spec: FRM-003, FRM-017, FRM-024, FRM-026
#[sqlx::test(migrations = "./migrations")]
async fn an_open_event_returns_its_form(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let mut body = event_body("2026-01-15T10:00:00Z", None);
    body["description"] = json!("Le grand salon d’Éloïse ✨");
    body["standard_fields"]["birth_date"] = json!("optional");
    body["standard_fields"]["phone"] = json!("off");
    let event_id = id_of(&create_event(&app, "alice", id_of(&card), body).await).to_string();

    let res = get_form(&app, "alice-durand", &event_id).await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    assert_eq!(res.json["state"], "open");
    let event = &res.json["event"];
    assert_eq!(event["id"], event_id);
    assert_eq!(event["title"], "Salon du Mariage Clermont 2027");
    assert_eq!(event["description"], "Le grand salon d’Éloïse ✨");
    assert_eq!(
        event["standard_fields"],
        json!([
            { "field": "first_name", "required": true },
            { "field": "last_name", "required": true },
            { "field": "birth_date", "required": false },
            { "field": "email", "required": true },
        ])
    );
    assert_eq!(event["custom_fields"][0]["label"], "Formule");
    assert_eq!(event["custom_fields"][0]["options"][1], "Premium");
    let consent = event["consent_text"].as_str().unwrap();
    assert!(
        consent.contains("j'accepte que Alice Durand conserve")
            && consent.contains("l'événement « Salon du Mariage Clermont 2027 »"),
        "{consent}"
    );
    let version = event["form_version"].as_str().unwrap();
    assert_eq!(version.len(), 16);
    assert!(version.chars().all(|c| c.is_ascii_hexdigit()));
    // Nothing internal.
    for key in [
        "access_code",
        "device_limit",
        "card_id",
        "starts_at",
        "ends_at",
    ] {
        assert!(event.get(key).is_none(), "{key} leaked: {event}");
    }
}

/// The only event of the owner's only card.
async fn app_event(app: &TestApp, sub: &str, card: &Value) -> Value {
    let res = common::events::list_events(app, sub, id_of(card)).await;
    res.json["events"][0].clone()
}

// spec: FRM-017, FRM-030
#[sqlx::test(migrations = "./migrations")]
async fn the_form_version_follows_what_the_prospect_sees(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    event_on(&app, "alice", &card, "Salon", "2026-01-15T10:00:00Z", None).await;
    let event = app_event(&app, "alice", &card).await;
    let id = id_of(&event);
    let first = get_form(&app, "alice-durand", id).await.json["event"].clone();
    let again = get_form(&app, "alice-durand", id).await.json["event"].clone();
    assert_eq!(first["form_version"], again["form_version"]);

    let saved =
        common::events::put_event(&app, "alice", id, json!({ "description": "Nouveau" })).await;
    assert_eq!(saved.status, StatusCode::OK, "{}", saved.json);
    let changed = get_form(&app, "alice-durand", id).await.json["event"].clone();
    assert_ne!(first["form_version"], changed["form_version"]);
}

// spec: EVT-012, EVT-027, FRM-002, EVT-011
#[sqlx::test(migrations = "./migrations")]
async fn a_coded_event_hides_its_form_until_unlocked(pool: PgPool) {
    let (logs, _guard) = capture_logs();
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let event = coded_event(&app, "alice", &card).await;
    let id = id_of(&event);

    let mut seen = Vec::new();
    seen.push(public(&app, "/api/public/cards/alice-durand").await);
    let locked = get_form(&app, "alice-durand", id).await;
    assert_eq!(locked.status, StatusCode::OK, "{}", locked.json);
    assert_eq!(
        locked.json,
        json!({ "state": "code_required", "event": { "id": id, "title": "Soirée VIP" } })
    );
    let text = String::from_utf8(locked.body.to_vec()).unwrap();
    for secret in ["confidentiel", "Formule", "consent", "form_version"] {
        assert!(!text.contains(secret), "{secret} leaked: {text}");
    }
    seen.push(locked);

    let wrong = unlock(&app, "alice-durand", id, "moulin").await;
    assert_eq!(wrong.status, StatusCode::FORBIDDEN, "{}", wrong.json);
    assert_eq!(error_code(&wrong), "invalid_access_code");
    seen.push(wrong);

    let ok = unlock(&app, "alice-durand", id, "  chateau ").await;
    assert_eq!(ok.status, StatusCode::OK, "{}", ok.json);
    assert_eq!(ok.json["id"], id);
    assert_eq!(ok.json["title"], "Soirée VIP");
    assert_eq!(
        ok.json["description"],
        "Programme confidentiel de la soirée"
    );
    assert_eq!(ok.json["custom_fields"][0]["label"], "Formule");
    assert!(
        ok.json["consent_text"]
            .as_str()
            .unwrap()
            .contains("Soirée VIP")
    );
    assert_eq!(ok.json["form_version"].as_str().unwrap().len(), 16);
    // The form handed out by the unlock is the one the open state would hand out.
    seen.push(ok);

    // The code appears in no public response and in no log.
    for res in &seen {
        let text = String::from_utf8_lossy(&res.body).to_lowercase();
        assert!(
            !text.contains("château")
                && !text.contains("chateau")
                && !text.contains("\"access_code\""),
            "the code leaked: {text}"
        );
    }
    let logged = logs.contents().to_lowercase();
    assert!(
        !logged.contains("château") && !logged.contains("chateau"),
        "the code was logged"
    );
}

// spec: EVT-027, EVT-008
#[sqlx::test(migrations = "./migrations")]
async fn an_event_without_code_unlocks_with_any_code(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let event = event_on(&app, "alice", &card, "Salon", "2026-01-15T10:00:00Z", None).await;
    let res = unlock(&app, "alice-durand", id_of(&event), "n'importe quoi").await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    assert_eq!(res.json["title"], "Salon");
}

// spec: EVT-008, EVT-026, FRM-024
#[sqlx::test(migrations = "./migrations")]
async fn closed_and_upcoming_events(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let upcoming = event_on(
        &app,
        "alice",
        &card,
        "À venir",
        "2026-01-15T13:00:00Z",
        Some("2026-01-15T14:00:00Z"),
    )
    .await;
    let just_ended = event_on(
        &app,
        "alice",
        &card,
        "Terminé il y a 10 min",
        "2026-01-15T09:00:00Z",
        Some("2026-01-15T11:50:00Z"),
    )
    .await;
    let long_ended = event_on(
        &app,
        "alice",
        &card,
        "Terminé il y a 16 min",
        "2026-01-15T09:00:00Z",
        Some("2026-01-15T11:44:00Z"),
    )
    .await;

    let res = get_form(&app, "alice-durand", id_of(&upcoming)).await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    assert_eq!(
        res.json,
        json!({ "state": "closed", "event": { "id": upcoming["id"], "title": "À venir" } })
    );
    assert_eq!(
        get_form(&app, "alice-durand", id_of(&just_ended))
            .await
            .json["state"],
        "open"
    );
    let closed = get_form(&app, "alice-durand", id_of(&long_ended)).await;
    assert_eq!(closed.json["state"], "closed");
    assert!(closed.json["event"].get("consent_text").is_none());

    for event in [&upcoming, &long_ended] {
        let res = unlock(&app, "alice-durand", id_of(event), CODE).await;
        assert_eq!(res.status, StatusCode::CONFLICT, "{}", res.json);
        assert_eq!(error_code(&res), "event_closed");
    }
}

// spec: EVT-008, EVT-026, EVT-012
#[sqlx::test(migrations = "./migrations")]
async fn a_closed_coded_event_says_closed_before_asking_for_the_code(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let event = coded_event(&app, "alice", &card).await;
    app.clock.set(
        "2026-01-15T19:00:00Z"
            .parse::<chrono::DateTime<chrono::Utc>>()
            .unwrap(),
    );
    let res = get_form(&app, "alice-durand", id_of(&event)).await;
    assert_eq!(res.json["state"], "closed");
    let wrong = unlock(&app, "alice-durand", id_of(&event), "moulin").await;
    assert_eq!(wrong.status, StatusCode::CONFLICT);
    assert_eq!(error_code(&wrong), "event_closed");
}

// spec: FRM-024, ACC-017
#[sqlx::test(migrations = "./migrations")]
async fn unknown_or_foreign_events_are_404(pool: PgPool) {
    let app = cards_app(pool).await;
    let alice = create_card(&app, "alice", "alice-durand").await;
    let bob = create_card(&app, "bob", "bob-martin").await;
    let foreign = event_on(&app, "bob", &bob, "Salon", "2026-01-15T10:00:00Z", None).await;
    let deleted = event_on(&app, "alice", &alice, "Vendu", "2026-01-15T10:00:00Z", None).await;
    let removal = app
        .request(
            "DELETE",
            &format!("/api/events/{}", id_of(&deleted)),
            Some(&token("alice")),
            None,
        )
        .await;
    assert_eq!(removal.status, StatusCode::NO_CONTENT);

    let unknown = "0190c9a0-0000-7000-8000-0000000000aa";
    for (slug, id) in [
        ("alice-durand", id_of(&foreign)),
        ("alice-durand", unknown),
        ("alice-durand", id_of(&deleted)),
        ("inconnu", id_of(&foreign)),
    ] {
        let read = get_form(&app, slug, id).await;
        assert_eq!(read.status, StatusCode::NOT_FOUND, "{slug} {id}");
        assert_eq!(error_code(&read), "not_found");
        let tried = unlock(&app, slug, id, CODE).await;
        assert_eq!(tried.status, StatusCode::NOT_FOUND, "{slug} {id}");
        assert_eq!(error_code(&tried), "not_found");
    }
    // Not an identifier: a malformed request, not a lookup.
    let malformed = get_form(&app, "alice-durand", "pas-un-uuid").await;
    assert_eq!(malformed.status, StatusCode::BAD_REQUEST);
    // The foreign event is fine through its own card.
    assert_eq!(
        get_form(&app, "bob-martin", id_of(&foreign)).await.status,
        StatusCode::OK
    );
}

// spec: LNK-007, LNK-026
#[sqlx::test(migrations = "./migrations")]
async fn an_unserved_card_refuses_its_forms(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    for sub in ["owner-off", "support-off", "suspended"] {
        let card = create_card(&app, sub, sub).await;
        let event = event_on(&app, sub, &card, "Salon", "2026-01-15T10:00:00Z", None).await;
        match sub {
            "owner-off" => {
                let res = app
                    .request(
                        "POST",
                        &format!("/api/cards/{}/disable", id_of(&card)),
                        Some(&token(sub)),
                        None,
                    )
                    .await;
                assert_eq!(res.status, StatusCode::OK);
            }
            "support-off" => support_disable(&pool, id_of(&card)).await,
            _ => set_owner_status(&pool, sub, "suspended").await,
        }
        let read = get_form(&app, sub, id_of(&event)).await;
        assert_eq!(read.status, StatusCode::GONE, "{sub}");
        assert_eq!(error_code(&read), "card_inactive");
        let tried = unlock(&app, sub, id_of(&event), CODE).await;
        assert_eq!(tried.status, StatusCode::GONE, "{sub}");
        assert_eq!(error_code(&tried), "card_inactive");
    }
}

// spec: LNK-003, FRM-024
#[sqlx::test(migrations = "./migrations")]
async fn an_old_slug_still_reaches_the_event(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let event = coded_event(&app, "alice", &card).await;
    let saved = put_card(
        &app,
        "alice",
        id_of(&card),
        json!({ "slug": "alice-martin" }),
    )
    .await;
    assert_eq!(saved.status, StatusCode::OK, "{}", saved.json);

    for slug in [
        "alice-durand",
        "Alice-Durand",
        "alice-martin",
        "ALICE-MARTIN",
    ] {
        let read = get_form(&app, slug, id_of(&event)).await;
        assert_eq!(read.status, StatusCode::OK, "{slug}: {}", read.json);
        assert_eq!(read.json["state"], "code_required", "{slug}");
        assert!(read.headers.get("location").is_none(), "{slug}");
        let ok = unlock(&app, slug, id_of(&event), CODE).await;
        assert_eq!(ok.status, StatusCode::OK, "{slug}: {}", ok.json);
        assert!(ok.headers.get("location").is_none(), "{slug}");
    }
}

// spec: ABU-007
#[sqlx::test(migrations = "./migrations")]
async fn failed_codes_are_limited_per_ip(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let event = coded_event(&app, "alice", &card).await;
    let id = id_of(&event);

    for attempt in 0..30 {
        let res = unlock_from(&app, "203.0.113.7", "alice-durand", id, "moulin").await;
        assert_eq!(res.status, StatusCode::FORBIDDEN, "attempt {attempt}");
    }
    // The 31st is refused whatever the code, with the delay to wait.
    let limited = unlock_from(&app, "203.0.113.7", "alice-durand", id, CODE).await;
    assert_eq!(
        limited.status,
        StatusCode::TOO_MANY_REQUESTS,
        "{}",
        limited.json
    );
    assert_eq!(error_code(&limited), "rate_limited");
    assert!(limited.headers.get("retry-after").is_some());
    // Another address is not affected.
    let other = unlock_from(&app, "198.51.100.2", "alice-durand", id, CODE).await;
    assert_eq!(other.status, StatusCode::OK, "{}", other.json);

    // A correct code never counts.
    for attempt in 0..100 {
        let res = unlock_from(&app, "192.0.2.9", "alice-durand", id, CODE).await;
        assert_eq!(res.status, StatusCode::OK, "attempt {attempt}");
    }
}

// spec: ABU-007
#[sqlx::test(migrations = "./migrations")]
async fn failed_codes_age_out_of_the_window(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let event = coded_event(&app, "alice", &card).await;
    let id = id_of(&event);
    for _ in 0..30 {
        unlock_from(&app, "203.0.113.7", "alice-durand", id, "moulin").await;
    }
    app.clock.set(
        "2026-01-15T12:10:01Z"
            .parse::<chrono::DateTime<chrono::Utc>>()
            .unwrap(),
    );
    let res = unlock_from(&app, "203.0.113.7", "alice-durand", id, CODE).await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
}
