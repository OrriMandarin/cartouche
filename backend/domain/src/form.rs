//! Definition of an event form: standard fields and custom fields (FRM-017 to FRM-021, FRM-032).

use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const MAX_CUSTOM_FIELDS: usize = 30;
pub const MAX_FIELD_LABEL_CHARS: usize = 100;
pub const MAX_FIELD_HELP_CHARS: usize = 300;
pub const MIN_CHOICE_OPTIONS: usize = 2;
pub const MAX_CHOICE_OPTIONS: usize = 20;
pub const MAX_OPTION_CHARS: usize = 100;

/// Whether a standard field is absent from the form, optional or required (FRM-019).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub enum FieldMode {
    Off,
    Optional,
    Required,
}

/// The standard fields an owner can enable (FRM-017).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub enum StandardField {
    FirstName,
    LastName,
    BirthDate,
    Email,
    Phone,
    Address,
}

/// The types of custom field (FRM-021).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub enum CustomFieldKind {
    Text,
    LongText,
    Date,
    Number,
    SingleChoice,
    Checkbox,
}

/// The mode of each standard field.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub struct StandardFields {
    pub first_name: FieldMode,
    pub last_name: FieldMode,
    pub birth_date: FieldMode,
    pub email: FieldMode,
    pub phone: FieldMode,
    pub address: FieldMode,
}

impl StandardFields {
    /// The enabled fields in the fixed display order of FRM-017, each with its required flag.
    pub fn enabled(&self) -> Vec<(StandardField, bool)> {
        [
            (StandardField::FirstName, self.first_name),
            (StandardField::LastName, self.last_name),
            (StandardField::BirthDate, self.birth_date),
            (StandardField::Email, self.email),
            (StandardField::Phone, self.phone),
            (StandardField::Address, self.address),
        ]
        .into_iter()
        .filter(|(_, mode)| *mode != FieldMode::Off)
        .map(|(field, mode)| (field, mode == FieldMode::Required))
        .collect()
    }
}

/// A field added by the owner, with a stable identifier (FRM-020, FRM-032).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub struct CustomField {
    pub id: Uuid,
    pub label: String,
    pub kind: CustomFieldKind,
    pub required: bool,
    pub help: Option<String>,
    /// Only for `single_choice`; empty for every other kind, and may then be left out.
    #[serde(default)]
    pub options: Vec<String>,
}

/// The fields of an event form, as stored with the event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FormDefinition {
    pub standard: StandardFields,
    pub custom: Vec<CustomField>,
}

#[cfg(test)]
mod tests {
    use super::*;

    // spec: FRM-017, FRM-019
    #[test]
    fn standard_fields_keep_the_fixed_order() {
        let fields = StandardFields {
            first_name: FieldMode::Optional,
            last_name: FieldMode::Off,
            birth_date: FieldMode::Off,
            email: FieldMode::Off,
            phone: FieldMode::Off,
            address: FieldMode::Required,
        };
        assert_eq!(
            fields.enabled(),
            vec![
                (StandardField::FirstName, false),
                (StandardField::Address, true)
            ]
        );
    }

    // spec: FRM-017
    #[test]
    fn unknown_standard_field_is_rejected() {
        let json = serde_json::json!({
            "first_name": "off", "last_name": "off", "birth_date": "off",
            "email": "off", "phone": "off", "address": "off", "company": "off"
        });
        assert!(serde_json::from_value::<StandardFields>(json).is_err());
    }

    // spec: FRM-021, FRM-032
    #[test]
    fn options_may_be_left_out_of_a_non_choice_field() {
        let json = serde_json::json!({
            "id": "0190c9a0-0000-7000-8000-000000000001",
            "label": "Société", "kind": "text", "required": false, "help": null
        });
        let field: CustomField = serde_json::from_value(json).unwrap();
        assert!(field.options.is_empty());
    }
}
