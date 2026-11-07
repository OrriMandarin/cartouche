//! `GET /media/*` headers and key access in local storage mode.

use crate::common;

use axum::http::StatusCode;
use bytes::Bytes;
use cartouche_domain::{Clock, ORIGINAL_FILE, VIDEO_FILE, edit_copy_name, storage_key};
use common::TestApp;
use common::cards::{cards_app, create_card};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

const BASE: &str = "http://localhost:3000";
const TOKEN: &str = "0123456789abcdef0123456789abcdef";
const CLIP: &[u8] = b"0123456789-not-really-a-video";

fn card_id(card: &Value) -> Uuid {
    card["id"].as_str().unwrap().parse().unwrap()
}

/// The path of a stored key, signed or not, as the API hands it out.
fn path(app: &TestApp, key: &str, signed: bool) -> String {
    if signed {
        let url = app.media.dashboard_url(key, app.clock.now());
        url.strip_prefix(BASE).unwrap().to_string()
    } else {
        format!("/media/{key}")
    }
}

async fn get(app: &TestApp, path: &str, range: Option<&str>) -> common::TestResponse {
    let headers: Vec<(&str, &str)> = range.map(|r| ("range", r)).into_iter().collect();
    app.request_with_headers("GET", path, None, None, &headers)
        .await
}

fn assert_sandboxed(res: &common::TestResponse) {
    assert_eq!(
        res.headers["content-security-policy"],
        "sandbox; default-src 'none'"
    );
    assert_eq!(res.headers["content-disposition"], "inline");
    assert_eq!(res.headers["x-content-type-options"], "nosniff");
}

// spec: MED-046
#[sqlx::test(migrations = "./migrations")]
async fn local_media_responses_are_sandboxed_and_inline(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let key = storage_key(card_id(&card), Uuid::now_v7(), VIDEO_FILE);
    app.media.put(&key, Bytes::from_static(CLIP)).await.unwrap();

    let whole = get(&app, &path(&app, &key, false), None).await;
    assert_eq!(whole.status, StatusCode::OK);
    assert_sandboxed(&whole);
    let partial = get(&app, &path(&app, &key, false), Some("bytes=0-3")).await;
    assert_eq!(partial.status, StatusCode::PARTIAL_CONTENT);
    assert_sandboxed(&partial);
    let unsatisfiable = get(&app, &path(&app, &key, false), Some("bytes=9999-")).await;
    assert_eq!(unsatisfiable.status, StatusCode::RANGE_NOT_SATISFIABLE);
    assert_sandboxed(&unsatisfiable);
    let signed = get(&app, &path(&app, &key, true), None).await;
    assert_eq!(signed.status, StatusCode::OK);
    assert_sandboxed(&signed);
}

// spec: MED-031
#[sqlx::test(migrations = "./migrations")]
async fn an_edit_copy_needs_a_signature_even_on_a_served_card(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let key = storage_key(card_id(&card), Uuid::now_v7(), &edit_copy_name(TOKEN));
    app.media.put(&key, Bytes::from_static(CLIP)).await.unwrap();

    let unsigned = get(&app, &path(&app, &key, false), None).await;
    assert_eq!(unsigned.status, StatusCode::NOT_FOUND);
    let signed = get(&app, &path(&app, &key, true), None).await;
    assert_eq!(signed.status, StatusCode::OK);
    assert_eq!(signed.headers["content-type"], "video/mp4");
    assert_eq!(signed.body.as_ref(), CLIP);
    let partial = get(&app, &path(&app, &key, true), Some("bytes=2-5")).await;
    assert_eq!(partial.status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(partial.body.as_ref(), &CLIP[2..6]);
}

// spec: MED-044
#[sqlx::test(migrations = "./migrations")]
async fn private_keys_are_never_served(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let key = storage_key(card_id(&card), Uuid::now_v7(), ORIGINAL_FILE);
    app.media
        .put_private(&key, Bytes::from_static(CLIP))
        .await
        .unwrap();
    app.media.put(&key, Bytes::from_static(CLIP)).await.unwrap();

    for signed in [false, true] {
        for candidate in [key.clone(), format!("private/{key}")] {
            let res = get(&app, &path(&app, &candidate, signed), None).await;
            assert_eq!(res.status, StatusCode::NOT_FOUND, "{candidate} {signed}");
        }
    }
}
