//! Owner routes for the contacts collected by the events: list (per event or per card), mark
//! or unmark as spam, delete (EDI-020, LEA-013, ABU-003, ABU-004, ABU-009, ABU-010, ACC-017).

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::ApprovedUser;
use crate::db::leads;
use crate::error::{ApiError, ErrorBody};
use crate::extract::{ApiJson, ApiPath};
use crate::state::AppState;
use crate::views::LeadView;

#[derive(Debug, Serialize, ToSchema)]
pub struct LeadList {
    /// The contacts, newest first, spam ones included (EDI-020, LEA-013).
    pub leads: Vec<LeadView>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SpamBody {
    /// `true` marks the contact as spam, `false` removes the mark.
    pub spam: bool,
}

/// Lists the contacts of all the events of one of the caller's cards (LEA-013, LEA-014).
#[utoipa::path(
    get,
    path = "/api/cards/{id}/leads",
    summary = "List the contacts of a card",
    description = "The contacts collected by every event of the card, from the most recent to the oldest, spam ones included and flagged, each with the title of its event. Contacts of a disabled card are listed too.",
    tag = "leads",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the card.")),
    responses(
        (status = 200, description = "The card's contacts.", body = LeadList),
        (status = 400, description = "Malformed id (`invalid_request`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller's account is not approved (`account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such card for the caller (`not_found`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn list_card_leads(
    ApprovedUser(me): ApprovedUser,
    State(state): State<AppState>,
    ApiPath(card_id): ApiPath<Uuid>,
) -> Result<Json<LeadList>, ApiError> {
    let listed = leads::list_for_card(&state.db, me.user.id, card_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    Ok(Json(LeadList {
        leads: listed.into_iter().map(LeadView::from).collect(),
    }))
}

/// Lists the contacts of one of the caller's events.
#[utoipa::path(
    get,
    path = "/api/events/{id}/leads",
    summary = "List the contacts of an event",
    description = "The contacts collected by the event, from the most recent to the oldest, spam ones included and flagged. Contacts of an event of a disabled card are listed too.",
    tag = "leads",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the event.")),
    responses(
        (status = 200, description = "The event's contacts.", body = LeadList),
        (status = 400, description = "Malformed id (`invalid_request`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller's account is not approved (`account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such event for the caller (`not_found`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn list_event_leads(
    ApprovedUser(me): ApprovedUser,
    State(state): State<AppState>,
    ApiPath(event_id): ApiPath<Uuid>,
) -> Result<Json<LeadList>, ApiError> {
    let listed = leads::list_for_event(&state.db, me.user.id, event_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    Ok(Json(LeadList {
        leads: listed.into_iter().map(LeadView::from).collect(),
    }))
}

/// Marks or unmarks one of the caller's contacts as spam (ABU-003, ABU-009).
#[utoipa::path(
    put,
    path = "/api/leads/{id}/spam",
    summary = "Mark or unmark a contact as spam",
    description = "Sets whether the contact is spam. Repeating the same value is accepted. A spam contact stays in the event's list.",
    tag = "leads",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the contact.")),
    request_body = SpamBody,
    responses(
        (status = 200, description = "The contact, with its new mark.", body = LeadView),
        (status = 400, description = "Malformed id or body (`invalid_request`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller's account is not approved (`account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such contact for the caller (`not_found`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn set_lead_spam(
    ApprovedUser(me): ApprovedUser,
    State(state): State<AppState>,
    ApiPath(lead_id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<SpamBody>,
) -> Result<Json<LeadView>, ApiError> {
    let marked_at = body.spam.then(|| state.clock.now());
    let lead = leads::set_spam(&state.db, me.user.id, lead_id, marked_at)
        .await?
        .ok_or(ApiError::NotFound)?;
    Ok(Json(lead.into()))
}

/// Deletes one of the caller's contacts for good (ABU-004, ABU-010).
#[utoipa::path(
    delete,
    path = "/api/leads/{id}",
    summary = "Delete a contact",
    description = "Deletes the contact for good.",
    tag = "leads",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the contact.")),
    responses(
        (status = 204, description = "The contact is deleted."),
        (status = 400, description = "Malformed id (`invalid_request`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller's account is not approved (`account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such contact for the caller (`not_found`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn delete_lead(
    ApprovedUser(me): ApprovedUser,
    State(state): State<AppState>,
    ApiPath(lead_id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiError> {
    if leads::delete_for_owner(&state.db, me.user.id, lead_id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::NotFound)
    }
}
