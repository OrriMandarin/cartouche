use unicode_normalization::UnicodeNormalization;

/// Normalizes user-provided text to NFC and trims surrounding whitespace.
pub fn normalize(input: &str) -> String {
    input.nfc().collect::<String>().trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_composes_and_trims() {
        assert_eq!(normalize("  E\u{0301}loi\u{0308}se "), "Éloïse");
    }
}
