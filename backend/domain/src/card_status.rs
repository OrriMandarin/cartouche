//! Card status derived from the two disable switches (LNK-026, LNK-028).

use serde::{Deserialize, Serialize};

use crate::UserStatus;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub enum CardStatus {
    Active,
    /// Turned off by its owner.
    Disabled,
    /// Turned off by support; the owner cannot turn it back on.
    DisabledBySupport,
}

impl CardStatus {
    /// The support switch wins over the owner switch.
    pub fn of(owner_disabled: bool, support_disabled: bool) -> CardStatus {
        if support_disabled {
            CardStatus::DisabledBySupport
        } else if owner_disabled {
            CardStatus::Disabled
        } else {
            CardStatus::Active
        }
    }
}

/// A card is publicly served only when it is active and its owner is approved.
pub fn is_served(status: CardStatus, owner: UserStatus) -> bool {
    status == CardStatus::Active && owner == UserStatus::Approved
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::UserStatus;

    // spec: LNK-026, LNK-028
    #[test]
    fn support_disable_wins_over_owner_disable() {
        assert_eq!(CardStatus::of(false, false), CardStatus::Active);
        assert_eq!(CardStatus::of(true, false), CardStatus::Disabled);
        assert_eq!(CardStatus::of(false, true), CardStatus::DisabledBySupport);
        assert_eq!(CardStatus::of(true, true), CardStatus::DisabledBySupport);
    }

    // spec: LNK-026, LNK-028, ADM-011
    #[test]
    fn served_only_when_active_and_owner_approved() {
        for status in [
            CardStatus::Active,
            CardStatus::Disabled,
            CardStatus::DisabledBySupport,
        ] {
            for owner in [
                UserStatus::Pending,
                UserStatus::Approved,
                UserStatus::Rejected,
                UserStatus::Suspended,
            ] {
                let expected = status == CardStatus::Active && owner == UserStatus::Approved;
                assert_eq!(is_served(status, owner), expected, "{status:?} / {owner:?}");
            }
        }
    }

    #[test]
    fn status_serializes_in_snake_case() {
        assert_eq!(
            serde_json::to_string(&CardStatus::DisabledBySupport).unwrap(),
            "\"disabled_by_support\""
        );
    }
}
