//! Public routes for an event's form: read it (or learn that a code or an open window is
//! needed), unlock it with the access code and send it (EVT-008, EVT-011, EVT-012, EVT-013,
//! EVT-026, EVT-027, EVT-029, FRM-002, FRM-003, FRM-024, FRM-030, ABU-005 to ABU-007). The
//! access code never leaves the server: before a correct code, only the id and title of the
//! event go out. Neither the code nor the answers are ever logged.

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use cartouche_domain::{
    AnswersInput, DeviceLimitReached, FormChanged, PublicFormState, UnlockOutcome,
    access_code_matches, check_device_limit, check_form_version, honeypot_filled,
    public_form_state, unlock_outcome, validate_lead,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::client_ip::ClientIp;
use crate::db::cards::Card;
use crate::db::events::{self, Event};
use crate::db::leads::{self, NewLead};
use crate::error::{ApiError, ErrorBody};
use crate::extract::{ApiJson, ApiPath};
use crate::rate_limit::{Bucket, RetryAfter};
use crate::routes::public_cards::serve_card;
use crate::state::AppState;
use crate::views::{PublicEventForm, PublicEventHeading, ShownForm};

/// What a visitor gets for an event.
#[derive(Debug, Serialize, ToSchema)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum PublicEventResponse {
    /// The form is open and needs no code.
    Open { event: PublicEventForm },
    /// The form needs the access code first: only the title is given.
    CodeRequired { event: PublicEventHeading },
    /// The event does not accept submissions now: only the title is given.
    Closed { event: PublicEventHeading },
}

// No `Debug`: the code must never reach a log line (EVT-027).
#[derive(Deserialize, ToSchema)]
pub struct UnlockBody {
    /// The code as typed: case, surrounding spaces and accents do not matter.
    pub access_code: String,
}

/// What a prospect sends.
// No `Debug`: neither the code nor the answers may reach a log line (EVT-027).
#[derive(Deserialize, ToSchema)]
pub struct LeadSubmission {
    /// Identifier of the browser, kept in a cookie (EVT-028).
    pub device_id: Uuid,
    /// The `form_version` of the form the prospect filled in.
    pub form_version: String,
    /// The code typed to unlock the form, for an event with an access code.
    pub access_code: Option<String>,
    /// Whether the consent box is ticked.
    pub consent: bool,
    pub answers: AnswersInput,
    /// Hidden trap field: the form always leaves it empty.
    pub fax: Option<String>,
}

fn rate_limited(RetryAfter(retry_after_secs): RetryAfter) -> ApiError {
    ApiError::RateLimited { retry_after_secs }
}

/// The served card behind the slug and its event, or `not_found` for an event that does not
/// exist or belongs to another card.
async fn card_and_event(
    state: &AppState,
    slug: &str,
    event_id: Uuid,
) -> Result<(Card, Event), ApiError> {
    let card = serve_card(state, slug).await?;
    let event = events::find_public(&state.db, card.id, event_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    Ok((card, event))
}

/// Reads the form of an event.
#[utoipa::path(
    get,
    path = "/api/public/cards/{slug}/events/{event_id}",
    summary = "Read a public event form",
    description = "No token needed. `open` carries the form. `code_required` and `closed` carry only the id and title of the event: the description, fields and consent text of an event with an access code are given by the unlock route after a correct code. An old slug or a slug with capitals reaches the event too. An event outside its submission window (from its start to 15 minutes after its end) is `closed`, whether or not it has a code.",
    tag = "public",
    params(
        ("slug" = String, Path, description = "The slug, in any case."),
        ("event_id" = Uuid, Path, description = "Id of the event."),
    ),
    responses(
        (status = 200, description = "The form, or what to do before getting it.", body = PublicEventResponse),
        (status = 400, description = "Malformed event id (`invalid_request`).", body = ErrorBody),
        (status = 404, description = "Unknown slug, or an event that is unknown, deleted or of another card (`not_found`).", body = ErrorBody),
        (status = 410, description = "The card is not served (`card_inactive`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn get_public_event(
    State(state): State<AppState>,
    ApiPath((slug, event_id)): ApiPath<(String, Uuid)>,
) -> Result<Json<PublicEventResponse>, ApiError> {
    let (card, event) = card_and_event(&state, &slug, event_id).await?;
    let form_state = public_form_state(
        &event.period,
        state.clock.now(),
        event.access_code.is_some(),
    );
    Ok(Json(match form_state {
        PublicFormState::Open => PublicEventResponse::Open {
            event: PublicEventForm::new(event, &card.content),
        },
        PublicFormState::CodeRequired => PublicEventResponse::CodeRequired {
            event: PublicEventHeading::from(&event),
        },
        PublicFormState::Closed => PublicEventResponse::Closed {
            event: PublicEventHeading::from(&event),
        },
    }))
}

/// Checks an access code and hands out the form.
#[utoipa::path(
    post,
    path = "/api/public/cards/{slug}/events/{event_id}/unlock",
    summary = "Unlock a public event form",
    description = "No token needed. A correct code (or any code, for an event without one) returns the form. A wrong code is `403 invalid_access_code`. Each address may fail 30 codes per 10 minutes; past that every attempt is `429 rate_limited` with `Retry-After`, a correct code included. A correct code does not count.",
    tag = "public",
    params(
        ("slug" = String, Path, description = "The slug, in any case."),
        ("event_id" = Uuid, Path, description = "Id of the event."),
    ),
    request_body = UnlockBody,
    responses(
        (status = 200, description = "The form.", body = PublicEventForm),
        (status = 400, description = "Malformed id or body (`invalid_request`).", body = ErrorBody),
        (status = 403, description = "Wrong access code (`invalid_access_code`).", body = ErrorBody),
        (status = 404, description = "Unknown slug, or an event that is unknown, deleted or of another card (`not_found`).", body = ErrorBody),
        (status = 409, description = "The event does not accept submissions now (`event_closed`).", body = ErrorBody),
        (status = 410, description = "The card is not served (`card_inactive`).", body = ErrorBody),
        (status = 429, description = "Too many wrong codes from this address (`rate_limited`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn unlock_public_event(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    ApiPath((slug, event_id)): ApiPath<(String, Uuid)>,
    ApiJson(body): ApiJson<UnlockBody>,
) -> Result<Json<PublicEventForm>, ApiError> {
    let now = state.clock.now();
    state
        .rate_limiter
        .check(Bucket::FailedAccessCode, ip, now)
        .map_err(rate_limited)?;
    let (card, event) = card_and_event(&state, &slug, event_id).await?;
    match unlock_outcome(
        &event.period,
        now,
        event.access_code.as_deref(),
        &body.access_code,
    ) {
        UnlockOutcome::Closed => Err(ApiError::EventClosed),
        UnlockOutcome::WrongCode => {
            state.rate_limiter.record(Bucket::FailedAccessCode, ip, now);
            Err(ApiError::InvalidAccessCode)
        }
        UnlockOutcome::Granted => Ok(Json(PublicEventForm::new(event, &card.content))),
    }
}

/// Sends a prospect's answers.
#[utoipa::path(
    post,
    path = "/api/public/cards/{slug}/events/{event_id}/leads",
    summary = "Send a public event form",
    description = "No token needed. Stores the answers as a lead of the event, with the consent text shown with the form and the time of sending. Each address may make 120 sends per 10 minutes, accepted or refused, over every event; past that every send is `429 rate_limited` with `Retry-After`. The event must accept submissions (from its start to 15 minutes after its end). For an event with an access code, the code is checked again: a wrong or missing one is `403 invalid_access_code` and counts against the 30 wrong codes per address of the unlock route. A `form_version` that is no longer the form's is `409 form_changed`: reload the form. A device may send as many leads to an event as its device limit, leads marked as spam included. A send whose `fax` is not blank is answered like an accepted one and not stored.",
    tag = "public",
    params(
        ("slug" = String, Path, description = "The slug, in any case."),
        ("event_id" = Uuid, Path, description = "Id of the event."),
    ),
    request_body = LeadSubmission,
    responses(
        (status = 204, description = "The lead is stored."),
        (status = 400, description = "Malformed id or body (`invalid_request`), or invalid answers (`validation_failed`, every invalid field listed).", body = ErrorBody),
        (status = 403, description = "Wrong or missing access code (`invalid_access_code`).", body = ErrorBody),
        (status = 404, description = "Unknown slug, or an event that is unknown, deleted or of another card (`not_found`).", body = ErrorBody),
        (status = 409, description = "The event does not accept submissions now (`event_closed`), the form changed (`form_changed`) or this device reached the event's limit (`device_limit_reached`).", body = ErrorBody),
        (status = 410, description = "The card is not served (`card_inactive`).", body = ErrorBody),
        (status = 429, description = "Too many sends, or too many wrong codes, from this address (`rate_limited`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn submit_lead(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    path: Result<ApiPath<(String, Uuid)>, ApiError>,
    body: Result<ApiJson<LeadSubmission>, ApiError>,
) -> Result<StatusCode, ApiError> {
    let now = state.clock.now();
    // Every send counts, malformed ones included (ABU-006).
    state
        .rate_limiter
        .hit(Bucket::LeadSubmission, ip, now)
        .map_err(rate_limited)?;
    let ApiPath((slug, event_id)) = path?;
    let ApiJson(submission) = body?;
    let (card, event) = card_and_event(&state, &slug, event_id).await?;
    if !event.period.accepts_submissions(now) {
        return Err(ApiError::EventClosed);
    }
    if honeypot_filled(submission.fax.as_deref()) {
        // The same answer as an accepted send, and nothing stored (ABU-005).
        tracing::info!("honeypot");
        return Ok(StatusCode::NO_CONTENT);
    }
    if let Some(stored_code) = event.access_code.as_deref() {
        state
            .rate_limiter
            .check(Bucket::FailedAccessCode, ip, now)
            .map_err(rate_limited)?;
        let typed = submission.access_code.as_deref().unwrap_or_default();
        if !access_code_matches(stored_code, typed) {
            state.rate_limiter.record(Bucket::FailedAccessCode, ip, now);
            return Err(ApiError::InvalidAccessCode);
        }
    }
    let shown = ShownForm::new(&event, &card.content);
    check_form_version(&shown.form_version, &submission.form_version)
        .map_err(|FormChanged| ApiError::FormChanged)?;
    let lead = validate_lead(
        &event.form,
        submission.answers,
        submission.consent,
        now.date_naive(),
    )
    .map_err(ApiError::Validation)?;

    let mut tx = state.db.begin().await?;
    leads::lock_device(&mut tx, event.id, submission.device_id).await?;
    let count = leads::count_for_device(&mut tx, event.id, submission.device_id).await?;
    check_device_limit(count, event.device_limit)
        .map_err(|DeviceLimitReached| ApiError::DeviceLimitReached)?;
    let new_lead = NewLead {
        id: Uuid::now_v7(),
        event_id: event.id,
        device_id: submission.device_id,
        submitted_at: now,
        lead: &lead,
        consent_text: &shown.consent_text,
    };
    leads::insert(&mut tx, &new_lead).await.map_err(|error| {
        if leads::is_missing_event(&error) {
            ApiError::NotFound
        } else {
            error.into()
        }
    })?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
