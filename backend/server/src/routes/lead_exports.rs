//! Owner routes that download the contacts of an event or of a whole card as a CSV, XLSX or
//! JSON file (LEA-006, LEA-012, LEA-021, LEA-026, LEA-032, LNK-008, ACC-017).
//!
//! Nothing about the contacts is logged: a failure names the card only.

use axum::extract::State;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use cartouche_domain::export::{
    ExportContext, ExportEvent, ExportFormat, ExportLead, ExportRequest, ExportScope, parse_zone,
    render,
};
use serde::Deserialize;
use utoipa::openapi::RefOr;
use utoipa::openapi::schema::{KnownFormat, ObjectBuilder, Schema, SchemaFormat, Type};
use utoipa::{IntoParams, PartialSchema, ToSchema};
use uuid::Uuid;

use crate::auth::ApprovedUser;
use crate::db::cards::{self, Card};
use crate::db::{events, leads};
use crate::error::{ApiError, ErrorBody};
use crate::extract::{ApiPath, ApiQuery};
use crate::state::AppState;

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ExportQuery {
    /// The file format: `csv`, `xlsx` or `json`.
    pub format: ExportFormat,
    /// Keep the contacts marked as spam, flagged in their own column (default: leave them out).
    #[serde(default)]
    pub include_spam: bool,
    /// IANA time zone of the dates and of the day in the file name, e.g. `Europe/Paris`; an
    /// unknown or missing zone means `Europe/Paris`.
    pub tz: Option<String>,
}

/// The bytes of an export file, whatever its format.
pub struct ExportFileBody;

impl PartialSchema for ExportFileBody {
    fn schema() -> RefOr<Schema> {
        ObjectBuilder::new()
            .schema_type(Type::String)
            .format(Some(SchemaFormat::KnownFormat(KnownFormat::Binary)))
            .into()
    }
}

impl ToSchema for ExportFileBody {}

/// Renders the export and wraps it as an attachment.
fn file_response(
    state: &AppState,
    query: &ExportQuery,
    card: &Card,
    event: Option<&ExportEvent>,
    events: &[ExportEvent],
    exported_leads: &[ExportLead],
) -> Result<Response, ApiError> {
    let request = ExportRequest {
        scope: if event.is_some() {
            ExportScope::Event
        } else {
            ExportScope::Card
        },
        events,
        leads: exported_leads,
        include_spam: query.include_spam,
        zone: parse_zone(query.tz.as_deref()),
    };
    let context = ExportContext {
        card_id: card.id,
        card_slug: &card.slug,
        event,
        now: state.clock.now(),
    };
    // The error text can quote a cell of the file, so it is not kept.
    let file = render(&request, &context, query.format).map_err(|_| {
        ApiError::Internal(format!(
            "lead export of card {} could not be written",
            card.id
        ))
    })?;
    let disposition =
        HeaderValue::from_str(&format!("attachment; filename=\"{}\"", file.file_name)).map_err(
            |_| {
                ApiError::Internal(format!(
                    "lead export of card {} has an invalid file name",
                    card.id
                ))
            },
        )?;
    Ok((
        StatusCode::OK,
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static(file.content_type),
            ),
            (header::CONTENT_DISPOSITION, disposition),
            (header::CACHE_CONTROL, HeaderValue::from_static("no-store")),
        ],
        file.bytes,
    )
        .into_response())
}

/// Downloads the contacts of one of the caller's events (LEA-006, LEA-021).
#[utoipa::path(
    get,
    path = "/api/events/{id}/leads/export",
    summary = "Export the contacts of an event",
    description = "A file with the event's contacts, oldest first, named `contacts-<card slug>-<event slug>-<date>.<extension>`. Contacts marked as spam are left out unless `include_spam` is true. The form's current fields come first, then the fields of earlier versions of the form that contacts answered. Contacts of an event of a disabled card are exported too.",
    tag = "leads",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the event."), ExportQuery),
    responses(
        (status = 200, description = "The file, as an attachment.", content(
            (ExportFileBody = "text/csv"),
            (ExportFileBody = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            (ExportFileBody = "application/json"),
        )),
        (status = 400, description = "Malformed id, unknown format or malformed parameter (`invalid_request`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller's account is not approved (`account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such event for the caller (`not_found`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn export_event_leads(
    ApprovedUser(me): ApprovedUser,
    State(state): State<AppState>,
    ApiPath(event_id): ApiPath<Uuid>,
    ApiQuery(query): ApiQuery<ExportQuery>,
) -> Result<Response, ApiError> {
    let found = events::find_for_owner(&state.db, me.user.id, event_id)
        .await?
        .ok_or(ApiError::NotFound)?
        .event;
    let card = cards::find_for_owner(&state.db, me.user.id, found.card_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let listed = leads::list_for_event(&state.db, me.user.id, event_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let event = ExportEvent::from(found);
    let exported: Vec<ExportLead> = listed.into_iter().map(ExportLead::from).collect();
    file_response(
        &state,
        &query,
        &card,
        Some(&event),
        std::slice::from_ref(&event),
        &exported,
    )
}

/// Downloads the contacts of every event of one of the caller's cards (LEA-006, LEA-021).
#[utoipa::path(
    get,
    path = "/api/cards/{id}/leads/export",
    summary = "Export the contacts of a card",
    description = "A file with the contacts of every event of the card, oldest first, each with its event, named `contacts-<card slug>-<date>.<extension>`. Contacts marked as spam are left out unless `include_spam` is true. Contacts of a disabled card are exported too.",
    tag = "leads",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Id of the card."), ExportQuery),
    responses(
        (status = 200, description = "The file, as an attachment.", content(
            (ExportFileBody = "text/csv"),
            (ExportFileBody = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            (ExportFileBody = "application/json"),
        )),
        (status = 400, description = "Malformed id, unknown format or malformed parameter (`invalid_request`).", body = ErrorBody),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller's account is not approved (`account_pending`, `account_rejected`, `account_suspended`, `signup_closed`).", body = ErrorBody),
        (status = 404, description = "No such card for the caller (`not_found`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn export_card_leads(
    ApprovedUser(me): ApprovedUser,
    State(state): State<AppState>,
    ApiPath(card_id): ApiPath<Uuid>,
    ApiQuery(query): ApiQuery<ExportQuery>,
) -> Result<Response, ApiError> {
    let card = cards::find_for_owner(&state.db, me.user.id, card_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let listed_events = events::list_for_card(&state.db, me.user.id, card_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let listed = leads::list_for_card(&state.db, me.user.id, card_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let export_events: Vec<ExportEvent> = listed_events
        .into_iter()
        .map(|counted| ExportEvent::from(counted.event))
        .collect();
    let exported: Vec<ExportLead> = listed.into_iter().map(ExportLead::from).collect();
    file_response(&state, &query, &card, None, &export_events, &exported)
}
