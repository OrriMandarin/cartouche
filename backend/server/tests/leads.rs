mod common;

use axum::http::StatusCode;
use cartouche_domain::Clock;
use common::cards::{cards_app, create_card, merge, token};
use common::events::{
    create_event, delete_lead, event_body, get_event, get_leads, put_event, put_spam, send_lead,
};
use common::{TestApp, TestResponse};
use serde_json::{Value, json};
use sqlx::PgPool;

const SLUG: &str = "alice-durand";
const FORMULA: &str = "0190c9a0-0000-7000-8000-00000000f001";
const GUESTS: &str = "0190c9a0-0000-7000-8000-00000000f002";
const NOTE: &str = "0190c9a0-0000-7000-8000-00000000f003";

fn id_of(value: &Value) -> &str {
    value["id"].as_str().expect("an id")
}

fn error_code(res: &TestResponse) -> &str {
    res.json["error"]["code"].as_str().unwrap_or_default()
}

/// An event of Alice's card running since 10:00 without end (the clock is at 12:00),
/// `patch` merged into `event_body`.
async fn running_event(app: &TestApp, card: &Value, patch: Value) -> Value {
    let mut body = event_body("2026-01-15T10:00:00Z", None);
    merge(&mut body, patch);
    create_event(app, "alice", id_of(card), body).await
}

/// The leads of the event for Alice, which must be readable.
async fn leads_of(app: &TestApp, event: &Value) -> Vec<Value> {
    let res = get_leads(app, "alice", id_of(event)).await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    res.json["leads"].as_array().expect("leads").clone()
}

fn one_second_later(app: &TestApp) {
    app.clock.advance(chrono::Duration::seconds(1));
}

// spec: EDI-020, FRM-038
#[sqlx::test(migrations = "./migrations")]
async fn event_leads_are_listed_newest_first(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", SLUG).await;
    let event = running_event(&app, &card, json!({})).await;
    let first = app.clock.now();
    for first_name in ["Éloïse", "Zoé", "Noël"] {
        send_lead(
            &app,
            SLUG,
            id_of(&event),
            json!({ "answers": { "first_name": first_name } }),
        )
        .await;
        one_second_later(&app);
    }

    let leads = leads_of(&app, &event).await;
    let names: Vec<&str> = leads
        .iter()
        .map(|lead| lead["answers"]["first_name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["Noël", "Zoé", "Éloïse"]);

    let oldest = &leads[2];
    assert_eq!(oldest["event_id"], event["id"]);
    assert_eq!(oldest["spam"], false);
    assert_eq!(
        oldest["submitted_at"],
        first.to_rfc3339().replace("+00:00", "Z")
    );
    assert_eq!(oldest["answers"]["last_name"], "D’Aubigné-Müller");
    assert_eq!(oldest["answers"]["email"], "eloise@example.com");
    assert_eq!(oldest["answers"]["phone"], "+33612345678");
    assert_eq!(oldest["phone_display"], "+33 6 12 34 56 78");
    assert_eq!(oldest["custom"][0]["label"], "Formule");
    assert_eq!(oldest["custom"][0]["kind"], "single_choice");
    assert_eq!(oldest["custom"][0]["value"], "Essentielle");
    assert_eq!(oldest["consent_at"], oldest["submitted_at"]);
    assert_eq!(
        oldest["consent_text"],
        get_event(&app, "alice", id_of(&event)).await.json["default_consent_text"]
    );
}

// spec: ABU-003, ABU-009
#[sqlx::test(migrations = "./migrations")]
async fn spam_can_be_set_and_cleared(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", SLUG).await;
    let event = running_event(&app, &card, json!({})).await;
    send_lead(&app, SLUG, id_of(&event), json!({})).await;
    let lead = leads_of(&app, &event).await.remove(0);
    let lead_id = id_of(&lead);

    let marked = put_spam(&app, "alice", lead_id, true).await;
    assert_eq!(marked.status, StatusCode::OK, "{}", marked.json);
    assert_eq!(marked.json["id"], lead["id"]);
    assert_eq!(marked.json["spam"], true);
    assert_eq!(marked.json["answers"], lead["answers"]);

    let again = put_spam(&app, "alice", lead_id, true).await;
    assert_eq!(again.status, StatusCode::OK, "{}", again.json);
    assert_eq!(again.json["spam"], true);
    // A spam lead stays in the list, flagged.
    let listed = leads_of(&app, &event).await;
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0]["spam"], true);

    let cleared = put_spam(&app, "alice", lead_id, false).await;
    assert_eq!(cleared.status, StatusCode::OK, "{}", cleared.json);
    assert_eq!(cleared.json["spam"], false);
    let cleared_again = put_spam(&app, "alice", lead_id, false).await;
    assert_eq!(cleared_again.status, StatusCode::OK);
    let listed = leads_of(&app, &event).await;
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0]["spam"], false);
}

// spec: ABU-004, ABU-010
#[sqlx::test(migrations = "./migrations")]
async fn deleting_a_lead(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", SLUG).await;
    let event = running_event(&app, &card, json!({ "device_limit": 5 })).await;
    for _ in 0..2 {
        send_lead(&app, SLUG, id_of(&event), json!({})).await;
    }
    let before = get_event(&app, "alice", id_of(&event)).await;
    assert_eq!(before.json["lead_count"], 2);
    let doomed = leads_of(&app, &event).await.remove(0);

    let deleted = delete_lead(&app, "alice", id_of(&doomed)).await;
    assert_eq!(deleted.status, StatusCode::NO_CONTENT);
    assert!(deleted.body.is_empty());

    let left = leads_of(&app, &event).await;
    assert_eq!(left.len(), 1);
    assert_ne!(left[0]["id"], doomed["id"]);
    let after = get_event(&app, "alice", id_of(&event)).await;
    assert_eq!(after.json["lead_count"], 1);

    let again = delete_lead(&app, "alice", id_of(&doomed)).await;
    assert_eq!(again.status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&again), "not_found");
}

// spec: EVT-024
#[sqlx::test(migrations = "./migrations")]
async fn deleting_an_event_deletes_its_leads(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, "alice", SLUG).await;
    let event = running_event(&app, &card, json!({ "device_limit": 5 })).await;
    let other = running_event(&app, &card, json!({ "title": "Autre salon" })).await;
    for event in [&event, &event, &other] {
        send_lead(&app, SLUG, id_of(event), json!({})).await;
    }

    let deleted = app
        .request(
            "DELETE",
            &format!("/api/events/{}", id_of(&event)),
            Some(&token("alice")),
            None,
        )
        .await;
    assert_eq!(deleted.status, StatusCode::NO_CONTENT);

    let remaining: Vec<(String,)> = sqlx::query_as("select event_id::text from leads")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(remaining, [(id_of(&other).to_string(),)]);
    assert_eq!(leads_of(&app, &other).await.len(), 1);
    let gone = get_leads(&app, "alice", id_of(&event)).await;
    assert_eq!(gone.status, StatusCode::NOT_FOUND);
}

// spec: FRM-022, FRM-023, Review Focus 6
#[sqlx::test(migrations = "./migrations")]
async fn editing_fields_never_breaks_existing_leads(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", SLUG).await;
    let event = running_event(
        &app,
        &card,
        json!({ "device_limit": 5, "custom_fields": [
            {
                "id": FORMULA, "label": "Formule", "kind": "single_choice", "required": false,
                "help": null, "options": ["Essentielle", "Prestige"],
            },
            {
                "id": GUESTS, "label": "Nombre d’invités", "kind": "number", "required": false,
                "help": null,
            },
            {
                "id": NOTE, "label": "Commentaire", "kind": "text", "required": false,
                "help": null,
            },
        ] }),
    )
    .await;
    send_lead(
        &app,
        SLUG,
        id_of(&event),
        json!({ "answers": { "custom": {
            FORMULA: "Prestige", GUESTS: 120, NOTE: "À rappeler après le salon ✨",
        } } }),
    )
    .await;
    let original = leads_of(&app, &event).await.remove(0);
    assert_eq!(original["custom"].as_array().unwrap().len(), 3);

    // Renames "Formule" and drops "Prestige", turns the guests into text, deletes the note.
    one_second_later(&app);
    let edited = put_event(
        &app,
        "alice",
        id_of(&event),
        json!({ "custom_fields": [
            {
                "id": FORMULA, "label": "Offre", "kind": "single_choice", "required": false,
                "help": null, "options": ["Essentielle", "Premium"],
            },
            {
                "id": GUESTS, "label": "Invités", "kind": "text", "required": false,
                "help": null,
            },
        ] }),
    )
    .await;
    assert_eq!(edited.status, StatusCode::OK, "{}", edited.json);

    let unchanged = leads_of(&app, &event).await.remove(0);
    assert_eq!(unchanged["custom"], original["custom"]);
    assert_eq!(
        unchanged["custom"],
        json!([
            {
                "field_id": FORMULA, "label": "Formule", "kind": "single_choice",
                "value": "Prestige",
            },
            {
                "field_id": GUESTS, "label": "Nombre d’invités", "kind": "number",
                "value": 120,
            },
            {
                "field_id": NOTE, "label": "Commentaire", "kind": "text",
                "value": "À rappeler après le salon ✨",
            },
        ])
    );

    // A new lead follows the new definition.
    send_lead(&app, SLUG, id_of(&event), json!({})).await;
    let leads = leads_of(&app, &event).await;
    assert_eq!(leads.len(), 2);
    assert_eq!(
        leads[0]["custom"],
        json!([
            {
                "field_id": FORMULA, "label": "Offre", "kind": "single_choice",
                "value": "Essentielle",
            },
            {
                "field_id": GUESTS, "label": "Invités", "kind": "text",
                "value": "Zoé Lefèvre ✨",
            },
        ])
    );
    assert_eq!(leads[1]["custom"], original["custom"]);
}

// spec: ACC-017
#[sqlx::test(migrations = "./migrations")]
async fn other_users_leads_are_404(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", SLUG).await;
    let event = running_event(&app, &card, json!({})).await;
    send_lead(&app, SLUG, id_of(&event), json!({})).await;
    let lead = leads_of(&app, &event).await.remove(0);

    // Bob exists (he has a card) but owns neither the event nor the lead.
    create_card(&app, "bob", "bob-martin").await;
    let listed = get_leads(&app, "bob", id_of(&event)).await;
    assert_eq!(listed.status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&listed), "not_found");
    let marked = put_spam(&app, "bob", id_of(&lead), true).await;
    assert_eq!(marked.status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&marked), "not_found");
    let deleted = delete_lead(&app, "bob", id_of(&lead)).await;
    assert_eq!(deleted.status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&deleted), "not_found");

    // Nothing changed for Alice.
    let untouched = leads_of(&app, &event).await;
    assert_eq!(untouched, [lead]);
}

// spec: LNK-008
#[sqlx::test(migrations = "./migrations")]
async fn leads_of_a_disabled_card_stay_visible(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, "alice", SLUG).await;
    let event = running_event(&app, &card, json!({})).await;
    send_lead(&app, SLUG, id_of(&event), json!({})).await;

    let disabled = app
        .request(
            "POST",
            &format!("/api/cards/{}/disable", id_of(&card)),
            Some(&token("alice")),
            None,
        )
        .await;
    assert_eq!(disabled.status, StatusCode::OK);
    sqlx::query("update cards set support_disabled_at = now() where id = $1::uuid")
        .bind(id_of(&card))
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(leads_of(&app, &event).await.len(), 1);
}

async fn get_card_leads(app: &TestApp, sub: &str, card_id: &str) -> TestResponse {
    app.request(
        "GET",
        &format!("/api/cards/{card_id}/leads"),
        Some(&token(sub)),
        None,
    )
    .await
}

// spec: LEA-001, LEA-013, LEA-014
#[sqlx::test(migrations = "./migrations")]
async fn whole_card_lists_every_event_newest_first(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", SLUG).await;
    let event_a = running_event(&app, &card, json!({ "title": "A", "device_limit": 5 })).await;
    let event_b = running_event(&app, &card, json!({ "title": "B", "device_limit": 5 })).await;
    for (event, first_name) in [(&event_a, "Éloïse"), (&event_a, "Zoé"), (&event_b, "Noël")] {
        send_lead(
            &app,
            SLUG,
            id_of(event),
            json!({ "answers": { "first_name": first_name } }),
        )
        .await;
        one_second_later(&app);
    }
    let zoe = leads_of(&app, &event_a)
        .await
        .into_iter()
        .find(|lead| lead["answers"]["first_name"] == "Zoé")
        .expect("Zoé's lead");
    let marked = put_spam(&app, "alice", id_of(&zoe), true).await;
    assert_eq!(marked.status, StatusCode::OK, "{}", marked.json);

    let res = get_card_leads(&app, "alice", id_of(&card)).await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    let leads = res.json["leads"].as_array().expect("leads");
    let summary: Vec<(&str, &str, bool)> = leads
        .iter()
        .map(|lead| {
            (
                lead["answers"]["first_name"].as_str().unwrap(),
                lead["event_title"].as_str().unwrap(),
                lead["spam"].as_bool().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        summary,
        [
            ("Noël", "B", false),
            ("Zoé", "A", true),
            ("Éloïse", "A", false)
        ]
    );
}

// spec: EDI-020, LEA-013
#[sqlx::test(migrations = "./migrations")]
async fn event_leads_carry_their_event_title(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", SLUG).await;
    let event = running_event(&app, &card, json!({ "title": "Salon du Mariage ✨" })).await;
    send_lead(&app, SLUG, id_of(&event), json!({})).await;

    let leads = leads_of(&app, &event).await;
    assert_eq!(leads.len(), 1);
    assert_eq!(leads[0]["event_title"], "Salon du Mariage ✨");
}

// spec: ACC-017
#[sqlx::test(migrations = "./migrations")]
async fn whole_card_of_another_user_is_404(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", SLUG).await;
    let event = running_event(&app, &card, json!({})).await;
    send_lead(&app, SLUG, id_of(&event), json!({})).await;
    create_card(&app, "bob", "bob-martin").await;

    let foreign = get_card_leads(&app, "bob", id_of(&card)).await;
    assert_eq!(foreign.status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&foreign), "not_found");
    let unknown = get_card_leads(&app, "alice", "0190c9a0-0000-7000-8000-00000000dead").await;
    assert_eq!(unknown.status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&unknown), "not_found");
}

// spec: LNK-008
#[sqlx::test(migrations = "./migrations")]
async fn whole_card_of_a_disabled_card_is_listed(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", SLUG).await;
    let event = running_event(&app, &card, json!({})).await;
    send_lead(&app, SLUG, id_of(&event), json!({})).await;
    let disabled = app
        .request(
            "POST",
            &format!("/api/cards/{}/disable", id_of(&card)),
            Some(&token("alice")),
            None,
        )
        .await;
    assert_eq!(disabled.status, StatusCode::OK);

    let res = get_card_leads(&app, "alice", id_of(&card)).await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    assert_eq!(res.json["leads"].as_array().unwrap().len(), 1);
}

// spec: ABU-003, ABU-009
#[sqlx::test(migrations = "./migrations")]
async fn re_marking_spam_keeps_the_first_date(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, "alice", SLUG).await;
    let event = running_event(&app, &card, json!({})).await;
    send_lead(&app, SLUG, id_of(&event), json!({})).await;
    let lead = leads_of(&app, &event).await.remove(0);
    let lead_id = id_of(&lead);
    let spam_at = || async {
        sqlx::query_scalar::<_, Option<chrono::DateTime<chrono::Utc>>>(
            "select spam_at from leads where id = $1::uuid",
        )
        .bind(lead_id)
        .fetch_one(&pool)
        .await
        .unwrap()
    };

    let first = app.clock.now();
    put_spam(&app, "alice", lead_id, true).await;
    assert_eq!(spam_at().await, Some(first));

    app.clock.advance(chrono::Duration::hours(1));
    let again = put_spam(&app, "alice", lead_id, true).await;
    assert_eq!(again.status, StatusCode::OK, "{}", again.json);
    assert_eq!(spam_at().await, Some(first));

    put_spam(&app, "alice", lead_id, false).await;
    assert_eq!(spam_at().await, None);

    put_spam(&app, "alice", lead_id, true).await;
    assert_eq!(spam_at().await, Some(first + chrono::Duration::hours(1)));
}

// spec: ABU-003
#[sqlx::test(migrations = "./migrations")]
async fn spam_body_and_lead_id_are_checked(pool: PgPool) {
    let app = cards_app(pool).await;
    create_card(&app, "alice", SLUG).await;
    let lead_id = "0190c9a0-0000-7000-8000-00000000dead";

    for body in [json!({ "spam": "yes" }), json!({})] {
        let res = app
            .request(
                "PUT",
                &format!("/api/leads/{lead_id}/spam"),
                Some(&token("alice")),
                Some(body),
            )
            .await;
        assert_eq!(res.status, StatusCode::BAD_REQUEST, "{}", res.json);
        assert_eq!(error_code(&res), "invalid_request");
    }
    let bad_id = app
        .request(
            "PUT",
            "/api/leads/not-a-uuid/spam",
            Some(&token("alice")),
            Some(json!({ "spam": true })),
        )
        .await;
    assert_eq!(bad_id.status, StatusCode::BAD_REQUEST);
    assert_eq!(error_code(&bad_id), "invalid_request");
    let bad_delete = delete_lead(&app, "alice", "not-a-uuid").await;
    assert_eq!(bad_delete.status, StatusCode::BAD_REQUEST);
    assert_eq!(error_code(&bad_delete), "invalid_request");
}
