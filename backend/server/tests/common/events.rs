//! Helpers for the event integration tests.

use axum::http::StatusCode;
use serde_json::{Map, Value, json};
use uuid::Uuid;

use super::cards::{merge, token};
use super::{TestApp, TestResponse};

/// The fields of a view that an event save sends back.
const EDITABLE: [&str; 9] = [
    "title",
    "description",
    "starts_at",
    "ends_at",
    "access_code",
    "device_limit",
    "standard_fields",
    "custom_fields",
    "consent_text",
];

/// A valid event body: first name, last name and email required, phone optional, and one
/// single-choice custom field. `starts_at` and `ends_at` are RFC 3339 instants.
pub fn event_body(starts_at: &str, ends_at: Option<&str>) -> Value {
    json!({
        "title": "Salon du Mariage Clermont 2027",
        "description": null,
        "starts_at": starts_at,
        "ends_at": ends_at,
        "access_code": null,
        "device_limit": 1,
        "standard_fields": {
            "first_name": "required",
            "last_name": "required",
            "birth_date": "off",
            "email": "required",
            "phone": "optional",
            "address": "off",
        },
        "custom_fields": [{
            "id": "0190c9a0-0000-7000-8000-00000000f001",
            "label": "Formule",
            "kind": "single_choice",
            "required": false,
            "help": null,
            "options": ["Essentielle", "Premium"],
        }],
        "consent_text": null,
    })
}

/// Creates the event on the card and returns its `EventView`.
pub async fn create_event(app: &TestApp, sub: &str, card_id: &str, body: Value) -> Value {
    let res = post_event(app, sub, card_id, body).await;
    assert_eq!(
        res.status,
        StatusCode::CREATED,
        "create event: {}",
        res.json
    );
    res.json
}

pub async fn post_event(app: &TestApp, sub: &str, card_id: &str, body: Value) -> TestResponse {
    app.request(
        "POST",
        &format!("/api/cards/{card_id}/events"),
        Some(&token(sub)),
        Some(body),
    )
    .await
}

pub async fn get_event(app: &TestApp, sub: &str, id: &str) -> TestResponse {
    app.request("GET", &format!("/api/events/{id}"), Some(&token(sub)), None)
        .await
}

pub async fn list_events(app: &TestApp, sub: &str, card_id: &str) -> TestResponse {
    app.request(
        "GET",
        &format!("/api/cards/{card_id}/events"),
        Some(&token(sub)),
        None,
    )
    .await
}

/// Reads the event, merges the top-level keys of `patch` into its editable fields and sends
/// the `PUT`.
pub async fn put_event(app: &TestApp, sub: &str, id: &str, patch: Value) -> TestResponse {
    let current = get_event(app, sub, id).await;
    assert_eq!(
        current.status,
        StatusCode::OK,
        "read {id}: {}",
        current.json
    );
    let mut body = Value::Object(
        EDITABLE
            .iter()
            .map(|key| ((*key).to_string(), current.json[*key].clone()))
            .collect(),
    );
    for (key, value) in patch.as_object().expect("patch is an object") {
        body[key.as_str()] = value.clone();
    }
    app.request(
        "PUT",
        &format!("/api/events/{id}"),
        Some(&token(sub)),
        Some(body),
    )
    .await
}

/// A valid submission for `form` (a `PublicEventForm`): an answer to every field it shows,
/// consent given, a new device id, no code, an empty trap field and the form's version.
/// `overrides` is merged in, objects key by key (`{"answers": {"email": "x"}}`).
pub fn submission(form: &Value, overrides: Value) -> Value {
    let mut answers = Map::new();
    for field in form["standard_fields"].as_array().expect("standard fields") {
        let name = field["field"].as_str().expect("a field name");
        let answer = match name {
            "first_name" => json!("Éloïse"),
            "last_name" => json!("D’Aubigné-Müller"),
            "birth_date" => json!("1990-05-12"),
            "email" => json!("eloise@example.com"),
            "phone" => json!("06 12 34 56 78"),
            "address" => json!({
                "street": "12 rue de l’Église",
                "postal_code": "63000",
                "city": "Clermont-Ferrand",
                "country": "France",
            }),
            other => panic!("unknown standard field {other}"),
        };
        answers.insert(name.to_string(), answer);
    }
    let custom: Map<String, Value> = form["custom_fields"]
        .as_array()
        .expect("custom fields")
        .iter()
        .map(|field| {
            let answer = match field["kind"].as_str().expect("a kind") {
                "text" => json!("Zoé Lefèvre ✨"),
                "long_text" => json!("Une réception de 120 personnes."),
                "date" => json!("2027-06-12"),
                "number" => json!(120),
                "single_choice" => field["options"][0].clone(),
                "checkbox" => json!(true),
                other => panic!("unknown field kind {other}"),
            };
            (field["id"].as_str().expect("an id").to_string(), answer)
        })
        .collect();
    answers.insert("custom".to_string(), Value::Object(custom));
    let mut body = json!({
        "device_id": Uuid::now_v7(),
        "form_version": form["form_version"],
        "access_code": null,
        "consent": true,
        "answers": answers,
        "fax": null,
    });
    merge(&mut body, overrides);
    body
}

/// The form of a running event without access code, as a prospect gets it from the public card.
pub async fn public_form(app: &TestApp, slug: &str, event_id: &str) -> Value {
    let res = app
        .request(
            "GET",
            &format!("/api/public/cards/{slug}/events/{event_id}"),
            None,
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::OK, "public form: {}", res.json);
    assert_eq!(res.json["state"], "open", "public form: {}", res.json);
    res.json["event"].clone()
}

/// Sends a lead through the public API (a valid answer to every field of the form shown now,
/// `overrides` merged as in `submission`) and returns the submitted body.
pub async fn send_lead(app: &TestApp, slug: &str, event_id: &str, overrides: Value) -> Value {
    let form = public_form(app, slug, event_id).await;
    let body = submission(&form, overrides);
    let res = app
        .request(
            "POST",
            &format!("/api/public/cards/{slug}/events/{event_id}/leads"),
            None,
            Some(body.clone()),
        )
        .await;
    assert_eq!(
        res.status,
        StatusCode::NO_CONTENT,
        "send lead: {}",
        res.json
    );
    body
}

pub async fn get_leads(app: &TestApp, sub: &str, event_id: &str) -> TestResponse {
    app.request(
        "GET",
        &format!("/api/events/{event_id}/leads"),
        Some(&token(sub)),
        None,
    )
    .await
}

pub async fn put_spam(app: &TestApp, sub: &str, lead_id: &str, spam: bool) -> TestResponse {
    app.request(
        "PUT",
        &format!("/api/leads/{lead_id}/spam"),
        Some(&token(sub)),
        Some(json!({ "spam": spam })),
    )
    .await
}

pub async fn delete_lead(app: &TestApp, sub: &str, lead_id: &str) -> TestResponse {
    app.request(
        "DELETE",
        &format!("/api/leads/{lead_id}"),
        Some(&token(sub)),
        None,
    )
    .await
}
