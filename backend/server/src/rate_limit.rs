//! The per-IP rate limiter behind a trait (ABU-006, ABU-007).

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Mutex;

use cartouche_domain::{
    RateLimit, SlidingWindow, failed_access_codes_per_ip, lead_submissions_per_ip, rate_limit_key,
};
use chrono::{DateTime, TimeDelta, Utc};

/// What is counted. Each bucket has its own limit and its own counter per address.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Bucket {
    /// Lead submissions, accepted or refused (ABU-006).
    LeadSubmission,
    /// Wrong event access codes (ABU-007).
    FailedAccessCode,
}

impl Bucket {
    pub fn limit(self) -> RateLimit {
        match self {
            Bucket::LeadSubmission => lead_submissions_per_ip(),
            Bucket::FailedAccessCode => failed_access_codes_per_ip(),
        }
    }
}

/// How long to wait before retrying, in seconds: at least 1, rounded up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetryAfter(pub u64);

pub trait RateLimiter: Send + Sync {
    /// `Ok` while `ip` has not used up the bucket; does not count anything.
    fn check(&self, bucket: Bucket, ip: IpAddr, now: DateTime<Utc>) -> Result<(), RetryAfter>;

    /// Counts one event for `ip`.
    fn record(&self, bucket: Bucket, ip: IpAddr, now: DateTime<Utc>);

    /// `check` then `record` as one step: concurrent callers cannot exceed the limit.
    fn hit(&self, bucket: Bucket, ip: IpAddr, now: DateTime<Utc>) -> Result<(), RetryAfter>;

    /// Forgets every counter (`POST /api/test/reset`).
    #[cfg(feature = "test-support")]
    fn reset(&self);
}

/// Counters in the memory of this process (one API instance).
#[derive(Default)]
pub struct InMemoryRateLimiter {
    inner: Mutex<Counters>,
}

#[derive(Default)]
struct Counters {
    windows: HashMap<(Bucket, IpAddr), SlidingWindow>,
    calls: usize,
}

/// Counters are dropped once idle, checked every this many calls.
const PURGE_EVERY: usize = 1_024;

impl Counters {
    fn check(&mut self, bucket: Bucket, ip: IpAddr, now: DateTime<Utc>) -> Result<(), RetryAfter> {
        self.count_call(now);
        match self.windows.get_mut(&(bucket, rate_limit_key(ip))) {
            Some(window) => window
                .check(now, &bucket.limit())
                .map_err(|wait| RetryAfter(ceil_seconds(wait))),
            None => Ok(()),
        }
    }

    fn record(&mut self, bucket: Bucket, ip: IpAddr, now: DateTime<Utc>) {
        self.count_call(now);
        self.windows
            .entry((bucket, rate_limit_key(ip)))
            .or_default()
            .record(now);
    }

    fn count_call(&mut self, now: DateTime<Utc>) {
        self.calls += 1;
        if self.calls >= PURGE_EVERY {
            self.calls = 0;
            self.windows
                .retain(|(bucket, _), window| !window.is_idle(now, &bucket.limit()));
        }
    }
}

/// Whole seconds, rounded up, at least 1.
fn ceil_seconds(wait: TimeDelta) -> u64 {
    let seconds = wait.num_seconds();
    let rounded = if wait > TimeDelta::seconds(seconds) {
        seconds + 1
    } else {
        seconds
    };
    u64::try_from(rounded).unwrap_or(0).max(1)
}

impl InMemoryRateLimiter {
    fn counters(&self) -> std::sync::MutexGuard<'_, Counters> {
        // The counters stay consistent if a holder panicked: keep serving.
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
}

impl RateLimiter for InMemoryRateLimiter {
    fn check(&self, bucket: Bucket, ip: IpAddr, now: DateTime<Utc>) -> Result<(), RetryAfter> {
        self.counters().check(bucket, ip, now)
    }

    fn record(&self, bucket: Bucket, ip: IpAddr, now: DateTime<Utc>) {
        self.counters().record(bucket, ip, now);
    }

    fn hit(&self, bucket: Bucket, ip: IpAddr, now: DateTime<Utc>) -> Result<(), RetryAfter> {
        let mut counters = self.counters();
        counters.check(bucket, ip, now)?;
        counters.record(bucket, ip, now);
        Ok(())
    }

    #[cfg(feature = "test-support")]
    fn reset(&self) {
        *self.counters() = Counters::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn t0() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 6, 1, 10, 0, 0).unwrap()
    }

    fn ip(text: &str) -> IpAddr {
        text.parse().unwrap()
    }

    impl InMemoryRateLimiter {
        fn tracked_windows(&self) -> usize {
            self.inner.lock().unwrap().windows.len()
        }
    }

    // spec: ABU-006, ABU-007
    #[test]
    fn buckets_and_addresses_are_counted_apart() {
        let limiter = InMemoryRateLimiter::default();
        let (busy, other) = (ip("203.0.113.7"), ip("203.0.113.8"));
        for _ in 0..Bucket::LeadSubmission.limit().max {
            limiter.hit(Bucket::LeadSubmission, busy, t0()).unwrap();
        }
        assert_eq!(
            limiter.check(Bucket::LeadSubmission, busy, t0()),
            Err(RetryAfter(600))
        );
        assert_eq!(limiter.check(Bucket::FailedAccessCode, busy, t0()), Ok(()));
        assert_eq!(limiter.check(Bucket::LeadSubmission, other, t0()), Ok(()));
        // 120 per window: the 121st is refused and not counted.
        assert!(
            limiter
                .hit(Bucket::LeadSubmission, busy, t0() + TimeDelta::minutes(5))
                .is_err()
        );
        assert_eq!(
            limiter.check(Bucket::LeadSubmission, busy, t0() + TimeDelta::minutes(10)),
            Ok(())
        );
    }

    // spec: ABU-007
    #[test]
    fn check_does_not_count_and_record_does() {
        let limiter = InMemoryRateLimiter::default();
        let visitor = ip("203.0.113.7");
        for _ in 0..100 {
            limiter
                .check(Bucket::FailedAccessCode, visitor, t0())
                .unwrap();
        }
        for _ in 0..Bucket::FailedAccessCode.limit().max {
            limiter.record(Bucket::FailedAccessCode, visitor, t0());
        }
        assert_eq!(
            limiter.check(Bucket::FailedAccessCode, visitor, t0()),
            Err(RetryAfter(600))
        );
    }

    // spec: ABU-006
    #[test]
    fn retry_after_is_at_least_one_second_and_rounded_up() {
        let limiter = InMemoryRateLimiter::default();
        let visitor = ip("203.0.113.7");
        for _ in 0..Bucket::FailedAccessCode.limit().max {
            limiter.record(Bucket::FailedAccessCode, visitor, t0());
        }
        let almost = t0() + TimeDelta::minutes(10) - TimeDelta::milliseconds(1);
        assert_eq!(
            limiter.check(Bucket::FailedAccessCode, visitor, almost),
            Err(RetryAfter(1))
        );
        let part = t0() + TimeDelta::minutes(10) - TimeDelta::milliseconds(1_500);
        assert_eq!(
            limiter.check(Bucket::FailedAccessCode, visitor, part),
            Err(RetryAfter(2))
        );
    }

    // spec: ABU-008
    #[test]
    fn addresses_of_one_ipv6_prefix_share_a_counter() {
        let limiter = InMemoryRateLimiter::default();
        for _ in 0..Bucket::LeadSubmission.limit().max {
            limiter
                .hit(Bucket::LeadSubmission, ip("2001:db8::1"), t0())
                .unwrap();
        }
        assert!(
            limiter
                .check(Bucket::LeadSubmission, ip("2001:db8::ffff:1"), t0())
                .is_err()
        );
        assert!(
            limiter
                .check(Bucket::LeadSubmission, ip("2001:db8:0:1::1"), t0())
                .is_ok()
        );
    }

    // spec: ABU-006
    #[test]
    fn idle_windows_are_purged() {
        let limiter = InMemoryRateLimiter::default();
        for n in 0..2_000u32 {
            let visitor = IpAddr::V4(std::net::Ipv4Addr::from(0x0A00_0000 + n));
            limiter.record(Bucket::LeadSubmission, visitor, t0());
        }
        assert_eq!(limiter.tracked_windows(), 2_000);
        let later = t0() + TimeDelta::minutes(11);
        let active = ip("203.0.113.7");
        limiter.record(Bucket::LeadSubmission, active, later);
        for _ in 0..1_024 {
            let _ = limiter.check(Bucket::LeadSubmission, active, later);
        }
        assert_eq!(limiter.tracked_windows(), 1);
    }

    // spec: ABU-006
    #[cfg(feature = "test-support")]
    #[test]
    fn reset_forgets_every_counter() {
        let limiter = InMemoryRateLimiter::default();
        let visitor = ip("203.0.113.7");
        for _ in 0..Bucket::LeadSubmission.limit().max {
            limiter.hit(Bucket::LeadSubmission, visitor, t0()).unwrap();
        }
        limiter.reset();
        assert_eq!(limiter.check(Bucket::LeadSubmission, visitor, t0()), Ok(()));
    }

    // spec: ABU-006
    #[test]
    fn concurrent_hits_never_exceed_the_limit() {
        let limiter = std::sync::Arc::new(InMemoryRateLimiter::default());
        let visitor = ip("203.0.113.7");
        let admitted: usize = (0..8)
            .map(|_| {
                let limiter = limiter.clone();
                std::thread::spawn(move || {
                    (0..50)
                        .filter(|_| limiter.hit(Bucket::LeadSubmission, visitor, t0()).is_ok())
                        .count()
                })
            })
            .collect::<Vec<_>>()
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .sum();
        assert_eq!(admitted, 120);
    }
}
