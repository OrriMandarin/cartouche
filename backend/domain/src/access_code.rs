//! Event access codes: comparison ignores case, surrounding spaces and accents (EVT-011).

use crate::text::fold;

/// Folds a code to its comparison form: trimmed, accents removed, lowercase.
pub fn fold_access_code(input: &str) -> String {
    fold(input)
}

/// Whether the code typed by a visitor matches the stored code (EVT-011).
pub fn access_code_matches(stored: &str, typed: &str) -> bool {
    fold_access_code(stored) == fold_access_code(typed)
}

#[cfg(test)]
mod tests {
    use super::*;

    // spec: EVT-011
    #[test]
    fn access_code_ignores_case_spaces_and_accents() {
        assert!(access_code_matches("Château", "  chateau "));
        assert!(access_code_matches("Château", "CHÂTEAU"));
        assert!(access_code_matches("Œuf", "œuf"));
        assert!(!access_code_matches("Château", "chateaux"));
        assert!(!access_code_matches("Châ teau", "chateau"));
    }

    // spec: EVT-011
    #[test]
    fn decomposed_and_composed_accents_match() {
        assert!(access_code_matches("Cha\u{302}teau", "Château"));
        assert_eq!(fold_access_code("  É\u{301}té "), "ete");
    }
}
