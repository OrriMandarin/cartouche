//! Export of leads: the table the writers (CSV, XLSX, JSON) render (LEA-010 to LEA-012, LEA-023
//! to LEA-026). Pure data in, pure data out.

pub mod csv;
pub mod file_name;
pub mod json;
pub mod labels;
pub mod table;
pub mod xlsx;

use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use serde::Deserialize;
use uuid::Uuid;

use crate::form::{CustomField, StandardFields};
use crate::lead::{AnswerSnapshot, StandardAnswers};

pub use file_name::export_file_name;
pub use table::{Cell, Column, ExportTable, StandardColumn, build_table, parse_zone};

/// An event of the export, with its current form.
#[derive(Debug, Clone)]
pub struct ExportEvent {
    pub id: Uuid,
    pub title: String,
    pub starts_at: DateTime<Utc>,
    pub standard: StandardFields,
    pub custom: Vec<CustomField>,
}

/// A lead of the export, with its answers as recorded at submission.
#[derive(Debug, Clone)]
pub struct ExportLead {
    pub id: Uuid,
    pub event_id: Uuid,
    pub submitted_at: DateTime<Utc>,
    pub standard: StandardAnswers,
    pub custom: Vec<AnswerSnapshot>,
    pub consent_at: DateTime<Utc>,
    pub consent_text: String,
    pub spam: bool,
}

/// Whether the export covers one event or the whole card (LEA-021).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportScope {
    Event,
    Card,
}

/// Everything needed to build an export.
#[derive(Debug, Clone, Copy)]
pub struct ExportRequest<'a> {
    pub scope: ExportScope,
    pub events: &'a [ExportEvent],
    pub leads: &'a [ExportLead],
    pub include_spam: bool,
    pub zone: Tz,
}

/// The leads that end up in the export: spam ones left out unless asked for (LEA-012), oldest
/// submission first (LEA-023).
pub fn exported_leads<'a>(req: &ExportRequest<'a>) -> Vec<&'a ExportLead> {
    let mut leads: Vec<&'a ExportLead> = req
        .leads
        .iter()
        .filter(|lead| req.include_spam || !lead.spam)
        .collect();
    leads.sort_by_key(|lead| (lead.submitted_at, lead.id));
    leads
}

/// The file formats of an export (LEA-006).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub enum ExportFormat {
    Csv,
    Xlsx,
    Json,
}

impl ExportFormat {
    /// The file extension, without the dot.
    pub fn extension(self) -> &'static str {
        match self {
            ExportFormat::Csv => "csv",
            ExportFormat::Xlsx => "xlsx",
            ExportFormat::Json => "json",
        }
    }

    /// The `Content-Type` of the file.
    pub fn content_type(self) -> &'static str {
        match self {
            ExportFormat::Csv => "text/csv; charset=utf-8",
            ExportFormat::Xlsx => {
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            }
            ExportFormat::Json => "application/json",
        }
    }
}

/// What an export knows besides the leads: the card, the event (`None` for the whole card) and
/// the instant of the export.
#[derive(Debug, Clone, Copy)]
pub struct ExportContext<'a> {
    pub card_id: Uuid,
    pub card_slug: &'a str,
    pub event: Option<&'a ExportEvent>,
    pub now: DateTime<Utc>,
}

/// A rendered export, ready to be sent.
#[derive(Debug, Clone)]
pub struct ExportFile {
    pub bytes: Vec<u8>,
    pub content_type: &'static str,
    pub file_name: String,
}

/// An export that could not be written.
#[derive(Debug, thiserror::Error)]
pub enum ExportError {
    #[error("xlsx: {0}")]
    Xlsx(String),
}

/// Renders an export in the requested format. The scope of the request is the one of the context
/// (LEA-021): an event export has an event, a whole-card export has none.
pub fn render(
    req: &ExportRequest,
    ctx: &ExportContext,
    format: ExportFormat,
) -> Result<ExportFile, ExportError> {
    debug_assert_eq!(
        req.scope == ExportScope::Event,
        ctx.event.is_some(),
        "the scope of the request and the event of the context disagree"
    );
    let scope = if ctx.event.is_some() {
        ExportScope::Event
    } else {
        ExportScope::Card
    };
    let req = ExportRequest { scope, ..*req };

    let bytes = match format {
        ExportFormat::Csv => csv::write(&build_table(&req)),
        ExportFormat::Xlsx => xlsx::write(&build_table(&req))?,
        ExportFormat::Json => json::write(&req, ctx),
    };
    let today = ctx.now.with_timezone(&req.zone).date_naive();
    Ok(ExportFile {
        bytes,
        content_type: format.content_type(),
        file_name: export_file_name(
            ctx.card_slug,
            ctx.event.map(|event| event.title.as_str()),
            today,
            format,
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::form::{FieldMode, StandardFields};

    fn event() -> ExportEvent {
        ExportEvent {
            id: Uuid::from_u128(1),
            title: "Salon du Mariage Clermont 2027".to_string(),
            starts_at: "2027-03-01T08:00:00Z".parse().unwrap(),
            standard: StandardFields {
                first_name: FieldMode::Off,
                last_name: FieldMode::Off,
                birth_date: FieldMode::Off,
                email: FieldMode::Off,
                phone: FieldMode::Off,
                address: FieldMode::Off,
            },
            custom: vec![],
        }
    }

    fn request<'a>(scope: ExportScope, events: &'a [ExportEvent]) -> ExportRequest<'a> {
        ExportRequest {
            scope,
            events,
            leads: &[],
            include_spam: false,
            zone: chrono_tz::Europe::Paris,
        }
    }

    fn context<'a>(event: Option<&'a ExportEvent>) -> ExportContext<'a> {
        ExportContext {
            card_id: Uuid::from_u128(9),
            card_slug: "alice-durand",
            event,
            // 23:30 in UTC is already the next day in Paris.
            now: "2027-03-14T23:30:00Z".parse().unwrap(),
        }
    }

    // spec: LEA-006, LEA-007, LEA-008, LEA-009
    #[test]
    fn formats_have_an_extension_and_a_content_type() {
        let expected = [
            (ExportFormat::Csv, "csv", "text/csv; charset=utf-8"),
            (
                ExportFormat::Xlsx,
                "xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ),
            (ExportFormat::Json, "json", "application/json"),
        ];
        for (format, extension, content_type) in expected {
            assert_eq!(format.extension(), extension);
            assert_eq!(format.content_type(), content_type);
        }
    }

    // spec: LEA-006, LEA-021
    #[test]
    fn formats_are_read_in_lowercase() {
        let format: ExportFormat = serde_json::from_str("\"xlsx\"").unwrap();
        assert_eq!(format, ExportFormat::Xlsx);
        assert!(serde_json::from_str::<ExportFormat>("\"XLSX\"").is_err());
    }

    // spec: LEA-006, LEA-021, LEA-022, LEA-026
    #[test]
    fn render_names_the_file_after_the_scope_and_the_day_in_the_zone() {
        let events = [event()];

        let file = render(
            &request(ExportScope::Event, &events),
            &context(Some(&events[0])),
            ExportFormat::Csv,
        )
        .unwrap();
        assert_eq!(
            file.file_name,
            "contacts-alice-durand-salon-du-mariage-clermont-2027-2027-03-15.csv"
        );
        assert_eq!(file.content_type, "text/csv; charset=utf-8");
        assert_eq!(&file.bytes[..3], [0xEF, 0xBB, 0xBF]);

        let file = render(
            &request(ExportScope::Card, &events),
            &context(None),
            ExportFormat::Json,
        )
        .unwrap();
        assert_eq!(file.file_name, "contacts-alice-durand-2027-03-15.json");
        assert_eq!(file.content_type, "application/json");

        let file = render(
            &request(ExportScope::Card, &events),
            &context(None),
            ExportFormat::Xlsx,
        )
        .unwrap();
        assert_eq!(file.file_name, "contacts-alice-durand-2027-03-15.xlsx");
        assert_eq!(&file.bytes[..2], b"PK", "a zip container");
    }

    // spec: LEA-021
    #[test]
    #[cfg(debug_assertions)]
    #[should_panic(expected = "scope")]
    fn render_refuses_a_scope_that_disagrees_with_the_context() {
        let events = [event()];
        let _ = render(
            &request(ExportScope::Card, &events),
            &context(Some(&events[0])),
            ExportFormat::Csv,
        );
    }
}
