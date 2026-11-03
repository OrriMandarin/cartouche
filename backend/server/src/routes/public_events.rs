//! Public routes for an event's form: read it (or learn that a code or an open window is
//! needed) and unlock it with the access code (EVT-008, EVT-011, EVT-012, EVT-026, EVT-027,
//! FRM-002, FRM-003, FRM-024, ABU-007). The access code never leaves the server: before a
//! correct code, only the id and title of the event go out.

use axum::Json;
use axum::extract::State;
use cartouche_domain::{PublicFormState, UnlockOutcome, public_form_state, unlock_outcome};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::client_ip::ClientIp;
use crate::db::cards::Card;
use crate::db::events::{self, Event};
use crate::error::{ApiError, ErrorBody};
use crate::extract::{ApiJson, ApiPath};
use crate::rate_limit::{Bucket, RetryAfter};
use crate::routes::public_cards::serve_card;
use crate::state::AppState;
use crate::views::{PublicEventForm, PublicEventHeading};

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

#[derive(Debug, Deserialize, ToSchema)]
pub struct UnlockBody {
    /// The code as typed: case, surrounding spaces and accents do not matter.
    pub access_code: String,
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
        .map_err(|RetryAfter(retry_after_secs)| ApiError::RateLimited { retry_after_secs })?;
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
