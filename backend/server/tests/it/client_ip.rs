//! The `ClientIp` extractor on real requests (headers, connection, configuration).

use crate::common;

use std::net::SocketAddr;

use axum::Router;
use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::Request;
use axum::routing::get;
use cartouche_api::client_ip::ClientIp;
use common::test_state_with;
use http_body_util::BodyExt;
use sqlx::PgPool;
use tower::ServiceExt;

async fn seen_ip(pool: PgPool, hops: &str, forwarded_for: &[&str], peer: Option<&str>) -> String {
    let (state, _clock) = test_state_with(pool, &[("TRUSTED_PROXY_HOPS", hops)]);
    let router = Router::new()
        .route(
            "/ip",
            get(|ClientIp(ip): ClientIp| async move { ip.to_string() }),
        )
        .with_state(state);
    let mut builder = Request::builder().uri("/ip");
    for line in forwarded_for {
        builder = builder.header("x-forwarded-for", *line);
    }
    let mut request = builder.body(Body::empty()).unwrap();
    if let Some(peer) = peer {
        let addr: SocketAddr = peer.parse().unwrap();
        request.extensions_mut().insert(ConnectInfo(addr));
    }
    let response = router.oneshot(request).await.unwrap();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    String::from_utf8(bytes.to_vec()).unwrap()
}

// spec: ABU-008
#[sqlx::test]
async fn client_ip_comes_from_the_proxy_header(pool: PgPool) {
    let peer = Some("10.0.0.9:4000");
    assert_eq!(
        seen_ip(pool.clone(), "1", &["203.0.113.7"], peer).await,
        "203.0.113.7"
    );
    // Several header lines count as one list, the last entry being the proxy's.
    assert_eq!(
        seen_ip(pool.clone(), "1", &["198.51.100.1", "203.0.113.7"], peer).await,
        "203.0.113.7"
    );
    assert_eq!(
        seen_ip(
            pool.clone(),
            "2",
            &["198.51.100.1, 192.0.2.5", "203.0.113.7"],
            peer
        )
        .await,
        "192.0.2.5"
    );
}

// spec: ABU-008
#[sqlx::test]
async fn client_ip_falls_back_to_the_connection(pool: PgPool) {
    let peer = Some("10.0.0.9:4000");
    assert_eq!(
        seen_ip(pool.clone(), "0", &["203.0.113.7"], peer).await,
        "10.0.0.9"
    );
    assert_eq!(seen_ip(pool.clone(), "1", &[], peer).await, "10.0.0.9");
    // Neither header nor connection: one shared address.
    assert_eq!(seen_ip(pool, "1", &[], None).await, "0.0.0.0");
}
