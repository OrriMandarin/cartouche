use serde::Serialize;

/// One invalid field of a request, reported with `400 validation_failed`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub struct FieldError {
    /// Path of the field in the request, e.g. `content.email` or `links[3].url`.
    pub field: String,
    /// Stable machine-readable code, snake_case (e.g. `invalid_email`).
    pub code: &'static str,
}

impl FieldError {
    pub fn new(field: impl Into<String>, code: &'static str) -> FieldError {
        FieldError {
            field: field.into(),
            code,
        }
    }
}
