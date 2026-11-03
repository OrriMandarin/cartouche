//! Owner routes for events: list, create, read, update, end now and delete, plus the preview
//! of the default consent text (EVT-001, EVT-004 to EVT-006, EVT-009, EVT-010, EVT-016 to
//! EVT-022, EVT-024, EVT-025, FRM-029, ACC-017).
//!
//! The simultaneous-event limit is checked while holding the card's row lock, taken before
//! the periods are read: two concurrent writes on a card queue up and the second one sees
//! the first (EVT-018).

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use cartouche_domain::{
    EventInput, Period, TooManySimultaneousEvents, check_simultaneous_limit, default_consent_text,
    normalize, validate_event,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::ApprovedUser;
use crate::config::Config;
use crate::db::{cards, events};
use crate::error::{ApiError, ErrorBody};
use crate::extract::{ApiJson, ApiPath};
use crate::state::AppState;
use crate::views::EventView;

#[derive(Debug, Serialize, ToSchema)]
pub struct EventList {
    /// The card's events, by start (EVT-009).
    pub events: Vec<EventView>,
}

/// The title to compose the default consent text for.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ConsentPreviewBody {
    pub title: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ConsentPreview {
    /// The default consent text for this card and title (FRM-029).
    pub text: String,
}

/// Reads the event with its card's content, as its owner sees it.
async fn event_view(
    state: &AppState,
    owner_id: Uuid,
    event_id: Uuid,
) -> Result<EventView, ApiError> {
    let counted = events::find_for_owner(&state.db, owner_id, event_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let card = cards::find_for_owner(&state.db, owner_id, counted.event.card_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    Ok(EventView::new(counted, &card.content, state.clock.now()))
}

/// EVT-004, EVT-005: `period` must not make more events run together than the configuration
/// allows.
fn check_limit(config: &Config, period: &Period, others: &[Period]) -> Result<(), ApiError> {
    check_simultaneous_limit(period, others, config.max_simultaneous_events)
        .map_err(|TooManySimultaneousEvents| ApiError::TooManySimultaneousEvents)
}

/// Lists the events of one of the caller's cards, by start.
#[utoipa::path(
    get,
    path = "/api/cards/{id}/events",
    summary = "List the events of a card",
    description = "The events of the card by start, each with its state (`upcoming`, `running` or `past`, from the server clock), its access code in clear and its number of contacts. Events of a disabled card are listed too.",
    tag = "events",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the card.")),
    responses(
        (status = 200, description = "The card's events.", body = EventList),
        (status = 400, description = "Malformed id (`invalid_request`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller's account is not approved (`account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such card for the caller (`not_found`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn list_events(
    ApprovedUser(me): ApprovedUser,
    State(state): State<AppState>,
    ApiPath(card_id): ApiPath<Uuid>,
) -> Result<Json<EventList>, ApiError> {
    let owner_id = me.user.id;
    let listed = events::list_for_card(&state.db, owner_id, card_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let card = cards::find_for_owner(&state.db, owner_id, card_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let now = state.clock.now();
    let events = listed
        .into_iter()
        .map(|counted| EventView::new(counted, &card.content, now))
        .collect();
    Ok(Json(EventList { events }))
}

/// Creates an event on one of the caller's cards (EVT-001).
#[utoipa::path(
    post,
    path = "/api/cards/{id}/events",
    summary = "Create an event",
    description = "Creates an event on the card. All invalid fields are reported at once. Refused with `too_many_simultaneous_events` when it would make more events of the card run together than the instance allows; concurrent creations cannot exceed the limit together.",
    tag = "events",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the card.")),
    request_body = EventInput,
    responses(
        (status = 201, description = "The new event.", body = EventView),
        (status = 400, description = "Malformed id or body (`invalid_request`) or invalid fields (`validation_failed`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller's account is not approved (`account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such card for the caller (`not_found`).", body = ErrorBody),
        (status = 409, description = "Too many simultaneous events (`too_many_simultaneous_events`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn create_event(
    ApprovedUser(me): ApprovedUser,
    State(state): State<AppState>,
    ApiPath(card_id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<EventInput>,
) -> Result<(StatusCode, Json<EventView>), ApiError> {
    let owner_id = me.user.id;
    let event_id = Uuid::now_v7();
    let mut tx = state.db.begin().await?;
    // The card first: it serializes every write on the events of this card.
    cards::lock_for_owner(&mut tx, owner_id, card_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let valid = validate_event(body).map_err(ApiError::Validation)?;
    let others = events::periods_of_card(&mut tx, owner_id, card_id, None).await?;
    check_limit(&state.config, &valid.period, &others)?;
    events::insert(&mut tx, owner_id, card_id, event_id, &valid)
        .await?
        .ok_or(ApiError::NotFound)?;
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(event_view(&state, owner_id, event_id).await?),
    ))
}

/// Reads one of the caller's events.
#[utoipa::path(
    get,
    path = "/api/events/{id}",
    summary = "Get an event",
    description = "One of the caller's events. An event of another user is reported as not found.",
    tag = "events",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the event.")),
    responses(
        (status = 200, description = "The event.", body = EventView),
        (status = 400, description = "Malformed id (`invalid_request`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller's account is not approved (`account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such event for the caller (`not_found`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn get_event(
    ApprovedUser(me): ApprovedUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<EventView>, ApiError> {
    Ok(Json(event_view(&state, me.user.id, id).await?))
}

/// Replaces everything an owner sets on an event.
#[utoipa::path(
    put,
    path = "/api/events/{id}",
    summary = "Update an event",
    description = "Replaces the event's title, description, dates, access code, device limit, fields and consent text. All invalid fields are reported at once. Refused with `too_many_simultaneous_events` when the new period would make more events of the card run together than the instance allows; the event being edited does not count against itself. Nothing is saved on a refusal.",
    tag = "events",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the event.")),
    request_body = EventInput,
    responses(
        (status = 200, description = "The saved event.", body = EventView),
        (status = 400, description = "Malformed id or body (`invalid_request`) or invalid fields (`validation_failed`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller's account is not approved (`account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such event for the caller (`not_found`).", body = ErrorBody),
        (status = 409, description = "Too many simultaneous events (`too_many_simultaneous_events`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn update_event(
    ApprovedUser(me): ApprovedUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<EventInput>,
) -> Result<Json<EventView>, ApiError> {
    let owner_id = me.user.id;
    let mut tx = state.db.begin().await?;
    let card_id = events::lock_card_of_event(&mut tx, owner_id, id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let valid = validate_event(body).map_err(ApiError::Validation)?;
    let others = events::periods_of_card(&mut tx, owner_id, card_id, Some(id)).await?;
    check_limit(&state.config, &valid.period, &others)?;
    events::update(&mut tx, owner_id, id, &valid)
        .await?
        .ok_or(ApiError::NotFound)?;
    tx.commit().await?;
    Ok(Json(event_view(&state, owner_id, id).await?))
}

/// Ends a running event now (EVT-006).
#[utoipa::path(
    post,
    path = "/api/events/{id}/end",
    summary = "End an event now",
    description = "Sets the end of a running event to the server's current instant. Refused with `event_not_running` for an event that has not started or is already over.",
    tag = "events",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the event.")),
    responses(
        (status = 200, description = "The event, now ended.", body = EventView),
        (status = 400, description = "Malformed id (`invalid_request`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller's account is not approved (`account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such event for the caller (`not_found`).", body = ErrorBody),
        (status = 409, description = "The event is not running (`event_not_running`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn end_event(
    ApprovedUser(me): ApprovedUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<EventView>, ApiError> {
    let owner_id = me.user.id;
    let mut tx = state.db.begin().await?;
    events::lock_card_of_event(&mut tx, owner_id, id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let event = events::find_in_tx(&mut tx, owner_id, id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let ended = event
        .period
        .end_now(state.clock.now())
        .map_err(|_| ApiError::EventNotRunning)?;
    events::set_end(&mut tx, owner_id, id, ended.ends_at)
        .await?
        .ok_or(ApiError::NotFound)?;
    tx.commit().await?;
    Ok(Json(event_view(&state, owner_id, id).await?))
}

/// Deletes an event and its contacts (EVT-024).
#[utoipa::path(
    delete,
    path = "/api/events/{id}",
    summary = "Delete an event",
    description = "Deletes the event and every contact collected with it.",
    tag = "events",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the event.")),
    responses(
        (status = 204, description = "The event is deleted."),
        (status = 400, description = "Malformed id (`invalid_request`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller's account is not approved (`account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such event for the caller (`not_found`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn delete_event(
    ApprovedUser(me): ApprovedUser,
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiError> {
    if events::delete_for_owner(&state.db, me.user.id, id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::NotFound)
    }
}

/// The default consent text for a card and a title, as the editor previews it (FRM-029).
#[utoipa::path(
    post,
    path = "/api/cards/{id}/consent-preview",
    summary = "Preview the default consent text",
    description = "The default consent text of the card for an event with this title: the text a prospect accepts when the event has no custom consent text.",
    tag = "events",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the card.")),
    request_body = ConsentPreviewBody,
    responses(
        (status = 200, description = "The default consent text.", body = ConsentPreview),
        (status = 400, description = "Malformed id or body (`invalid_request`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller's account is not approved (`account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such card for the caller (`not_found`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn consent_preview(
    ApprovedUser(me): ApprovedUser,
    State(state): State<AppState>,
    ApiPath(card_id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<ConsentPreviewBody>,
) -> Result<Json<ConsentPreview>, ApiError> {
    let card = cards::find_for_owner(&state.db, me.user.id, card_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    Ok(Json(ConsentPreview {
        text: default_consent_text(&card.content, &normalize(&body.title)),
    }))
}
