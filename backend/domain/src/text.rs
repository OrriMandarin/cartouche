use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};

/// Normalizes user-provided text to NFC and trims surrounding whitespace.
pub fn normalize(input: &str) -> String {
    input.nfc().collect::<String>().trim().to_string()
}

/// Folds a text to its comparison form: trimmed, accents removed, lowercase.
pub fn fold(input: &str) -> String {
    input
        .trim()
        .nfd()
        .filter(|c| !is_combining_mark(*c))
        .collect::<String>()
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_composes_and_trims() {
        assert_eq!(normalize("  E\u{0301}loi\u{0308}se "), "Éloïse");
    }

    #[test]
    fn fold_ignores_case_accents_and_surrounding_spaces() {
        assert_eq!(fold("  Éloïse  "), "eloise");
        assert_eq!(fold("E\u{0301}te\u{0301}"), "ete");
    }
}
