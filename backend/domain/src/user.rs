use std::str::FromStr;

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub enum UserStatus {
    Pending,
    Approved,
    Rejected,
    Suspended,
}

impl UserStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            UserStatus::Pending => "pending",
            UserStatus::Approved => "approved",
            UserStatus::Rejected => "rejected",
            UserStatus::Suspended => "suspended",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("unknown user status: {0:?}")]
pub struct ParseUserStatusError(pub String);

impl FromStr for UserStatus {
    type Err = ParseUserStatusError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "pending" => Ok(UserStatus::Pending),
            "approved" => Ok(UserStatus::Approved),
            "rejected" => Ok(UserStatus::Rejected),
            "suspended" => Ok(UserStatus::Suspended),
            other => Err(ParseUserStatusError(other.to_string())),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SignupMode {
    Approval,
    Open,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("unknown signup mode: {0:?}")]
pub struct ParseSignupModeError(pub String);

impl FromStr for SignupMode {
    type Err = ParseSignupModeError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "approval" => Ok(SignupMode::Approval),
            "open" => Ok(SignupMode::Open),
            "closed" => Ok(SignupMode::Closed),
            other => Err(ParseSignupModeError(other.to_string())),
        }
    }
}

/// Signup is closed: no account may be created.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
#[error("signup is closed")]
pub struct SignupClosed;

/// Status of a freshly created account. Admins are always approved, whatever the mode.
pub fn initial_status(mode: SignupMode, is_admin: bool) -> Result<UserStatus, SignupClosed> {
    if is_admin {
        return Ok(UserStatus::Approved);
    }
    match mode {
        SignupMode::Approval => Ok(UserStatus::Pending),
        SignupMode::Open => Ok(UserStatus::Approved),
        SignupMode::Closed => Err(SignupClosed),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
#[error("invalid status transition: {from:?} -> {to:?}")]
pub struct InvalidTransition {
    pub from: UserStatus,
    pub to: UserStatus,
}

/// Allowed: pending -> approved | rejected, rejected -> approved, approved -> suspended,
/// suspended -> approved.
pub fn check_transition(from: UserStatus, to: UserStatus) -> Result<(), InvalidTransition> {
    use UserStatus::{Approved, Pending, Rejected, Suspended};
    match (from, to) {
        (Pending, Approved | Rejected)
        | (Rejected, Approved)
        | (Approved, Suspended)
        | (Suspended, Approved) => Ok(()),
        _ => Err(InvalidTransition { from, to }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use SignupMode::{Approval, Closed, Open};
    use UserStatus::{Approved, Pending, Rejected, Suspended};

    // spec: ACC-002
    #[test]
    fn approval_mode_starts_pending() {
        assert_eq!(initial_status(Approval, false), Ok(Pending));
    }

    // spec: ACC-002
    #[test]
    fn open_mode_starts_approved() {
        assert_eq!(initial_status(Open, false), Ok(Approved));
    }

    // spec: ACC-002
    #[test]
    fn closed_mode_refuses() {
        assert_eq!(initial_status(Closed, false), Err(SignupClosed));
    }

    // spec: ACC-002
    #[test]
    fn admin_always_approved() {
        for mode in [Approval, Open, Closed] {
            assert_eq!(initial_status(mode, true), Ok(Approved));
        }
    }

    // spec: ADM-003
    #[test]
    fn only_allowed_transitions_pass() {
        let all = [Pending, Approved, Rejected, Suspended];
        let allowed = [
            (Pending, Approved),
            (Pending, Rejected),
            (Rejected, Approved),
            (Approved, Suspended),
            (Suspended, Approved),
        ];
        let mut ok_count = 0;
        for from in all {
            for to in all {
                let result = check_transition(from, to);
                if allowed.contains(&(from, to)) {
                    assert_eq!(result, Ok(()), "{from:?} -> {to:?} should pass");
                    ok_count += 1;
                } else {
                    assert_eq!(
                        result,
                        Err(InvalidTransition { from, to }),
                        "{from:?} -> {to:?} should be refused"
                    );
                }
            }
        }
        assert_eq!(ok_count, 5);
    }

    #[test]
    fn status_string_round_trip() {
        for (s, status) in [
            ("pending", Pending),
            ("approved", Approved),
            ("rejected", Rejected),
            ("suspended", Suspended),
        ] {
            assert_eq!(status.as_str(), s);
            assert_eq!(s.parse::<UserStatus>(), Ok(status));
        }
        assert!("PENDING".parse::<UserStatus>().is_err());
    }

    #[test]
    fn status_serde_is_snake_case() {
        for status in [Pending, Approved, Rejected, Suspended] {
            let json = serde_json::to_string(&status).unwrap();
            assert_eq!(json, format!("\"{}\"", status.as_str()));
            assert_eq!(serde_json::from_str::<UserStatus>(&json).unwrap(), status);
        }
    }

    #[test]
    fn signup_mode_parses() {
        assert_eq!("approval".parse::<SignupMode>(), Ok(Approval));
        assert_eq!("open".parse::<SignupMode>(), Ok(Open));
        assert_eq!("closed".parse::<SignupMode>(), Ok(Closed));
        assert!("whatever".parse::<SignupMode>().is_err());
        assert!("".parse::<SignupMode>().is_err());
    }
}
