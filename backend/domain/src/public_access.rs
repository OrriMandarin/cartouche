//! What a visitor gets for a slug, decided from how the slug matched (LNK-003, LNK-021,
//! LNK-026, LNK-027).

/// How the slug matched, with whether the card is publicly served (active, owner approved).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlugMatch {
    /// The card's current slug.
    Current { served: bool },
    /// An old slug of the card.
    Old { served: bool },
    /// A slug of a card that no longer exists.
    Deleted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PublicAccess {
    /// Show the card.
    Serve,
    /// Send the visitor to the card's current address.
    Redirect,
    /// Say nothing but that the card is not available.
    Inactive,
}

/// `typed_as_stored` tells whether the slug was typed exactly as stored (lowercase). A card
/// that is not served is neutral from every address, so that nothing tells why, nor where its
/// current slug is (LNK-027).
pub fn public_access(found: SlugMatch, typed_as_stored: bool) -> PublicAccess {
    match found {
        SlugMatch::Deleted
        | SlugMatch::Current { served: false }
        | SlugMatch::Old { served: false } => PublicAccess::Inactive,
        SlugMatch::Old { served: true } => PublicAccess::Redirect,
        SlugMatch::Current { served: true } if !typed_as_stored => PublicAccess::Redirect,
        SlugMatch::Current { served: true } => PublicAccess::Serve,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // spec: LNK-003, LNK-021, LNK-026, LNK-027
    #[test]
    fn public_access_decisions() {
        use PublicAccess::*;
        assert_eq!(
            public_access(SlugMatch::Current { served: true }, true),
            Serve
        );
        assert_eq!(
            public_access(SlugMatch::Current { served: true }, false),
            Redirect
        );
        assert_eq!(
            public_access(SlugMatch::Old { served: true }, true),
            Redirect
        );
        assert_eq!(
            public_access(SlugMatch::Old { served: true }, false),
            Redirect
        );
        for typed in [true, false] {
            assert_eq!(
                public_access(SlugMatch::Current { served: false }, typed),
                Inactive
            );
            assert_eq!(
                public_access(SlugMatch::Old { served: false }, typed),
                Inactive
            );
            assert_eq!(public_access(SlugMatch::Deleted, typed), Inactive);
        }
    }
}
