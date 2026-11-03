//! Events: periods, simultaneous-event limit and validation of what an owner submits
//! (EVT-001 to EVT-006, EVT-008, EVT-016 to EVT-021, EVT-026, EVT-030, FRM-028, FRM-031, FRM-032).

use std::collections::HashSet;

use chrono::{DateTime, TimeDelta, Utc};
use serde::{Deserialize, Serialize};

use crate::form::{
    CustomField, FormDefinition, MAX_CHOICE_OPTIONS, MAX_CUSTOM_FIELDS, MAX_FIELD_HELP_CHARS,
    MAX_FIELD_LABEL_CHARS, MAX_OPTION_CHARS, MIN_CHOICE_OPTIONS, StandardFields,
};
use crate::{CustomFieldKind, FieldError, normalize};

pub const MAX_EVENT_TITLE_CHARS: usize = 120;
pub const MAX_EVENT_DESCRIPTION_CHARS: usize = 2_000;
pub const MAX_ACCESS_CODE_CHARS: usize = 32;
pub const MAX_CONSENT_TEXT_CHARS: usize = 3_000;
pub const MIN_DEVICE_LIMIT: u32 = 1;
pub const MAX_DEVICE_LIMIT: u32 = 100;
pub const DEFAULT_DEVICE_LIMIT: u32 = 1;

/// How long after its end an event still accepts submissions (EVT-008).
pub fn submission_grace() -> TimeDelta {
    TimeDelta::minutes(15)
}

/// Where an event stands relative to the server clock (EVT-020).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub enum EventPhase {
    Upcoming,
    Running,
    Past,
}

/// `end_now` was asked on an event that is not running (EVT-021).
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("event is not running")]
pub struct EventNotRunning;

/// The half-open period `[starts_at, ends_at)` of an event; no end means until closed (EVT-003).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Period {
    pub starts_at: DateTime<Utc>,
    pub ends_at: Option<DateTime<Utc>>,
}

impl Period {
    pub fn phase(&self, now: DateTime<Utc>) -> EventPhase {
        if now < self.starts_at {
            EventPhase::Upcoming
        } else if self.is_running(now) {
            EventPhase::Running
        } else {
            EventPhase::Past
        }
    }

    /// EVT-002.
    pub fn is_running(&self, now: DateTime<Utc>) -> bool {
        self.starts_at <= now && self.ends_at.is_none_or(|end| now < end)
    }

    /// EVT-008, EVT-026: running, or ended at most [`submission_grace`] ago.
    pub fn accepts_submissions(&self, now: DateTime<Utc>) -> bool {
        self.starts_at <= now
            && self
                .ends_at
                .is_none_or(|end| now <= end + submission_grace())
    }

    /// The period closed at `now` (EVT-006); only a running event can be closed (EVT-021).
    pub fn end_now(&self, now: DateTime<Utc>) -> Result<Period, EventNotRunning> {
        if self.is_running(now) {
            Ok(Period {
                starts_at: self.starts_at,
                ends_at: Some(now),
            })
        } else {
            Err(EventNotRunning)
        }
    }
}

/// The largest number of events running at the same instant during `candidate`, itself included
/// (EVT-005). Periods are half-open, so events that only touch never overlap.
pub fn max_simultaneous(candidate: &Period, others: &[Period]) -> usize {
    // Instants where the running count changes, within the candidate's window.
    let mut changes: Vec<(DateTime<Utc>, i32)> = Vec::new();
    for period in others {
        let starts_at = period.starts_at.max(candidate.starts_at);
        let ends_at = match (period.ends_at, candidate.ends_at) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        };
        if ends_at.is_none_or(|end| starts_at < end) {
            changes.push((starts_at, 1));
            if let Some(end) = ends_at {
                changes.push((end, -1));
            }
        }
    }
    // At equal instants, ends come before starts: touching periods do not overlap.
    changes.sort_by_key(|(instant, delta)| (*instant, *delta));
    let mut running = 0;
    let mut peak = 0;
    for (_, delta) in changes {
        running += delta;
        peak = peak.max(running);
    }
    peak as usize + 1
}

/// A creation or modification would exceed the simultaneous-event limit (EVT-018).
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("too many simultaneous events")]
pub struct TooManySimultaneousEvents;

/// Checks EVT-004/EVT-005: `candidate` must not make more than `max_allowed` events run together.
pub fn check_simultaneous_limit(
    candidate: &Period,
    others: &[Period],
    max_allowed: usize,
) -> Result<(), TooManySimultaneousEvents> {
    if max_simultaneous(candidate, others) > max_allowed {
        Err(TooManySimultaneousEvents)
    } else {
        Ok(())
    }
}

/// Everything an owner submits for an event; also the body of the event routes.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub struct EventInput {
    pub title: String,
    pub description: Option<String>,
    /// Required; kept optional so that a missing start is reported as a field error.
    pub starts_at: Option<DateTime<Utc>>,
    pub ends_at: Option<DateTime<Utc>>,
    pub access_code: Option<String>,
    /// Submissions allowed per device, from 1 to 100 (EVT-014, EVT-030).
    // Signed and wide so that any out-of-range number is a field error, not a malformed body.
    pub device_limit: i64,
    pub standard_fields: StandardFields,
    pub custom_fields: Vec<CustomField>,
    pub consent_text: Option<String>,
}

/// An event that passed [`validate_event`].
#[derive(Debug, Clone, PartialEq)]
pub struct ValidEvent {
    pub title: String,
    pub description: Option<String>,
    pub period: Period,
    pub access_code: Option<String>,
    pub device_limit: u32,
    pub form: FormDefinition,
    pub consent_text: Option<String>,
}

/// Validates and normalizes a submitted event, reporting every invalid field at once.
pub fn validate_event(input: EventInput) -> Result<ValidEvent, Vec<FieldError>> {
    let mut errors = Vec::new();

    let title = normalize(&input.title);
    if title.is_empty() {
        errors.push(FieldError::new("title", "required"));
    }
    check_length(&title, MAX_EVENT_TITLE_CHARS, "title", &mut errors);

    let description = clean(input.description);
    check_optional_length(
        &description,
        MAX_EVENT_DESCRIPTION_CHARS,
        "description",
        &mut errors,
    );

    let access_code = clean(input.access_code);
    check_optional_length(
        &access_code,
        MAX_ACCESS_CODE_CHARS,
        "access_code",
        &mut errors,
    );

    let consent_text = clean(input.consent_text);
    check_optional_length(
        &consent_text,
        MAX_CONSENT_TEXT_CHARS,
        "consent_text",
        &mut errors,
    );

    match input.starts_at {
        None => errors.push(FieldError::new("starts_at", "required")),
        Some(starts_at) => {
            if input.ends_at.is_some_and(|ends_at| ends_at <= starts_at) {
                errors.push(FieldError::new("ends_at", "end_before_start"));
            }
        }
    }

    let device_limit = u32::try_from(input.device_limit)
        .ok()
        .filter(|limit| (MIN_DEVICE_LIMIT..=MAX_DEVICE_LIMIT).contains(limit));
    if device_limit.is_none() {
        errors.push(FieldError::new("device_limit", "out_of_range"));
    }

    if input.standard_fields.enabled().is_empty() && input.custom_fields.is_empty() {
        errors.push(FieldError::new("standard_fields", "no_fields"));
    }
    let custom = validate_custom_fields(input.custom_fields, &mut errors);

    match (input.starts_at, device_limit) {
        (Some(starts_at), Some(device_limit)) if errors.is_empty() => Ok(ValidEvent {
            title,
            description,
            period: Period {
                starts_at,
                ends_at: input.ends_at,
            },
            access_code,
            device_limit,
            form: FormDefinition {
                standard: input.standard_fields,
                custom,
            },
            consent_text,
        }),
        _ => Err(errors),
    }
}

fn validate_custom_fields(
    fields: Vec<CustomField>,
    errors: &mut Vec<FieldError>,
) -> Vec<CustomField> {
    if fields.len() > MAX_CUSTOM_FIELDS {
        errors.push(FieldError::new("custom_fields", "too_many_fields"));
    }
    let mut seen_ids = HashSet::new();
    fields
        .into_iter()
        .enumerate()
        .map(|(index, field)| validate_custom_field(index, field, &mut seen_ids, errors))
        .collect()
}

fn validate_custom_field(
    index: usize,
    field: CustomField,
    seen_ids: &mut HashSet<uuid::Uuid>,
    errors: &mut Vec<FieldError>,
) -> CustomField {
    let path = format!("custom_fields[{index}]");

    if !seen_ids.insert(field.id) {
        errors.push(FieldError::new(format!("{path}.id"), "duplicate_field_id"));
    }

    let label = normalize(&field.label);
    if label.is_empty() {
        errors.push(FieldError::new(format!("{path}.label"), "required"));
    }
    check_length(
        &label,
        MAX_FIELD_LABEL_CHARS,
        &format!("{path}.label"),
        errors,
    );

    let help = clean(field.help);
    check_optional_length(&help, MAX_FIELD_HELP_CHARS, &format!("{path}.help"), errors);

    let options = if field.kind == CustomFieldKind::SingleChoice {
        validate_options(&path, field.options, errors)
    } else {
        Vec::new()
    };

    CustomField {
        id: field.id,
        label,
        kind: field.kind,
        required: field.required,
        help,
        options,
    }
}

fn validate_options(path: &str, options: Vec<String>, errors: &mut Vec<FieldError>) -> Vec<String> {
    if options.len() < MIN_CHOICE_OPTIONS {
        errors.push(FieldError::new(
            format!("{path}.options"),
            "too_few_options",
        ));
    } else if options.len() > MAX_CHOICE_OPTIONS {
        errors.push(FieldError::new(
            format!("{path}.options"),
            "too_many_options",
        ));
    }
    let mut seen = HashSet::new();
    options
        .iter()
        .enumerate()
        .map(|(position, option)| {
            let option = normalize(option);
            let field = format!("{path}.options[{position}]");
            if option.is_empty() {
                errors.push(FieldError::new(field, "required"));
            } else if option.chars().count() > MAX_OPTION_CHARS {
                errors.push(FieldError::new(field, "too_long"));
            } else if !seen.insert(option.clone()) {
                errors.push(FieldError::new(field, "duplicate_option"));
            }
            option
        })
        .collect()
}

/// Normalizes an optional text: empty after normalization means absent.
fn clean(value: Option<String>) -> Option<String> {
    value.map(|v| normalize(&v)).filter(|v| !v.is_empty())
}

fn check_length(value: &str, max: usize, field: &str, errors: &mut Vec<FieldError>) {
    if value.chars().count() > max {
        errors.push(FieldError::new(field, "too_long"));
    }
}

fn check_optional_length(
    value: &Option<String>,
    max: usize,
    field: &str,
    errors: &mut Vec<FieldError>,
) {
    if let Some(value) = value {
        check_length(value, max, field, errors);
    }
}

#[cfg(test)]
mod tests {
    use chrono::{DateTime, TimeDelta, TimeZone, Utc};
    use uuid::Uuid;

    use super::*;
    use crate::FieldError;
    use crate::form::{CustomField, CustomFieldKind, FieldMode, StandardFields};

    fn at(hour: i64) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2027, 3, 15, 0, 0, 0).unwrap() + TimeDelta::hours(hour)
    }

    fn period(start: i64, end: Option<i64>) -> Period {
        Period {
            starts_at: at(start),
            ends_at: end.map(at),
        }
    }

    // spec: EVT-002, EVT-003, EVT-020
    #[test]
    fn phases_follow_the_clock() {
        let p = period(8, Some(10));
        assert_eq!(p.phase(at(7)), EventPhase::Upcoming);
        assert_eq!(p.phase(at(8)), EventPhase::Running);
        assert_eq!(p.phase(at(9)), EventPhase::Running);
        assert_eq!(p.phase(at(10)), EventPhase::Past);
        assert!(p.is_running(at(8)));
        assert!(!p.is_running(at(10)));
        let open = period(8, None);
        assert_eq!(
            open.phase(at(8) + TimeDelta::days(36_525)),
            EventPhase::Running
        );
        assert!(open.is_running(at(8)));
    }

    // spec: EVT-008, EVT-026, Review Focus 8
    #[test]
    fn submissions_are_accepted_up_to_15_minutes_after_the_end() {
        let p = period(8, Some(10));
        let end = at(10);
        assert!(p.accepts_submissions(end + TimeDelta::minutes(15)));
        assert!(!p.accepts_submissions(end + TimeDelta::minutes(15) + TimeDelta::seconds(1)));
        assert!(!p.accepts_submissions(at(7)));
        assert!(p.accepts_submissions(at(8)));
        assert!(period(8, None).accepts_submissions(at(8) + TimeDelta::days(3_650)));
    }

    // spec: EVT-006, EVT-021
    #[test]
    fn end_now_only_while_running() {
        let ended = period(8, Some(12)).end_now(at(9)).unwrap();
        assert_eq!(
            ended,
            Period {
                starts_at: at(8),
                ends_at: Some(at(9))
            }
        );
        assert!(period(8, None).end_now(at(9)).is_ok());
        assert_eq!(period(8, Some(12)).end_now(at(7)), Err(EventNotRunning));
        assert_eq!(period(8, Some(12)).end_now(at(12)), Err(EventNotRunning));
    }

    // spec: EVT-004, EVT-005
    #[test]
    fn max_simultaneous_is_the_peak_over_the_whole_period() {
        assert_eq!(max_simultaneous(&period(8, Some(18)), &[]), 1);
        // touching bounds never overlap
        assert_eq!(
            max_simultaneous(&period(8, Some(10)), &[period(10, Some(12))]),
            1
        );
        assert_eq!(
            max_simultaneous(&period(10, Some(12)), &[period(8, Some(10))]),
            1
        );
        // two others that are never together with each other
        assert_eq!(
            max_simultaneous(
                &period(8, Some(18)),
                &[period(9, Some(10)), period(11, Some(12))]
            ),
            2
        );
        assert_eq!(
            max_simultaneous(
                &period(8, Some(18)),
                &[period(9, Some(12)), period(10, Some(11))]
            ),
            3
        );
        // open-ended candidate against an event three years later
        let three_years = 3 * 365 * 24;
        assert_eq!(
            max_simultaneous(
                &period(8, None),
                &[period(three_years, Some(three_years + 2))]
            ),
            2
        );
        // past candidate against a future event
        assert_eq!(
            max_simultaneous(&period(1, Some(2)), &[period(30, Some(40))]),
            1
        );
        // others overlapping only outside the candidate do not count
        assert_eq!(
            max_simultaneous(
                &period(8, Some(10)),
                &[period(0, Some(8)), period(10, None)]
            ),
            1
        );
        // an open-ended other starts counting at its start
        assert_eq!(
            max_simultaneous(&period(8, Some(18)), &[period(12, None)]),
            2
        );
    }

    // spec: EVT-018, EVT-019
    #[test]
    fn simultaneous_limit_is_checked_against_the_configured_maximum() {
        let others = [period(9, Some(12)), period(10, Some(11))];
        let candidate = period(8, Some(18));
        assert_eq!(check_simultaneous_limit(&candidate, &others, 3), Ok(()));
        assert_eq!(
            check_simultaneous_limit(&candidate, &others, 2),
            Err(TooManySimultaneousEvents)
        );
        assert_eq!(check_simultaneous_limit(&candidate, &[], 1), Ok(()));
    }

    fn valid_input() -> EventInput {
        EventInput {
            title: "Salon".into(),
            description: None,
            starts_at: Some(at(8)),
            ends_at: Some(at(10)),
            access_code: None,
            device_limit: 1,
            standard_fields: StandardFields {
                first_name: FieldMode::Required,
                last_name: FieldMode::Off,
                birth_date: FieldMode::Off,
                email: FieldMode::Off,
                phone: FieldMode::Off,
                address: FieldMode::Off,
            },
            custom_fields: Vec::new(),
            consent_text: None,
        }
    }

    fn errors_of(input: EventInput) -> Vec<(String, &'static str)> {
        validate_event(input)
            .expect_err("expected validation errors")
            .into_iter()
            .map(|FieldError { field, code }| (field, code))
            .collect()
    }

    fn has(errors: &[(String, &'static str)], field: &str, code: &str) -> bool {
        errors.iter().any(|(f, c)| f == field && *c == code)
    }

    // spec: EVT-001, EVT-016, EVT-017, EVT-030
    #[test]
    fn event_input_is_validated_and_normalized() {
        let ok = validate_event(EventInput {
            title: "  Salon E\u{301}té ".into(),
            description: Some("  ".into()),
            access_code: Some("  ".into()),
            ..valid_input()
        })
        .unwrap();
        assert_eq!(ok.title, "Salon Été");
        assert_eq!(ok.description, None);
        assert_eq!(ok.access_code, None);
        assert_eq!(ok.period, period(8, Some(10)));
        assert_eq!(ok.device_limit, 1);
        assert_eq!(ok.consent_text, None);

        let coded = validate_event(EventInput {
            access_code: Some("  Château ".into()),
            ..valid_input()
        })
        .unwrap();
        assert_eq!(coded.access_code.as_deref(), Some("Château"));

        let e = errors_of(EventInput {
            title: "  ".into(),
            ..valid_input()
        });
        assert_eq!(e, vec![("title".to_string(), "required")]);
        let e = errors_of(EventInput {
            title: "a".repeat(121),
            ..valid_input()
        });
        assert_eq!(e, vec![("title".to_string(), "too_long")]);
        assert!(
            validate_event(EventInput {
                title: "é".repeat(120),
                ..valid_input()
            })
            .is_ok()
        );
        let e = errors_of(EventInput {
            description: Some("a".repeat(2_001)),
            ..valid_input()
        });
        assert_eq!(e, vec![("description".to_string(), "too_long")]);
        let e = errors_of(EventInput {
            access_code: Some("a".repeat(33)),
            ..valid_input()
        });
        assert_eq!(e, vec![("access_code".to_string(), "too_long")]);
        let e = errors_of(EventInput {
            ends_at: Some(at(8)),
            ..valid_input()
        });
        assert_eq!(e, vec![("ends_at".to_string(), "end_before_start")]);
        for limit in [0, 101, -1, 5_000_000_000] {
            let e = errors_of(EventInput {
                device_limit: limit,
                ..valid_input()
            });
            assert_eq!(e, vec![("device_limit".to_string(), "out_of_range")]);
        }
        assert!(
            validate_event(EventInput {
                device_limit: 100,
                ..valid_input()
            })
            .is_ok()
        );

        let e = errors_of(EventInput {
            title: "".into(),
            ends_at: Some(at(7)),
            device_limit: 0,
            ..valid_input()
        });
        assert_eq!(e.len(), 3);
        assert!(has(&e, "title", "required"));
        assert!(has(&e, "ends_at", "end_before_start"));
        assert!(has(&e, "device_limit", "out_of_range"));
    }

    // spec: EDI-019, EDI-015
    #[test]
    fn missing_start_is_a_field_error() {
        let e = errors_of(EventInput {
            starts_at: None,
            ..valid_input()
        });
        assert_eq!(e, vec![("starts_at".to_string(), "required")]);
        let e = errors_of(EventInput {
            starts_at: None,
            ends_at: None,
            ..valid_input()
        });
        assert_eq!(e, vec![("starts_at".to_string(), "required")]);
    }

    fn custom(label: &str, kind: CustomFieldKind, options: &[&str]) -> CustomField {
        CustomField {
            id: Uuid::now_v7(),
            label: label.into(),
            kind,
            required: false,
            help: None,
            options: options.iter().map(|o| o.to_string()).collect(),
        }
    }

    fn with_custom(fields: Vec<CustomField>) -> EventInput {
        EventInput {
            custom_fields: fields,
            ..valid_input()
        }
    }

    // spec: FRM-020, FRM-021, FRM-031, FRM-032
    #[test]
    fn custom_fields_are_validated() {
        let thirty_one: Vec<_> = (0..31)
            .map(|i| custom(&format!("c{i}"), CustomFieldKind::Text, &[]))
            .collect();
        assert!(has(
            &errors_of(with_custom(thirty_one)),
            "custom_fields",
            "too_many_fields"
        ));
        let thirty: Vec<_> = (0..30)
            .map(|i| custom(&format!("c{i}"), CustomFieldKind::Text, &[]))
            .collect();
        assert!(validate_event(with_custom(thirty)).is_ok());

        let e = errors_of(with_custom(vec![custom("", CustomFieldKind::Text, &[])]));
        assert_eq!(e, vec![("custom_fields[0].label".to_string(), "required")]);
        let e = errors_of(with_custom(vec![custom(
            &"a".repeat(101),
            CustomFieldKind::Text,
            &[],
        )]));
        assert_eq!(e, vec![("custom_fields[0].label".to_string(), "too_long")]);

        let mut helped = custom("Note", CustomFieldKind::Text, &[]);
        helped.help = Some("a".repeat(301));
        let e = errors_of(with_custom(vec![helped]));
        assert_eq!(e, vec![("custom_fields[0].help".to_string(), "too_long")]);
        let mut blank_help = custom("Note", CustomFieldKind::Text, &[]);
        blank_help.help = Some("  ".into());
        let ok = validate_event(with_custom(vec![blank_help])).unwrap();
        assert_eq!(ok.form.custom[0].help, None);

        let first = custom("A", CustomFieldKind::Text, &[]);
        let mut second = custom("B", CustomFieldKind::Text, &[]);
        second.id = first.id;
        let e = errors_of(with_custom(vec![first, second]));
        assert_eq!(
            e,
            vec![("custom_fields[1].id".to_string(), "duplicate_field_id")]
        );

        let e = errors_of(with_custom(vec![custom(
            "Choix",
            CustomFieldKind::SingleChoice,
            &["Seule"],
        )]));
        assert_eq!(
            e,
            vec![("custom_fields[0].options".to_string(), "too_few_options")]
        );
        let e = errors_of(with_custom(vec![custom(
            "Choix",
            CustomFieldKind::SingleChoice,
            &[],
        )]));
        assert_eq!(
            e,
            vec![("custom_fields[0].options".to_string(), "too_few_options")]
        );
        let many: Vec<String> = (0..21).map(|i| format!("o{i}")).collect();
        let many_refs: Vec<&str> = many.iter().map(String::as_str).collect();
        let e = errors_of(with_custom(vec![custom(
            "Choix",
            CustomFieldKind::SingleChoice,
            &many_refs,
        )]));
        assert_eq!(
            e,
            vec![("custom_fields[0].options".to_string(), "too_many_options")]
        );
        let e = errors_of(with_custom(vec![custom(
            "Choix",
            CustomFieldKind::SingleChoice,
            &["Ok", ""],
        )]));
        assert_eq!(
            e,
            vec![("custom_fields[0].options[1]".to_string(), "required")]
        );
        let long = "a".repeat(101);
        let e = errors_of(with_custom(vec![custom(
            "Choix",
            CustomFieldKind::SingleChoice,
            &["Ok", &long],
        )]));
        assert_eq!(
            e,
            vec![("custom_fields[0].options[1]".to_string(), "too_long")]
        );
        let e = errors_of(with_custom(vec![custom(
            "Choix",
            CustomFieldKind::SingleChoice,
            &["Prestige", "Prestige "],
        )]));
        assert_eq!(
            e,
            vec![(
                "custom_fields[0].options[1]".to_string(),
                "duplicate_option"
            )]
        );
        let e = errors_of(with_custom(vec![custom(
            "Choix",
            CustomFieldKind::SingleChoice,
            &["Cafe\u{301}", "Café"],
        )]));
        assert_eq!(
            e,
            vec![(
                "custom_fields[0].options[1]".to_string(),
                "duplicate_option"
            )]
        );

        let ok = validate_event(with_custom(vec![custom(
            "Note",
            CustomFieldKind::Text,
            &["x", "y"],
        )]))
        .unwrap();
        assert!(ok.form.custom[0].options.is_empty());

        let none = EventInput {
            standard_fields: StandardFields {
                first_name: FieldMode::Off,
                last_name: FieldMode::Off,
                birth_date: FieldMode::Off,
                email: FieldMode::Off,
                phone: FieldMode::Off,
                address: FieldMode::Off,
            },
            ..valid_input()
        };
        assert_eq!(
            errors_of(none.clone()),
            vec![("standard_fields".to_string(), "no_fields")]
        );
        let only_custom = EventInput {
            custom_fields: vec![custom("Note", CustomFieldKind::Text, &[])],
            ..none
        };
        assert!(validate_event(only_custom).is_ok());
    }

    // spec: FRM-016
    #[test]
    fn field_texts_are_stored_in_nfc() {
        let mut field = custom("  Date du marie\u{301} ", CustomFieldKind::Date, &[]);
        field.help = Some("Aide e\u{301}crite".into());
        let ok = validate_event(with_custom(vec![field])).unwrap();
        assert_eq!(ok.form.custom[0].label, "Date du marié");
        assert_eq!(ok.form.custom[0].help.as_deref(), Some("Aide écrite"));
        let choice = custom(
            "Choix",
            CustomFieldKind::SingleChoice,
            &["Cafe\u{301}", "Thé"],
        );
        let ok = validate_event(with_custom(vec![choice])).unwrap();
        assert_eq!(ok.form.custom[0].options, vec!["Café", "Thé"]);
    }

    // spec: FRM-028
    #[test]
    fn custom_consent_text_is_limited() {
        let e = errors_of(EventInput {
            consent_text: Some("a".repeat(3_001)),
            ..valid_input()
        });
        assert_eq!(e, vec![("consent_text".to_string(), "too_long")]);
        let ok = validate_event(EventInput {
            consent_text: Some("   ".into()),
            ..valid_input()
        })
        .unwrap();
        assert_eq!(ok.consent_text, None);
        let ok = validate_event(EventInput {
            consent_text: Some(" Mon texte ".into()),
            ..valid_input()
        })
        .unwrap();
        assert_eq!(ok.consent_text.as_deref(), Some("Mon texte"));
    }
}
