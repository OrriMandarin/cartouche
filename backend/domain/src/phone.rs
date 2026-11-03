//! Phone numbers: validation, E.164 normalization and international display (PUB-020).

use phonenumber::{Mode, country};

/// The input is not a valid phone number.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("invalid phone number")]
pub struct InvalidPhone;

/// Parses `input` (France is the default country) and returns it in E.164, e.g. `+33612345678`.
pub fn normalize_phone(input: &str) -> Result<String, InvalidPhone> {
    let number = phonenumber::parse(Some(country::Id::FR), input).map_err(|_| InvalidPhone)?;
    if !phonenumber::is_valid(&number) {
        return Err(InvalidPhone);
    }
    Ok(number.format().mode(Mode::E164).to_string())
}

/// Formats an E.164 number for display, e.g. `+33 6 12 34 56 78`. Returns the input as is
/// when it cannot be parsed.
pub fn format_international(e164: &str) -> String {
    match phonenumber::parse(None, e164) {
        Ok(number) => number.format().mode(Mode::International).to_string(),
        Err(_) => e164.to_string(),
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    // spec: PUB-020
    #[test]
    fn french_numbers_are_the_default() {
        assert_eq!(
            normalize_phone("06 12 34 56 78").as_deref(),
            Ok("+33612345678")
        );
        assert_eq!(normalize_phone("0612345678").as_deref(), Ok("+33612345678"));
        assert_eq!(
            normalize_phone("+33 6 12 34 56 78").as_deref(),
            Ok("+33612345678")
        );
    }

    // spec: PUB-020
    #[test]
    fn foreign_numbers_keep_their_country() {
        assert_eq!(
            normalize_phone("+44 20 7946 0958").as_deref(),
            Ok("+442079460958")
        );
    }

    // spec: PUB-020
    #[test]
    fn invalid_numbers_are_refused() {
        for bad in [
            "12",
            "abc",
            "",
            "06 12 34",
            "+999 123",
            "0612345678901234567890",
        ] {
            assert_eq!(normalize_phone(bad), Err(InvalidPhone), "{bad}");
        }
    }

    // spec: PUB-020
    #[test]
    fn phone_is_displayed_internationally() {
        assert_eq!(format_international("+33612345678"), "+33 6 12 34 56 78");
        assert_eq!(format_international("+442079460958"), "+44 20 7946 0958");
        assert_eq!(format_international("garbage"), "garbage");
    }
}
