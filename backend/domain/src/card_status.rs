//! Card status derived from the two disable switches (LNK-026, LNK-028).

use serde::{Deserialize, Serialize};
use thiserror::Error;

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
/// Support asked for a block state the card is already in (ADM-015).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
#[error("the card is already in the requested support state")]
pub struct SupportBlockUnchanged;

/// Blocking an already blocked card, or lifting a block that does not exist, is refused
/// (ADM-015). `blocked_now` is the current state, `block` the requested one.
pub fn check_support_block(blocked_now: bool, block: bool) -> Result<(), SupportBlockUnchanged> {
    if blocked_now == block {
        Err(SupportBlockUnchanged)
    } else {
        Ok(())
    }
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

    // spec: ADM-015
    #[test]
    fn support_block_must_change_state() {
        assert!(check_support_block(false, true).is_ok());
        assert!(check_support_block(true, false).is_ok());
        assert_eq!(check_support_block(true, true), Err(SupportBlockUnchanged));
        assert_eq!(
            check_support_block(false, false),
            Err(SupportBlockUnchanged)
        );
    }

    #[test]
    fn status_serializes_in_snake_case() {
        assert_eq!(
            serde_json::to_string(&CardStatus::DisabledBySupport).unwrap(),
            "\"disabled_by_support\""
        );
    }
}
