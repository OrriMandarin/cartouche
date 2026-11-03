//! Helpers for the event integration tests.

use axum::http::StatusCode;
use serde_json::{Value, json};

use super::cards::token;
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
