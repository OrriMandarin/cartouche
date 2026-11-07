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

/// What a test needs to know about an HTTP answer, read before the objects are deleted so that
/// a failed assertion never leaves objects in the bucket.
#[derive(Debug)]
struct Answer {
    status: u16,
    content_type: Option<String>,
    cache_control: Option<String>,
    content_disposition: Option<String>,
    content_range: Option<String>,
    allow_origin: Option<String>,
    body: Bytes,
}

impl Answer {
    async fn of(res: reqwest::Response) -> Answer {
        let text = |name: &str| header(&res, name).map(str::to_string);
        Answer {
            status: res.status().as_u16(),
            content_type: text("content-type"),
            cache_control: text("cache-control"),
            content_disposition: text("content-disposition"),
            content_range: text("content-range"),
            allow_origin: text("access-control-allow-origin"),
            body: res.bytes().await.unwrap(),
        }
    }
}

async fn answer(url: &str, headers: &[(&str, &str)]) -> Answer {
    Answer::of(fetch(url, headers).await).await
}

fn header<'a>(res: &'a reqwest::Response, name: &str) -> Option<&'a str> {
    res.headers().get(name).and_then(|v| v.to_str().ok())
}

/// `true` when `key` is in neither bucket.
async fn is_gone(media: &MediaService, key: &str) -> bool {
    matches!(media.size(key).await, Err(MediaError::NotFound))
        && matches!(
            media.get_private(key, Some(0..1)).await,
            Err(MediaError::NotFound)
        )
}

const WEBP_HEAD: &[u8] = b"RIFF\x04\x00\x00\x00WEBP";
const IMMUTABLE: &str = "public, max-age=31536000, immutable";

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
    let mut answers = Vec::new();
    for (name, _) in cases {
        media
            .put(&key(card, id, name), Bytes::from_static(WEBP_HEAD))
            .await
            .unwrap();
        answers.push(answer(&public_url(&media, &key(card, id, name)), &[]).await);
    }
    media.delete_card(card).await.unwrap();

    for ((name, content_type), res) in cases.into_iter().zip(answers) {
        assert_eq!(res.status, 200, "{name}");
        assert_eq!(res.content_type.as_deref(), Some(content_type), "{name}");
        assert_eq!(res.cache_control.as_deref(), Some(IMMUTABLE), "{name}");
        assert_eq!(res.content_disposition.as_deref(), Some("inline"), "{name}");
    }
}

// spec: MED-017
#[tokio::test]
async fn the_bucket_answers_range_requests() {
    let media = s3_media_from_env().await;
    let (card, id) = (Uuid::now_v7(), Uuid::now_v7());
    let clip = header_clip();
    let key = key(card, id, "video.mp4");
    media.put(&key, Bytes::from(clip.clone())).await.unwrap();

    let res = answer(&public_url(&media, &key), &[("range", "bytes=0-99")]).await;
    media.delete_card(card).await.unwrap();

    assert_eq!(res.status, 206);
    assert_eq!(
        res.content_range.as_deref(),
        Some(format!("bytes 0-99/{}", clip.len()).as_str())
    );
    assert_eq!(res.body.as_ref(), &clip[..100]);
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

    let allowed = answer(&url, &[("origin", &app_origin)]).await;
    let foreign = answer(&url, &[("origin", "https://evil.example")]).await;
    media.delete_card(card).await.unwrap();

    assert_eq!(allowed.allow_origin.as_deref(), Some(app_origin.as_str()));
    assert_eq!(foreign.allow_origin, None);
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

    // The object is there: the answers below are about the bucket, not a missing object.
    let stored = media.get_private(&key, Some(0..4)).await;
    // By the public address of the same key.
    let by_url = answer(&public_url(&media, &key), &[]).await;
    // By the private bucket's name as host: it has no website access.
    let by_host = answer(
        &public_url(&media, &key),
        &[("host", "cartouche-media-private")],
    )
    .await;
    let in_public_bucket = media.size(&key).await;
    media.delete_card(card).await.unwrap();

    assert!(stored.is_ok(), "the private object is missing: {stored:?}");
    assert_eq!(by_url.status, 404);
    assert!(
        (400..500).contains(&by_host.status),
        "the private bucket answered {}",
        by_host.status
    );
    assert!(in_public_bucket.is_err());
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
    let first_gone = [
        is_gone(&media, &key(card, first, "video.mp4")).await,
        is_gone(&media, &key(card, first, "original.mp4")).await,
    ];
    let second_kept = media.size(&key(card, second, "video.mp4")).await.is_ok();

    media.delete_card(card).await.unwrap();
    let second_gone = [
        is_gone(&media, &key(card, second, "video.mp4")).await,
        is_gone(&media, &key(card, second, "original.mp4")).await,
    ];
    // Deleting what is already gone is not an error.
    let again = media.delete_card(card).await;

    assert_eq!(first_gone, [true, true]);
    assert!(second_kept);
    assert_eq!(second_gone, [true, true]);
    assert!(again.is_ok());
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

    let res = answer(&public_url(&media, &key(card, to, "video.mp4")), &[]).await;
    media.delete_card(card).await.unwrap();

    assert_eq!(res.status, 200);
    assert_eq!(res.content_type.as_deref(), Some("video/mp4"));
    assert_eq!(res.cache_control.as_deref(), Some(IMMUTABLE));
    assert_eq!(res.content_disposition.as_deref(), Some("inline"));
}

// spec: MED-036, MED-044
#[tokio::test]
async fn a_private_original_is_copied_within_the_private_bucket() {
    let media = s3_media_from_env().await;
    let card = Uuid::now_v7();
    let (from, to) = (Uuid::now_v7(), Uuid::now_v7());
    let (from_key, to_key) = (
        key(card, from, "original.mp4"),
        key(card, to, "original.mp4"),
    );
    media
        .put_private(&from_key, Bytes::from(header_clip()))
        .await
        .unwrap();

    let copied = media.copy_private(&from_key, &to_key).await;
    let bytes = media.get_private(&to_key, None).await;
    let in_public_bucket = media.size(&to_key).await;
    let missing = media
        .copy_private(&key(card, Uuid::now_v7(), "original.mp4"), &to_key)
        .await;
    media.delete_card(card).await.unwrap();

    copied.unwrap();
    assert_eq!(bytes.unwrap().bytes.as_ref(), header_clip().as_slice());
    assert!(
        in_public_bucket.is_err(),
        "the copy leaked to the public bucket"
    );
    assert!(matches!(missing, Err(MediaError::NotFound)), "{missing:?}");
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
    let card_uuid: Uuid = card_id.parse().unwrap();

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
    let view = res.json.clone();
    let created = res.status == StatusCode::CREATED;
    if !created {
        app.media.delete_card(card_uuid).await.unwrap();
    }
    assert!(created, "{} {view}", res.status);

    let served = view["video_url"].as_str().unwrap();
    let mut urls = vec![served, view["source"]["url"].as_str().unwrap()];
    urls.extend(
        view["images"]
            .as_array()
            .unwrap()
            .iter()
            .map(|image| image["url"].as_str().unwrap()),
    );
    let mut statuses = Vec::new();
    for url in &urls {
        statuses.push((url.to_string(), answer(url, &[]).await.status));
    }

    // The original is only in the private bucket.
    let original = served.replace("video.mp4", "original.mp4");
    let original_key = original.strip_prefix(app.media.url("").as_str()).unwrap();
    let private = app.media.get_private(original_key, None).await;
    let in_public_bucket = app.media.size(original_key).await;
    let by_url = answer(&original, &[]).await;
    app.media.delete_card(card_uuid).await.unwrap();

    for (url, status) in statuses {
        assert!(
            url.starts_with(app.media.url("").as_str()),
            "{url} is not a bucket address"
        );
        assert_eq!(status, 200, "{url}");
    }
    assert_eq!(private.unwrap().bytes.as_ref(), header_clip().as_slice());
    assert!(in_public_bucket.is_err());
    assert_eq!(by_url.status, 404);
}
