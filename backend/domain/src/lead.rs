//! What a prospect submits: validation of the answers, the form version and the pure decisions
//! taken on a submission (FRM-012 to FRM-016, FRM-030, FRM-033 to FRM-038, ABU-005, EVT-014,
//! EVT-029).

use std::collections::BTreeMap;

use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::{
    CustomField, CustomFieldKind, FieldError, FieldMode, FormDefinition, StandardFields,
    is_valid_email, normalize, normalize_phone,
};

const MAX_NAME_CHARS: usize = 100;
const MAX_EMAIL_CHARS: usize = 254;
const MAX_STREET_CHARS: usize = 200;
const MAX_POSTAL_CODE_CHARS: usize = 20;
const MAX_TEXT_CHARS: usize = 500;
const MAX_LONG_TEXT_CHARS: usize = 5_000;

/// The postal address as typed by the prospect.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub struct AddressInput {
    pub street: Option<String>,
    pub postal_code: Option<String>,
    pub city: Option<String>,
    pub country: Option<String>,
}

/// The answers of a prospect, as sent by the form (the `answers` of a submission).
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub struct AnswersInput {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    /// `AAAA-MM-JJ`.
    pub birth_date: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub address: Option<AddressInput>,
    /// Answers to the custom fields, by field identifier.
    #[serde(default)]
    pub custom: BTreeMap<Uuid, Value>,
}

/// Validated answers to the standard fields; an empty or disabled field is `None`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub struct StandardAnswers {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub birth_date: Option<NaiveDate>,
    pub email: Option<String>,
    /// E.164.
    pub phone: Option<String>,
    pub street: Option<String>,
    pub postal_code: Option<String>,
    pub city: Option<String>,
    pub country: Option<String>,
}

/// The answer to one custom field, with the label and type the field had at submission time
/// (FRM-022, FRM-038).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub struct AnswerSnapshot {
    pub field_id: Uuid,
    pub label: String,
    pub kind: CustomFieldKind,
    /// A string (`text`, `long_text`, `single_choice`, `date` as `AAAA-MM-JJ`), a number
    /// (`number`), a boolean (`checkbox`) or `null` when left empty.
    pub value: Value,
}

/// Answers that passed [`validate_lead`].
#[derive(Debug, Clone, PartialEq)]
pub struct ValidLead {
    pub standard: StandardAnswers,
    /// One snapshot per custom field of the form, in the form's order.
    pub custom: Vec<AnswerSnapshot>,
}

/// Validates and normalizes a submission, reporting every invalid field at once.
///
/// Answers to disabled standard fields and to unknown custom field identifiers are ignored.
/// `today` bounds the birth date (FRM-035).
pub fn validate_lead(
    form: &FormDefinition,
    answers: AnswersInput,
    consent: bool,
    today: NaiveDate,
) -> Result<ValidLead, Vec<FieldError>> {
    let mut errors = Vec::new();
    let mut answers = answers;
    let custom_answers = std::mem::take(&mut answers.custom);
    let standard = validate_standard(&form.standard, answers, today, &mut errors);
    let custom = form
        .custom
        .iter()
        .map(|field| validate_custom(field, custom_answers.get(&field.id), &mut errors))
        .collect();
    if !consent {
        errors.push(FieldError::new("consent", "required"));
    }
    if errors.is_empty() {
        Ok(ValidLead { standard, custom })
    } else {
        Err(errors)
    }
}

fn validate_standard(
    fields: &StandardFields,
    answers: AnswersInput,
    today: NaiveDate,
    errors: &mut Vec<FieldError>,
) -> StandardAnswers {
    let first_name = text_answer(
        answers.first_name,
        fields.first_name,
        MAX_NAME_CHARS,
        "answers.first_name",
        errors,
    );
    let last_name = text_answer(
        answers.last_name,
        fields.last_name,
        MAX_NAME_CHARS,
        "answers.last_name",
        errors,
    );
    let birth_date = text_answer(
        answers.birth_date,
        fields.birth_date,
        usize::MAX,
        "answers.birth_date",
        errors,
    )
    .and_then(|raw| match parse_date(&raw) {
        Some(date) if date <= today => Some(date),
        _ => {
            errors.push(FieldError::new("answers.birth_date", "invalid_date"));
            None
        }
    });
    let email = text_answer(
        answers.email,
        fields.email,
        MAX_EMAIL_CHARS,
        "answers.email",
        errors,
    )
    .filter(|email| {
        let plausible = email.chars().count() > MAX_EMAIL_CHARS || is_valid_email(email);
        if !plausible {
            errors.push(FieldError::new("answers.email", "invalid_email"));
        }
        plausible
    });
    let phone = text_answer(
        answers.phone,
        fields.phone,
        usize::MAX,
        "answers.phone",
        errors,
    )
    .and_then(|raw| match normalize_phone(&raw) {
        Ok(e164) => Some(e164),
        Err(_) => {
            errors.push(FieldError::new("answers.phone", "invalid_phone"));
            None
        }
    });

    let address = answers.address.unwrap_or_default();
    let mode = fields.address;
    let street = text_answer(
        address.street,
        mode,
        MAX_STREET_CHARS,
        "answers.address.street",
        errors,
    );
    let postal_code = text_answer(
        address.postal_code,
        mode,
        MAX_POSTAL_CODE_CHARS,
        "answers.address.postal_code",
        errors,
    );
    let city = text_answer(
        address.city,
        mode,
        MAX_NAME_CHARS,
        "answers.address.city",
        errors,
    );
    let country = text_answer(
        address.country,
        mode,
        MAX_NAME_CHARS,
        "answers.address.country",
        errors,
    );

    StandardAnswers {
        first_name,
        last_name,
        birth_date,
        email,
        phone,
        street,
        postal_code,
        city,
        country,
    }
}

/// Normalizes a text answer and applies its mode and length limit. A disabled field is ignored.
fn text_answer(
    raw: Option<String>,
    mode: FieldMode,
    max_chars: usize,
    path: &str,
    errors: &mut Vec<FieldError>,
) -> Option<String> {
    if mode == FieldMode::Off {
        return None;
    }
    let value = raw.map(|v| normalize(&v)).filter(|v| !v.is_empty());
    match &value {
        None if mode == FieldMode::Required => errors.push(FieldError::new(path, "required")),
        Some(v) if v.chars().count() > max_chars => errors.push(FieldError::new(path, "too_long")),
        _ => {}
    }
    value
}

fn validate_custom(
    field: &CustomField,
    raw: Option<&Value>,
    errors: &mut Vec<FieldError>,
) -> AnswerSnapshot {
    let path = format!("answers.custom.{}", field.id);
    let value = match custom_value(field, raw.unwrap_or(&Value::Null)) {
        Ok(value) => {
            if field.required && is_empty(&value, field.kind) {
                errors.push(FieldError::new(path, "required"));
            }
            value
        }
        Err(code) => {
            errors.push(FieldError::new(path, code));
            Value::Null
        }
    };
    AnswerSnapshot {
        field_id: field.id,
        label: field.label.clone(),
        kind: field.kind,
        value,
    }
}

/// An unchecked box is the empty answer of a checkbox.
fn is_empty(value: &Value, kind: CustomFieldKind) -> bool {
    match kind {
        CustomFieldKind::Checkbox => value != &Value::Bool(true),
        _ => value.is_null(),
    }
}

/// The normalized answer (`null` when empty), or the code of the error.
fn custom_value(field: &CustomField, raw: &Value) -> Result<Value, &'static str> {
    if let (CustomFieldKind::Checkbox, Value::Null) = (field.kind, raw) {
        return Ok(Value::Bool(false));
    }
    if raw.is_null() {
        return Ok(Value::Null);
    }
    match (field.kind, raw) {
        (CustomFieldKind::Checkbox, Value::Bool(checked)) => Ok(Value::Bool(*checked)),
        (CustomFieldKind::Number, Value::Number(number)) => Ok(Value::Number(number.clone())),
        (CustomFieldKind::Checkbox, _) => Err("invalid_value"),
        (kind, Value::String(text)) => text_value(field, kind, &normalize(text)),
        _ => Err("invalid_value"),
    }
}

/// The answer to a field of a type typed as text, already normalized.
fn text_value(
    field: &CustomField,
    kind: CustomFieldKind,
    text: &str,
) -> Result<Value, &'static str> {
    if text.is_empty() {
        return Ok(Value::Null);
    }
    match kind {
        CustomFieldKind::Text => limited(text, MAX_TEXT_CHARS),
        CustomFieldKind::LongText => limited(text, MAX_LONG_TEXT_CHARS),
        CustomFieldKind::Date => parse_date(text)
            .map(|_| Value::String(text.to_string()))
            .ok_or("invalid_date"),
        CustomFieldKind::Datetime => parse_datetime(text)
            .map(|()| Value::String(text.to_string()))
            .ok_or("invalid_date"),
        CustomFieldKind::Number => parse_decimal(text).ok_or("invalid_number"),
        CustomFieldKind::SingleChoice if field.options.iter().any(|o| o == text) => {
            Ok(Value::String(text.to_string()))
        }
        CustomFieldKind::SingleChoice => Err("invalid_choice"),
        CustomFieldKind::Checkbox => Err("invalid_value"),
    }
}

fn limited(text: &str, max_chars: usize) -> Result<Value, &'static str> {
    if text.chars().count() > max_chars {
        Err("too_long")
    } else {
        Ok(Value::String(text.to_string()))
    }
}

/// A date written `AAAA-MM-JJ`, existing in the calendar, from 1900-01-01 to 2100-12-31
/// (FRM-035).
fn parse_date(text: &str) -> Option<NaiveDate> {
    let bytes = text.as_bytes();
    let shape_ok = bytes.len() == 10
        && bytes.iter().enumerate().all(|(i, b)| {
            if i == 4 || i == 7 {
                *b == b'-'
            } else {
                b.is_ascii_digit()
            }
        });
    if !shape_ok {
        return None;
    }
    let year = text[0..4].parse().ok()?;
    let month = text[5..7].parse().ok()?;
    let day = text[8..10].parse().ok()?;
    NaiveDate::from_ymd_opt(year, month, day).filter(|date| (1900..=2100).contains(&date.year()))
}

/// A date and time written `AAAA-MM-JJTHH:MM`, with no seconds and no zone: the date as for
/// [`parse_date`], the hour from 00 to 23 and the minute from 00 to 59 (FRM-043).
fn parse_datetime(text: &str) -> Option<()> {
    let (date, time) = text.split_at_checked(10)?;
    parse_date(date)?;
    let time = time.strip_prefix('T')?;
    let bytes = time.as_bytes();
    let shape_ok = bytes.len() == 5
        && bytes.iter().enumerate().all(|(i, b)| {
            if i == 2 {
                *b == b':'
            } else {
                b.is_ascii_digit()
            }
        });
    if !shape_ok {
        return None;
    }
    let hour: u32 = time[0..2].parse().ok()?;
    let minute: u32 = time[3..5].parse().ok()?;
    (hour < 24 && minute < 60).then_some(())
}

/// A decimal number with an optional sign, written with a point or a comma (FRM-036).
fn parse_decimal(text: &str) -> Option<Value> {
    let unsigned = text.strip_prefix(['-', '+']).unwrap_or(text);
    let (whole, fraction) = match unsigned.split_once(['.', ',']) {
        Some((whole, fraction)) => (whole, Some(fraction)),
        None => (unsigned, None),
    };
    let digits = |part: &str| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit());
    if !digits(whole) || fraction.is_some_and(|f| !digits(f)) {
        return None;
    }
    if let Ok(integer) = text.parse::<i64>() {
        return Some(Value::from(integer));
    }
    let number: f64 = text.replace(',', ".").parse().ok()?;
    serde_json::Number::from_f64(number).map(Value::Number)
}

/// What the prospect is shown, hashed into the form version (FRM-030).
#[derive(Debug, Serialize)]
pub struct PublicForm<'a> {
    pub title: &'a str,
    pub description: Option<&'a str>,
    pub standard: &'a StandardFields,
    pub custom: &'a [CustomField],
    pub consent_text: &'a str,
}

/// A fingerprint of the form shown to the prospect: FNV-1a 64 bits of its JSON, as 16 lowercase
/// hexadecimal digits. A submission carrying another version is refused (FRM-030).
pub fn form_version(form: &PublicForm) -> String {
    const OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0100_0000_01b3;
    let json = serde_json::to_vec(form).expect("a form is plain data and always serializes");
    let hash = json.iter().fold(OFFSET_BASIS, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(PRIME)
    });
    format!("{hash:016x}")
}

/// The form shown to the prospect is not the one the event has now (FRM-030).
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("form changed")]
pub struct FormChanged;

/// `shown` is the version of the form as the event has it now, `received` the one the prospect
/// saw when they filled it in.
pub fn check_form_version(shown: &str, received: &str) -> Result<(), FormChanged> {
    if shown == received {
        Ok(())
    } else {
        Err(FormChanged)
    }
}

/// Whether the hidden `fax` field was filled in: a robot (ABU-002, ABU-005).
pub fn honeypot_filled(value: Option<&str>) -> bool {
    value.is_some_and(|v| !v.trim().is_empty())
}

/// The device already submitted as many times as the event allows (EVT-014, EVT-029).
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("device limit reached")]
pub struct DeviceLimitReached;

/// `count` is the number of leads of the event from this device, spam ones included.
pub fn check_device_limit(count: i64, limit: u32) -> Result<(), DeviceLimitReached> {
    if count >= i64::from(limit) {
        Err(DeviceLimitReached)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        CustomField, CustomFieldKind, FieldError, FieldMode, FormDefinition, StandardFields,
    };
    use chrono::NaiveDate;
    use serde_json::json;
    use uuid::Uuid;

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2027, 5, 10).unwrap()
    }

    fn standard(mode: FieldMode) -> StandardFields {
        StandardFields {
            first_name: mode,
            last_name: mode,
            birth_date: mode,
            email: mode,
            phone: mode,
            address: mode,
        }
    }

    fn form(standard: StandardFields, custom: Vec<CustomField>) -> FormDefinition {
        FormDefinition { standard, custom }
    }

    fn field(n: u128, kind: CustomFieldKind, required: bool, options: &[&str]) -> CustomField {
        CustomField {
            id: Uuid::from_u128(n),
            label: format!("Champ {n}"),
            kind,
            required,
            help: None,
            options: options.iter().map(|o| o.to_string()).collect(),
        }
    }

    fn err(field: &str, code: &'static str) -> FieldError {
        FieldError::new(field, code)
    }

    fn only_first_name(mode: FieldMode) -> StandardFields {
        StandardFields {
            first_name: mode,
            ..standard(FieldMode::Off)
        }
    }

    fn custom_answers(entries: &[(u128, serde_json::Value)]) -> AnswersInput {
        AnswersInput {
            custom: entries
                .iter()
                .map(|(n, v)| (Uuid::from_u128(*n), v.clone()))
                .collect(),
            ..AnswersInput::default()
        }
    }

    // spec: FRM-012, FRM-013, FRM-016, FRM-034
    #[test]
    fn standard_answers_are_validated_and_normalized() {
        let f = form(
            StandardFields {
                address: FieldMode::Off,
                birth_date: FieldMode::Off,
                ..standard(FieldMode::Optional)
            },
            vec![],
        );
        let errors = validate_lead(
            &f,
            AnswersInput {
                email: Some("éloïse@".into()),
                phone: Some("12".into()),
                first_name: Some("a".repeat(101)),
                ..AnswersInput::default()
            },
            true,
            today(),
        )
        .unwrap_err();
        assert_eq!(
            errors,
            vec![
                err("answers.first_name", "too_long"),
                err("answers.email", "invalid_email"),
                err("answers.phone", "invalid_phone"),
            ]
        );

        let ok = validate_lead(
            &f,
            AnswersInput {
                first_name: Some("E\u{301}loi\u{308}se".into()),
                phone: Some("06 12 34 56 78".into()),
                email: Some(" eloise@example.org ".into()),
                ..AnswersInput::default()
            },
            true,
            today(),
        )
        .unwrap();
        assert_eq!(ok.standard.first_name.as_deref(), Some("Éloïse"));
        assert_eq!(ok.standard.phone.as_deref(), Some("+33612345678"));
        assert_eq!(ok.standard.email.as_deref(), Some("eloise@example.org"));
        assert_eq!(ok.standard.last_name, None);
    }

    // spec: FRM-034
    #[test]
    fn length_limits_apply_to_every_standard_answer() {
        let f = form(standard(FieldMode::Optional), vec![]);
        let long_email = format!("{}@example.org", "a".repeat(255 - "@example.org".len()));
        let errors = validate_lead(
            &f,
            AnswersInput {
                last_name: Some("n".repeat(101)),
                email: Some(long_email),
                address: Some(AddressInput {
                    street: Some("r".repeat(201)),
                    postal_code: Some("1".repeat(21)),
                    city: Some("v".repeat(101)),
                    country: Some("p".repeat(101)),
                }),
                ..AnswersInput::default()
            },
            true,
            today(),
        )
        .unwrap_err();
        assert_eq!(
            errors,
            vec![
                err("answers.last_name", "too_long"),
                err("answers.email", "too_long"),
                err("answers.address.street", "too_long"),
                err("answers.address.postal_code", "too_long"),
                err("answers.address.city", "too_long"),
                err("answers.address.country", "too_long"),
            ]
        );
        let at_limit = validate_lead(
            &f,
            AnswersInput {
                last_name: Some("n".repeat(100)),
                address: Some(AddressInput {
                    street: Some("r".repeat(200)),
                    postal_code: Some("1".repeat(20)),
                    city: Some("v".repeat(100)),
                    country: Some("p".repeat(100)),
                }),
                ..AnswersInput::default()
            },
            true,
            today(),
        );
        assert!(at_limit.is_ok());
    }

    // spec: FRM-034
    #[test]
    fn a_required_standard_field_cannot_be_empty() {
        let f = form(only_first_name(FieldMode::Required), vec![]);
        for answer in [None, Some("".to_string()), Some("  \n".to_string())] {
            let errors = validate_lead(
                &f,
                AnswersInput {
                    first_name: answer,
                    ..AnswersInput::default()
                },
                true,
                today(),
            )
            .unwrap_err();
            assert_eq!(errors, vec![err("answers.first_name", "required")]);
        }
    }

    // spec: FRM-019
    #[test]
    fn answers_to_disabled_standard_fields_are_ignored() {
        let f = form(only_first_name(FieldMode::Optional), vec![]);
        let lead = validate_lead(
            &f,
            AnswersInput {
                first_name: Some("Zoé".into()),
                last_name: Some("Lefèvre ✨".into()),
                email: Some("not an email".into()),
                address: Some(AddressInput {
                    city: Some("Lyon".into()),
                    ..AddressInput::default()
                }),
                ..AnswersInput::default()
            },
            true,
            today(),
        )
        .unwrap();
        assert_eq!(lead.standard.first_name.as_deref(), Some("Zoé"));
        assert_eq!(lead.standard.last_name, None);
        assert_eq!(lead.standard.email, None);
        assert_eq!(lead.standard.city, None);
    }

    // spec: FRM-014, FRM-035
    #[test]
    fn dates_are_checked() {
        let f = form(
            StandardFields {
                birth_date: FieldMode::Optional,
                ..standard(FieldMode::Off)
            },
            vec![field(1, CustomFieldKind::Date, false, &[])],
        );
        let birth = |s: &str| {
            validate_lead(
                &f,
                AnswersInput {
                    birth_date: Some(s.into()),
                    ..AnswersInput::default()
                },
                true,
                today(),
            )
        };
        for bad in [
            "1990-02-30",
            "30/01/1990",
            "1899-12-31",
            "1990-2-3",
            "+1990-01-01",
            "2027-05-11",
        ] {
            assert_eq!(
                birth(bad).unwrap_err(),
                vec![err("answers.birth_date", "invalid_date")],
                "{bad}"
            );
        }
        for good in ["1900-01-01", "1990-02-28", "2027-05-10"] {
            assert!(birth(good).is_ok(), "{good}");
        }
        let lead = birth("1990-02-28").unwrap();
        assert_eq!(
            lead.standard.birth_date,
            NaiveDate::from_ymd_opt(1990, 2, 28)
        );

        let custom_date =
            |s: &str| validate_lead(&f, custom_answers(&[(1, json!(s))]), true, today());
        assert!(custom_date("2100-12-31").is_ok());
        assert!(custom_date("2027-12-31").is_ok());
        assert_eq!(
            custom_date("2101-01-01").unwrap_err(),
            vec![err(
                &format!("answers.custom.{}", Uuid::from_u128(1)),
                "invalid_date"
            )]
        );
    }

    // spec: FRM-043
    #[test]
    fn datetime_answers_are_checked() {
        let f = form(
            standard(FieldMode::Off),
            vec![field(1, CustomFieldKind::Datetime, false, &[])],
        );
        let answer = |s: &str| validate_lead(&f, custom_answers(&[(1, json!(s))]), true, today());
        for good in ["2027-03-20T14:30", "1900-01-01T00:00", "2100-12-31T23:59"] {
            assert_eq!(answer(good).unwrap().custom[0].value, json!(good), "{good}");
        }
        for bad in [
            "2027-02-30T10:00",
            "2027-02-06T24:00",
            "2027-02-06T14:60",
            "2027-02-06T14:30:00",
            "2027-02-06 14:30",
            "1899-12-31T10:00",
            "2101-01-01T10:00",
            "2027-02-06T14:30Z",
            "2027-02-06T1:30",
            "2027-02-06",
        ] {
            assert_eq!(
                answer(bad).unwrap_err(),
                vec![err(
                    &format!("answers.custom.{}", Uuid::from_u128(1)),
                    "invalid_date"
                )],
                "{bad}"
            );
        }
    }

    // spec: FRM-018, FRM-033
    #[test]
    fn a_required_address_needs_every_part() {
        let f = form(
            StandardFields {
                address: FieldMode::Required,
                ..standard(FieldMode::Off)
            },
            vec![],
        );
        let errors = validate_lead(
            &f,
            AnswersInput {
                address: Some(AddressInput {
                    street: Some("12 rue des Lilas".into()),
                    city: Some("Clermont-Ferrand".into()),
                    ..AddressInput::default()
                }),
                ..AnswersInput::default()
            },
            true,
            today(),
        )
        .unwrap_err();
        assert_eq!(
            errors,
            vec![
                err("answers.address.postal_code", "required"),
                err("answers.address.country", "required"),
            ]
        );
        let none = validate_lead(&f, AnswersInput::default(), true, today()).unwrap_err();
        assert_eq!(none.len(), 4);
    }

    // spec: FRM-018, FRM-019
    #[test]
    fn an_optional_address_may_be_partial_or_absent() {
        let f = form(
            StandardFields {
                address: FieldMode::Optional,
                ..standard(FieldMode::Off)
            },
            vec![],
        );
        let lead = validate_lead(
            &f,
            AnswersInput {
                address: Some(AddressInput {
                    city: Some("Lyon".into()),
                    ..AddressInput::default()
                }),
                ..AnswersInput::default()
            },
            true,
            today(),
        )
        .unwrap();
        assert_eq!(lead.standard.city.as_deref(), Some("Lyon"));
        assert_eq!(lead.standard.street, None);
        assert!(validate_lead(&f, AnswersInput::default(), true, today()).is_ok());
    }

    // spec: FRM-021, FRM-036
    #[test]
    fn custom_answers_follow_their_type() {
        let f = form(
            standard(FieldMode::Off),
            vec![
                field(1, CustomFieldKind::Number, false, &[]),
                field(
                    2,
                    CustomFieldKind::SingleChoice,
                    false,
                    &["Standard", "Premium"],
                ),
                field(3, CustomFieldKind::Checkbox, true, &[]),
                field(4, CustomFieldKind::Text, false, &[]),
                field(5, CustomFieldKind::LongText, false, &[]),
            ],
        );
        let path = |n: u128| format!("answers.custom.{}", Uuid::from_u128(n));

        let ok = |entries: &[(u128, serde_json::Value)]| {
            validate_lead(&f, custom_answers(entries), true, today())
        };
        let with_box = |mut entries: Vec<(u128, serde_json::Value)>| {
            if !entries.iter().any(|(n, _)| *n == 3) {
                entries.push((3, json!(true)));
            }
            validate_lead(&f, custom_answers(&entries), true, today())
        };

        assert_eq!(
            with_box(vec![(1, json!(12.5))]).unwrap().custom[0].value,
            json!(12.5)
        );
        assert_eq!(
            with_box(vec![(1, json!("12,5"))]).unwrap().custom[0].value,
            json!(12.5)
        );
        assert_eq!(
            with_box(vec![(1, json!("-3"))]).unwrap().custom[0].value,
            json!(-3)
        );
        assert_eq!(
            with_box(vec![(1, json!(7))]).unwrap().custom[0].value,
            json!(7)
        );
        for bad in ["abc", "1e5", "inf", "NaN", "1,2,3", "12."] {
            assert_eq!(
                with_box(vec![(1, json!(bad))]).unwrap_err(),
                vec![err(&path(1), "invalid_number")],
                "{bad}"
            );
        }
        assert_eq!(
            with_box(vec![(2, json!("Luxe"))]).unwrap_err(),
            vec![err(&path(2), "invalid_choice")]
        );
        assert_eq!(
            with_box(vec![(2, json!("Premium"))]).unwrap().custom[1].value,
            json!("Premium")
        );
        assert_eq!(
            ok(&[(3, json!(false))]).unwrap_err(),
            vec![err(&path(3), "required")]
        );
        assert_eq!(ok(&[]).unwrap_err(), vec![err(&path(3), "required")]);
        assert_eq!(
            with_box(vec![(4, json!(12))]).unwrap_err(),
            vec![err(&path(4), "invalid_value")]
        );
        assert_eq!(
            with_box(vec![(1, json!(true))]).unwrap_err(),
            vec![err(&path(1), "invalid_value")]
        );
        assert_eq!(
            with_box(vec![(3, json!("yes"))]).unwrap_err(),
            vec![err(&path(3), "invalid_value")]
        );
        assert_eq!(
            with_box(vec![(5, json!("x".repeat(5_001)))]).unwrap_err(),
            vec![err(&path(5), "too_long")]
        );
        assert!(with_box(vec![(5, json!("x".repeat(5_000)))]).is_ok());
        assert_eq!(
            with_box(vec![(4, json!("x".repeat(501)))]).unwrap_err(),
            vec![err(&path(4), "too_long")]
        );
        // Unknown identifier: ignored.
        let unknown = with_box(vec![(99, json!("whatever"))]).unwrap();
        assert_eq!(unknown.custom.len(), 5);
    }

    // spec: FRM-034
    #[test]
    fn a_required_custom_field_cannot_be_empty() {
        let f = form(
            standard(FieldMode::Off),
            vec![field(1, CustomFieldKind::Text, true, &[])],
        );
        for answer in [json!(null), json!(""), json!("   ")] {
            assert_eq!(
                validate_lead(&f, custom_answers(&[(1, answer)]), true, today()).unwrap_err(),
                vec![err(
                    &format!("answers.custom.{}", Uuid::from_u128(1)),
                    "required"
                )]
            );
        }
    }

    // spec: FRM-022, FRM-038
    #[test]
    fn every_custom_field_gets_a_snapshot() {
        let f = form(
            standard(FieldMode::Off),
            vec![
                field(1, CustomFieldKind::Text, false, &[]),
                field(2, CustomFieldKind::Checkbox, false, &[]),
                field(3, CustomFieldKind::Date, false, &[]),
                field(4, CustomFieldKind::Number, false, &[]),
            ],
        );
        let lead = validate_lead(
            &f,
            custom_answers(&[(1, json!(" Zoé Lefèvre ✨ "))]),
            true,
            today(),
        )
        .unwrap();
        let ids: Vec<_> = lead.custom.iter().map(|s| s.field_id).collect();
        assert_eq!(ids, (1..=4).map(Uuid::from_u128).collect::<Vec<_>>());
        assert_eq!(lead.custom[0].label, "Champ 1");
        assert_eq!(lead.custom[0].kind, CustomFieldKind::Text);
        assert_eq!(lead.custom[0].value, json!("Zoé Lefèvre ✨"));
        assert_eq!(lead.custom[1].value, json!(false));
        assert_eq!(lead.custom[2].value, json!(null));
        assert_eq!(lead.custom[3].value, json!(null));
    }

    // spec: FRM-006, FRM-037
    #[test]
    fn consent_is_required() {
        let f = form(only_first_name(FieldMode::Required), vec![]);
        let errors = validate_lead(&f, AnswersInput::default(), false, today()).unwrap_err();
        assert_eq!(
            errors,
            vec![
                err("answers.first_name", "required"),
                err("consent", "required")
            ]
        );
        let only_consent = form(only_first_name(FieldMode::Optional), vec![]);
        assert_eq!(
            validate_lead(&only_consent, AnswersInput::default(), false, today()).unwrap_err(),
            vec![err("consent", "required")]
        );
    }

    fn public_form<'a>(
        title: &'a str,
        description: Option<&'a str>,
        standard: &'a StandardFields,
        custom: &'a [CustomField],
        consent_text: &'a str,
    ) -> PublicForm<'a> {
        PublicForm {
            title,
            description,
            standard,
            custom,
            consent_text,
        }
    }

    // spec: FRM-030
    #[test]
    fn form_version_changes_with_anything_shown() {
        let std = standard(FieldMode::Optional);
        let custom = vec![field(1, CustomFieldKind::SingleChoice, false, &["A", "B"])];
        let base = form_version(&public_form("Salon", Some("Desc"), &std, &custom, "Texte"));
        assert_eq!(base.len(), 16);
        assert!(base.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')));
        assert_eq!(
            base,
            form_version(&public_form("Salon", Some("Desc"), &std, &custom, "Texte"))
        );

        let mut relabelled = custom.clone();
        relabelled[0].label = "Autre".into();
        let mut required = custom.clone();
        required[0].required = true;
        let mut reoptioned = custom.clone();
        reoptioned[0].options[1] = "C".into();
        let other_std = StandardFields {
            email: FieldMode::Required,
            ..std
        };

        let variants = [
            form_version(&public_form(
                "Salon 2",
                Some("Desc"),
                &std,
                &custom,
                "Texte",
            )),
            form_version(&public_form(
                "Salon",
                Some("Desc 2"),
                &std,
                &custom,
                "Texte",
            )),
            form_version(&public_form("Salon", None, &std, &custom, "Texte")),
            form_version(&public_form(
                "Salon",
                Some("Desc"),
                &std,
                &relabelled,
                "Texte",
            )),
            form_version(&public_form(
                "Salon",
                Some("Desc"),
                &std,
                &required,
                "Texte",
            )),
            form_version(&public_form(
                "Salon",
                Some("Desc"),
                &std,
                &reoptioned,
                "Texte",
            )),
            form_version(&public_form(
                "Salon",
                Some("Desc"),
                &other_std,
                &custom,
                "Texte",
            )),
            form_version(&public_form(
                "Salon",
                Some("Desc"),
                &std,
                &custom,
                "Texte 2",
            )),
        ];
        for (i, v) in variants.iter().enumerate() {
            assert_ne!(*v, base, "variant {i}");
        }
    }

    // spec: ABU-002, ABU-005
    #[test]
    fn honeypot_is_filled_when_not_blank() {
        assert!(honeypot_filled(Some("http://spam.example")));
        assert!(honeypot_filled(Some("  x ")));
        assert!(!honeypot_filled(None));
        assert!(!honeypot_filled(Some("")));
        assert!(!honeypot_filled(Some(" \t\n\u{a0}")));
    }

    // spec: FRM-030
    #[test]
    fn a_submission_must_carry_the_current_form_version() {
        assert_eq!(check_form_version("00ab", "00ab"), Ok(()));
        assert_eq!(check_form_version("00ab", "00ac"), Err(FormChanged));
        assert_eq!(check_form_version("00ab", ""), Err(FormChanged));
    }

    // spec: EVT-014, EVT-029
    #[test]
    fn device_limit_refuses_at_the_limit() {
        assert_eq!(check_device_limit(0, 1), Ok(()));
        assert_eq!(check_device_limit(1, 1), Err(DeviceLimitReached));
        assert_eq!(check_device_limit(2, 1), Err(DeviceLimitReached));
        assert_eq!(check_device_limit(2, 3), Ok(()));
        assert_eq!(check_device_limit(3, 3), Err(DeviceLimitReached));
        assert_eq!(check_device_limit(99, 100), Ok(()));
    }
}
