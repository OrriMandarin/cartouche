//! The address of the visitor, as seen through the trusted reverse proxies (ABU-008).

use std::convert::Infallible;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};

use axum::extract::{ConnectInfo, FromRequestParts};
use axum::http::request::Parts;

use crate::state::AppState;

/// The `trusted_hops`-th entry of `X-Forwarded-For` counted from the right, which is the one
/// the outermost trusted proxy added: entries to its left were sent by the client and are
/// ignored. Without trusted proxy, with fewer entries, or with an unreadable entry, the
/// address of the connection (`peer`) is returned.
pub fn client_ip(
    forwarded_for: Option<&str>,
    peer: Option<IpAddr>,
    trusted_hops: usize,
) -> Option<IpAddr> {
    let from_header = forwarded_for
        .filter(|_| trusted_hops > 0)
        .and_then(|header| {
            let entries: Vec<&str> = header.split(',').map(str::trim).collect();
            let position = entries.len().checked_sub(trusted_hops)?;
            entries[position].parse::<IpAddr>().ok()
        });
    from_header.or(peer)
}

/// The address requests are counted under. Falls back to `0.0.0.0` when neither the header
/// nor the connection gives one (in-process tests).
pub struct ClientIp(pub IpAddr);

impl FromRequestParts<AppState> for ClientIp {
    type Rejection = Infallible;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let forwarded_for = parts
            .headers
            .get_all("x-forwarded-for")
            .iter()
            .filter_map(|value| value.to_str().ok())
            .collect::<Vec<_>>()
            .join(",");
        let peer = parts
            .extensions
            .get::<ConnectInfo<SocketAddr>>()
            .map(|ConnectInfo(addr)| addr.ip());
        let forwarded_for = (!forwarded_for.is_empty()).then_some(forwarded_for.as_str());
        let ip = client_ip(forwarded_for, peer, state.config.trusted_proxy_hops)
            .unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED));
        Ok(ClientIp(ip))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(text: &str) -> IpAddr {
        text.parse().unwrap()
    }

    // spec: ABU-008
    #[test]
    fn client_ip_from_forwarded_for() {
        let peer = Some(ip("10.0.0.9"));
        let from = |header: Option<&str>, hops| client_ip(header, peer, hops);
        assert_eq!(from(Some("203.0.113.7"), 1), Some(ip("203.0.113.7")));
        // An address the client put on the left is ignored.
        assert_eq!(
            from(Some("198.51.100.1, 203.0.113.7"), 1),
            Some(ip("203.0.113.7"))
        );
        assert_eq!(
            from(Some("198.51.100.1, 203.0.113.7"), 2),
            Some(ip("198.51.100.1"))
        );
        assert_eq!(from(Some("2001:db8::1"), 1), Some(ip("2001:db8::1")));
        // No trusted proxy, unreadable header, no header, too few entries: the connection.
        assert_eq!(from(Some("203.0.113.7"), 0), peer);
        assert_eq!(from(Some("n'importe quoi"), 1), peer);
        assert_eq!(from(Some("198.51.100.1, n'importe quoi"), 1), peer);
        assert_eq!(from(Some(""), 1), peer);
        assert_eq!(from(None, 1), peer);
        assert_eq!(from(Some("198.51.100.1, 203.0.113.7"), 3), peer);
        assert_eq!(client_ip(None, None, 1), None);
    }
}
