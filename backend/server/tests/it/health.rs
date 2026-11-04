use crate::common;

use axum::http::StatusCode;
use common::test_app;
use serde_json::json;
use sqlx::PgPool;

#[sqlx::test(migrations = "./migrations")]
async fn health_reports_ok_with_db(pool: PgPool) {
    let app = test_app(pool).await;
    let res = app.request("GET", "/api/health", None, None).await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json, json!({"status": "ok", "db": "ok"}));
}

#[sqlx::test(migrations = "./migrations")]
async fn health_reports_degraded_when_db_is_down(pool: PgPool) {
    let app = test_app(pool.clone()).await;
    pool.close().await;
    let res = app.request("GET", "/api/health", None, None).await;
    assert_eq!(res.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(res.json, json!({"status": "degraded", "db": "error"}));
}

#[sqlx::test(migrations = "./migrations")]
async fn request_id_is_echoed_when_valid(pool: PgPool) {
    let app = test_app(pool).await;
    let res = app
        .request_with_headers(
            "GET",
            "/api/health",
            None,
            None,
            &[("x-request-id", "abc-123")],
        )
        .await;
    assert_eq!(res.headers["x-request-id"], "abc-123");
}

#[sqlx::test(migrations = "./migrations")]
async fn request_id_is_generated_when_invalid(pool: PgPool) {
    let app = test_app(pool).await;
    let too_long = "a".repeat(65);
    for bad in ["bad id!", "", too_long.as_str(), "caf\u{e9}"] {
        let res = app
            .request_with_headers("GET", "/api/health", None, None, &[("x-request-id", bad)])
            .await;
        let id = res.headers["x-request-id"].to_str().unwrap();
        assert_ne!(id, bad);
        let parsed = uuid::Uuid::parse_str(id).expect("generated id is a UUID");
        assert_eq!(parsed.get_version_num(), 7);
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn request_id_of_64_characters_is_kept(pool: PgPool) {
    let app = test_app(pool).await;
    let id = "Z9-".repeat(21) + "x";
    assert_eq!(id.len(), 64);
    let res = app
        .request_with_headers("GET", "/api/health", None, None, &[("x-request-id", &id)])
        .await;
    assert_eq!(res.headers["x-request-id"], id.as_str());
}

#[sqlx::test(migrations = "./migrations")]
async fn request_id_is_generated_when_absent(pool: PgPool) {
    let app = test_app(pool).await;
    let res = app.request("GET", "/api/health", None, None).await;
    let id = res.headers["x-request-id"].to_str().unwrap();
    uuid::Uuid::parse_str(id).expect("generated id is a UUID");
}

#[sqlx::test(migrations = "./migrations")]
async fn unknown_route_returns_json_error_with_request_id(pool: PgPool) {
    let app = test_app(pool).await;
    let res = app.request("GET", "/api/nope", None, None).await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    assert_eq!(res.json["error"]["code"], "not_found");
    assert_eq!(
        res.json["error"]["request_id"].as_str().unwrap(),
        res.headers["x-request-id"].to_str().unwrap()
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn wrong_method_returns_json_error_with_request_id(pool: PgPool) {
    let app = test_app(pool).await;
    let res = app
        .request_with_headers(
            "POST",
            "/api/health",
            None,
            None,
            &[("x-request-id", "req-42")],
        )
        .await;
    assert_eq!(res.status, StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(res.json["error"]["code"], "method_not_allowed");
    assert_eq!(res.json["error"]["request_id"], "req-42");
}
