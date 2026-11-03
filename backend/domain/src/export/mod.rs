//! Export of leads: the table the writers (CSV, XLSX, JSON) render (LEA-010 to LEA-012, LEA-023
//! to LEA-026). Pure data in, pure data out.

pub mod labels;
pub mod table;

use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use uuid::Uuid;

use crate::form::{CustomField, StandardFields};
use crate::lead::{AnswerSnapshot, StandardAnswers};

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
