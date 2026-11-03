//! What a visitor may do with an event's form: see it, be asked for the code, or be told it is
//! not open, and the outcome of a code attempt (EVT-008, EVT-011, EVT-012, EVT-026, EVT-027).

use chrono::{DateTime, Utc};

use crate::{Period, access_code_matches};

/// What the public form endpoint reveals about an event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PublicFormState {
    /// The form is shown.
    Open,
    /// Only the title is shown, until a correct code is typed.
    CodeRequired,
    /// Outside the submission window: only the title is shown.
    Closed,
}

/// The window comes first: a closed event does not ask for its code (EVT-026, EVT-027).
pub fn public_form_state(
    period: &Period,
    now: DateTime<Utc>,
    has_access_code: bool,
) -> PublicFormState {
    if !period.accepts_submissions(now) {
        PublicFormState::Closed
    } else if has_access_code {
        PublicFormState::CodeRequired
    } else {
        PublicFormState::Open
    }
}

/// The result of a visitor typing a code for an event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnlockOutcome {
    /// The form may be handed out.
    Granted,
    /// Outside the submission window (EVT-026).
    Closed,
    /// A code is required and this one is wrong (EVT-027).
    WrongCode,
}

/// An event without code is unlocked by anything typed; only a failed attempt counts against
/// the rate limit (ABU-007).
pub fn unlock_outcome(
    period: &Period,
    now: DateTime<Utc>,
    stored_code: Option<&str>,
    typed: &str,
) -> UnlockOutcome {
    if !period.accepts_submissions(now) {
        return UnlockOutcome::Closed;
    }
    match stored_code {
        Some(stored) if !access_code_matches(stored, typed) => UnlockOutcome::WrongCode,
        _ => UnlockOutcome::Granted,
    }
}

#[cfg(test)]
mod tests {
    use chrono::{TimeDelta, TimeZone};

    use super::*;

    fn noon() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 1, 15, 12, 0, 0).unwrap()
    }

    fn ending(minutes_from_now: i64) -> Period {
        Period {
            starts_at: noon() - TimeDelta::hours(2),
            ends_at: Some(noon() + TimeDelta::minutes(minutes_from_now)),
        }
    }

    // spec: FRM-024, EVT-026, EVT-027
    #[test]
    fn form_state_puts_the_window_before_the_code() {
        use PublicFormState::*;
        let running = ending(60);
        assert_eq!(public_form_state(&running, noon(), false), Open);
        assert_eq!(public_form_state(&running, noon(), true), CodeRequired);
        let upcoming = Period {
            starts_at: noon() + TimeDelta::minutes(1),
            ends_at: None,
        };
        assert_eq!(public_form_state(&upcoming, noon(), true), Closed);
        assert_eq!(public_form_state(&upcoming, noon(), false), Closed);
        // EVT-008: still open 15 minutes after the end, closed a second later.
        let ended = ending(-15);
        assert_eq!(public_form_state(&ended, noon(), true), CodeRequired);
        let late = noon() + TimeDelta::seconds(1);
        assert_eq!(public_form_state(&ended, late, true), Closed);
        assert_eq!(public_form_state(&ended, late, false), Closed);
    }

    // spec: EVT-011, EVT-026, EVT-027
    #[test]
    fn unlock_outcomes() {
        use UnlockOutcome::*;
        let running = ending(60);
        assert_eq!(
            unlock_outcome(&running, noon(), Some("Château"), "  chateau "),
            Granted
        );
        assert_eq!(
            unlock_outcome(&running, noon(), Some("Château"), "moulin"),
            WrongCode
        );
        assert_eq!(
            unlock_outcome(&running, noon(), Some("Château"), ""),
            WrongCode
        );
        assert_eq!(
            unlock_outcome(&running, noon(), None, "n'importe quoi"),
            Granted
        );
        let ended = ending(-16);
        assert_eq!(
            unlock_outcome(&ended, noon(), Some("Château"), "chateau"),
            Closed
        );
        assert_eq!(
            unlock_outcome(&ended, noon(), Some("Château"), "moulin"),
            Closed
        );
        assert_eq!(unlock_outcome(&ended, noon(), None, "x"), Closed);
    }
}
