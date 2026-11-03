mod common;

use std::time::Duration;

use axum::http::{HeaderMap, StatusCode};
use cartouche_domain::Clock;
use chrono::{DateTime, Utc};
use common::cards::{cards_app, create_card, merge, put_card, token};
use common::events::{create_event, event_body, get_event, put_event, submission};
use common::{TestApp, TestResponse, capture_logs};
use futures_util::future::join_all;
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// The access code of the coded events; the tests run on a clock frozen at 2026-01-15 12:00 UTC.
const CODE: &str = "Château";
const SLUG: &str = "alice-durand";
/// Where the submissions come from unless a test says otherwise.
const IP: &str = "203.0.113.50";

fn error_code(res: &TestResponse) -> &str {
    res.json["error"]["code"].as_str().unwrap_or_default()
}

fn id_of(value: &Value) -> &str {
    value["id"].as_str().expect("an id")
}

fn at(instant: &str) -> DateTime<Utc> {
    instant.parse().expect("an RFC 3339 instant")
}

/// An event of `card` running since 10:00 without end, `patch` merged into `event_body`.
async fn running_event(app: &TestApp, card: &Value, patch: Value) -> Value {
    let mut body = event_body("2026-01-15T10:00:00Z", None);
    merge(&mut body, patch);
    create_event(app, "alice", id_of(card), body).await
}

/// The form of an event without code, as the prospect gets it.
async fn form_of(app: &TestApp, event: &Value) -> Value {
    let res = app
        .request(
            "GET",
            &format!("/api/public/cards/{SLUG}/events/{}", id_of(event)),
            None,
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    assert_eq!(res.json["state"], "open", "{}", res.json);
    res.json["event"].clone()
}

/// The form of a coded event, unlocked with `code`.
async fn unlocked_form(app: &TestApp, event: &Value, code: &str) -> Value {
    let res = app
        .request(
            "POST",
            &format!("/api/public/cards/{SLUG}/events/{}/unlock", id_of(event)),
            None,
            Some(json!({ "access_code": code })),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    res.json
}

fn leads_path(event: &Value) -> String {
    format!("/api/public/cards/{SLUG}/events/{}/leads", id_of(event))
}

async fn submit_from(app: &TestApp, ip: &str, event: &Value, body: &Value) -> TestResponse {
    app.request_from(ip, "POST", &leads_path(event), None, Some(body.clone()))
        .await
}

async fn submit(app: &TestApp, event: &Value, body: &Value) -> TestResponse {
    submit_from(app, IP, event, body).await
}

fn assert_accepted(res: &TestResponse) {
    assert_eq!(res.status, StatusCode::NO_CONTENT, "{}", res.json);
}

fn assert_refused(res: &TestResponse, status: StatusCode, code: &str) {
    assert_eq!(res.status, status, "{}", res.json);
    assert_eq!(error_code(res), code, "{}", res.json);
}

async fn lead_count(pool: &PgPool) -> i64 {
    sqlx::query_scalar("select count(*) from leads")
        .fetch_one(pool)
        .await
        .unwrap()
}

/// The device of a submission body.
fn device_of(body: &Value) -> &str {
    body["device_id"].as_str().expect("a device id")
}

// spec: FRM-004, FRM-008, FRM-038, FRM-013, FRM-016
#[sqlx::test(migrations = "./migrations")]
async fn a_valid_submission_is_stored_with_its_consent(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", SLUG).await;
    let mut body = event_body("2026-01-15T10:00:00Z", None);
    body["custom_fields"].as_array_mut().unwrap().push(json!({
        "id": "0190c9a0-0000-7000-8000-00000000f002",
        "label": "Commentaire",
        "kind": "text",
        "required": false,
        "help": null,
    }));
    let event = create_event(&app, "alice", id_of(&card), body).await;
    let form = form_of(&app, &event).await;
    // A decomposed "Éloïse" (E + U+0301, i + U+0308) and a French phone.
    let sent = submission(
        &form,
        json!({ "answers": {
            "first_name": "  E\u{301}loi\u{308}se ",
            "phone": "06 12 34 56 78",
            "custom": { "0190c9a0-0000-7000-8000-00000000f002": null },
        } }),
    );

    let res = submit(&app, &event, &sent).await;
    assert_accepted(&res);
    assert!(res.body.is_empty(), "a 204 has no body");

    let row = sqlx::query(
        "select event_id, device_id, submitted_at, consent_at, consent_text, first_name, \
                last_name, email, phone, custom_answers from leads",
    )
    .fetch_one(&app.pool)
    .await
    .unwrap();
    let now = app.clock.now();
    assert_eq!(row.get::<Uuid, _>("event_id").to_string(), id_of(&event));
    assert_eq!(
        row.get::<Uuid, _>("device_id").to_string(),
        device_of(&sent)
    );
    assert_eq!(row.get::<DateTime<Utc>, _>("submitted_at"), now);
    assert_eq!(row.get::<DateTime<Utc>, _>("consent_at"), now);
    assert_eq!(
        row.get::<String, _>("consent_text"),
        form["consent_text"].as_str().unwrap()
    );
    assert_eq!(row.get::<String, _>("first_name"), "\u{c9}lo\u{ef}se");
    assert_eq!(row.get::<String, _>("last_name"), "D’Aubigné-Müller");
    assert_eq!(row.get::<String, _>("email"), "eloise@example.com");
    assert_eq!(row.get::<String, _>("phone"), "+33612345678");
    assert_eq!(
        row.get::<Value, _>("custom_answers"),
        json!([
            {
                "field_id": "0190c9a0-0000-7000-8000-00000000f001",
                "label": "Formule",
                "kind": "single_choice",
                "value": "Essentielle",
            },
            {
                "field_id": "0190c9a0-0000-7000-8000-00000000f002",
                "label": "Commentaire",
                "kind": "text",
                "value": null,
            },
        ])
    );

    // FRM-038: the address of the prospect is not stored.
    let columns: Vec<(String, String)> = sqlx::query_as(
        "select column_name::text, data_type::text from information_schema.columns \
         where table_name = 'leads'",
    )
    .fetch_all(&app.pool)
    .await
    .unwrap();
    assert!(!columns.is_empty());
    for (name, data_type) in &columns {
        assert!(
            !name.contains("ip") && !["inet", "cidr"].contains(&data_type.as_str()),
            "leads.{name} ({data_type}) looks like an IP address"
        );
    }
}

// spec: FRM-006, FRM-012, FRM-015, FRM-037
#[sqlx::test(migrations = "./migrations")]
async fn an_invalid_submission_reports_every_field(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", SLUG).await;
    let event = running_event(
        &app,
        &card,
        json!({ "custom_fields": [{
            "id": "0190c9a0-0000-7000-8000-00000000f001",
            "label": "Formule",
            "kind": "single_choice",
            "required": true,
            "help": null,
            "options": ["Essentielle", "Premium"],
        }] }),
    )
    .await;
    let form = form_of(&app, &event).await;
    let sent = submission(
        &form,
        json!({
            "consent": false,
            "answers": {
                "email": "eloise@",
                "custom": { "0190c9a0-0000-7000-8000-00000000f001": "" },
            },
        }),
    );

    let res = submit(&app, &event, &sent).await;
    assert_refused(&res, StatusCode::BAD_REQUEST, "validation_failed");
    let mut fields: Vec<(String, String)> = res.json["error"]["fields"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| {
            (
                f["field"].as_str().unwrap().to_string(),
                f["code"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    fields.sort();
    assert_eq!(
        fields,
        [
            (
                "answers.custom.0190c9a0-0000-7000-8000-00000000f001",
                "required"
            ),
            ("answers.email", "invalid_email"),
            ("consent", "required"),
        ]
        .map(|(field, code)| (field.to_string(), code.to_string()))
    );
    assert_eq!(lead_count(&app.pool).await, 0);
}

// spec: FRM-035
#[sqlx::test(migrations = "./migrations")]
async fn the_birth_date_is_bounded_by_the_clock_date(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", SLUG).await;
    let event = running_event(
        &app,
        &card,
        json!({ "standard_fields": { "birth_date": "required" } }),
    )
    .await;
    let form = form_of(&app, &event).await;
    // The clock says 2026-01-15: the day after is in the future, whatever the real date.
    let tomorrow = submission(&form, json!({ "answers": { "birth_date": "2026-01-16" } }));
    let res = submit(&app, &event, &tomorrow).await;
    assert_refused(&res, StatusCode::BAD_REQUEST, "validation_failed");
    assert_eq!(
        res.json["error"]["fields"],
        json!([{ "field": "answers.birth_date", "code": "invalid_date" }])
    );
    let today = submission(&form, json!({ "answers": { "birth_date": "2026-01-15" } }));
    assert_accepted(&submit(&app, &event, &today).await);
}

// spec: EVT-008, EVT-026, Review Focus 8
#[sqlx::test(migrations = "./migrations")]
async fn grace_window_boundary(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", SLUG).await;
    let mut body = event_body("2026-01-15T09:00:00Z", Some("2026-01-15T11:45:00Z"));
    body["title"] = json!("Terminé à 11 h 45");
    let ended = create_event(&app, "alice", id_of(&card), body).await;
    let mut body = event_body("2026-01-15T13:00:00Z", None);
    body["title"] = json!("À venir");
    let upcoming = create_event(&app, "alice", id_of(&card), body).await;
    let form = form_of(&app, &ended).await;

    // 12:00 is the end + 15 minutes: still accepted.
    assert_accepted(&submit(&app, &ended, &submission(&form, json!({}))).await);

    app.clock.set(at("2026-01-15T12:00:01Z"));
    let late = submit(&app, &ended, &submission(&form, json!({}))).await;
    assert_refused(&late, StatusCode::CONFLICT, "event_closed");
    let early = submit(&app, &upcoming, &submission(&form, json!({}))).await;
    assert_refused(&early, StatusCode::CONFLICT, "event_closed");
    assert_eq!(lead_count(&app.pool).await, 1);
}

/// A running event with the access code `CODE`.
async fn coded_event(app: &TestApp, card: &Value) -> Value {
    running_event(app, card, json!({ "access_code": CODE })).await
}

// spec: EVT-013, FRM-041
#[sqlx::test(migrations = "./migrations")]
async fn a_changed_code_is_checked_again(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", SLUG).await;
    let event = coded_event(&app, &card).await;
    let form = unlocked_form(&app, &event, CODE).await;
    let with_code = |code: Value| submission(&form, json!({ "access_code": code }));

    // The owner changes the code while the prospect fills the form in.
    let saved = put_event(
        &app,
        "alice",
        id_of(&event),
        json!({ "access_code": "Moulin" }),
    )
    .await;
    assert_eq!(saved.status, StatusCode::OK, "{}", saved.json);

    let old = submit(&app, &event, &with_code(json!(CODE))).await;
    assert_refused(&old, StatusCode::FORBIDDEN, "invalid_access_code");
    let missing = submit(&app, &event, &with_code(Value::Null)).await;
    assert_refused(&missing, StatusCode::FORBIDDEN, "invalid_access_code");
    assert_eq!(lead_count(&app.pool).await, 0);
    assert_accepted(&submit(&app, &event, &with_code(json!(" moulin"))).await);
    assert_eq!(lead_count(&app.pool).await, 1);
}

// spec: ABU-007, EVT-013
#[sqlx::test(migrations = "./migrations")]
async fn wrong_codes_at_submission_count_against_the_code_limit(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", SLUG).await;
    let event = coded_event(&app, &card).await;
    let form = unlocked_form(&app, &event, CODE).await;
    let with_code = |code: &str| submission(&form, json!({ "access_code": code }));

    for _ in 0..30 {
        let res = submit_from(&app, "203.0.113.7", &event, &with_code("moulin")).await;
        assert_refused(&res, StatusCode::FORBIDDEN, "invalid_access_code");
    }
    // The 31st is refused whatever the code.
    let limited = submit_from(&app, "203.0.113.7", &event, &with_code(CODE)).await;
    assert_refused(&limited, StatusCode::TOO_MANY_REQUESTS, "rate_limited");
    assert!(limited.headers.get("retry-after").is_some());
    // A correct code from another address does not count.
    for _ in 0..31 {
        let res = submit_from(&app, "198.51.100.2", &event, &with_code(CODE)).await;
        assert_accepted(&res);
    }
}

async fn set_spam(pool: &PgPool, device: &str) {
    sqlx::query("update leads set spam_at = now() where device_id = $1::uuid")
        .bind(device)
        .execute(pool)
        .await
        .unwrap();
}

async fn delete_leads_of(pool: &PgPool, device: &str) {
    sqlx::query("delete from leads where device_id = $1::uuid")
        .bind(device)
        .execute(pool)
        .await
        .unwrap();
}

// spec: EVT-014, EVT-029
#[sqlx::test(migrations = "./migrations")]
async fn the_device_limit_is_enforced(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", SLUG).await;
    let event = running_event(&app, &card, json!({})).await;
    let form = form_of(&app, &event).await;
    let first = submission(&form, json!({}));

    assert_accepted(&submit(&app, &event, &first).await);
    let again = submit(&app, &event, &first).await;
    assert_refused(&again, StatusCode::CONFLICT, "device_limit_reached");
    assert_accepted(&submit(&app, &event, &submission(&form, json!({}))).await);

    // A lead marked as spam still counts; a deleted one frees its place.
    set_spam(&app.pool, device_of(&first)).await;
    let spam = submit(&app, &event, &first).await;
    assert_refused(&spam, StatusCode::CONFLICT, "device_limit_reached");
    delete_leads_of(&app.pool, device_of(&first)).await;
    assert_accepted(&submit(&app, &event, &first).await);

    // Limit 2: the third send of a device is refused.
    let saved = put_event(&app, "alice", id_of(&event), json!({ "device_limit": 2 })).await;
    assert_eq!(saved.status, StatusCode::OK, "{}", saved.json);
    let form = form_of(&app, &event).await;
    let other = submission(&form, json!({}));
    assert_accepted(&submit(&app, &event, &other).await);
    assert_accepted(&submit(&app, &event, &other).await);
    let third = submit(&app, &event, &other).await;
    assert_refused(&third, StatusCode::CONFLICT, "device_limit_reached");
    assert_eq!(lead_count(&app.pool).await, 4);
}

// spec: EVT-029, Review Focus 2
#[sqlx::test(migrations = "./migrations")]
async fn simultaneous_submissions_from_one_device(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", SLUG).await;
    let event = running_event(&app, &card, json!({})).await;
    let form = form_of(&app, &event).await;
    let sent = submission(&form, json!({}));

    let responses = join_all((0..5).map(|_| submit(&app, &event, &sent))).await;
    let accepted = responses
        .iter()
        .filter(|r| r.status == StatusCode::NO_CONTENT)
        .count();
    let refused = responses
        .iter()
        .filter(|r| r.status == StatusCode::CONFLICT && error_code(r) == "device_limit_reached")
        .count();
    assert_eq!((accepted, refused), (1, 4));
    assert_eq!(lead_count(&app.pool).await, 1);
}

/// The headers of a response but its request id, which differs on every response.
fn headers_but_request_id(headers: &HeaderMap) -> Vec<(String, Vec<u8>)> {
    let mut list: Vec<(String, Vec<u8>)> = headers
        .iter()
        .filter(|(name, _)| name.as_str() != "x-request-id")
        .map(|(name, value)| (name.to_string(), value.as_bytes().to_vec()))
        .collect();
    list.sort();
    list
}

// spec: ABU-002, ABU-005, Review Focus 4
#[sqlx::test(migrations = "./migrations")]
async fn a_filled_honeypot_is_ignored_silently(pool: PgPool) {
    let (logs, _guard) = capture_logs();
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", SLUG).await;
    let event = running_event(&app, &card, json!({})).await;
    let form = form_of(&app, &event).await;

    let robot_body = submission(&form, json!({ "fax": "  http://spam " }));
    let robot = submit(&app, &event, &robot_body).await;
    assert_eq!(
        lead_count(&app.pool).await,
        0,
        "the robot's send is not stored"
    );

    // A trap field made of spaces only is not filled in.
    let human = submit(&app, &event, &submission(&form, json!({ "fax": "   " }))).await;
    assert_accepted(&human);
    assert_eq!(lead_count(&app.pool).await, 1);
    assert_eq!(robot.status, human.status);
    assert_eq!(robot.body, human.body);
    assert_eq!(
        headers_but_request_id(&robot.headers),
        headers_but_request_id(&human.headers)
    );

    // The robot's device did not use its only place.
    let mut later = robot_body.clone();
    later["fax"] = Value::Null;
    assert_accepted(&submit(&app, &event, &later).await);
    assert_eq!(lead_count(&app.pool).await, 2);

    let logged = logs.contents();
    assert!(logged.contains("honeypot"), "the trap is logged: {logged}");
    assert!(
        !logged.contains("http://spam") && !logged.contains("eloise@example.com"),
        "the robot's answers were logged: {logged}"
    );
}

// spec: FRM-030, Review Focus 9
#[sqlx::test(migrations = "./migrations")]
async fn a_changed_form_is_refused(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", SLUG).await;
    let event = running_event(&app, &card, json!({})).await;
    let id = id_of(&event);

    // The owner renames a field while the prospect fills the form in.
    let form = form_of(&app, &event).await;
    let mut fields = get_event(&app, "alice", id).await.json["custom_fields"].clone();
    fields[0]["label"] = json!("Formule choisie");
    let saved = put_event(&app, "alice", id, json!({ "custom_fields": fields })).await;
    assert_eq!(saved.status, StatusCode::OK, "{}", saved.json);
    let res = submit(&app, &event, &submission(&form, json!({}))).await;
    assert_refused(&res, StatusCode::CONFLICT, "form_changed");

    // The card's email is in the default consent text: changing it changes the form.
    let form = form_of(&app, &event).await;
    let saved = put_card(
        &app,
        "alice",
        id_of(&card),
        json!({ "content": { "email": "alice@exemple.fr" } }),
    )
    .await;
    assert_eq!(saved.status, StatusCode::OK, "{}", saved.json);
    let res = submit(&app, &event, &submission(&form, json!({}))).await;
    assert_refused(&res, StatusCode::CONFLICT, "form_changed");
    assert_eq!(lead_count(&app.pool).await, 0);

    let form = form_of(&app, &event).await;
    assert!(
        form["consent_text"]
            .as_str()
            .unwrap()
            .contains("alice@exemple.fr")
    );
    assert_accepted(&submit(&app, &event, &submission(&form, json!({}))).await);
}

// spec: ABU-001, ABU-006, ABU-008, Review Focus 5
#[sqlx::test(migrations = "./migrations")]
async fn submissions_are_limited_per_ip(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", SLUG).await;
    let event = running_event(&app, &card, json!({})).await;
    let form = form_of(&app, &event).await;
    let fair = "203.0.113.7";

    // A trade show of 80 prospects behind one Wi-Fi address.
    for prospect in 0..80 {
        let res = submit_from(&app, fair, &event, &submission(&form, json!({}))).await;
        assert_eq!(res.status, StatusCode::NO_CONTENT, "prospect {prospect}");
    }
    // Refused sends count too: invalid answers, then malformed bodies.
    for _ in 0..20 {
        let res = submit_from(
            &app,
            fair,
            &event,
            &submission(&form, json!({ "consent": false })),
        )
        .await;
        assert_refused(&res, StatusCode::BAD_REQUEST, "validation_failed");
    }
    for _ in 0..20 {
        let res = submit_from(&app, fair, &event, &json!({ "device_id": "pas-un-id" })).await;
        assert_refused(&res, StatusCode::BAD_REQUEST, "invalid_request");
    }

    // The 121st within 10 minutes is refused, valid or not.
    let limited = submit_from(&app, fair, &event, &submission(&form, json!({}))).await;
    assert_refused(&limited, StatusCode::TOO_MANY_REQUESTS, "rate_limited");
    assert_eq!(limited.headers["retry-after"], "600");
    assert_eq!(lead_count(&app.pool).await, 80);

    // Another address is not affected.
    let elsewhere = submit_from(&app, "198.51.100.2", &event, &submission(&form, json!({}))).await;
    assert_accepted(&elsewhere);
    // An address the client adds to the left of the header does not change the one counted.
    let spoofed = app
        .request_with_headers(
            "POST",
            &leads_path(&event),
            None,
            Some(submission(&form, json!({}))),
            &[("x-forwarded-for", "192.0.2.1, 203.0.113.7")],
        )
        .await;
    assert_refused(&spoofed, StatusCode::TOO_MANY_REQUESTS, "rate_limited");
}

// spec: LNK-007
#[sqlx::test(migrations = "./migrations")]
async fn submitting_to_an_unserved_card_is_410(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", SLUG).await;
    let event = running_event(&app, &card, json!({})).await;
    let form = form_of(&app, &event).await;

    // The owner disables the card while the prospect fills the form in.
    let disabled = app
        .request(
            "POST",
            &format!("/api/cards/{}/disable", id_of(&card)),
            Some(&token("alice")),
            None,
        )
        .await;
    assert_eq!(disabled.status, StatusCode::OK);
    let res = submit(&app, &event, &submission(&form, json!({}))).await;
    assert_refused(&res, StatusCode::GONE, "card_inactive");
    assert_eq!(lead_count(&app.pool).await, 0);
}

// spec: FRM-024, ACC-017
#[sqlx::test(migrations = "./migrations")]
async fn unknown_foreign_or_deleted_events_are_404(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", SLUG).await;
    let bob = create_card(&app, "bob", "bob-martin").await;
    let event = running_event(&app, &card, json!({})).await;
    let form = form_of(&app, &event).await;
    let foreign = create_event(
        &app,
        "bob",
        id_of(&bob),
        event_body("2026-01-15T10:00:00Z", None),
    )
    .await;
    let deleted = running_event(&app, &card, json!({ "title": "Supprimé" })).await;
    let removal = app
        .request(
            "DELETE",
            &format!("/api/events/{}", id_of(&deleted)),
            Some(&token("alice")),
            None,
        )
        .await;
    assert_eq!(removal.status, StatusCode::NO_CONTENT);

    for target in [
        &foreign,
        &deleted,
        &json!({ "id": "0190c9a0-0000-7000-8000-0000000000aa" }),
    ] {
        let res = submit(&app, target, &submission(&form, json!({}))).await;
        assert_refused(&res, StatusCode::NOT_FOUND, "not_found");
    }
    assert_eq!(lead_count(&app.pool).await, 0);
}

/// Waits until a session of this test's database waits on a lock.
async fn until_a_session_waits_on_a_lock(pool: &PgPool) {
    for _ in 0..400 {
        let waiting: i64 = sqlx::query_scalar(
            "select count(*) from pg_stat_activity \
             where datname = current_database() and wait_event_type = 'Lock'",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        if waiting > 0 {
            return;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("no session ever waited on a lock");
}

// spec: FRM-024, EVT-024
#[sqlx::test(migrations = "./migrations")]
async fn an_event_deleted_during_the_submission_is_404(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, "alice", SLUG).await;
    let event = running_event(&app, &card, json!({})).await;
    let form = form_of(&app, &event).await;
    let sent = submission(&form, json!({}));

    // The owner holds the event row: the lead's foreign key check waits for them, after the
    // event was read, and the owner then deletes the event.
    let mut owner = pool.begin().await.unwrap();
    sqlx::query("select id from events where id = $1::uuid for update")
        .bind(id_of(&event))
        .execute(&mut *owner)
        .await
        .unwrap();
    let delete_once_blocked = async {
        until_a_session_waits_on_a_lock(&pool).await;
        sqlx::query("delete from events where id = $1::uuid")
            .bind(id_of(&event))
            .execute(&mut *owner)
            .await
            .unwrap();
        owner.commit().await.unwrap();
    };
    let (res, ()) = tokio::join!(submit(&app, &event, &sent), delete_once_blocked);

    assert_refused(&res, StatusCode::NOT_FOUND, "not_found");
    assert_eq!(lead_count(&app.pool).await, 0);
}

// spec: EVT-012, Review Focus 3
#[sqlx::test(migrations = "./migrations")]
async fn the_access_code_never_reaches_the_logs(pool: PgPool) {
    let (logs, _guard) = capture_logs();
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", SLUG).await;
    let event = coded_event(&app, &card).await;
    let form = unlocked_form(&app, &event, CODE).await;

    let right = submit(
        &app,
        &event,
        &submission(&form, json!({ "access_code": CODE })),
    )
    .await;
    assert_accepted(&right);
    let wrong = submission(&form, json!({ "access_code": "Châteaux" }));
    let res = submit(&app, &event, &wrong).await;
    assert_refused(&res, StatusCode::FORBIDDEN, "invalid_access_code");

    let logged = logs.contents().to_lowercase();
    // Otherwise the checks below would pass on an empty capture.
    assert!(
        logged.contains("request completed"),
        "the requests were not logged"
    );
    for secret in [
        "château",
        "chateau",
        "éloïse",
        "eloise",
        "aubigné",
        "+33612345678",
        "06 12 34 56 78",
        "essentielle",
    ] {
        assert!(!logged.contains(secret), "{secret} was logged: {logged}");
    }
}
