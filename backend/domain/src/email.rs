//! Plausibility check for the email address shown on a card (PUB-020).

const MAX_LEN: usize = 254;

/// One `@`, a non-empty local part, a dotted domain with no empty label, no whitespace,
/// at most 254 characters.
pub fn is_valid_email(input: &str) -> bool {
    if input.chars().count() > MAX_LEN || input.chars().any(char::is_whitespace) {
        return false;
    }
    let Some((local, domain)) = input.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && !domain.contains('@')
        && domain.contains('.')
        && domain.split('.').all(|label| !label.is_empty())
}
#[cfg(test)]
mod tests {
    use super::*;

    // spec: PUB-020
    #[test]
    fn plausible_addresses_pass() {
        for ok in [
            "alice@example.org",
            "a.b+tag@sub.example.co",
            "éloïse@exemple.fr",
        ] {
            assert!(is_valid_email(ok), "{ok}");
        }
    }

    // spec: PUB-020
    #[test]
    fn malformed_addresses_fail() {
        for bad in [
            "",
            "alice@",
            "@example.org",
            "alice",
            "alice@example",
            "a@@example.org",
            "a@b@example.org",
            "al ice@example.org",
            "alice@exa mple.org",
            "alice@.org",
            "alice@example.",
            "alice@exa..mple.org",
        ] {
            assert!(!is_valid_email(bad), "{bad:?}");
        }
    }

    // spec: PUB-020
    #[test]
    fn length_is_capped_at_254_characters() {
        let domain = "@example.org";
        let ok = format!("{}{domain}", "a".repeat(254 - domain.len()));
        assert!(is_valid_email(&ok));
        assert!(!is_valid_email(&format!("a{ok}")));
    }
}
