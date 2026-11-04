//! The JSON writer (LEA-009, LEA-030).

use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
use serde::Serialize;
use uuid::Uuid;

use super::{ExportContext, ExportEvent, ExportLead, ExportRequest, exported_leads};
use crate::lead::{AnswerSnapshot, StandardAnswers};

#[derive(Serialize)]
struct Document<'a> {
    exported_at: String,
    card: CardRef<'a>,
    event: Option<EventRef<'a>>,
    include_spam: bool,
    leads: Vec<LeadEntry<'a>>,
}

#[derive(Serialize)]
struct CardRef<'a> {
    id: Uuid,
    slug: &'a str,
}

#[derive(Serialize)]
struct EventRef<'a> {
    id: Uuid,
    title: &'a str,
}

#[derive(Serialize)]
struct LeadEntry<'a> {
    id: Uuid,
    event: EventRef<'a>,
    submitted_at: String,
    consent_at: String,
    consent_text: &'a str,
    spam: bool,
    standard: Standard<'a>,
    custom: &'a [AnswerSnapshot],
}

/// The nine standard fields, always all present (`null` when unanswered).
#[derive(Serialize)]
struct Standard<'a> {
    first_name: Option<&'a str>,
    last_name: Option<&'a str>,
    birth_date: Option<NaiveDate>,
    email: Option<&'a str>,
    phone: Option<&'a str>,
    street: Option<&'a str>,
    postal_code: Option<&'a str>,
    city: Option<&'a str>,
    country: Option<&'a str>,
}

impl<'a> From<&'a StandardAnswers> for Standard<'a> {
    fn from(answers: &'a StandardAnswers) -> Self {
        Standard {
            first_name: answers.first_name.as_deref(),
            last_name: answers.last_name.as_deref(),
            birth_date: answers.birth_date,
            email: answers.email.as_deref(),
            phone: answers.phone.as_deref(),
            street: answers.street.as_deref(),
            postal_code: answers.postal_code.as_deref(),
            city: answers.city.as_deref(),
            country: answers.country.as_deref(),
        }
    }
}

/// An instant in UTC, as in the API (LEA-026).
fn instant(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Secs, true)
}

/// A lead of the document; its event is looked up among the events of the export.
fn entry<'a>(lead: &'a ExportLead, events: &'a [ExportEvent]) -> LeadEntry<'a> {
    LeadEntry {
        id: lead.id,
        event: EventRef {
            id: lead.event_id,
            title: events
                .iter()
                .find(|event| event.id == lead.event_id)
                .map_or("", |event| event.title.as_str()),
        },
        submitted_at: instant(lead.submitted_at),
        consent_at: instant(lead.consent_at),
        consent_text: &lead.consent_text,
        spam: lead.spam,
        standard: Standard::from(&lead.standard),
        custom: &lead.custom,
    }
}

/// Writes the export as pretty-printed JSON, UTF-8 without BOM (LEA-030).
pub fn write(req: &ExportRequest, ctx: &ExportContext) -> Vec<u8> {
    let document = Document {
        exported_at: instant(ctx.now),
        card: CardRef {
            id: ctx.card_id,
            slug: ctx.card_slug,
        },
        event: ctx.event.map(|event| EventRef {
            id: event.id,
            title: &event.title,
        }),
        include_spam: req.include_spam,
        leads: exported_leads(req)
            .into_iter()
            .map(|lead| entry(lead, req.events))
            .collect(),
    };
    serde_json::to_vec_pretty(&document).expect("an export document is serializable")
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;
    use crate::export::ExportScope;
    use crate::form::{CustomFieldKind, FieldMode, StandardFields};

    fn id(n: u128) -> Uuid {
        Uuid::from_u128(n)
    }

    fn at(rfc3339: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(rfc3339)
            .unwrap()
            .with_timezone(&Utc)
    }

    fn event() -> ExportEvent {
        ExportEvent {
            id: id(1),
            title: "Salon d’été ✨".to_string(),
            starts_at: at("2027-03-01T08:00:00Z"),
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

    fn snapshot(n: u128, label: &str, kind: CustomFieldKind, value: Value) -> AnswerSnapshot {
        AnswerSnapshot {
            field_id: id(n),
            label: label.to_string(),
            kind,
            value,
        }
    }

    fn lead(n: u128, submitted_at: &str, spam: bool) -> ExportLead {
        ExportLead {
            id: id(n),
            event_id: id(1),
            submitted_at: at(submitted_at),
            standard: StandardAnswers::default(),
            custom: vec![],
            consent_at: at(submitted_at),
            consent_text: "J’accepte d’être recontacté·e".to_string(),
            spam,
        }
    }

    fn written(
        scope: ExportScope,
        events: &[ExportEvent],
        leads: &[ExportLead],
        include_spam: bool,
    ) -> Vec<u8> {
        let req = ExportRequest {
            scope,
            events,
            leads,
            include_spam,
            zone: chrono_tz::Europe::Paris,
        };
        let ctx = ExportContext {
            card_id: id(9),
            card_slug: "alice-durand",
            event: (scope == ExportScope::Event).then(|| &events[0]),
            now: at("2027-03-15T10:00:00Z"),
        };
        write(&req, &ctx)
    }

    fn rendered(
        scope: ExportScope,
        events: &[ExportEvent],
        leads: &[ExportLead],
        include_spam: bool,
    ) -> Value {
        let bytes = written(scope, events, leads, include_spam);
        assert_ne!(&bytes[..3], [0xEF, 0xBB, 0xBF], "no BOM");
        serde_json::from_slice(&bytes).unwrap()
    }

    // spec: LEA-009, LEA-030
    #[test]
    fn json_keeps_types_and_utc_instants() {
        let events = [event()];
        let mut first = lead(11, "2027-03-01T10:00:00Z", false);
        first.standard = StandardAnswers {
            first_name: Some("Éloïse".to_string()),
            birth_date: NaiveDate::from_ymd_opt(1990, 5, 2),
            phone: Some("+33612345678".to_string()),
            ..StandardAnswers::default()
        };
        first.custom = vec![
            snapshot(21, "Budget", CustomFieldKind::Number, json!(120)),
            snapshot(22, "Newsletter", CustomFieldKind::Checkbox, json!(true)),
            snapshot(23, "Remarque", CustomFieldKind::Text, Value::Null),
            snapshot(24, "Ville ✨", CustomFieldKind::Text, json!("Clermont")),
        ];
        let leads = [lead(12, "2027-03-02T10:00:00Z", true), first];

        let document = rendered(ExportScope::Event, &events, &leads, false);

        assert_eq!(document["exported_at"], "2027-03-15T10:00:00Z");
        assert_eq!(
            document["card"],
            json!({ "id": id(9).to_string(), "slug": "alice-durand" })
        );
        assert_eq!(
            document["event"],
            json!({ "id": id(1).to_string(), "title": "Salon d’été ✨" })
        );
        assert_eq!(document["include_spam"], false);

        let exported = document["leads"].as_array().unwrap();
        assert_eq!(exported.len(), 1, "spam left out");
        let lead = &exported[0];
        assert_eq!(lead["id"], id(11).to_string());
        assert_eq!(
            lead["event"],
            json!({ "id": id(1).to_string(), "title": "Salon d’été ✨" })
        );
        assert_eq!(lead["submitted_at"], "2027-03-01T10:00:00Z");
        assert_eq!(lead["consent_at"], "2027-03-01T10:00:00Z");
        assert_eq!(lead["consent_text"], "J’accepte d’être recontacté·e");
        assert_eq!(lead["spam"], false);
        assert_eq!(
            lead["standard"],
            json!({
                "first_name": "Éloïse",
                "last_name": null,
                "birth_date": "1990-05-02",
                "email": null,
                "phone": "+33612345678",
                "street": null,
                "postal_code": null,
                "city": null,
                "country": null,
            })
        );
        assert_eq!(
            lead["custom"],
            json!([
                { "field_id": id(21).to_string(), "label": "Budget", "kind": "number", "value": 120 },
                { "field_id": id(22).to_string(), "label": "Newsletter", "kind": "checkbox", "value": true },
                { "field_id": id(23).to_string(), "label": "Remarque", "kind": "text", "value": null },
                { "field_id": id(24).to_string(), "label": "Ville ✨", "kind": "text", "value": "Clermont" },
            ])
        );
    }

    // spec: LEA-012, LEA-030
    #[test]
    fn json_card_scope_has_no_event_and_can_include_spam() {
        let events = [event()];
        let leads = [
            lead(12, "2027-03-02T10:00:00Z", true),
            lead(11, "2027-03-01T10:00:00Z", false),
        ];

        let document = rendered(ExportScope::Card, &events, &leads, true);

        assert_eq!(document["event"], Value::Null);
        assert_eq!(document["include_spam"], true);
        let ids: Vec<&str> = document["leads"]
            .as_array()
            .unwrap()
            .iter()
            .map(|lead| lead["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, [id(11).to_string(), id(12).to_string()]);
        assert_eq!(document["leads"][1]["spam"], true);
    }

    // spec: LEA-009
    #[test]
    fn json_is_pretty_printed_with_two_spaces() {
        let events = [event()];
        let text = String::from_utf8(written(ExportScope::Card, &events, &[], false)).unwrap();
        assert!(text.starts_with("{\n  \"exported_at\": \"2027-03-15T10:00:00Z\",\n"));
    }

    // spec: LEA-031
    #[test]
    fn an_empty_json_export_has_an_empty_list() {
        let events = [event()];
        let document = rendered(ExportScope::Event, &events, &[], false);
        assert_eq!(document["leads"], json!([]));
    }
}
