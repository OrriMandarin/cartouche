use std::sync::RwLock;

use chrono::{DateTime, Duration, Utc};

/// Source of the current time, injectable so rules and tests never read the system clock directly.
pub trait Clock: Send + Sync {
    fn now(&self) -> DateTime<Utc>;
}

/// The real clock.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }
}

/// A frozen clock for unit and integration tests.
#[derive(Debug)]
pub struct ManualClock {
    now: RwLock<DateTime<Utc>>,
}

impl ManualClock {
    pub fn new(now: DateTime<Utc>) -> Self {
        Self {
            now: RwLock::new(now),
        }
    }

    pub fn set(&self, now: DateTime<Utc>) {
        *self.now.write().unwrap_or_else(|e| e.into_inner()) = now;
    }

    pub fn advance(&self, by: Duration) {
        let mut guard = self.now.write().unwrap_or_else(|e| e.into_inner());
        *guard += by;
    }
}

impl Clock for ManualClock {
    fn now(&self) -> DateTime<Utc> {
        *self.now.read().unwrap_or_else(|e| e.into_inner())
    }
}

/// Clock for `development` and `test` environments: follows system time until a value is forced.
#[derive(Debug, Default)]
pub struct OverridableClock {
    forced: RwLock<Option<DateTime<Utc>>>,
}

impl OverridableClock {
    pub fn new() -> Self {
        Self::default()
    }

    /// `Some(t)` freezes the clock at `t`; `None` goes back to system time.
    pub fn set(&self, forced: Option<DateTime<Utc>>) {
        *self.forced.write().unwrap_or_else(|e| e.into_inner()) = forced;
    }
}

impl Clock for OverridableClock {
    fn now(&self) -> DateTime<Utc> {
        let forced = *self.forced.read().unwrap_or_else(|e| e.into_inner());
        forced.unwrap_or_else(Utc::now)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Duration, TimeZone, Utc};

    #[test]
    fn manual_clock_advances() {
        let t0 = Utc.with_ymd_and_hms(2026, 1, 1, 12, 0, 0).unwrap();
        let clock = ManualClock::new(t0);
        assert_eq!(clock.now(), t0);
        clock.advance(Duration::hours(2));
        assert_eq!(clock.now(), t0 + Duration::hours(2));
        let t1 = Utc.with_ymd_and_hms(2030, 6, 1, 0, 0, 0).unwrap();
        clock.set(t1);
        assert_eq!(clock.now(), t1);
    }

    #[test]
    fn overridable_clock_follows_system_time_until_set() {
        let clock = OverridableClock::new();
        let near_now = |t: chrono::DateTime<Utc>| (Utc::now() - t).num_seconds().abs() < 5;
        assert!(near_now(clock.now()));

        let forced = Utc.with_ymd_and_hms(2020, 2, 3, 4, 5, 6).unwrap();
        clock.set(Some(forced));
        assert_eq!(clock.now(), forced);

        clock.set(None);
        assert!(near_now(clock.now()));
    }

    #[test]
    fn system_clock_is_close_to_utc_now() {
        assert!((Utc::now() - SystemClock.now()).num_seconds().abs() < 5);
    }
}
