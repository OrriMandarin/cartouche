//! Support routes on events and leads, read-only: the events of a card, and the leads of an
//! event or of a whole card (ADM-007, ADM-008, ADM-016, ADM-018, ADM-019). There is
//! deliberately no route that marks, deletes or exports leads (ADM-012, ADM-018).
//!
//! Listing leads is audited before anything is sent: the entry and the read share one
//! transaction, and the response is built only once it is committed, so a failed audit
//! write sends no lead (ADM-019).

use axum::Json;
use axum::extract::State;
use serde::Serialize;
use serde_json::json;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::AdminUser;
use crate::db::admin_cards;
use crate::db::admin_leads::{self, LeadScope};
use crate::db::audit::{self, AuditEntry};
use crate::error::{ApiError, ErrorBody};
use crate::extract::ApiPath;
use crate::routes::leads::LeadList;
use crate::state::AppState;
use crate::views::{EventView, LeadView};

/// The events of a card, as support sees them.
#[derive(Debug, Serialize, ToSchema)]
pub struct AdminEventList {
    /// The card's events, by start (EVT-009).
    pub events: Vec<EventView>,
}

/// Lists the events of any card, read-only. Not audited (ADM-016).
#[utoipa::path(
    get,
    path = "/api/admin/cards/{id}/events",
    operation_id = "support_list_card_events",
    summary = "List the events of a card as support",
    description = "The events of any card by start, each with its state and its number of contacts, even if the card is disabled. Read-only and not audited: the contacts themselves are (see the contact lists).",
    tag = "admin",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the card.")),
    responses(
        (status = 200, description = "The card's events.", body = AdminEventList),
        (status = 400, description = "Malformed id (`invalid_request`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller is not an approved administrator (`forbidden`, `account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such card (`not_found`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn list_card_events(
    _admin: AdminUser,
    State(state): State<AppState>,
    ApiPath(card_id): ApiPath<Uuid>,
) -> Result<Json<AdminEventList>, ApiError> {
    let listed = admin_leads::list_events_of_card(&mut *state.db.acquire().await?, card_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let card = admin_cards::find(&state.db, card_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let now = state.clock.now();
    let events = listed
        .into_iter()
        .map(|counted| EventView::new(counted, &card.content, now))
        .collect();
    Ok(Json(AdminEventList { events }))
}

/// What a lead list is a list of, for the audit entry.
#[derive(Clone, Copy)]
enum Target {
    Event,
    Card,
}

impl Target {
    fn name(self) -> &'static str {
        match self {
            Target::Event => "event",
            Target::Card => "card",
        }
    }
}

/// Reads the leads of `id` and records the view in the audit log, atomically, then answers.
/// Any early return drops the transaction: no entry stays and no lead is sent (ADM-019).
async fn audited_leads(
    state: &AppState,
    admin: &AdminUser,
    target: Target,
    id: Uuid,
) -> Result<Json<LeadList>, ApiError> {
    let mut tx = state.db.begin().await?;
    let scope = match target {
        Target::Event => admin_leads::list_for_event(&mut tx, id).await?,
        Target::Card => admin_leads::list_for_card(&mut tx, id).await?,
    };
    let LeadScope {
        card_id,
        owner_id,
        leads,
    } = scope.ok_or(ApiError::NotFound)?;
    audit::record(
        &mut tx,
        AuditEntry {
            actor_user_id: admin.0.user.id,
            action: "leads.viewed",
            target_type: target.name(),
            target_id: id,
            // Identifiers and a count only: no prospect data in the audit log (ADM-020).
            metadata: json!({
                "owner_id": owner_id,
                "card_id": card_id,
                "lead_count": leads.len(),
            }),
        },
    )
    .await?;
    tx.commit().await?;
    Ok(Json(LeadList {
        leads: leads.into_iter().map(LeadView::from).collect(),
    }))
}

/// Lists the contacts of any event, read-only and audited (ADM-007, ADM-008, ADM-019).
#[utoipa::path(
    get,
    path = "/api/admin/events/{id}/leads",
    operation_id = "support_list_event_leads",
    summary = "List the contacts of an event as support",
    description = "The contacts collected by any event, from the most recent to the oldest, spam ones included and flagged. Read-only. Each request records an entry in the audit log before the contacts are sent; if the entry cannot be recorded, no contact is sent.",
    tag = "admin",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the event.")),
    responses(
        (status = 200, description = "The event's contacts.", body = LeadList),
        (status = 400, description = "Malformed id (`invalid_request`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller is not an approved administrator (`forbidden`, `account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such event (`not_found`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure, including a failed audit write (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn list_event_leads(
    admin: AdminUser,
    State(state): State<AppState>,
    ApiPath(event_id): ApiPath<Uuid>,
) -> Result<Json<LeadList>, ApiError> {
    audited_leads(&state, &admin, Target::Event, event_id).await
}

/// Lists the contacts of every event of any card, read-only and audited (ADM-007, ADM-019).
#[utoipa::path(
    get,
    path = "/api/admin/cards/{id}/leads",
    operation_id = "support_list_card_leads",
    summary = "List the contacts of a card as support",
    description = "The contacts collected by every event of any card, from the most recent to the oldest, spam ones included and flagged, each with the title of its event. Read-only. Each request records an entry in the audit log before the contacts are sent; if the entry cannot be recorded, no contact is sent.",
    tag = "admin",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the card.")),
    responses(
        (status = 200, description = "The card's contacts.", body = LeadList),
        (status = 400, description = "Malformed id (`invalid_request`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller is not an approved administrator (`forbidden`, `account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such card (`not_found`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure, including a failed audit write (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn list_card_leads(
    admin: AdminUser,
    State(state): State<AppState>,
    ApiPath(card_id): ApiPath<Uuid>,
) -> Result<Json<LeadList>, ApiError> {
    audited_leads(&state, &admin, Target::Card, card_id).await
}
