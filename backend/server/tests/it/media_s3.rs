//! The media service against the development Garage (`make dev-db`): what only a real bucket
//! proves, the headers it stores and serves, range requests, CORS and the private bucket.
//! The settings come from the `MEDIA_S3_*` variables of the Makefile; the tests fail, never
//! skip, when the storage is not running (MED-009).

use crate::common;

use axum::http::StatusCode;
use bytes::Bytes;
use cartouche_api::media::{MediaError, MediaService};
use common::cards::{create_card, token};
use common::media_fixtures::header_clip;
use common::{Part, TestApp, s3_app_origin, s3_media_from_env, test_state_with};
use reqwest::header::{HeaderMap, HeaderValue};
use sqlx::PgPool;
use uuid::Uuid;

/// A file key under a fresh random card, so concurrent runs and other worktrees never meet.
fn key(card: Uuid, media: Uuid, name: &str) -> String {
    format!("cards/{card}/{media}/{name}")
}

fn http() -> reqwest::Client {
    reqwest::Client::new()
}

/// Address of `key` on the bucket's web endpoint.
fn public_url(media: &MediaService, key: &str) -> String {
    media.url(key)
}

async fn fetch(url: &str, headers: &[(&str, &str)]) -> reqwest::Response {
    let mut map = HeaderMap::new();
    for (name, value) in headers {
        map.insert(
            reqwest::header::HeaderName::from_bytes(name.as_bytes()).unwrap(),
            HeaderValue::from_str(value).unwrap(),
        );
    }
    http()
        .get(url)
        .headers(map)
        .send()
        .await
        .unwrap_or_else(|e| panic!("GET {url}: {e}; start the development storage: make dev-db"))
}

fn header<'a>(res: &'a reqwest::Response, name: &str) -> Option<&'a str> {
    res.headers().get(name).and_then(|v| v.to_str().ok())
}

async fn assert_gone(media: &MediaService, key: &str) {
    assert!(
        matches!(media.size(key).await, Err(MediaError::NotFound)),
        "{key} is still in the public bucket"
    );
    assert!(
        matches!(
            media.get_private(key, Some(0..1)).await,
            Err(MediaError::NotFound)
        ),
        "{key} is still in the private bucket"
    );
}

const WEBP_HEAD: &[u8] = b"RIFF\x04\x00\x00\x00WEBP";

// spec: MED-043, MED-016
#[tokio::test]
async fn public_files_are_served_with_their_type_cache_and_inline() {
    let media = s3_media_from_env().await;
    let (card, id) = (Uuid::now_v7(), Uuid::now_v7());
    let cases = [
        ("w750.webp", "image/webp"),
        ("s256.jpg", "image/jpeg"),
        ("video.mp4", "video/mp4"),
    ];
    for (name, _) in cases {
        media
            .put(&key(card, id, name), Bytes::from_static(WEBP_HEAD))
            .await
            .unwrap();
    }

    for (name, content_type) in cases {
        let res = fetch(&public_url(&media, &key(card, id, name)), &[]).await;
        assert_eq!(res.status(), 200, "{name}");
        assert_eq!(header(&res, "content-type"), Some(content_type), "{name}");
        assert_eq!(
            header(&res, "cache-control"),
            Some("public, max-age=31536000, immutable"),
            "{name}"
        );
        assert_eq!(
            header(&res, "content-disposition"),
            Some("inline"),
            "{name}"
        );
    }
    media.delete_card(card).await.unwrap();
}

// spec: MED-017
#[tokio::test]
async fn the_bucket_answers_range_requests() {
    let media = s3_media_from_env().await;
    let (card, id) = (Uuid::now_v7(), Uuid::now_v7());
    let clip = header_clip();
    let key = key(card, id, "video.mp4");
    media.put(&key, Bytes::from(clip.clone())).await.unwrap();

    let res = fetch(&public_url(&media, &key), &[("range", "bytes=0-99")]).await;

    assert_eq!(res.status(), 206);
    assert_eq!(
        header(&res, "content-range"),
        Some(format!("bytes 0-99/{}", clip.len()).as_str())
    );
    assert_eq!(res.bytes().await.unwrap().as_ref(), &clip[..100]);
    media.delete_card(card).await.unwrap();
}

// spec: MED-045
#[tokio::test]
async fn the_bucket_allows_the_app_origin_only() {
    let media = s3_media_from_env().await;
    let (card, id) = (Uuid::now_v7(), Uuid::now_v7());
    let key = key(card, id, "w750.webp");
    media
        .put(&key, Bytes::from_static(WEBP_HEAD))
        .await
        .unwrap();
    let url = public_url(&media, &key);
    let app_origin = s3_app_origin();

    let allowed = fetch(&url, &[("origin", &app_origin)]).await;
    assert_eq!(
        header(&allowed, "access-control-allow-origin"),
        Some(app_origin.as_str())
    );
    let foreign = fetch(&url, &[("origin", "https://evil.example")]).await;
    assert_eq!(header(&foreign, "access-control-allow-origin"), None);
    media.delete_card(card).await.unwrap();
}

// spec: MED-044
#[tokio::test]
async fn the_private_bucket_is_not_served() {
    let media = s3_media_from_env().await;
    let (card, id) = (Uuid::now_v7(), Uuid::now_v7());
    let key = key(card, id, "original.mp4");
    media
        .put_private(&key, Bytes::from(header_clip()))
        .await
        .unwrap();

    // By the public address of the same key.
    let by_url = fetch(&public_url(&media, &key), &[]).await;
    assert_eq!(by_url.status(), 404);
    // By the private bucket's name as host: it has no website access.
    let by_host = fetch(
        &public_url(&media, &key),
        &[("host", "cartouche-media-private")],
    )
    .await;
    assert!(
        by_host.status().is_client_error(),
        "the private bucket answered {}",
        by_host.status()
    );
    assert!(media.size(&key).await.is_err());
    media.delete_card(card).await.unwrap();
}

// spec: MED-018, MED-019
#[tokio::test]
async fn deletes_reach_both_buckets() {
    let media = s3_media_from_env().await;
    let card = Uuid::now_v7();
    let (first, second) = (Uuid::now_v7(), Uuid::now_v7());
    for id in [first, second] {
        media
            .put(&key(card, id, "video.mp4"), Bytes::from_static(b"served"))
            .await
            .unwrap();
        media
            .put_private(&key(card, id, "original.mp4"), Bytes::from_static(b"raw"))
            .await
            .unwrap();
    }

    media.delete_media(card, first).await.unwrap();
    assert_gone(&media, &key(card, first, "video.mp4")).await;
    assert_gone(&media, &key(card, first, "original.mp4")).await;
    assert!(media.size(&key(card, second, "video.mp4")).await.is_ok());

    media.delete_card(card).await.unwrap();
    assert_gone(&media, &key(card, second, "video.mp4")).await;
    assert_gone(&media, &key(card, second, "original.mp4")).await;
    // Deleting what is already gone is not an error.
    media.delete_card(card).await.unwrap();
}

// spec: MED-043
#[tokio::test]
async fn a_copied_file_keeps_its_headers() {
    let media = s3_media_from_env().await;
    let card = Uuid::now_v7();
    let (from, to) = (Uuid::now_v7(), Uuid::now_v7());
    media
        .put(&key(card, from, "video.mp4"), Bytes::from(header_clip()))
        .await
        .unwrap();
    media
        .copy(&key(card, from, "video.mp4"), &key(card, to, "video.mp4"))
        .await
        .unwrap();

    let res = fetch(&public_url(&media, &key(card, to, "video.mp4")), &[]).await;

    assert_eq!(res.status(), 200);
    assert_eq!(header(&res, "content-type"), Some("video/mp4"));
    assert_eq!(
        header(&res, "cache-control"),
        Some("public, max-age=31536000, immutable")
    );
    assert_eq!(header(&res, "content-disposition"), Some("inline"));
    media.delete_card(card).await.unwrap();
}

// spec: MED-009, MED-031
#[sqlx::test(migrations = "./migrations")]
async fn an_upload_on_s3_is_served_by_the_bucket(pool: PgPool) {
    let (mut state, clock) =
        test_state_with(pool, &[("SIGNUP_MODE", "open"), ("ADMIN_USER_IDS", "boss")]);
    state.media = s3_media_from_env().await;
    let app = TestApp::from_state(state, clock);
    let card = create_card(&app, "alice", "alice-durand").await;
    let card_id = card["id"].as_str().unwrap();

    let res = app
        .request_multipart(
            "POST",
            &format!("/api/cards/{card_id}/media"),
            Some(&token("alice")),
            &[
                Part::text("slot", "header"),
                Part::file("file", "clip.mp4", "video/mp4", header_clip()),
            ],
        )
        .await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);
    let view = res.json;

    let served = view["video_url"].as_str().unwrap();
    let mut urls = vec![served, view["source"]["url"].as_str().unwrap()];
    urls.extend(
        view["images"]
            .as_array()
            .unwrap()
            .iter()
            .map(|image| image["url"].as_str().unwrap()),
    );
    for url in &urls {
        assert!(
            url.starts_with(app.media.url("").as_str()),
            "{url} is not a bucket address"
        );
        assert_eq!(fetch(url, &[]).await.status(), 200, "{url}");
    }

    // The original is only in the private bucket.
    let original = served.replace("video.mp4", "original.mp4");
    let original_key = original.strip_prefix(app.media.url("").as_str()).unwrap();
    assert_eq!(
        app.media
            .get_private(original_key, None)
            .await
            .unwrap()
            .bytes
            .as_ref(),
        header_clip().as_slice()
    );
    assert!(app.media.size(original_key).await.is_err());
    assert_eq!(fetch(&original, &[]).await.status(), 404);

    let card_uuid: Uuid = card_id.parse().unwrap();
    app.media.delete_card(card_uuid).await.unwrap();
}
