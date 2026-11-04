//! The export table: which columns an export has, what each lead's row holds (LEA-010, LEA-011,
//! LEA-023 to LEA-026).

use std::collections::HashMap;

use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
use chrono_tz::Tz;
use serde_json::{Number, Value};
use uuid::Uuid;

use super::{ExportEvent, ExportLead, ExportRequest, ExportScope, exported_leads, labels};
use crate::form::{CustomFieldKind, FieldMode, StandardFields};
use crate::lead::{AnswerSnapshot, StandardAnswers};
use crate::text::fold;

/// The standard fields as columns, in the order of FRM-017 (the address as four columns).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StandardColumn {
    FirstName,
    LastName,
    BirthDate,
    Email,
    Phone,
    Street,
    PostalCode,
    City,
    Country,
}

/// One column of an export.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Column {
    Standard(StandardColumn),
    /// A custom column. `fields` lists the `(event id, field id)` pairs whose answers it holds.
    Custom {
        kind: CustomFieldKind,
        fields: Vec<(Uuid, Uuid)>,
    },
    Event,
    SubmittedAt,
    ConsentAt,
    ConsentText,
    Spam,
}

/// One typed cell. Writers turn it into text (CSV), a typed cell (XLSX) or JSON.
#[derive(Debug, Clone, PartialEq)]
pub enum Cell {
    Empty,
    Text(String),
    /// A phone number in E.164.
    Phone(String),
    Date(NaiveDate),
    /// Already converted to the zone of the export.
    DateTime(NaiveDateTime),
    /// The JSON number as stored with the answer, unchanged.
    Number(Number),
    Bool(bool),
}

/// The columns, their headers and one row per exported lead.
#[derive(Debug, Clone, PartialEq)]
pub struct ExportTable {
    pub columns: Vec<Column>,
    pub headers: Vec<String>,
    pub rows: Vec<Vec<Cell>>,
}

/// The time zone of the request, or Europe/Paris when it is missing or unknown (LEA-026).
pub fn parse_zone(input: Option<&str>) -> Tz {
    input
        .and_then(|name| name.parse::<Tz>().ok())
        .unwrap_or(chrono_tz::Europe::Paris)
}

/// Builds the table of an export.
pub fn build_table(req: &ExportRequest) -> ExportTable {
    let leads = exported_leads(req);

    let mut columns: Vec<Column> = standard_columns(req, &leads)
        .into_iter()
        .map(Column::Standard)
        .collect();
    let mut headers: Vec<String> = columns.iter().map(header_of_standard).collect();

    for planned in plan_custom_columns(req, &leads) {
        headers.push(planned.header);
        columns.push(Column::Custom {
            kind: planned.kind,
            fields: planned.fields,
        });
    }

    for (column, header) in [
        (Column::Event, labels::EVENT.to_string()),
        (
            Column::SubmittedAt,
            labels::time_header(labels::SUBMITTED_AT, req.zone),
        ),
        (
            Column::ConsentAt,
            labels::time_header(labels::CONSENT_AT, req.zone),
        ),
        (Column::ConsentText, labels::CONSENT_TEXT.to_string()),
        (Column::Spam, labels::SPAM.to_string()),
    ] {
        columns.push(column);
        headers.push(header);
    }

    let rows = leads
        .iter()
        .map(|lead| {
            columns
                .iter()
                .map(|column| cell(column, lead, req))
                .collect()
        })
        .collect();

    ExportTable {
        columns,
        headers: suffix_duplicates(headers),
        rows,
    }
}

fn header_of_standard(column: &Column) -> String {
    let Column::Standard(standard) = column else {
        unreachable!("only standard columns are given")
    };
    match standard {
        StandardColumn::FirstName => labels::FIRST_NAME,
        StandardColumn::LastName => labels::LAST_NAME,
        StandardColumn::BirthDate => labels::BIRTH_DATE,
        StandardColumn::Email => labels::EMAIL,
        StandardColumn::Phone => labels::PHONE,
        StandardColumn::Street => labels::STREET,
        StandardColumn::PostalCode => labels::POSTAL_CODE,
        StandardColumn::City => labels::CITY,
        StandardColumn::Country => labels::COUNTRY,
    }
    .to_string()
}

/// The standard columns present in the export: asked by an event or answered by a lead
/// (LEA-023). The four address parts are present together.
fn standard_columns(req: &ExportRequest, leads: &[&ExportLead]) -> Vec<StandardColumn> {
    let asked = |mode: fn(&StandardFields) -> FieldMode| {
        req.events
            .iter()
            .any(|event| mode(&event.standard) != FieldMode::Off)
    };
    let answered =
        |answer: fn(&StandardAnswers) -> bool| leads.iter().any(|lead| answer(&lead.standard));

    let mut columns = Vec::new();
    if asked(|f| f.first_name) || answered(|a| a.first_name.is_some()) {
        columns.push(StandardColumn::FirstName);
    }
    if asked(|f| f.last_name) || answered(|a| a.last_name.is_some()) {
        columns.push(StandardColumn::LastName);
    }
    if asked(|f| f.birth_date) || answered(|a| a.birth_date.is_some()) {
        columns.push(StandardColumn::BirthDate);
    }
    if asked(|f| f.email) || answered(|a| a.email.is_some()) {
        columns.push(StandardColumn::Email);
    }
    if asked(|f| f.phone) || answered(|a| a.phone.is_some()) {
        columns.push(StandardColumn::Phone);
    }
    if asked(|f| f.address)
        || answered(|a| {
            a.street.is_some() || a.postal_code.is_some() || a.city.is_some() || a.country.is_some()
        })
    {
        columns.extend([
            StandardColumn::Street,
            StandardColumn::PostalCode,
            StandardColumn::City,
            StandardColumn::Country,
        ]);
    }
    columns
}

/// A custom column before its header is made unique.
struct PlannedColumn {
    header: String,
    kind: CustomFieldKind,
    fields: Vec<(Uuid, Uuid)>,
}

/// A custom field of one event: its header and type, and its identifier.
struct EventField {
    header: String,
    kind: CustomFieldKind,
    id: Uuid,
}

/// The custom columns (LEA-024): events by start date then identifier, and for each its current
/// fields followed by the deleted ones that still have answers. In a whole-card export, a field
/// joins the first column with the same label (ignoring case and accents) and type that holds no
/// field of its event.
fn plan_custom_columns(req: &ExportRequest, leads: &[&ExportLead]) -> Vec<PlannedColumn> {
    let mut events: Vec<&ExportEvent> = req.events.iter().collect();
    events.sort_by_key(|event| (event.starts_at, event.id));

    let mut planned: Vec<PlannedColumn> = Vec::new();
    for event in events {
        for field in event_fields(event, leads) {
            let joined = if req.scope == ExportScope::Card {
                planned.iter_mut().find(|column| {
                    column.kind == field.kind
                        && fold(&column.header) == fold(&field.header)
                        && column
                            .fields
                            .iter()
                            .all(|(event_id, _)| *event_id != event.id)
                })
            } else {
                None
            };
            match joined {
                Some(column) => column.fields.push((event.id, field.id)),
                None => planned.push(PlannedColumn {
                    header: field.header,
                    kind: field.kind,
                    fields: vec![(event.id, field.id)],
                }),
            }
        }
    }
    planned
}

/// The current fields of an event, then its deleted fields (FRM-023). A deleted field is one
/// answered (non-null) by an exported lead of the event without being a current field; it takes
/// the label and type of its most recent exported answer. `leads` are oldest first.
fn event_fields(event: &ExportEvent, leads: &[&ExportLead]) -> Vec<EventField> {
    let mut fields: Vec<EventField> = event
        .custom
        .iter()
        .map(|field| EventField {
            header: field.label.clone(),
            kind: field.kind,
            id: field.id,
        })
        .collect();

    let snapshots = || {
        leads
            .iter()
            .filter(|lead| lead.event_id == event.id)
            .flat_map(|lead| lead.custom.iter())
            .filter(|snapshot| {
                !event
                    .custom
                    .iter()
                    .any(|field| field.id == snapshot.field_id)
            })
    };
    let mut deleted: Vec<Uuid> = Vec::new();
    for snapshot in snapshots().filter(|snapshot| !snapshot.value.is_null()) {
        if !deleted.contains(&snapshot.field_id) {
            deleted.push(snapshot.field_id);
        }
    }
    for field_id in deleted {
        let latest = snapshots()
            .rfind(|snapshot| snapshot.field_id == field_id)
            .expect("a deleted field has at least one snapshot");
        fields.push(EventField {
            header: latest.label.clone(),
            kind: latest.kind,
            id: field_id,
        });
    }
    fields
}

/// Gives a suffix " (2)", " (3)"... to every header equal to an earlier one (LEA-024).
fn suffix_duplicates(headers: Vec<String>) -> Vec<String> {
    let mut seen: HashMap<String, usize> = HashMap::new();
    headers
        .into_iter()
        .map(|header| {
            let count = seen.entry(header.clone()).or_insert(0);
            *count += 1;
            if *count == 1 {
                header
            } else {
                format!("{header} ({count})")
            }
        })
        .collect()
}

fn cell(column: &Column, lead: &ExportLead, req: &ExportRequest) -> Cell {
    let answers = &lead.standard;
    let text = |value: &Option<String>| value.clone().map_or(Cell::Empty, Cell::Text);
    let local =
        |instant: DateTime<Utc>| Cell::DateTime(instant.with_timezone(&req.zone).naive_local());
    match column {
        Column::Standard(StandardColumn::FirstName) => text(&answers.first_name),
        Column::Standard(StandardColumn::LastName) => text(&answers.last_name),
        Column::Standard(StandardColumn::BirthDate) => {
            answers.birth_date.map_or(Cell::Empty, Cell::Date)
        }
        Column::Standard(StandardColumn::Email) => text(&answers.email),
        Column::Standard(StandardColumn::Phone) => {
            answers.phone.clone().map_or(Cell::Empty, Cell::Phone)
        }
        Column::Standard(StandardColumn::Street) => text(&answers.street),
        Column::Standard(StandardColumn::PostalCode) => text(&answers.postal_code),
        Column::Standard(StandardColumn::City) => text(&answers.city),
        Column::Standard(StandardColumn::Country) => text(&answers.country),
        Column::Custom { fields, .. } => lead
            .custom
            .iter()
            .find(|snapshot| fields.contains(&(lead.event_id, snapshot.field_id)))
            .map_or(Cell::Empty, custom_cell),
        Column::Event => req
            .events
            .iter()
            .find(|event| event.id == lead.event_id)
            .map_or(Cell::Empty, |event| Cell::Text(event.title.clone())),
        Column::SubmittedAt => local(lead.submitted_at),
        Column::ConsentAt => local(lead.consent_at),
        Column::ConsentText => Cell::Text(lead.consent_text.clone()),
        Column::Spam => Cell::Bool(lead.spam),
    }
}

/// A custom answer written according to the type recorded with it (LEA-025). A value that does
/// not fit its recorded type is kept as text rather than lost.
fn custom_cell(snapshot: &AnswerSnapshot) -> Cell {
    match (&snapshot.value, snapshot.kind) {
        (Value::Null, _) => Cell::Empty,
        (Value::Number(number), CustomFieldKind::Number) => Cell::Number(number.clone()),
        (Value::Bool(checked), CustomFieldKind::Checkbox) => Cell::Bool(*checked),
        (Value::String(text), CustomFieldKind::Date) => NaiveDate::parse_from_str(text, "%Y-%m-%d")
            .map_or_else(|_| Cell::Text(text.clone()), Cell::Date),
        (Value::String(text), _) => Cell::Text(text.clone()),
        (other, _) => Cell::Text(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::form::CustomField;

    fn id(n: u128) -> Uuid {
        Uuid::from_u128(n)
    }

    fn at(rfc3339: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(rfc3339)
            .unwrap()
            .with_timezone(&Utc)
    }

    fn naive(text: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S").unwrap()
    }

    fn modes(
        first_name: FieldMode,
        email: FieldMode,
        phone: FieldMode,
        address: FieldMode,
    ) -> StandardFields {
        StandardFields {
            first_name,
            last_name: FieldMode::Off,
            birth_date: FieldMode::Off,
            email,
            phone,
            address,
        }
    }

    fn no_standard() -> StandardFields {
        modes(
            FieldMode::Off,
            FieldMode::Off,
            FieldMode::Off,
            FieldMode::Off,
        )
    }

    fn field(n: u128, label: &str, kind: CustomFieldKind) -> CustomField {
        CustomField {
            id: id(n),
            label: label.to_string(),
            kind,
            required: false,
            help: None,
            options: vec![],
        }
    }

    fn event(
        n: u128,
        title: &str,
        starts_at: &str,
        standard: StandardFields,
        custom: Vec<CustomField>,
    ) -> ExportEvent {
        ExportEvent {
            id: id(n),
            title: title.to_string(),
            starts_at: at(starts_at),
            standard,
            custom,
        }
    }

    fn lead(n: u128, event: u128, submitted_at: &str) -> ExportLead {
        ExportLead {
            id: id(n),
            event_id: id(event),
            submitted_at: at(submitted_at),
            standard: StandardAnswers::default(),
            custom: vec![],
            consent_at: at(submitted_at),
            consent_text: "J’accepte d’être recontacté·e".to_string(),
            spam: false,
        }
    }

    fn snap(field: u128, label: &str, kind: CustomFieldKind, value: Value) -> AnswerSnapshot {
        AnswerSnapshot {
            field_id: id(field),
            label: label.to_string(),
            kind,
            value,
        }
    }

    fn request<'a>(
        scope: ExportScope,
        events: &'a [ExportEvent],
        leads: &'a [ExportLead],
        include_spam: bool,
    ) -> ExportRequest<'a> {
        ExportRequest {
            scope,
            events,
            leads,
            include_spam,
            zone: chrono_tz::Europe::Paris,
        }
    }

    fn position(table: &ExportTable, column: &Column) -> usize {
        table.columns.iter().position(|c| c == column).unwrap()
    }

    // spec: LEA-010, LEA-012, LEA-023
    #[test]
    fn one_row_per_lead_oldest_first_spam_left_out() {
        let events = [event(
            1,
            "Salon Éloïse",
            "2027-03-01T08:00:00Z",
            no_standard(),
            vec![],
        )];
        let mut spam = lead(12, 1, "2027-03-02T10:00:00Z");
        spam.spam = true;
        let leads = [
            lead(13, 1, "2027-03-03T10:00:00Z"),
            spam,
            lead(11, 1, "2027-03-01T10:00:00Z"),
        ];

        let table = build_table(&request(ExportScope::Event, &events, &leads, false));
        let submitted = position(&table, &Column::SubmittedAt);
        assert_eq!(table.rows.len(), 2);
        assert_eq!(
            table.rows[0][submitted],
            Cell::DateTime(naive("2027-03-01 11:00:00"))
        );
        assert_eq!(
            table.rows[1][submitted],
            Cell::DateTime(naive("2027-03-03 11:00:00"))
        );

        let table = build_table(&request(ExportScope::Event, &events, &leads, true));
        let spam_column = position(&table, &Column::Spam);
        assert_eq!(table.rows.len(), 3);
        assert_eq!(table.rows[0][spam_column], Cell::Bool(false));
        assert_eq!(table.rows[1][spam_column], Cell::Bool(true));
        assert_eq!(table.rows[2][spam_column], Cell::Bool(false));
    }

    // spec: LEA-010, LEA-023
    #[test]
    fn leads_submitted_together_are_ordered_by_identifier() {
        let events = [event(
            1,
            "Salon",
            "2027-03-01T08:00:00Z",
            no_standard(),
            vec![],
        )];
        let leads = [
            lead(22, 1, "2027-03-01T10:00:00Z"),
            lead(21, 1, "2027-03-01T10:00:00Z"),
        ];
        let req = request(ExportScope::Event, &events, &leads, false);
        let ids: Vec<Uuid> = crate::export::exported_leads(&req)
            .iter()
            .map(|l| l.id)
            .collect();
        assert_eq!(ids, vec![id(21), id(22)]);
    }

    // spec: LEA-023
    #[test]
    fn standard_columns_are_the_asked_or_answered_ones() {
        let asks_name_and_email = modes(
            FieldMode::Optional,
            FieldMode::Required,
            FieldMode::Off,
            FieldMode::Off,
        );
        let events = [event(
            1,
            "Salon",
            "2027-03-01T08:00:00Z",
            asks_name_and_email,
            vec![],
        )];
        let table = build_table(&request(ExportScope::Event, &events, &[], false));
        assert_eq!(
            table.columns[..2],
            [
                Column::Standard(StandardColumn::FirstName),
                Column::Standard(StandardColumn::Email)
            ]
        );
        assert_eq!(table.headers[..2], ["Prénom", "Email"]);
        assert_eq!(table.columns.len(), 2 + 5);

        // A phone number answered although the event no longer asks for it.
        let mut answered = lead(11, 1, "2027-03-01T10:00:00Z");
        answered.standard.phone = Some("+33612345678".to_string());
        let leads = [answered];
        let table = build_table(&request(ExportScope::Event, &events, &leads, false));
        assert_eq!(table.headers[..3], ["Prénom", "Email", "Téléphone"]);
        let phone = position(&table, &Column::Standard(StandardColumn::Phone));
        assert_eq!(
            table.rows[0][phone],
            Cell::Phone("+33612345678".to_string())
        );

        // The four address columns come together, after the phone.
        let asks_address = modes(
            FieldMode::Off,
            FieldMode::Off,
            FieldMode::Optional,
            FieldMode::Optional,
        );
        let events = [event(
            1,
            "Salon",
            "2027-03-01T08:00:00Z",
            asks_address,
            vec![],
        )];
        let table = build_table(&request(ExportScope::Event, &events, &[], false));
        assert_eq!(
            table.headers[..5],
            ["Téléphone", "Rue", "Code postal", "Ville", "Pays"]
        );

        // One answered part is enough for the whole address group.
        let events = [event(
            1,
            "Salon",
            "2027-03-01T08:00:00Z",
            no_standard(),
            vec![],
        )];
        let mut with_city = lead(11, 1, "2027-03-01T10:00:00Z");
        with_city.standard.city = Some("Saint-Étienne".to_string());
        let leads = [with_city];
        let table = build_table(&request(ExportScope::Event, &events, &leads, false));
        assert_eq!(table.headers[..4], ["Rue", "Code postal", "Ville", "Pays"]);
        let city = position(&table, &Column::Standard(StandardColumn::City));
        assert_eq!(table.rows[0][city], Cell::Text("Saint-Étienne".to_string()));

        // Nothing asked, nothing answered: metadata only.
        let events = [event(
            1,
            "Salon",
            "2027-03-01T08:00:00Z",
            no_standard(),
            vec![],
        )];
        let table = build_table(&request(ExportScope::Event, &events, &[], false));
        assert_eq!(table.columns.len(), 5);

        // The order is the one of FRM-017 whatever the answers.
        let all = StandardFields {
            first_name: FieldMode::Optional,
            last_name: FieldMode::Optional,
            birth_date: FieldMode::Optional,
            email: FieldMode::Optional,
            phone: FieldMode::Optional,
            address: FieldMode::Optional,
        };
        let events = [event(1, "Salon", "2027-03-01T08:00:00Z", all, vec![])];
        let table = build_table(&request(ExportScope::Event, &events, &[], false));
        assert_eq!(
            table.headers[..9],
            [
                "Prénom",
                "Nom",
                "Date de naissance",
                "Email",
                "Téléphone",
                "Rue",
                "Code postal",
                "Ville",
                "Pays"
            ]
        );
    }

    // spec: LEA-011, LEA-023
    #[test]
    fn metadata_columns_close_the_table() {
        let events = [event(
            1,
            "Salon d’Éloïse ✨",
            "2027-03-01T08:00:00Z",
            no_standard(),
            vec![],
        )];
        let mut one = lead(11, 1, "2027-03-01T10:00:00Z");
        one.consent_at = at("2027-03-01T09:59:00Z");
        let leads = [one];
        let table = build_table(&request(ExportScope::Event, &events, &leads, false));
        assert_eq!(
            table.columns,
            vec![
                Column::Event,
                Column::SubmittedAt,
                Column::ConsentAt,
                Column::ConsentText,
                Column::Spam
            ]
        );
        assert_eq!(
            table.rows[0],
            vec![
                Cell::Text("Salon d’Éloïse ✨".to_string()),
                Cell::DateTime(naive("2027-03-01 11:00:00")),
                Cell::DateTime(naive("2027-03-01 10:59:00")),
                Cell::Text("J’accepte d’être recontacté·e".to_string()),
                Cell::Bool(false),
            ]
        );
    }

    // spec: LEA-011, LEA-024, FRM-023
    #[test]
    fn deleted_fields_come_after_current_ones_with_their_last_label() {
        let events = [event(
            1,
            "Salon",
            "2027-03-01T08:00:00Z",
            no_standard(),
            vec![field(100, "Formule", CustomFieldKind::Text)],
        )];
        let mut first = lead(11, 1, "2027-03-01T10:00:00Z");
        first.custom = vec![snap(
            200,
            "Société",
            CustomFieldKind::Text,
            json!("Acme Müller"),
        )];
        let mut second = lead(12, 1, "2027-03-02T10:00:00Z");
        second.custom = vec![
            snap(100, "Formule", CustomFieldKind::Text, json!("Pro")),
            snap(200, "Entreprise", CustomFieldKind::Text, json!("Globex")),
        ];
        let leads = [first, second];

        let table = build_table(&request(ExportScope::Event, &events, &leads, false));
        assert_eq!(table.headers[..2], ["Formule", "Entreprise"]);
        assert_eq!(
            table.columns[1],
            Column::Custom {
                kind: CustomFieldKind::Text,
                fields: vec![(id(1), id(200))]
            }
        );
        assert_eq!(table.rows[0][0], Cell::Empty);
        assert_eq!(table.rows[0][1], Cell::Text("Acme Müller".to_string()));
        assert_eq!(table.rows[1][0], Cell::Text("Pro".to_string()));
        assert_eq!(table.rows[1][1], Cell::Text("Globex".to_string()));
    }

    // spec: LEA-024, FRM-023
    #[test]
    fn deleted_field_never_answered_or_answered_only_by_spam_is_not_a_column() {
        let events = [event(
            1,
            "Salon",
            "2027-03-01T08:00:00Z",
            no_standard(),
            vec![],
        )];
        let mut empty = lead(11, 1, "2027-03-01T10:00:00Z");
        empty.custom = vec![snap(200, "Vide", CustomFieldKind::Text, Value::Null)];
        let mut spam = lead(12, 1, "2027-03-02T10:00:00Z");
        spam.spam = true;
        spam.custom = vec![snap(201, "Promo", CustomFieldKind::Text, json!("buy now"))];
        let leads = [empty, spam];

        let table = build_table(&request(ExportScope::Event, &events, &leads, false));
        assert_eq!(table.columns.len(), 5);

        let table = build_table(&request(ExportScope::Event, &events, &leads, true));
        assert_eq!(table.headers[0], "Promo");
        assert_eq!(table.columns.len(), 6);
    }

    // spec: LEA-024, Review Focus 3
    #[test]
    fn whole_card_merges_same_label_and_type_across_events_only() {
        let asks_email = modes(
            FieldMode::Off,
            FieldMode::Optional,
            FieldMode::Off,
            FieldMode::Off,
        );
        let events = [
            // Listed out of order on purpose: the later event comes first.
            event(
                2,
                "Salon B",
                "2027-04-01T08:00:00Z",
                asks_email,
                vec![
                    field(21, "entreprise", CustomFieldKind::Text),
                    field(22, "Entreprise", CustomFieldKind::LongText),
                    field(23, "Email", CustomFieldKind::Text),
                ],
            ),
            event(
                1,
                "Salon A",
                "2027-03-01T08:00:00Z",
                asks_email,
                vec![field(11, "Entreprise", CustomFieldKind::Text)],
            ),
        ];
        let mut lead_a = lead(101, 1, "2027-03-01T10:00:00Z");
        lead_a.custom = vec![
            snap(11, "Entreprise", CustomFieldKind::Text, json!("Acme")),
            snap(12, "Ancien champ", CustomFieldKind::Text, json!("vieux")),
        ];
        let mut lead_b = lead(102, 2, "2027-04-01T10:00:00Z");
        lead_b.custom = vec![
            snap(21, "entreprise", CustomFieldKind::Text, json!("Globex")),
            snap(
                22,
                "Entreprise",
                CustomFieldKind::LongText,
                json!("Une longue note"),
            ),
        ];
        let leads = [lead_b, lead_a];

        let table = build_table(&request(ExportScope::Card, &events, &leads, false));
        assert_eq!(
            table.headers[..5],
            [
                "Email",
                "Entreprise",
                "Ancien champ",
                "Entreprise (2)",
                "Email (2)"
            ]
        );
        assert_eq!(
            table.columns[1],
            Column::Custom {
                kind: CustomFieldKind::Text,
                fields: vec![(id(1), id(11)), (id(2), id(21))]
            }
        );
        // Rows are oldest first: the lead of A, then the lead of B in the merged column.
        assert_eq!(table.rows[0][1], Cell::Text("Acme".to_string()));
        assert_eq!(table.rows[1][1], Cell::Text("Globex".to_string()));
        assert_eq!(table.rows[1][3], Cell::Text("Une longue note".to_string()));
        assert_eq!(table.rows[0][3], Cell::Empty);

        // The same event alone: nothing to merge with.
        let events_b = [events[0].clone()];
        let leads_b = [leads[0].clone()];
        let table = build_table(&request(ExportScope::Event, &events_b, &leads_b, false));
        assert_eq!(
            table.headers[..4],
            ["Email", "entreprise", "Entreprise", "Email (2)"]
        );
    }

    // spec: LEA-024
    #[test]
    fn two_fields_of_one_event_never_share_a_column() {
        let events = [event(
            1,
            "Salon",
            "2027-03-01T08:00:00Z",
            no_standard(),
            vec![
                field(11, "Note", CustomFieldKind::Text),
                field(12, "Note", CustomFieldKind::Text),
            ],
        )];
        for scope in [ExportScope::Event, ExportScope::Card] {
            let table = build_table(&request(scope, &events, &[], false));
            assert_eq!(table.headers[..2], ["Note", "Note (2)"]);
        }
    }

    // spec: LEA-024
    #[test]
    fn a_header_equal_to_a_standard_or_metadata_header_gets_a_suffix() {
        let events = [event(
            1,
            "Salon",
            "2027-03-01T08:00:00Z",
            no_standard(),
            vec![
                field(11, "Spam", CustomFieldKind::Text),
                field(12, "Spam", CustomFieldKind::Checkbox),
            ],
        )];
        let table = build_table(&request(ExportScope::Card, &events, &[], false));
        assert_eq!(table.headers[0], "Spam");
        assert_eq!(table.headers[1], "Spam (2)");
        assert_eq!(table.headers[6], "Spam (3)");
    }

    // spec: LEA-025, FRM-022
    #[test]
    fn cells_follow_the_type_recorded_with_the_answer() {
        let events = [event(
            1,
            "Salon",
            "2027-03-01T08:00:00Z",
            no_standard(),
            vec![
                field(11, "Budget", CustomFieldKind::Text),
                field(12, "Accord", CustomFieldKind::Checkbox),
                field(13, "Arrivée", CustomFieldKind::Date),
                field(14, "Note", CustomFieldKind::Number),
            ],
        )];
        let mut old = lead(101, 1, "2027-03-01T10:00:00Z");
        old.custom = vec![
            snap(11, "Budget", CustomFieldKind::Number, json!(120)),
            snap(12, "Accord", CustomFieldKind::Checkbox, json!(false)),
            snap(13, "Arrivée", CustomFieldKind::Date, json!("2027-03-15")),
            snap(14, "Note", CustomFieldKind::Number, json!(12.5)),
        ];
        let mut new = lead(102, 1, "2027-03-02T10:00:00Z");
        new.custom = vec![
            snap(11, "Budget", CustomFieldKind::Text, json!("cent vingt")),
            snap(12, "Accord", CustomFieldKind::Checkbox, json!(true)),
            snap(13, "Arrivée", CustomFieldKind::Date, json!("bientôt")),
            snap(14, "Note", CustomFieldKind::Number, Value::Null),
        ];
        // Submitted before the form had any of these fields.
        let older = lead(100, 1, "2027-02-28T10:00:00Z");
        let leads = [new, old, older];

        let table = build_table(&request(ExportScope::Event, &events, &leads, false));
        assert_eq!(table.headers[..4], ["Budget", "Accord", "Arrivée", "Note"]);
        assert_eq!(
            table.rows[0][..4],
            [Cell::Empty, Cell::Empty, Cell::Empty, Cell::Empty]
        );
        assert_eq!(
            table.rows[1][..4],
            [
                Cell::Number(Number::from(120)),
                Cell::Bool(false),
                Cell::Date(NaiveDate::from_ymd_opt(2027, 3, 15).unwrap()),
                Cell::Number(json!(12.5).as_number().unwrap().clone()),
            ]
        );
        assert_eq!(
            table.rows[2][..4],
            [
                Cell::Text("cent vingt".to_string()),
                Cell::Bool(true),
                Cell::Text("bientôt".to_string()),
                Cell::Empty,
            ]
        );
        let Cell::Number(number) = &table.rows[1][3] else {
            panic!("expected a number")
        };
        assert_eq!(number.to_string(), "12.5");
    }

    // spec: LEA-025
    #[test]
    fn standard_cells_are_typed() {
        let events = [event(
            1,
            "Salon",
            "2027-03-01T08:00:00Z",
            StandardFields {
                first_name: FieldMode::Optional,
                last_name: FieldMode::Off,
                birth_date: FieldMode::Optional,
                email: FieldMode::Optional,
                phone: FieldMode::Optional,
                address: FieldMode::Off,
            },
            vec![],
        )];
        let mut one = lead(11, 1, "2027-03-01T10:00:00Z");
        one.standard.first_name = Some("Zoé".to_string());
        one.standard.birth_date = NaiveDate::from_ymd_opt(1990, 5, 17);
        one.standard.phone = Some("+33612345678".to_string());
        let leads = [one];

        let table = build_table(&request(ExportScope::Event, &events, &leads, false));
        assert_eq!(
            table.rows[0][..4],
            [
                Cell::Text("Zoé".to_string()),
                Cell::Date(NaiveDate::from_ymd_opt(1990, 5, 17).unwrap()),
                Cell::Empty,
                Cell::Phone("+33612345678".to_string()),
            ]
        );
    }

    // spec: LEA-026, Review Focus 8
    #[test]
    fn times_are_in_the_requested_zone() {
        let events = [event(
            1,
            "Salon",
            "2027-03-01T08:00:00Z",
            no_standard(),
            vec![],
        )];
        let leads = [
            lead(11, 1, "2027-03-28T00:59:59Z"),
            lead(12, 1, "2027-03-28T01:00:00Z"),
        ];

        let table = build_table(&request(ExportScope::Event, &events, &leads, false));
        let submitted = position(&table, &Column::SubmittedAt);
        let consent = position(&table, &Column::ConsentAt);
        assert_eq!(table.headers[submitted], "Date d'envoi (Europe/Paris)");
        assert_eq!(
            table.headers[consent],
            "Date du consentement (Europe/Paris)"
        );
        assert_eq!(
            table.rows[0][submitted],
            Cell::DateTime(naive("2027-03-28 01:59:59"))
        );
        assert_eq!(
            table.rows[1][submitted],
            Cell::DateTime(naive("2027-03-28 03:00:00"))
        );
        assert_eq!(
            table.rows[1][consent],
            Cell::DateTime(naive("2027-03-28 03:00:00"))
        );

        let mut req = request(ExportScope::Event, &events, &leads, false);
        req.zone = chrono_tz::America::New_York;
        let table = build_table(&req);
        assert_eq!(table.headers[submitted], "Date d'envoi (America/New_York)");
        assert_eq!(
            table.rows[0][submitted],
            Cell::DateTime(naive("2027-03-27 20:59:59"))
        );
        assert_eq!(
            table.rows[1][submitted],
            Cell::DateTime(naive("2027-03-27 21:00:00"))
        );
    }

    // spec: LEA-026
    #[test]
    fn unknown_zone_falls_back_to_paris() {
        assert_eq!(parse_zone(Some("Mars/Olympus")), chrono_tz::Europe::Paris);
        assert_eq!(parse_zone(Some("")), chrono_tz::Europe::Paris);
        assert_eq!(parse_zone(None), chrono_tz::Europe::Paris);
        assert_eq!(parse_zone(Some("Asia/Tokyo")), chrono_tz::Asia::Tokyo);
    }

    // spec: LEA-031
    #[test]
    fn no_lead_still_gives_the_headers() {
        let asks_email = modes(
            FieldMode::Off,
            FieldMode::Optional,
            FieldMode::Off,
            FieldMode::Off,
        );
        let events = [event(
            1,
            "Salon",
            "2027-03-01T08:00:00Z",
            asks_email,
            vec![],
        )];
        let table = build_table(&request(ExportScope::Event, &events, &[], false));
        assert_eq!(
            table.headers,
            [
                "Email",
                "Événement",
                "Date d'envoi (Europe/Paris)",
                "Date du consentement (Europe/Paris)",
                "Texte du consentement",
                "Spam"
            ]
        );
        assert!(table.rows.is_empty());

        // Only spam leads, left out: still the headers.
        let mut spam = lead(11, 1, "2027-03-01T10:00:00Z");
        spam.spam = true;
        let leads = [spam];
        let table = build_table(&request(ExportScope::Event, &events, &leads, false));
        assert_eq!(table.headers.len(), 6);
        assert!(table.rows.is_empty());
    }
}
