//! Card slugs: parsing, suggestion from a name, and claim decisions.
//!
//! A slug is 3 to 64 characters of `[a-z0-9]` separated by single dashes (LNK-018).

use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};
use uuid::Uuid;

const MIN_LEN: usize = 3;
const MAX_LEN: usize = 64;

/// A validated card slug.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Slug(String);

/// The input is not a valid slug (LNK-018).
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("invalid slug")]
pub struct InvalidSlug;

impl Slug {
    /// Trims and lowercases `input`, then checks the slug shape.
    pub fn parse(input: &str) -> Result<Slug, InvalidSlug> {
        let candidate = input.trim().to_lowercase();
        if is_valid(&candidate) {
            Ok(Slug(candidate))
        } else {
            Err(InvalidSlug)
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

fn is_valid(candidate: &str) -> bool {
    (MIN_LEN..=MAX_LEN).contains(&candidate.len())
        && candidate.split('-').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        })
}

/// Puts `text` into slug form (LNK-019): accents removed, lowercase, every other run of
/// characters replaced by one hyphen, ligatures transliterated, then cut to `max_chars` without a
/// trailing hyphen. `None` when nothing is left.
pub fn slug_form(text: &str, max_chars: usize) -> Option<String> {
    let mut slug = String::new();
    let mut pending_dash = false;
    for c in text.to_lowercase().nfd().filter(|c| !is_combining_mark(*c)) {
        let replacement = match c {
            'ß' => "ss",
            'æ' => "ae",
            'œ' => "oe",
            'ø' => "o",
            'đ' => "d",
            'ł' => "l",
            _ => "",
        };
        if !replacement.is_empty() || c.is_ascii_lowercase() || c.is_ascii_digit() {
            if pending_dash && !slug.is_empty() {
                slug.push('-');
            }
            pending_dash = false;
            if replacement.is_empty() {
                slug.push(c);
            } else {
                slug.push_str(replacement);
            }
        } else {
            pending_dash = true;
        }
    }
    // The slug is ASCII: a byte is a character.
    slug.truncate(max_chars);
    let trimmed = slug.trim_end_matches('-');
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

/// Builds the slug proposed for a new card from the owner's names (LNK-019).
///
/// Returns `None` when fewer than 3 usable characters remain.
pub fn suggest_base(first_name: &str, last_name: &str) -> Option<Slug> {
    slug_form(&format!("{first_name} {last_name}"), MAX_LEN)
        .filter(|slug| slug.len() >= MIN_LEN)
        .map(Slug)
}

/// Appends `-n` to `base`, shortening the base so the result fits in 64 characters.
pub fn with_suffix(base: &Slug, n: u32) -> Slug {
    let suffix = format!("-{n}");
    let mut stem = base.0.clone();
    stem.truncate(MAX_LEN - suffix.len());
    Slug(format!("{}{suffix}", stem.trim_end_matches('-')))
}

/// What the store knows about a slug that is already recorded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SlugRecord {
    pub owner_id: Uuid,
    /// `None` when the card that held the slug has been deleted (the slug stays reserved).
    pub card_id: Option<Uuid>,
    pub is_current: bool,
}

/// How a slug claim is to be carried out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlugClaim {
    /// Nobody holds the slug.
    New,
    /// It is already the card's current slug.
    AlreadyCurrent,
    /// It is an old slug of the card, which becomes current again (LNK-025).
    ReclaimOwn,
    /// It is reserved by the owner after its card was deleted (LNK-014).
    AttachReserved,
}

/// Why a slug claim is refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum SlugClaimError {
    /// Another user holds it (LNK-022, LNK-013).
    #[error("slug taken")]
    Taken,
    /// The owner's other live card holds it (LNK-004, LNK-025).
    #[error("slug reserved")]
    Reserved,
}

/// Decides whether `owner_id` may claim a slug for `card_id` (`None` for a card being created).
pub fn decide_claim(
    existing: Option<&SlugRecord>,
    owner_id: Uuid,
    card_id: Option<Uuid>,
) -> Result<SlugClaim, SlugClaimError> {
    let Some(record) = existing else {
        return Ok(SlugClaim::New);
    };
    if record.owner_id != owner_id {
        return Err(SlugClaimError::Taken);
    }
    match record.card_id {
        None => Ok(SlugClaim::AttachReserved),
        Some(holder) if Some(holder) == card_id && record.is_current => {
            Ok(SlugClaim::AlreadyCurrent)
        }
        Some(holder) if Some(holder) == card_id => Ok(SlugClaim::ReclaimOwn),
        Some(_) => Err(SlugClaimError::Reserved),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // spec: LNK-018
    #[test]
    fn parse_trims_and_lowercases() {
        assert_eq!(
            Slug::parse("  Alice-Durand ").unwrap().as_str(),
            "alice-durand"
        );
    }

    // spec: LNK-018
    #[test]
    fn parse_rejects_bad_shapes() {
        for s in [
            "ab",
            "-alice",
            "alice-",
            "al--ice",
            "éloïse",
            "a b c",
            &"a".repeat(65),
        ] {
            assert!(Slug::parse(s).is_err(), "{s}");
        }
    }

    // spec: LNK-018
    #[test]
    fn parse_accepts_bounds() {
        assert!(Slug::parse("abc").is_ok());
        assert!(Slug::parse(&"a".repeat(64)).is_ok());
    }

    // spec: LNK-001, LNK-019
    #[test]
    fn suggestion_strips_accents() {
        assert_eq!(
            suggest_base("Éloïse", "D'Aubigné-Müller").unwrap().as_str(),
            "eloise-d-aubigne-muller"
        );
    }

    // spec: LNK-001, LNK-019
    #[test]
    fn suggestion_transliterates_ligatures() {
        assert_eq!(
            suggest_base("Œdipe", "Straße").unwrap().as_str(),
            "oedipe-strasse"
        );
    }

    // spec: LNK-001, LNK-019
    #[test]
    fn suggestion_is_none_when_too_short() {
        assert_eq!(suggest_base("", "Li"), None);
        assert_eq!(suggest_base("✨", ""), None);
    }

    // spec: LNK-019
    #[test]
    fn slug_form_matches_the_suggestion() {
        for (first, last) in [("Éloïse", "D'Aubigné-Müller"), ("Œdipe", "Straße")] {
            assert_eq!(
                slug_form(&format!("{first} {last}"), MAX_LEN).as_deref(),
                suggest_base(first, last).as_ref().map(Slug::as_str)
            );
        }
    }

    // spec: LNK-019
    #[test]
    fn slug_form_cuts_and_may_be_empty() {
        assert_eq!(slug_form("!!! ✨", 40), None);
        assert_eq!(slug_form("ab", 40).as_deref(), Some("ab"));
        assert_eq!(slug_form("ab-cd ef", 3).as_deref(), Some("ab"));
        assert_eq!(slug_form("Æon Łódź", 40).as_deref(), Some("aeon-lodz"));
    }

    // spec: LNK-019
    #[test]
    fn suggestion_is_truncated_without_trailing_dash() {
        let long_first = format!("{}-b", "a".repeat(63));
        let slug = suggest_base(&long_first, "c").unwrap();
        assert_eq!(slug.as_str(), "a".repeat(63));
    }

    // spec: LNK-019
    #[test]
    fn suffix_fits_in_64() {
        let base = Slug::parse(&"a".repeat(64)).unwrap();
        assert_eq!(with_suffix(&base, 12).as_str().len(), 64);
        assert!(with_suffix(&base, 12).as_str().ends_with("-12"));
    }

    // spec: LNK-019
    #[test]
    fn suffix_drops_trailing_dash_left_by_truncation() {
        let base = Slug::parse(&format!("{}-bcd", "a".repeat(60))).unwrap();
        assert_eq!(base.as_str().len(), 64);
        assert_eq!(
            with_suffix(&base, 12).as_str(),
            format!("{}-12", "a".repeat(60))
        );
    }

    // spec: LNK-019
    #[test]
    fn suffix_is_appended_when_it_fits() {
        let base = Slug::parse("alice-durand").unwrap();
        assert_eq!(with_suffix(&base, 2).as_str(), "alice-durand-2");
    }

    fn id(n: u128) -> Uuid {
        Uuid::from_u128(n)
    }

    fn record(owner: u128, card: Option<u128>, is_current: bool) -> SlugRecord {
        SlugRecord {
            owner_id: id(owner),
            card_id: card.map(id),
            is_current,
        }
    }

    // spec: LNK-004, LNK-013, LNK-014, LNK-022, LNK-025
    #[test]
    fn claim_decisions() {
        let me = id(1);
        let card = Some(id(10));

        // Free slug.
        assert_eq!(decide_claim(None, me, card), Ok(SlugClaim::New));
        assert_eq!(decide_claim(None, me, None), Ok(SlugClaim::New));

        // Current slug of this very card.
        assert_eq!(
            decide_claim(Some(&record(1, Some(10), true)), me, card),
            Ok(SlugClaim::AlreadyCurrent)
        );
        // Old slug of this very card.
        assert_eq!(
            decide_claim(Some(&record(1, Some(10), false)), me, card),
            Ok(SlugClaim::ReclaimOwn)
        );

        // Mine, card deleted: reserved slug can be attached to another or new card.
        assert_eq!(
            decide_claim(Some(&record(1, None, false)), me, card),
            Ok(SlugClaim::AttachReserved)
        );
        assert_eq!(
            decide_claim(Some(&record(1, None, false)), me, None),
            Ok(SlugClaim::AttachReserved)
        );

        // Mine, but held by another live card (old or current slug), or by a card being created.
        for is_current in [false, true] {
            assert_eq!(
                decide_claim(Some(&record(1, Some(11), is_current)), me, card),
                Err(SlugClaimError::Reserved)
            );
            assert_eq!(
                decide_claim(Some(&record(1, Some(11), is_current)), me, None),
                Err(SlugClaimError::Reserved)
            );
        }

        // Someone else's, whatever its state.
        for existing in [
            record(2, Some(20), true),
            record(2, Some(20), false),
            record(2, None, false),
        ] {
            assert_eq!(
                decide_claim(Some(&existing), me, card),
                Err(SlugClaimError::Taken)
            );
            assert_eq!(
                decide_claim(Some(&existing), me, None),
                Err(SlugClaimError::Taken)
            );
        }
    }
}
