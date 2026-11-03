//! Per-IP rate limits: the limits themselves, the sliding window and the key an address
//! is counted under (ABU-006, ABU-007, ABU-008).

use std::collections::VecDeque;
use std::net::{IpAddr, Ipv6Addr};

use chrono::{DateTime, TimeDelta, Utc};

/// At most `max` events on any sliding window of length `window`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RateLimit {
    pub max: usize,
    pub window: TimeDelta,
}

/// Lead submissions per IP address, accepted or refused (ABU-006).
pub fn lead_submissions_per_ip() -> RateLimit {
    RateLimit {
        max: 120,
        window: TimeDelta::minutes(10),
    }
}

/// Wrong access codes per IP address (ABU-007).
pub fn failed_access_codes_per_ip() -> RateLimit {
    RateLimit {
        max: 30,
        window: TimeDelta::minutes(10),
    }
}

/// The instants of the events still inside the window of one counter.
#[derive(Debug, Default)]
pub struct SlidingWindow {
    events: VecDeque<DateTime<Utc>>,
}

impl SlidingWindow {
    /// Forgets the events that left the window: an event exactly `window` old no longer counts.
    fn expire(&mut self, now: DateTime<Utc>, limit: &RateLimit) {
        let cutoff = now - limit.window;
        while self.events.front().is_some_and(|at| *at <= cutoff) {
            self.events.pop_front();
        }
    }

    /// `Ok` while another event fits; otherwise how long to wait until the oldest one leaves.
    pub fn check(&mut self, now: DateTime<Utc>, limit: &RateLimit) -> Result<(), TimeDelta> {
        self.expire(now, limit);
        if self.events.len() < limit.max {
            return Ok(());
        }
        let oldest = self.events.front().copied().unwrap_or(now);
        Err((oldest + limit.window - now).max(TimeDelta::zero()))
    }

    pub fn record(&mut self, now: DateTime<Utc>) {
        self.events.push_back(now);
    }

    /// Whether no event is left in the window: the counter can be dropped.
    pub fn is_idle(&mut self, now: DateTime<Utc>, limit: &RateLimit) -> bool {
        self.expire(now, limit);
        self.events.is_empty()
    }
}

/// The key an address is counted under: its /64 prefix for IPv6, the address itself for IPv4
/// (ABU-008). An IPv4-mapped IPv6 address counts as the IPv4 address it carries.
pub fn rate_limit_key(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V4(_) => ip,
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => IpAddr::V4(v4),
            None => {
                let prefix = u128::from(v6) & (u128::MAX << 64);
                IpAddr::V6(Ipv6Addr::from(prefix))
            }
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn t0() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 6, 1, 10, 0, 0).unwrap()
    }

    fn admit(window: &mut SlidingWindow, now: DateTime<Utc>, count: usize, limit: &RateLimit) {
        for _ in 0..count {
            window.check(now, limit).expect("admitted");
            window.record(now);
        }
    }

    // spec: ABU-006
    #[test]
    fn window_admits_up_to_max_then_says_when_to_retry() {
        let limit = lead_submissions_per_ip();
        assert_eq!((limit.max, limit.window), (120, TimeDelta::minutes(10)));
        let mut window = SlidingWindow::default();
        admit(&mut window, t0(), 120, &limit);
        assert_eq!(window.check(t0(), &limit), Err(TimeDelta::minutes(10)));
        assert_eq!(
            window.check(t0() + TimeDelta::minutes(4), &limit),
            Err(TimeDelta::minutes(6))
        );
        // An event exactly one window old no longer counts.
        assert_eq!(window.check(t0() + TimeDelta::minutes(10), &limit), Ok(()));
    }

    // spec: ABU-006
    #[test]
    fn window_slides() {
        let limit = lead_submissions_per_ip();
        let mut window = SlidingWindow::default();
        admit(&mut window, t0(), 60, &limit);
        admit(&mut window, t0() + TimeDelta::minutes(5), 60, &limit);
        let later = t0() + TimeDelta::minutes(10);
        // The first 60 left the window: 60 more fit, then the next waits for the second batch.
        admit(&mut window, later, 60, &limit);
        assert_eq!(window.check(later, &limit), Err(TimeDelta::minutes(5)));
    }

    // spec: ABU-007
    #[test]
    fn failed_access_codes_are_limited_to_30_per_10_minutes() {
        let limit = failed_access_codes_per_ip();
        assert_eq!((limit.max, limit.window), (30, TimeDelta::minutes(10)));
    }

    // spec: ABU-006
    #[test]
    fn idle_only_once_every_event_left_the_window() {
        let limit = failed_access_codes_per_ip();
        let mut window = SlidingWindow::default();
        assert!(window.is_idle(t0(), &limit));
        window.record(t0());
        assert!(!window.is_idle(t0() + TimeDelta::minutes(9), &limit));
        assert!(window.is_idle(t0() + TimeDelta::minutes(10), &limit));
    }

    // spec: ABU-008
    #[test]
    fn ipv6_counts_for_its_64_prefix() {
        let key = |text: &str| rate_limit_key(text.parse().unwrap());
        assert_eq!(key("2001:db8::1"), key("2001:db8::ffff:1"));
        assert_ne!(key("2001:db8::1"), key("2001:db8:0:1::1"));
        assert_eq!(key("2001:db8::1"), "2001:db8::".parse::<IpAddr>().unwrap());
        assert_eq!(key("203.0.113.7"), "203.0.113.7".parse::<IpAddr>().unwrap());
    }

    // spec: ABU-008
    #[test]
    fn ipv4_mapped_ipv6_counts_as_its_ipv4_address() {
        let key = |text: &str| rate_limit_key(text.parse().unwrap());
        assert_eq!(key("::ffff:203.0.113.7"), key("203.0.113.7"));
        assert_ne!(key("::ffff:203.0.113.7"), key("::ffff:203.0.113.8"));
    }
}
