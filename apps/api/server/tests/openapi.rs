//! Contract tests for the public OpenAPI document.
//!
//! The committed `packages/api-client/openapi.json` must equal the document the code
//! generates. `UPDATE_OPENAPI=1` rewrites it (this is what `make openapi` does).

mod common;

use std::path::PathBuf;

use axum::http::StatusCode;
use cartouche_api::openapi::document_json;
use common::test_app;
use sqlx::PgPool;

fn committed_path() -> PathBuf {
    // Tests run with the package root (`apps/api/server`) as working directory.
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../packages/api-client/openapi.json")
}

#[test]
fn openapi_is_up_to_date() {
    let generated = document_json();
    let path = committed_path();
    if std::env::var("UPDATE_OPENAPI").as_deref() == Ok("1") {
        std::fs::write(&path, &generated).expect("write openapi.json");
        return;
    }
    let committed = std::fs::read_to_string(&path).unwrap_or_default();
    assert!(committed == generated, "OpenAPI drift: run `make openapi`");
}

#[test]
fn openapi_excludes_test_routes() {
    let doc: serde_json::Value = serde_json::from_str(&document_json()).unwrap();
    let paths = doc["paths"].as_object().expect("paths object");
    assert!(!paths.is_empty());
    assert!(
        paths.keys().all(|path| !path.starts_with("/api/test")),
        "test routes leaked into the public contract: {:?}",
        paths.keys().collect::<Vec<_>>()
    );
}

#[test]
fn openapi_documents_every_public_route_and_the_error_shape() {
    let doc: serde_json::Value = serde_json::from_str(&document_json()).unwrap();
    for (path, method) in [
        ("/api/health", "get"),
        ("/api/me", "get"),
        ("/api/admin/users", "get"),
        ("/api/admin/users/{id}/status", "post"),
    ] {
        assert!(doc["paths"][path][method].is_object(), "{method} {path}");
    }
    let error = &doc["components"]["schemas"]["ErrorBody"];
    assert!(error.is_object(), "ErrorBody schema");
    assert_eq!(
        doc["components"]["securitySchemes"]["bearer"]["scheme"],
        "bearer"
    );
    assert_eq!(
        doc["components"]["schemas"]["UserStatus"]["enum"],
        serde_json::json!(["pending", "approved", "rejected", "suspended"])
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn the_document_is_served_without_authentication(pool: PgPool) {
    let app = test_app(pool).await;
    let res = app.request("GET", "/api/openapi.json", None, None).await;
    assert_eq!(res.status, StatusCode::OK);
    let expected: serde_json::Value = serde_json::from_str(&document_json()).unwrap();
    assert_eq!(res.json, expected);
}
