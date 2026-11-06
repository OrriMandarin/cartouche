use crate::common;

use axum::http::StatusCode;
use cartouche_api::media::video::VideoService;
use cartouche_api::test_support::video::StubVideoProcessor;
use cartouche_domain::{MAX_VIDEO_BYTES, PosterSeek, VIDEO_PROCESSING_DEADLINE, VideoProbe};
use common::cards::{cards_app, create_card, put_card, token};
use common::failing_store::FailingStore;
use common::media_fixtures::{
    header_clip, jpeg, jpeg_with_exif, mp4, mp4_with_brands, png, png_claiming, quadrants_png,
};
use common::{Part, TestApp, TestResponse, test_state_with};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Duration;

const BASE: &str = "http://localhost:3000";

/// An app whose video processor is `stub` and whose deadline is the real one.
async fn app_with_stub(pool: PgPool, stub: StubVideoProcessor) -> TestApp {
    let (mut state, clock) =
        test_state_with(pool, &[("SIGNUP_MODE", "open"), ("ADMIN_USER_IDS", "boss")]);
    state.video = VideoService::new(Arc::new(stub), 1, VIDEO_PROCESSING_DEADLINE);
    TestApp::from_state(state, clock)
}

fn error_code(res: &TestResponse) -> &str {
    res.json["error"]["code"].as_str().unwrap_or_default()
}

fn card_id(card: &Value) -> &str {
    card["id"].as_str().unwrap()
}

async fn upload(app: &TestApp, sub: &str, card: &str, parts: &[Part]) -> TestResponse {
    app.request_multipart(
        "POST",
        &format!("/api/cards/{card}/media"),
        Some(&token(sub)),
        parts,
    )
    .await
}

async fn upload_image(app: &TestApp, card: &str, slot: &str, bytes: Vec<u8>) -> TestResponse {
    upload(
        app,
        "alice",
        card,
        &[
            Part::text("slot", slot),
            Part::file("file", "photo.png", "image/png", bytes),
        ],
    )
    .await
}

/// Uploads an image and returns the `MediaView`, asserting `201`.
async fn uploaded(app: &TestApp, card: &str, slot: &str, bytes: Vec<u8>) -> Value {
    let res = upload_image(app, card, slot, bytes).await;
    assert_eq!(res.status, StatusCode::CREATED, "upload: {}", res.json);
    res.json
}

fn widths(media: &Value) -> Vec<u64> {
    media["images"]
        .as_array()
        .unwrap()
        .iter()
        .map(|image| image["width"].as_u64().unwrap())
        .collect()
}

/// The path (and query) of a media URL served by the API.
fn media_path(url: &Value) -> &str {
    url.as_str().unwrap().strip_prefix(BASE).unwrap()
}

/// A media address without its signature: the public address of the same file (MED-023).
fn unsigned(url: &str) -> &str {
    url.split_once('?').map_or(url, |(address, _)| address)
}

async fn get_file(app: &TestApp, path: &str, headers: &[(&str, &str)]) -> TestResponse {
    app.request_with_headers("GET", path, None, None, headers)
        .await
}

async fn get_card(app: &TestApp, id: &str) -> Value {
    let res = app
        .request(
            "GET",
            &format!("/api/cards/{id}"),
            Some(&token("alice")),
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::OK);
    res.json
}

// spec: MED-005, MED-006, MED-015
#[sqlx::test(migrations = "./migrations")]
async fn avatar_upload_returns_variant_urls(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card_id(&card);

    let media = uploaded(&app, id, "avatar", jpeg(800, 600)).await;

    assert_eq!(media["kind"], "image");
    assert_eq!(widths(&media), [128, 256, 512]);
    assert_eq!(media["video_url"], Value::Null);
    let prefix = format!("{BASE}/media/cards/{id}/{}/", media["id"].as_str().unwrap());
    for image in media["images"].as_array().unwrap() {
        let url = unsigned(image["url"].as_str().unwrap());
        assert!(url.starts_with(&prefix) && url.ends_with(".webp"), "{url}");
    }
    let jpeg_url = unsigned(media["jpeg_url"].as_str().unwrap());
    assert!(
        jpeg_url.starts_with(&prefix) && jpeg_url.ends_with("/s512.jpg"),
        "{jpeg_url}"
    );
    // Three WebP and two JPEG files and the source are stored; the upload itself is not.
    assert_eq!(app.media_keys().await.len(), 6);
}

// spec: MED-008, MED-012
#[sqlx::test(migrations = "./migrations")]
async fn type_is_checked_from_content(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card_id(&card);

    // A PNG named .jpg is accepted: the content decides, not the name.
    let res = upload(
        &app,
        "alice",
        id,
        &[
            Part::text("slot", "avatar"),
            Part::file("file", "photo.jpg", "image/jpeg", png(300, 300)),
        ],
    )
    .await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);

    // Text named .jpg is refused, whatever the declared type.
    let res = upload(
        &app,
        "alice",
        id,
        &[
            Part::text("slot", "avatar"),
            Part::file("file", "photo.jpg", "image/jpeg", b"not an image".to_vec()),
        ],
    )
    .await;
    assert_eq!(res.status, StatusCode::UNSUPPORTED_MEDIA_TYPE);
    assert_eq!(error_code(&res), "unsupported_media_type");

    // A video is a header, never an avatar.
    let res = upload(
        &app,
        "alice",
        id,
        &[
            Part::text("slot", "avatar"),
            Part::file("file", "clip.mp4", "video/mp4", mp4(2_000)),
        ],
    )
    .await;
    assert_eq!(res.status, StatusCode::UNSUPPORTED_MEDIA_TYPE);

    // An `ftyp` file without a movie header (HEIC, AVIF...) is not a usable MP4.
    let mut heic = 24u32.to_be_bytes().to_vec();
    heic.extend_from_slice(b"ftypheic\0\0\0\0heicmif1");
    let res = upload(
        &app,
        "alice",
        id,
        &[
            Part::text("slot", "header"),
            Part::file("file", "photo.heic", "image/heic", heic),
        ],
    )
    .await;
    assert_eq!(res.status, StatusCode::UNSUPPORTED_MEDIA_TYPE);
    assert_eq!(error_code(&res), "unsupported_media_type");
}

// spec: MED-022
#[sqlx::test(migrations = "./migrations")]
async fn quicktime_3gp_and_heic_are_refused(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card_id(&card);
    let header_upload = |bytes: Vec<u8>| {
        [
            Part::text("slot", "header"),
            Part::file("file", "clip.mp4", "video/mp4", bytes),
        ]
    };

    for major in [b"qt  ", b"3gp4", b"heic"] {
        let res = upload(
            &app,
            "alice",
            id,
            &header_upload(mp4_with_brands(major, &[b"isom"], 2_000)),
        )
        .await;
        assert_eq!(res.status, StatusCode::UNSUPPORTED_MEDIA_TYPE, "{major:?}");
        assert_eq!(error_code(&res), "unsupported_media_type");
    }

    let res = upload(
        &app,
        "alice",
        id,
        &header_upload(mp4_with_brands(b"mp42", &[b"mp42", b"isom"], 2_000)),
    )
    .await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);
}

// spec: MED-012, Review Focus 5
#[sqlx::test(migrations = "./migrations")]
async fn oversized_and_bomb_images_are_refused(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card_id(&card);

    let mut heavy = jpeg(64, 64);
    heavy.resize(11 << 20, 0);
    let res = upload_image(&app, id, "header", heavy).await;
    assert_eq!(res.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(error_code(&res), "payload_too_large");

    let res = upload_image(&app, id, "header", png_claiming(20_000, 20_000)).await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(error_code(&res), "validation_failed");
    assert_eq!(
        res.json["error"]["fields"],
        json!([{ "field": "file", "code": "image_too_large" }])
    );
    assert!(app.media_keys().await.is_empty());
}

// spec: MED-002, MED-013
#[sqlx::test(migrations = "./migrations")]
async fn video_rules(pool: PgPool) {
    let stub = StubVideoProcessor::default();
    let app = app_with_stub(pool, stub.clone()).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card_id(&card);
    let video = |bytes: Vec<u8>| Part::file("file", "clip.mp4", "video/mp4", bytes);

    // MED-013: too long is refused before any processing.
    let res = upload(
        &app,
        "alice",
        id,
        &[Part::text("slot", "header"), video(mp4(31_000))],
    )
    .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        res.json["error"]["fields"],
        json!([{ "field": "file", "code": "video_too_long" }])
    );
    assert!(stub.jobs().is_empty(), "a refused video is never processed");

    // MED-002: 50 MiB are accepted by the size rule, one byte more is too heavy.
    let mut heavy = mp4(2_000);
    heavy.resize(MAX_VIDEO_BYTES + 1, 0);
    let res = upload(
        &app,
        "alice",
        id,
        &[Part::text("slot", "header"), video(heavy)],
    )
    .await;
    assert_eq!(res.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(error_code(&res), "payload_too_large");
    assert!(
        app.media_keys().await.is_empty(),
        "a refused upload stores nothing"
    );
    assert!(stub.jobs().is_empty());
}

// spec: MED-002
#[sqlx::test(migrations = "./migrations")]
async fn a_video_of_exactly_50_mib_is_accepted(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let mut clip = mp4(2_000);
    clip.resize(MAX_VIDEO_BYTES, 0);
    let res = upload(
        &app,
        "alice",
        card_id(&card),
        &[
            Part::text("slot", "header"),
            Part::file("file", "clip.mp4", "video/mp4", clip),
        ],
    )
    .await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);
}

// spec: MED-003
#[sqlx::test(migrations = "./migrations")]
async fn a_video_upload_with_a_poster_part_is_refused(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let res = upload(
        &app,
        "alice",
        card_id(&card),
        &[
            Part::text("slot", "header"),
            Part::file("file", "clip.mp4", "video/mp4", header_clip()),
            Part::file("poster", "poster.jpg", "image/jpeg", jpeg(640, 360)),
        ],
    )
    .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(error_code(&res), "invalid_request");
    assert!(app.media_keys().await.is_empty());
    assert!(app.media.list_private_keys().await.is_empty());
}

// spec: MED-004, MED-034, MED-037
#[sqlx::test(migrations = "./migrations")]
async fn a_video_upload_stores_the_transcode_the_edit_copy_and_the_placeholder(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card_id(&card);
    let parts = video_parts(&[("loop", json!({ "start": 0.25, "end": 1.75 }).to_string())]);
    let res = upload(&app, "alice", id, &parts).await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);
    let media = res.json;
    assert_eq!(media["kind"], "video");

    let names: Vec<String> = app
        .media_keys()
        .await
        .iter()
        .map(|key| key.rsplit('/').next().unwrap().to_string())
        .collect();
    let mut sorted = names.clone();
    sorted.sort();
    let edit_copy = names
        .iter()
        .find(|name| cartouche_domain::is_video_source_name(name))
        .expect("an edit copy")
        .clone();
    let mut expected = vec![
        "video.mp4".to_string(),
        edit_copy,
        "w1125.webp".to_string(),
        "w1440.webp".to_string(),
        "w750.webp".to_string(),
    ];
    expected.sort();
    assert_eq!(sorted, expected, "no .webp source is stored for a video");

    let served = app
        .media
        .get(&key_of(&media["video_url"]), None)
        .await
        .unwrap();
    assert_eq!(served.bytes.as_ref(), b"served 1280x960 trim 0.250+1.500");
    let copy = app
        .media
        .get(&key_of(&media["source"]["url"]), None)
        .await
        .unwrap();
    assert_eq!(copy.bytes.as_ref(), b"edit copy 960x540");
    assert_eq!(media["source"]["width"], 960);
    assert_eq!(media["source"]["height"], 540);
    assert_eq!(widths(&media), [750, 1125, 1440]);
    // The video's own duration, not the loop's (R-S31).
    let duration = media["duration_seconds"].as_f64().unwrap();
    assert!((duration - clip_seconds()).abs() < 0.05, "{duration}");
}

// spec: MED-036
#[sqlx::test(migrations = "./migrations")]
async fn the_uploaded_file_is_kept_privately_as_is(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let res = upload(&app, "alice", card_id(&card), &video_parts(&[])).await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);
    let private = app.media.list_private_keys().await;
    assert_eq!(private.len(), 1, "{private:?}");
    assert!(
        private[0].ends_with(&format!(
            "/{}/original.mp4",
            res.json["id"].as_str().unwrap()
        )),
        "{private:?}"
    );
    let original = app.media.get_private(&private[0], None).await.unwrap();
    assert_eq!(original.bytes.as_ref(), header_clip().as_slice());
    assert!(
        !app.media_keys()
            .await
            .iter()
            .any(|key| key.ends_with("original.mp4")),
        "the original is never in the public store"
    );
}

// spec: MED-029, MED-003
#[sqlx::test(migrations = "./migrations")]
async fn the_placeholder_is_cut_from_the_frame_at_the_poster_time(pool: PgPool) {
    let stub = StubVideoProcessor::default();
    let app = app_with_stub(pool, stub.clone()).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let parts = video_parts(&[("poster_time", "1.5".to_string())]);
    let res = upload(&app, "alice", card_id(&card), &parts).await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);
    let jobs = stub.jobs();
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].plan.poster, PosterSeek::At(1.5));
    assert!(jobs[0].edit_copy);
    assert_close(&res.json["poster_time"], 1.5, "poster time");
    // The stub's frame is 1920 x 1080; the default crop is the centred 4:3.
    assert_crop(&res.json, 0.125, 0.0, 0.75, 1.0);
    let w1440 = variant(&app, &res.json, 1440).await;
    assert_eq!((w1440.width(), w1440.height()), (1440, 1080));
}

// spec: MED-025, MED-031
#[sqlx::test(migrations = "./migrations")]
async fn the_owner_view_gives_the_edit_copy_as_source(pool: PgPool) {
    let app = cards_app(pool).await;
    let id = card_with_video_header(&app).await;
    let owner = get_card(&app, &id).await;
    let url = owner["header"]["source"]["url"].as_str().unwrap();
    assert!(unsigned(url).ends_with(".mp4"), "{url}");
    assert!(url.contains('?'), "signed in local mode: {url}");
    assert_eq!(owner["header"]["source"]["width"], 960);

    let public = app
        .request("GET", "/api/public/cards/alice-durand", None, None)
        .await;
    assert_eq!(public.status, StatusCode::OK, "{}", public.json);
    assert_no_source(&public.json, "public view");
}

// spec: MED-039
#[sqlx::test(migrations = "./migrations")]
async fn an_unreadable_video_is_refused_on_its_file_field(pool: PgPool) {
    let stub = StubVideoProcessor::default().with_unreadable("no moov");
    let app = app_with_stub(pool, stub).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let res = upload(&app, "alice", card_id(&card), &video_parts(&[])).await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        res.json["error"]["fields"],
        json!([{ "field": "file", "code": "video_unreadable" }])
    );
    assert!(app.media_keys().await.is_empty());
    assert!(app.media.list_private_keys().await.is_empty());
}

// spec: MED-039
#[sqlx::test(migrations = "./migrations")]
async fn a_video_wider_than_4096_is_refused(pool: PgPool) {
    let stub = StubVideoProcessor::default().with_probe(VideoProbe {
        width: 4100,
        height: 2000,
        codec: "h264".to_string(),
    });
    let app = app_with_stub(pool, stub.clone()).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let res = upload(&app, "alice", card_id(&card), &video_parts(&[])).await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        res.json["error"]["fields"],
        json!([{ "field": "file", "code": "video_too_large" }])
    );
    assert!(stub.jobs().is_empty());
    assert!(app.media_keys().await.is_empty());
}

// spec: MED-040
#[sqlx::test(migrations = "./migrations")]
async fn an_unsupported_codec_is_refused(pool: PgPool) {
    let stub = StubVideoProcessor::default().with_probe(VideoProbe {
        width: 1920,
        height: 1080,
        codec: "mpeg4".to_string(),
    });
    let app = app_with_stub(pool, stub.clone()).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let res = upload(&app, "alice", card_id(&card), &video_parts(&[])).await;
    assert_eq!(res.status, StatusCode::UNSUPPORTED_MEDIA_TYPE);
    assert_eq!(error_code(&res), "unsupported_media_type");
    assert!(stub.jobs().is_empty());
    assert!(app.media_keys().await.is_empty());
}

// spec: MED-039
#[sqlx::test(migrations = "./migrations")]
async fn a_video_job_past_its_deadline_is_a_503_and_stores_nothing(pool: PgPool) {
    let (mut state, clock) =
        test_state_with(pool, &[("SIGNUP_MODE", "open"), ("ADMIN_USER_IDS", "boss")]);
    let stub = StubVideoProcessor::default().with_delay(Duration::from_secs(5));
    state.video = VideoService::new(Arc::new(stub.clone()), 1, Duration::from_secs(2));
    let app = TestApp::from_state(state, clock);
    let card = create_card(&app, "alice", "alice-durand").await;
    let res = upload(&app, "alice", card_id(&card), &video_parts(&[])).await;
    assert_eq!(res.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(error_code(&res), "video_processing_timeout");
    assert!(app.media_keys().await.is_empty());
    assert!(app.media.list_private_keys().await.is_empty());

    // The permit is free again: the next upload goes through.
    stub.set_delay(Duration::ZERO);
    let res = upload(&app, "alice", card_id(&card), &video_parts(&[])).await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);
}

// spec: MED-036, MED-018
#[sqlx::test(migrations = "./migrations")]
async fn a_failed_private_write_leaves_nothing_in_either_store(pool: PgPool) {
    let (private, failing) = FailingStore::failing_puts();
    let (mut state, clock) = test_state_with(
        pool.clone(),
        &[("SIGNUP_MODE", "open"), ("ADMIN_USER_IDS", "boss")],
    );
    state.media = cartouche_api::media::MediaService::with_stores(
        Arc::new(object_store::memory::InMemory::new()),
        Arc::new(private),
        "http://localhost:3000/media/".parse().unwrap(),
        true,
    );
    let app = TestApp::from_state(state, clock);
    let card = create_card(&app, "alice", "alice-durand").await;
    failing.store(true, std::sync::atomic::Ordering::SeqCst);

    let res = upload(&app, "alice", card_id(&card), &video_parts(&[])).await;
    assert_eq!(
        res.status,
        StatusCode::INTERNAL_SERVER_ERROR,
        "{}",
        res.json
    );
    assert!(
        app.media_keys().await.is_empty(),
        "public files were removed"
    );
    assert!(app.media.list_private_keys().await.is_empty());
    assert_eq!(media_rows(&pool).await, 0);
}

// spec: MED-035
#[sqlx::test(migrations = "./migrations")]
async fn a_crop_narrower_than_16_pixels_is_refused(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    // 4:3 on a 1920 x 1080 frame, 0.005 wide: 9.6 pixels.
    let crop = json!({ "x": 0.1, "y": 0.0, "width": 0.005, "height": 0.0089 }).to_string();
    let res = upload(
        &app,
        "alice",
        card_id(&card),
        &video_parts(&[("crop", crop)]),
    )
    .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        res.json["error"]["fields"],
        json!([{ "field": "crop", "code": "invalid_crop" }])
    );
    assert!(app.media_keys().await.is_empty());
}

// spec: MED-018, EDI-006, MED-001
#[sqlx::test(migrations = "./migrations")]
async fn media_is_attached_only_on_save(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card_id(&card);

    let a = uploaded(&app, id, "header", jpeg(1200, 800)).await;
    assert_eq!(get_card(&app, id).await["header"], Value::Null);

    let res = put_card(&app, "alice", id, json!({ "header_media_id": a["id"] })).await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    assert_eq!(res.json["header"], a);
    assert_eq!(get_card(&app, id).await["header"], a);
    assert_eq!(res.json["avatar"], Value::Null);

    // Replacing the header removes the old files after the save.
    let b = uploaded(&app, id, "header", jpeg(1200, 800)).await;
    let a_prefix = format!("cards/{id}/{}/", a["id"].as_str().unwrap());
    assert!(
        app.media_keys()
            .await
            .iter()
            .any(|k| k.starts_with(&a_prefix))
    );
    let res = put_card(&app, "alice", id, json!({ "header_media_id": b["id"] })).await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json["header"], b);
    assert!(
        !app.media_keys()
            .await
            .iter()
            .any(|k| k.starts_with(&a_prefix))
    );

    // An upload that is not kept is removed at the next save; the kept media stay.
    let c = uploaded(&app, id, "avatar", jpeg(600, 600)).await;
    let c_prefix = format!("cards/{id}/{}/", c["id"].as_str().unwrap());
    assert!(
        app.media_keys()
            .await
            .iter()
            .any(|k| k.starts_with(&c_prefix))
    );
    let res = put_card(&app, "alice", id, json!({})).await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json["header"], b);
    assert_eq!(res.json["avatar"], Value::Null);
    let b_prefix = format!("cards/{id}/{}/", b["id"].as_str().unwrap());
    let keys = app.media_keys().await;
    assert!(!keys.iter().any(|k| k.starts_with(&c_prefix)));
    assert!(keys.iter().any(|k| k.starts_with(&b_prefix)));

    // Removing the header (null) deletes it too.
    let res = put_card(&app, "alice", id, json!({ "header_media_id": null })).await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json["header"], Value::Null);
    assert!(app.media_keys().await.is_empty());
}

// spec: MED-020, ACC-017, EDI-015
#[sqlx::test(migrations = "./migrations")]
async fn media_of_another_card_is_invalid(pool: PgPool) {
    let app = cards_app(pool).await;
    let first = create_card(&app, "alice", "alice-durand").await;
    let second = create_card(&app, "alice", "alice-pro").await;
    let (first_id, second_id) = (card_id(&first), card_id(&second));
    let foreign = uploaded(&app, first_id, "avatar", png(400, 400)).await;

    let res = put_card(
        &app,
        "alice",
        second_id,
        json!({ "avatar_media_id": foreign["id"] }),
    )
    .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(error_code(&res), "validation_failed");
    assert_eq!(
        res.json["error"]["fields"],
        json!([{ "field": "avatar_media_id", "code": "invalid_media" }])
    );
    // Nothing was removed from the other card.
    let prefix = format!("cards/{first_id}/{}/", foreign["id"].as_str().unwrap());
    assert!(
        app.media_keys()
            .await
            .iter()
            .any(|k| k.starts_with(&prefix))
    );

    // An unknown id is just as invalid.
    let res = put_card(
        &app,
        "alice",
        second_id,
        json!({ "header_media_id": "0197c8c0-0000-7000-8000-000000000000" }),
    )
    .await;
    assert_eq!(
        res.json["error"]["fields"],
        json!([{ "field": "header_media_id", "code": "invalid_media" }])
    );

    // A header video is not an avatar, and an avatar is not a header.
    let video = upload(
        &app,
        "alice",
        first_id,
        &[
            Part::text("slot", "header"),
            Part::file("file", "clip.mp4", "video/mp4", mp4(2_000)),
        ],
    )
    .await;
    assert_eq!(video.status, StatusCode::CREATED);
    let res = put_card(
        &app,
        "alice",
        first_id,
        json!({ "avatar_media_id": video.json["id"] }),
    )
    .await;
    assert_eq!(
        res.json["error"]["fields"],
        json!([{ "field": "avatar_media_id", "code": "invalid_media" }])
    );
    let res = put_card(
        &app,
        "alice",
        first_id,
        json!({ "header_media_id": foreign["id"] }),
    )
    .await;
    assert_eq!(
        res.json["error"]["fields"],
        json!([{ "field": "header_media_id", "code": "invalid_media" }])
    );

    // Media errors come with the other field errors, in one answer.
    let res = put_card(
        &app,
        "alice",
        first_id,
        json!({ "template": "", "header_media_id": foreign["id"] }),
    )
    .await;
    assert_eq!(
        res.json["error"]["fields"],
        json!([
            { "field": "template", "code": "invalid_template" },
            { "field": "header_media_id", "code": "invalid_media" },
        ])
    );
}

// spec: ACC-017
#[sqlx::test(migrations = "./migrations")]
async fn saving_a_deleted_card_is_404(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card_id(&card);
    let media = uploaded(&app, id, "avatar", png(400, 400)).await;
    let body = json!({
        "slug": "alice-durand", "template": "classique", "settings": {},
        "theme": { "preset": "craie" }, "content": { "first_name": "Alice" },
        "links": [], "avatar_media_id": media["id"],
    });
    let deleted = app
        .request(
            "DELETE",
            &format!("/api/cards/{id}"),
            Some(&token("alice")),
            None,
        )
        .await;
    assert_eq!(deleted.status, StatusCode::NO_CONTENT);

    let res = app
        .request(
            "PUT",
            &format!("/api/cards/{id}"),
            Some(&token("alice")),
            Some(body),
        )
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&res), "not_found");
}

// spec: MED-019
#[sqlx::test(migrations = "./migrations")]
async fn deleting_a_card_deletes_its_files(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let other = create_card(&app, "alice", "alice-pro").await;
    let id = card_id(&card);
    let kept = uploaded(&app, card_id(&other), "avatar", png(400, 400)).await;
    let attached = uploaded(&app, id, "header", jpeg(1200, 800)).await;
    uploaded(&app, id, "avatar", png(400, 400)).await;
    put_card(
        &app,
        "alice",
        id,
        json!({ "header_media_id": attached["id"] }),
    )
    .await;

    let res = app
        .request(
            "DELETE",
            &format!("/api/cards/{id}"),
            Some(&token("alice")),
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::NO_CONTENT);

    let keys = app.media_keys().await;
    let prefix = format!("cards/{id}/");
    assert!(!keys.iter().any(|k| k.starts_with(&prefix)), "{keys:?}");
    // The other card keeps its files.
    let kept_prefix = format!(
        "cards/{}/{}/",
        card_id(&other),
        kept["id"].as_str().unwrap()
    );
    assert!(keys.iter().any(|k| k.starts_with(&kept_prefix)));
}

// spec: MED-020, ACC-017
#[sqlx::test(migrations = "./migrations")]
async fn only_the_owner_uploads(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    create_card(&app, "bob", "bob-martin").await;
    let id = card_id(&card);
    let parts = [
        Part::text("slot", "avatar"),
        Part::file("file", "photo.png", "image/png", png(300, 300)),
    ];

    let res = upload(&app, "bob", id, &parts).await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&res), "not_found");
    assert!(app.media_keys().await.is_empty());

    let res = app
        .request_multipart("POST", &format!("/api/cards/{id}/media"), None, &parts)
        .await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);
}

// spec: MED-005, EDI-015
#[sqlx::test(migrations = "./migrations")]
async fn malformed_uploads_are_400(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card_id(&card);
    let file = || Part::file("file", "photo.png", "image/png", png(300, 300));

    let res = upload(&app, "alice", id, &[file()]).await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        res.json["error"]["fields"],
        json!([{ "field": "slot", "code": "required" }])
    );

    let res = upload(&app, "alice", id, &[Part::text("slot", "header")]).await;
    assert_eq!(
        res.json["error"]["fields"],
        json!([{ "field": "file", "code": "required" }])
    );

    let res = upload(&app, "alice", id, &[Part::text("slot", "footer"), file()]).await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(error_code(&res), "invalid_request");

    // Not multipart at all.
    let res = app
        .request(
            "POST",
            &format!("/api/cards/{id}/media"),
            Some(&token("alice")),
            Some(json!({ "slot": "header" })),
        )
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(error_code(&res), "invalid_request");
    assert!(app.media_keys().await.is_empty());
}

// spec: MED-010, MED-016
#[sqlx::test(migrations = "./migrations")]
async fn media_files_are_served_with_long_cache(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let media = uploaded(&app, card_id(&card), "avatar", jpeg(800, 800)).await;
    // The upload answers with signed addresses, cached by the owner's browser only (MED-023).
    let signed = media_path(&media["images"][0]["url"]);
    let res = get_file(&app, signed, &[]).await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.headers["cache-control"], "private, max-age=86400");

    let res = get_file(&app, unsigned(signed), &[]).await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.headers["content-type"], "image/webp");
    assert_eq!(
        res.headers["cache-control"],
        "public, max-age=31536000, immutable"
    );
    assert_eq!(res.headers["x-content-type-options"], "nosniff");
    assert_eq!(res.headers["accept-ranges"], "bytes");
    assert_eq!(res.body.len().to_string(), res.headers["content-length"]);
    assert_eq!(&res.body[..4], b"RIFF");

    let jpeg_path = unsigned(media_path(&media["jpeg_url"]));
    let res = get_file(&app, jpeg_path, &[]).await;
    assert_eq!(res.headers["content-type"], "image/jpeg");

    // Unknown file in a well-formed key.
    let missing = jpeg_path.replace("s512.jpg", "s256.jpg.x");
    assert_eq!(
        get_file(&app, &missing, &[]).await.status,
        StatusCode::NOT_FOUND
    );
    let absent = jpeg_path.replace("s512.jpg", "s999.jpg");
    assert_eq!(
        get_file(&app, &absent, &[]).await.status,
        StatusCode::NOT_FOUND
    );
}

// spec: MED-017, Review Focus 2
#[sqlx::test(migrations = "./migrations")]
async fn media_files_honour_range_requests(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let video = upload(&app, "alice", card_id(&card), &video_parts(&[])).await;
    assert_eq!(video.status, StatusCode::CREATED);
    let path = unsigned(media_path(&video.json["video_url"]));
    let clip = app
        .media
        .get(&key_of(&video.json["video_url"]), None)
        .await
        .unwrap()
        .bytes
        .to_vec();
    let n = clip.len();

    let whole = get_file(&app, path, &[]).await;
    assert_eq!(whole.headers["content-type"], "video/mp4");
    assert_eq!(whole.body.as_ref(), clip.as_slice());

    let res = get_file(&app, path, &[("range", "bytes=0-1")]).await;
    assert_eq!(res.status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(res.body.as_ref(), &clip[..2]);
    assert_eq!(res.headers["content-range"], format!("bytes 0-1/{n}"));
    assert_eq!(res.headers["content-length"], "2");
    assert_eq!(res.headers["accept-ranges"], "bytes");
    assert_eq!(
        res.headers["cache-control"],
        "public, max-age=31536000, immutable"
    );

    let res = get_file(&app, path, &[("range", "bytes=-4")]).await;
    assert_eq!(res.status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(res.body.as_ref(), &clip[n - 4..]);
    assert_eq!(
        res.headers["content-range"],
        format!("bytes {}-{}/{n}", n - 4, n - 1)
    );

    let res = get_file(&app, path, &[("range", "bytes=10-")]).await;
    assert_eq!(res.status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(res.body.as_ref(), &clip[10..]);

    // An end past the file is cut short.
    let res = get_file(&app, path, &[("range", "bytes=10-99999999")]).await;
    assert_eq!(res.status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(
        res.headers["content-range"],
        format!("bytes 10-{}/{n}", n - 1)
    );

    for range in [
        format!("bytes={n}-"),
        format!("bytes={}-{}", n + 5, n + 9),
        "bytes=5-2".to_string(),
        "bytes=-0".to_string(),
        "bytes=abc".to_string(),
        "items=0-1".to_string(),
        "bytes=0-1,3-4".to_string(),
    ] {
        let res = get_file(&app, path, &[("range", &range)]).await;
        assert_eq!(res.status, StatusCode::RANGE_NOT_SATISFIABLE, "{range}");
        assert_eq!(
            res.headers["content-range"],
            format!("bytes */{n}"),
            "{range}"
        );
    }
}

// spec: MED-010
#[sqlx::test(migrations = "./migrations")]
async fn media_paths_cannot_escape(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let media = uploaded(&app, card_id(&card), "avatar", jpeg(800, 800)).await;
    let good = media_path(&media["images"][0]["url"]).to_string();
    assert_eq!(get_file(&app, &good, &[]).await.status, StatusCode::OK);

    for path in [
        "/media/../../etc/passwd",
        "/media/cards/x/y/z.txt",
        "/media/",
        "/media/cards/../s128.webp",
        &good.replace("/s128.webp", "/../s128.webp"),
        &good.replace("/s128.webp", "/s128.webp/"),
        &good.replace("/s128.webp", "/S128.WEBP"),
        &good.replace("/media/cards/", "/media/CARDS/"),
        &good.replace("/s128.webp", "/s1.webp"),
        &good.replace("/s128.webp", "/s12345.webp"),
        &good.replace("/s128.webp", "/s128.gif"),
    ] {
        let res = get_file(&app, path, &[]).await;
        assert_eq!(res.status, StatusCode::NOT_FOUND, "{path}");
    }
}

// spec: MED-011
#[sqlx::test(migrations = "./migrations")]
async fn s3_mode_does_not_mount_media_route(pool: PgPool) {
    let (mut state, clock) = test_state_with(pool, &[("SIGNUP_MODE", "open")]);
    state.media = cartouche_api::media::MediaService::in_memory_remote(
        "https://cdn.example/bucket/".parse().unwrap(),
    );
    let app = TestApp::from_state(state, clock);
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card_id(&card);

    let media = uploaded(&app, id, "avatar", jpeg(800, 800)).await;
    let url = media["images"][0]["url"].as_str().unwrap();
    let key = url.strip_prefix("https://cdn.example/bucket/").unwrap();
    assert!(key.starts_with(&format!("cards/{id}/")), "{url}");

    let res = get_file(&app, &format!("/media/{key}"), &[]).await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&res), "not_found");
}

/// Uploads an avatar for Alice's card, attaches it by a save and returns the card's id.
async fn card_with_avatar(app: &TestApp) -> String {
    let card = create_card(app, "alice", "alice-durand").await;
    let id = card_id(&card).to_string();
    let media = uploaded(app, &id, "avatar", jpeg(800, 800)).await;
    let res = put_card(app, "alice", &id, json!({ "avatar_media_id": media["id"] })).await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    id
}

/// The avatar's smallest image, as the public page lists it.
async fn public_avatar_path(app: &TestApp) -> String {
    let res = app
        .request("GET", "/api/public/cards/alice-durand", None, None)
        .await;
    assert_eq!(res.json["state"], "active", "{}", res.json);
    media_path(&res.json["card"]["avatar"]["images"][0]["url"]).to_string()
}

async fn owner_action(app: &TestApp, id: &str, action: &str) {
    let res = app
        .request(
            "POST",
            &format!("/api/cards/{id}/{action}"),
            Some(&token("alice")),
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::OK, "{action}: {}", res.json);
}

async fn support_action(app: &TestApp, id: &str, action: &str) {
    let res = app
        .request(
            "POST",
            &format!("/api/admin/cards/{id}/support-{action}"),
            Some(&token("boss")),
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::OK, "support-{action}: {}", res.json);
}

/// The `exp` and `sig` query parameters of a signed media address.
fn signature_of(path: &str) -> (i64, String) {
    let (_, query) = path
        .split_once('?')
        .unwrap_or_else(|| panic!("unsigned: {path}"));
    let param = |name: &str| {
        query
            .split('&')
            .find_map(|pair| pair.strip_prefix(&format!("{name}=")))
            .unwrap_or_else(|| panic!("no {name} in {path}"))
            .to_string()
    };
    (param("exp").parse().unwrap(), param("sig"))
}

// spec: MED-023, LNK-026, LNK-027
#[sqlx::test(migrations = "./migrations")]
async fn media_of_an_unserved_card_is_404_without_signature(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let id = card_with_avatar(&app).await;
    let path = public_avatar_path(&app).await;
    assert!(
        !path.contains('?'),
        "public addresses are not signed: {path}"
    );
    let served = get_file(&app, &path, &[]).await;
    assert_eq!(served.status, StatusCode::OK);
    assert_eq!(
        served.headers["cache-control"],
        "public, max-age=31536000, immutable"
    );

    owner_action(&app, &id, "disable").await;
    let res = get_file(&app, &path, &[]).await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&res), "not_found");
    let res = get_file(&app, &path, &[("range", "bytes=0-1")]).await;
    assert_eq!(res.status, StatusCode::NOT_FOUND, "a range is refused too");

    owner_action(&app, &id, "enable").await;
    assert_eq!(get_file(&app, &path, &[]).await.status, StatusCode::OK);

    support_action(&app, &id, "disable").await;
    assert_eq!(
        get_file(&app, &path, &[]).await.status,
        StatusCode::NOT_FOUND
    );
    support_action(&app, &id, "enable").await;
    assert_eq!(get_file(&app, &path, &[]).await.status, StatusCode::OK);

    sqlx::query("update users set status = 'suspended' where subject = 'alice'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        get_file(&app, &path, &[]).await.status,
        StatusCode::NOT_FOUND
    );
}

// spec: MED-023, LNK-008, ADM-013
#[sqlx::test(migrations = "./migrations")]
async fn dashboard_and_support_urls_stay_readable(pool: PgPool) {
    let app = cards_app(pool).await;
    let id = card_with_avatar(&app).await;
    let public = public_avatar_path(&app).await;
    support_action(&app, &id, "disable").await;
    assert_eq!(
        get_file(&app, &public, &[]).await.status,
        StatusCode::NOT_FOUND
    );

    let owner_view = get_card(&app, &id).await;
    let owner_path = media_path(&owner_view["avatar"]["images"][0]["url"]).to_string();
    let (exp, sig) = signature_of(&owner_path);
    assert!(!sig.is_empty());
    assert_eq!(unsigned(&owner_path), public);
    // The test clock reads 2026-01-15 12:00 UTC: the next hour, plus 24 hours.
    assert_eq!(exp, 1_768_482_000 + 24 * 3600);
    let res = get_file(&app, &owner_path, &[]).await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.headers["cache-control"], "private, max-age=86400");
    assert_eq!(res.headers["content-type"], "image/webp");
    assert_eq!(&res.body[..4], b"RIFF");

    let support_view = app
        .request(
            "GET",
            &format!("/api/admin/cards/{id}"),
            Some(&token("boss")),
            None,
        )
        .await;
    assert_eq!(support_view.status, StatusCode::OK);
    let jpeg_path = media_path(&support_view.json["card"]["avatar"]["jpeg_url"]).to_string();
    signature_of(&jpeg_path);
    let res = get_file(&app, &jpeg_path, &[]).await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.headers["cache-control"], "private, max-age=86400");
    assert_eq!(res.headers["content-type"], "image/jpeg");

    let res = get_file(&app, &owner_path, &[("range", "bytes=0-1")]).await;
    assert_eq!(res.status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(res.body.as_ref(), b"RI");
    assert_eq!(res.headers["cache-control"], "private, max-age=86400");

    // Addresses stay the same within the hour, so the browser can cache them.
    app.clock.advance(chrono::Duration::minutes(59));
    let again = get_card(&app, &id).await;
    assert_eq!(again["avatar"], owner_view["avatar"]);
}

// spec: MED-023
#[sqlx::test(migrations = "./migrations")]
async fn forged_or_expired_signatures_are_ignored(pool: PgPool) {
    let app = cards_app(pool).await;
    let id = card_with_avatar(&app).await;
    owner_action(&app, &id, "disable").await;
    let signed = media_path(&get_card(&app, &id).await["avatar"]["images"][0]["url"]).to_string();
    let (exp, sig) = signature_of(&signed);
    let public = unsigned(&signed);
    assert_eq!(get_file(&app, &signed, &[]).await.status, StatusCode::OK);

    let first = if sig.starts_with('A') { 'B' } else { 'A' };
    let forged_sig = format!("{first}{}", &sig[1..]);
    let other = media_path(&get_card(&app, &id).await["avatar"]["images"][1]["url"]).to_string();
    let other_public = unsigned(&other);
    for forged in [
        format!("{public}?exp={exp}&sig={forged_sig}"),
        format!("{public}?exp={}&sig={sig}", exp + 3600),
        format!("{public}?exp={exp}"),
        format!("{public}?sig={sig}"),
        // The signature of one file does not open another.
        format!("{other_public}?exp={exp}&sig={sig}"),
    ] {
        let res = get_file(&app, &forged, &[]).await;
        assert_eq!(res.status, StatusCode::NOT_FOUND, "{forged}");
        assert_eq!(error_code(&res), "not_found", "{forged}");
    }

    // Valid at least 24 hours, not 25.
    app.clock.advance(chrono::Duration::hours(24));
    assert_eq!(get_file(&app, &signed, &[]).await.status, StatusCode::OK);
    app.clock.advance(chrono::Duration::hours(1));
    assert_eq!(
        get_file(&app, &signed, &[]).await.status,
        StatusCode::NOT_FOUND
    );
}

// spec: MED-024, MED-011
#[sqlx::test(migrations = "./migrations")]
async fn s3_urls_are_never_signed(pool: PgPool) {
    let (mut state, clock) =
        test_state_with(pool, &[("SIGNUP_MODE", "open"), ("ADMIN_USER_IDS", "boss")]);
    state.media = cartouche_api::media::MediaService::in_memory_remote(
        "https://cdn.example/bucket/".parse().unwrap(),
    );
    let app = TestApp::from_state(state, clock);
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card_id(&card);
    let header = upload(
        &app,
        "alice",
        id,
        &[
            Part::text("slot", "header"),
            Part::file("file", "clip.mp4", "video/mp4", mp4(2_000)),
        ],
    )
    .await;
    assert_eq!(header.status, StatusCode::CREATED, "{}", header.json);
    let avatar = uploaded(&app, id, "avatar", jpeg(800, 800)).await;
    let res = put_card(
        &app,
        "alice",
        id,
        json!({ "header_media_id": header.json["id"], "avatar_media_id": avatar["id"] }),
    )
    .await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    owner_action(&app, id, "disable").await;

    let support_view = app
        .request(
            "GET",
            &format!("/api/admin/cards/{id}"),
            Some(&token("boss")),
            None,
        )
        .await;
    for view in [
        header.json.clone(),
        avatar,
        get_card(&app, id).await,
        support_view.json["card"].clone(),
    ] {
        let text = view.to_string();
        assert!(text.contains("https://cdn.example/bucket/cards/"), "{text}");
        assert!(!text.contains('?'), "{text}");
    }
}

/// The storage key of a file address handed out by the API, signed or not.
fn key_of(url: &Value) -> String {
    unsigned(url.as_str().unwrap())
        .strip_prefix(&format!("{BASE}/media/"))
        .unwrap()
        .to_string()
}

async fn stored_image(app: &TestApp, url: &Value) -> image::DynamicImage {
    let file = app.media.get(&key_of(url), None).await.unwrap();
    image::load_from_memory(&file.bytes).unwrap()
}

/// The stored image of the variant `width` of `media`.
async fn variant(app: &TestApp, media: &Value, width: u64) -> image::DynamicImage {
    let image = media["images"]
        .as_array()
        .unwrap()
        .iter()
        .find(|image| image["width"] == width)
        .unwrap_or_else(|| panic!("no w{width} in {media}"));
    stored_image(app, &image["url"]).await
}

fn source_file_name(media: &Value) -> String {
    key_of(&media["source"]["url"])
        .rsplit('/')
        .next()
        .unwrap()
        .to_string()
}

fn has_metadata(bytes: &[u8]) -> bool {
    bytes.windows(4).any(|w| w == b"Exif") || bytes.windows(3).any(|w| w == b"GPS")
}

async fn media_rows(pool: &PgPool) -> i64 {
    sqlx::query_scalar("select count(*) from media")
        .fetch_one(pool)
        .await
        .unwrap()
}

fn assert_close(actual: &Value, expected: f64, what: &str) {
    let actual = actual
        .as_f64()
        .unwrap_or_else(|| panic!("{what}: {actual}"));
    assert!((actual - expected).abs() < 1e-9, "{what}: {actual}");
}

fn assert_crop(media: &Value, x: f64, y: f64, width: f64, height: f64) {
    let crop = &media["crop"];
    assert_close(&crop["x"], x, "x");
    assert_close(&crop["y"], y, "y");
    assert_close(&crop["width"], width, "width");
    assert_close(&crop["height"], height, "height");
}

async fn upload_header(
    app: &TestApp,
    card: &str,
    bytes: Vec<u8>,
    crop: Option<Value>,
) -> TestResponse {
    let mut parts = vec![
        Part::text("slot", "header"),
        Part::file("file", "photo.png", "image/png", bytes),
    ];
    if let Some(crop) = crop {
        parts.push(Part::text("crop", &crop.to_string()));
    }
    upload(app, "alice", card, &parts).await
}

// spec: MED-025, MED-007, MED-014, Review Focus 7
#[sqlx::test(migrations = "./migrations")]
async fn the_source_is_kept_oriented_without_metadata(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let upload = jpeg_with_exif(1200, 800, 6, true);
    let media = uploaded(&app, card_id(&card), "header", upload.clone()).await;

    assert!(
        cartouche_domain::is_source_name(&source_file_name(&media)),
        "{media}"
    );
    assert_eq!(media["source"]["width"], 800);
    assert_eq!(media["source"]["height"], 1200);
    let source = app
        .media
        .get(&key_of(&media["source"]["url"]), None)
        .await
        .unwrap();
    assert_eq!(&source.bytes[8..12], b"WEBP");
    assert!(!has_metadata(&source.bytes));
    let decoded = image::load_from_memory(&source.bytes).unwrap();
    assert_eq!((decoded.width(), decoded.height()), (800, 1200));
    // No stored file carries metadata, and the upload itself is not kept (MED-007).
    for key in app.media_keys().await {
        let file = app.media.get(&key, None).await.unwrap();
        assert!(!has_metadata(&file.bytes), "{key}");
        assert_ne!(file.bytes.as_ref(), upload.as_slice(), "{key}");
    }
}

// spec: MED-026, MED-027, MED-015
#[sqlx::test(migrations = "./migrations")]
async fn the_header_is_cut_along_the_crop(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let crop = json!({ "x": 0.0, "y": 0.0, "width": 0.5, "height": 0.5 });
    let res = upload_header(&app, card_id(&card), quadrants_png(1600, 1200), Some(crop)).await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);
    let media = res.json;

    assert_crop(&media, 0.0, 0.0, 0.5, 0.5);
    assert_eq!(media["loop"], Value::Null);
    assert_eq!(media["poster_time"], Value::Null);
    assert_eq!(widths(&media), [750, 800]);
    let w750 = variant(&app, &media, 750).await;
    assert_eq!((w750.width(), w750.height()), (750, 563));
    let w800 = variant(&app, &media, 800).await.to_rgb8();
    assert_eq!(w800.dimensions(), (800, 600));
    // The top left quadrant, red, fills the file.
    for (x, y) in [(400, 300), (10, 10), (790, 590)] {
        let pixel = w800.get_pixel(x, y);
        assert!(
            pixel[0] > 200 && pixel[1] < 60 && pixel[2] < 60,
            "{x},{y}: {pixel:?}"
        );
    }
    // The source is the whole image.
    assert_eq!(media["source"]["width"], 1600);
    assert_eq!(media["source"]["height"], 1200);
}

// spec: MED-026
#[sqlx::test(migrations = "./migrations")]
async fn without_crop_the_largest_centered_rectangle_is_taken(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let media = uploaded(&app, card_id(&card), "header", png(1600, 900)).await;

    assert_crop(&media, 0.125, 0.0, 0.75, 1.0);
    assert_eq!(widths(&media), [750, 1125, 1200]);
    let w1125 = variant(&app, &media, 1125).await;
    assert_eq!((w1125.width(), w1125.height()), (1125, 844));

    let avatar = uploaded(&app, card_id(&card), "avatar", png(900, 1600)).await;
    assert_crop(&avatar, 0.0, 0.21875, 1.0, 0.5625);
}

// spec: MED-026, Review Focus 6
#[sqlx::test(migrations = "./migrations")]
async fn a_bad_crop_is_refused_and_nothing_is_stored(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card_id(&card);

    for crop in [
        // Past the right edge.
        json!({ "x": 0.5, "y": 0.0, "width": 0.75, "height": 0.75 }),
        // Not 4:3.
        json!({ "x": 0.0, "y": 0.0, "width": 0.5, "height": 0.5 * 1.1 }),
        json!({ "x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0 }),
    ] {
        let res = upload_header(&app, id, png(1600, 1200), Some(crop.clone())).await;
        assert_eq!(res.status, StatusCode::BAD_REQUEST, "{crop}");
        assert_eq!(error_code(&res), "validation_failed");
        assert_eq!(
            res.json["error"]["fields"],
            json!([{ "field": "crop", "code": "invalid_crop" }])
        );
    }

    // A square crop is an avatar's, not a header's.
    let res = upload(
        &app,
        "alice",
        id,
        &[
            Part::text("slot", "avatar"),
            Part::file("file", "photo.png", "image/png", png(1600, 1200)),
            Part::text("crop", r#"{"x":0,"y":0,"width":0.5,"height":0.5}"#),
        ],
    )
    .await;
    assert_eq!(
        res.json["error"]["fields"],
        json!([{ "field": "crop", "code": "invalid_crop" }])
    );

    // A crop that is not JSON, or misses a side, is a malformed request.
    for crop in ["not json", r#"{"x":0,"y":0,"width":1}"#] {
        let res = upload(
            &app,
            "alice",
            id,
            &[
                Part::text("slot", "header"),
                Part::file("file", "photo.png", "image/png", png(1600, 1200)),
                Part::text("crop", crop),
            ],
        )
        .await;
        assert_eq!(res.status, StatusCode::BAD_REQUEST, "{crop}");
        assert_eq!(error_code(&res), "invalid_request", "{crop}");
    }

    // A loop or a poster time is only for a video.
    let res = upload(
        &app,
        "alice",
        id,
        &[
            Part::text("slot", "header"),
            Part::file("file", "photo.png", "image/png", png(1600, 1200)),
            Part::text("poster_time", "1"),
        ],
    )
    .await;
    assert_eq!(error_code(&res), "invalid_request");

    assert!(app.media_keys().await.is_empty());
    assert_eq!(media_rows(&pool).await, 0);
}

fn video_parts(extra: &[(&str, String)]) -> Vec<Part> {
    let mut parts = vec![
        Part::text("slot", "header"),
        Part::file("file", "clip.mp4", "video/mp4", header_clip()),
    ];
    for (name, value) in extra {
        parts.push(Part::text(name, value));
    }
    parts
}

/// The duration of the clip fixture, as the server reads it.
fn clip_seconds() -> f64 {
    cartouche_domain::mp4_duration(&header_clip())
        .unwrap()
        .as_secs_f64()
}

// spec: MED-028, MED-026
#[sqlx::test(migrations = "./migrations")]
async fn a_video_keeps_its_framing(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let parts = video_parts(&[
        (
            "crop",
            json!({ "x": 0.125, "y": 0.0, "width": 0.75, "height": 1.0 }).to_string(),
        ),
        ("loop", json!({ "start": 0.2, "end": 1.8 }).to_string()),
        ("poster_time", "1".to_string()),
    ]);
    let res = upload(&app, "alice", card_id(&card), &parts).await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);
    let media = res.json;

    assert_eq!(media["kind"], "video");
    assert_crop(&media, 0.125, 0.0, 0.75, 1.0);
    assert_close(&media["loop"]["start"], 0.2, "loop start");
    assert_close(&media["loop"]["end"], 1.8, "loop end");
    assert_close(&media["poster_time"], 1.0, "poster time");
    let duration_ms: Option<i32> = sqlx::query_scalar("select duration_ms from media")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!((duration_ms.unwrap() - 2000).abs() < 50, "{duration_ms:?}");
    let w1440 = variant(&app, &media, 1440).await;
    assert_eq!((w1440.width(), w1440.height()), (1440, 1080));
    let w750 = variant(&app, &media, 750).await;
    assert_eq!((w750.width(), w750.height()), (750, 563));
}

// spec: MED-028
#[sqlx::test(migrations = "./migrations")]
async fn video_loop_and_poster_time_are_checked(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card_id(&card);

    for (field, value, code) in [
        (
            "loop",
            json!({ "start": 0.5, "end": 1.0 }).to_string(),
            "invalid_loop",
        ),
        (
            "loop",
            json!({ "start": 1.5, "end": 3.0 }).to_string(),
            "invalid_loop",
        ),
        ("poster_time", "3".to_string(), "invalid_poster_time"),
        ("poster_time", "-0.5".to_string(), "invalid_poster_time"),
    ] {
        let res = upload(&app, "alice", id, &video_parts(&[(field, value.clone())])).await;
        assert_eq!(res.status, StatusCode::BAD_REQUEST, "{field} {value}");
        assert_eq!(
            res.json["error"]["fields"],
            json!([{ "field": field, "code": code }]),
            "{field} {value}"
        );
    }
    let res = upload(
        &app,
        "alice",
        id,
        &video_parts(&[("poster_time", "soon".to_string())]),
    )
    .await;
    assert_eq!(error_code(&res), "invalid_request");
    assert!(app.media_keys().await.is_empty());
    assert_eq!(media_rows(&pool).await, 0);

    // Without them: the whole video, and the first frame.
    let res = upload(&app, "alice", id, &video_parts(&[])).await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);
    assert_close(&res.json["loop"]["start"], 0.0, "loop start");
    let end = res.json["loop"]["end"].as_f64().unwrap();
    assert!((end - clip_seconds()).abs() < 0.05, "{end}");
    assert_close(&res.json["poster_time"], 0.0, "poster time");
    assert_crop(&res.json, 0.125, 0.0, 0.75, 1.0);
}

/// Uploads a header image for Alice's card and attaches it; returns the card id.
async fn card_with_header(app: &TestApp) -> String {
    let card = create_card(app, "alice", "alice-durand").await;
    let id = card_id(&card).to_string();
    let media = uploaded(app, &id, "header", jpeg(1200, 900)).await;
    let res = put_card(app, "alice", &id, json!({ "header_media_id": media["id"] })).await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    id
}

/// Uploads the clip fixture as Alice's header, attaches it; returns the card id.
async fn card_with_video_header(app: &TestApp) -> String {
    let card = create_card(app, "alice", "alice-durand").await;
    let id = card_id(&card).to_string();
    let res = upload(app, "alice", &id, &video_parts(&[])).await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);
    let res = put_card(
        app,
        "alice",
        &id,
        json!({ "header_media_id": res.json["id"] }),
    )
    .await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    id
}

fn assert_no_source(view: &Value, what: &str) {
    let text = view.to_string();
    assert!(!text.contains("\"source\""), "{what}: {text}");
    assert!(!text.contains("source-"), "{what}: {text}");
}

// spec: MED-031, Review Focus 4
#[sqlx::test(migrations = "./migrations")]
async fn a_source_is_only_read_with_the_owners_signature(pool: PgPool) {
    let app = cards_app(pool).await;
    let id = card_with_header(&app).await;

    let owner = get_card(&app, &id).await;
    let signed = media_path(&owner["header"]["source"]["url"]).to_string();
    signature_of(&signed);
    let res = get_file(&app, &signed, &[]).await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.headers["content-type"], "image/webp");
    assert_eq!(res.headers["cache-control"], "private, max-age=86400");
    // The card is served, yet its source is not readable without the signature.
    let res = get_file(&app, unsigned(&signed), &[]).await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&res), "not_found");
    let res = get_file(&app, unsigned(&signed), &[("range", "bytes=0-1")]).await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);

    let public = app
        .request("GET", "/api/public/cards/alice-durand", None, None)
        .await;
    assert_eq!(public.json["state"], "active");
    assert!(public.json["card"]["header"]["crop"].is_object());
    assert_no_source(&public.json, "public card");
    let support = app
        .request(
            "GET",
            &format!("/api/admin/cards/{id}"),
            Some(&token("boss")),
            None,
        )
        .await;
    assert_eq!(support.status, StatusCode::OK);
    assert!(support.json["card"]["header"]["crop"].is_object());
    assert_no_source(&support.json, "support card");
    let users = app
        .request("GET", "/api/admin/users", Some(&token("boss")), None)
        .await;
    for listed in users.json["users"].as_array().into_iter().flatten() {
        let detail = app
            .request(
                "GET",
                &format!("/api/admin/users/{}", listed["id"].as_str().unwrap()),
                Some(&token("boss")),
                None,
            )
            .await;
        assert_eq!(detail.status, StatusCode::OK);
        assert_no_source(&detail.json, "support user");
    }
}

// spec: MED-031
#[sqlx::test(migrations = "./migrations")]
async fn a_source_name_cannot_be_derived_from_the_public_files(pool: PgPool) {
    let (mut state, clock) = test_state_with(pool, &[("SIGNUP_MODE", "open")]);
    state.media = cartouche_api::media::MediaService::in_memory_remote(
        "https://cdn.example/bucket/".parse().unwrap(),
    );
    let app = TestApp::from_state(state, clock);
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card_id(&card);

    let first = uploaded(&app, id, "header", jpeg(1200, 900)).await;
    let second = uploaded(&app, id, "header", jpeg(1200, 900)).await;
    let name_of = |media: &Value| {
        let url = media["source"]["url"].as_str().unwrap();
        assert!(
            url.starts_with("https://cdn.example/bucket/cards/"),
            "{url}"
        );
        assert!(!url.contains('?'), "{url}");
        url.rsplit('/').next().unwrap().to_string()
    };
    let (first_name, second_name) = (name_of(&first), name_of(&second));
    assert!(
        cartouche_domain::is_source_name(&first_name),
        "{first_name}"
    );
    assert!(
        cartouche_domain::is_source_name(&second_name),
        "{second_name}"
    );
    assert_ne!(first_name, second_name);

    // The public files of the media say nothing of its source.
    let res = put_card(&app, "alice", id, json!({ "header_media_id": first["id"] })).await;
    assert_eq!(res.status, StatusCode::OK);
    let public = app
        .request("GET", "/api/public/cards/alice-durand", None, None)
        .await;
    assert_no_source(&public.json, "public card");
    let public_url = public.json["card"]["header"]["images"][0]["url"]
        .as_str()
        .unwrap();
    let key = public_url
        .strip_prefix("https://cdn.example/bucket/")
        .unwrap();
    let guessed = format!("{}/source.webp", key.rsplit_once('/').unwrap().0);
    assert!(matches!(
        app.media.get(&guessed, None).await,
        Err(cartouche_api::media::MediaError::NotFound)
    ));
}

// spec: MED-033
#[sqlx::test(migrations = "./migrations")]
async fn a_media_from_before_plan_6_has_no_framing(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id: uuid::Uuid = card_id(&card).parse().unwrap();
    let media_id = uuid::Uuid::now_v7();
    sqlx::query(
        "insert into media (id, card_id, slot, kind, variants) values ($1, $2, 'header', 'image', \
         '[{\"name\":\"w640.webp\",\"width\":640,\"format\":\"webp\"}]')",
    )
    .bind(media_id)
    .bind(id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("update cards set header_media_id = $1 where id = $2")
        .bind(media_id)
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    let key = cartouche_domain::storage_key(id, media_id, "w640.webp");
    app.media
        .put(&key, bytes::Bytes::from(png(640, 480)))
        .await
        .unwrap();

    let owner = get_card(&app, &id.to_string()).await;
    let header = &owner["header"];
    assert_eq!(header["id"], media_id.to_string());
    for field in ["crop", "loop", "poster_time", "duration_seconds", "source"] {
        assert_eq!(header[field], Value::Null, "{field}");
    }
    assert_eq!(widths(header), [640]);
    let res = get_file(&app, &format!("/media/{key}"), &[]).await;
    assert_eq!(res.status, StatusCode::OK);
}

// spec: EDI-014, MED-025
#[sqlx::test(migrations = "./migrations")]
async fn duplication_copies_the_source_and_the_framing(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card_id(&card);
    let crop = json!({ "x": 0.5, "y": 0.5, "width": 0.5, "height": 0.5 });
    let res = upload_header(&app, id, quadrants_png(1600, 1200), Some(crop)).await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);
    let original = res.json;
    let res = put_card(
        &app,
        "alice",
        id,
        json!({ "header_media_id": original["id"] }),
    )
    .await;
    assert_eq!(res.status, StatusCode::OK);

    let res = app
        .request(
            "POST",
            &format!("/api/cards/{id}/duplicate"),
            Some(&token("alice")),
            Some(json!({ "slug": "alice-copie" })),
        )
        .await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);
    let copy = &res.json["header"];
    assert_ne!(copy["id"], original["id"]);
    assert_eq!(copy["crop"], original["crop"]);
    assert_eq!(copy["source"]["width"], 1600);
    assert_eq!(copy["source"]["height"], 1200);
    let (original_name, copy_name) = (source_file_name(&original), source_file_name(copy));
    assert!(cartouche_domain::is_source_name(&copy_name), "{copy_name}");
    assert_ne!(copy_name, original_name, "a new token for the copy");
    let new_card = res.json["id"].as_str().unwrap();
    assert!(key_of(&copy["source"]["url"]).starts_with(&format!("cards/{new_card}/")));

    let copied = app
        .media
        .get(&key_of(&copy["source"]["url"]), None)
        .await
        .unwrap();
    let kept = app
        .media
        .get(&key_of(&original["source"]["url"]), None)
        .await
        .unwrap();
    assert_eq!(copied.bytes, kept.bytes);
    let res = get_file(&app, media_path(&copy["source"]["url"]), &[]).await;
    assert_eq!(res.status, StatusCode::OK);
    // The copy's files are those of the original, cut along the same crop.
    let w800 = variant(&app, copy, 800).await.to_rgb8();
    let pixel = w800.get_pixel(400, 300);
    assert!(
        pixel[0] > 200 && pixel[1] > 200 && pixel[2] < 60,
        "yellow: {pixel:?}"
    );
}

async fn reframe(
    app: &TestApp,
    sub: &str,
    card: &str,
    media: &str,
    parts: &[Part],
) -> TestResponse {
    app.request_multipart(
        "POST",
        &format!("/api/cards/{card}/media/{media}/reframe"),
        Some(&token(sub)),
        parts,
    )
    .await
}

fn crop_part(x: f64, y: f64, width: f64, height: f64) -> Part {
    Part::text(
        "crop",
        &json!({ "x": x, "y": y, "width": width, "height": height }).to_string(),
    )
}

/// Every stored file with its bytes, by key.
async fn stored_files(app: &TestApp) -> std::collections::BTreeMap<String, bytes::Bytes> {
    let mut files = std::collections::BTreeMap::new();
    for key in app.media_keys().await {
        let file = app.media.get(&key, None).await.unwrap();
        files.insert(key, file.bytes);
    }
    files
}

/// Alice's card with an attached header cut from the quadrants image (default crop).
async fn card_with_quadrants_header(app: &TestApp) -> (String, Value) {
    let card = create_card(app, "alice", "alice-durand").await;
    let id = card_id(&card).to_string();
    let media = upload_header(app, &id, quadrants_png(1600, 1200), None)
        .await
        .json;
    let res = put_card(app, "alice", &id, json!({ "header_media_id": media["id"] })).await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    (id, media)
}

// spec: MED-030, MED-016, Review Focus 5
#[sqlx::test(migrations = "./migrations")]
async fn reframing_makes_a_new_media_and_leaves_the_old_one(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let (id, old) = card_with_quadrants_header(&app).await;
    let before = stored_files(&app).await;

    let res = reframe(
        &app,
        "alice",
        &id,
        old["id"].as_str().unwrap(),
        &[crop_part(0.5, 0.5, 0.5, 0.5)],
    )
    .await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);
    let new = res.json;

    assert_ne!(new["id"], old["id"]);
    assert_eq!(new["kind"], "image");
    assert_crop(&new, 0.5, 0.5, 0.5, 0.5);
    assert_eq!(media_rows(&pool).await, 2);
    // The new files are yellow, the bottom-right quadrant.
    let w800 = variant(&app, &new, 800).await.to_rgb8();
    let pixel = w800.get_pixel(400, 300);
    assert!(
        pixel[0] > 200 && pixel[1] > 200 && pixel[2] < 60,
        "yellow: {pixel:?}"
    );

    // The source is kept as it was, under a new name; the old media is untouched.
    let (old_name, new_name) = (source_file_name(&old), source_file_name(&new));
    assert!(cartouche_domain::is_source_name(&new_name), "{new_name}");
    assert_ne!(new_name, old_name);
    let after = stored_files(&app).await;
    for (key, bytes) in &before {
        assert_eq!(after.get(key), Some(bytes), "{key} is unchanged");
    }
    assert_eq!(
        after[&key_of(&new["source"]["url"])],
        before[&key_of(&old["source"]["url"])]
    );
    // The card still shows the old media until a save names the new one.
    assert_eq!(get_card(&app, &id).await["header"]["id"], old["id"]);
}

// spec: MED-030, MED-018
#[sqlx::test(migrations = "./migrations")]
async fn saving_the_reframed_media_replaces_the_previous_one(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let (id, old) = card_with_quadrants_header(&app).await;
    let old_prefix = format!("cards/{id}/{}/", old["id"].as_str().unwrap());
    let res = reframe(
        &app,
        "alice",
        &id,
        old["id"].as_str().unwrap(),
        &[crop_part(0.0, 0.0, 0.5, 0.5)],
    )
    .await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);
    let new = res.json;

    let res = put_card(&app, "alice", &id, json!({ "header_media_id": new["id"] })).await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.json);

    assert_eq!(media_rows(&pool).await, 1);
    let keys = app.media_keys().await;
    assert!(
        !keys.iter().any(|key| key.starts_with(&old_prefix)),
        "{keys:?}"
    );
    assert!(!keys.is_empty());
    assert_eq!(get_card(&app, &id).await["header"]["id"], new["id"]);
}

// spec: MED-020, ACC-017
#[sqlx::test(migrations = "./migrations")]
async fn another_owner_cannot_reframe(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let (id, old) = card_with_quadrants_header(&app).await;
    let other_card = create_card(&app, "alice", "alice-autre").await;
    create_card(&app, "bob", "bob-martin").await;
    let before = stored_files(&app).await;
    let media = old["id"].as_str().unwrap();
    let parts = [crop_part(0.0, 0.0, 0.5, 0.5)];

    let res = reframe(&app, "bob", &id, media, &parts).await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&res), "not_found");
    let unknown = uuid::Uuid::now_v7().to_string();
    let res = reframe(&app, "alice", &id, &unknown, &parts).await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    // A media of another card of the same owner.
    let res = reframe(&app, "alice", card_id(&other_card), media, &parts).await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);

    assert_eq!(stored_files(&app).await, before);
    assert_eq!(media_rows(&pool).await, 1);
}

// spec: MED-030
#[sqlx::test(migrations = "./migrations")]
async fn a_media_without_source_cannot_be_reframed(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id: uuid::Uuid = card_id(&card).parse().unwrap();
    let media_id = uuid::Uuid::now_v7();
    sqlx::query(
        "insert into media (id, card_id, slot, kind, variants) values ($1, $2, 'header', 'image', \
         '[{\"name\":\"w640.webp\",\"width\":640,\"format\":\"webp\"}]')",
    )
    .bind(media_id)
    .bind(id)
    .execute(&pool)
    .await
    .unwrap();

    let res = reframe(
        &app,
        "alice",
        &id.to_string(),
        &media_id.to_string(),
        &[crop_part(0.0, 0.0, 0.5, 0.5)],
    )
    .await;
    assert_eq!(res.status, StatusCode::CONFLICT);
    assert_eq!(error_code(&res), "media_not_reframable");
    assert_eq!(media_rows(&pool).await, 1);
    assert!(app.media_keys().await.is_empty());
}

/// Alice's card with the clip fixture attached as header, on an app whose video processor is
/// `stub`; returns the card id and the uploaded media.
async fn card_with_stub_video_header(app: &TestApp) -> (String, Value) {
    let card = create_card(app, "alice", "alice-durand").await;
    let id = card_id(&card).to_string();
    let parts = video_parts(&[("loop", json!({ "start": 0.25, "end": 1.75 }).to_string())]);
    let media = upload(app, "alice", &id, &parts).await;
    assert_eq!(media.status, StatusCode::CREATED, "{}", media.json);
    let res = put_card(
        app,
        "alice",
        &id,
        json!({ "header_media_id": media.json["id"] }),
    )
    .await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    (id, media.json)
}

fn media_files_of(files: &[String], media: &Value) -> Vec<String> {
    let id = media["id"].as_str().unwrap();
    files
        .iter()
        .filter(|key| key.contains(&format!("/{id}/")))
        .cloned()
        .collect()
}

// spec: MED-030, MED-036
#[sqlx::test(migrations = "./migrations")]
async fn re_framing_a_video_transcodes_its_original_again(pool: PgPool) {
    let stub = StubVideoProcessor::default();
    let app = app_with_stub(pool.clone(), stub.clone()).await;
    let (id, old) = card_with_stub_video_header(&app).await;
    let before = stored_files(&app).await;
    let private_before = app.media.list_private_keys().await;

    let res = reframe(
        &app,
        "alice",
        &id,
        old["id"].as_str().unwrap(),
        &[
            crop_part(0.25, 0.0, 0.75, 1.0),
            Part::text("loop", &json!({ "start": 0.5, "end": 1.75 }).to_string()),
            Part::text("poster_time", "1.25"),
        ],
    )
    .await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);
    let new = res.json;
    assert_ne!(new["id"], old["id"]);
    assert_eq!(new["kind"], "video");
    assert_eq!(media_rows(&pool).await, 2);
    assert_close(&new["loop"]["start"], 0.5, "loop start");
    assert_close(&new["loop"]["end"], 1.75, "loop end");
    assert_close(&new["poster_time"], 1.25, "poster time");
    assert_crop(&new, 0.25, 0.0, 0.75, 1.0);
    // The video's own duration stays the original's (R-S31).
    assert_eq!(new["duration_seconds"], old["duration_seconds"]);

    // The job ran on the private original, without an edit copy.
    let jobs = stub.jobs();
    assert_eq!(jobs.len(), 2);
    assert!(!jobs[1].edit_copy);
    assert_eq!(jobs[1].plan.poster, PosterSeek::At(1.25));
    assert_eq!(stub.inputs()[1], header_clip());
    let served = app
        .media
        .get(&key_of(&new["video_url"]), None)
        .await
        .unwrap();
    assert_eq!(served.bytes.as_ref(), b"served 1280x960 trim 0.500+1.250");
    assert_eq!(widths(&new), [750, 1125, 1440]);

    // The original is copied to the new media; the old media is untouched.
    let private = app.media.list_private_keys().await;
    assert_eq!(private.len(), 2, "{private:?}");
    let copied = media_files_of(&private, &new);
    assert_eq!(copied.len(), 1, "{private:?}");
    let original = app.media.get_private(&copied[0], None).await.unwrap();
    assert_eq!(original.bytes.as_ref(), header_clip().as_slice());
    assert!(private_before.iter().all(|key| private.contains(key)));
    let after = stored_files(&app).await;
    for (key, bytes) in &before {
        assert_eq!(after.get(key), Some(bytes), "{key} is unchanged");
    }
    // The card still shows the old media until a save names the new one.
    assert_eq!(get_card(&app, &id).await["header"]["id"], old["id"]);
}

// spec: MED-031
#[sqlx::test(migrations = "./migrations")]
async fn a_re_framed_video_keeps_its_edit_copy_under_a_new_name(pool: PgPool) {
    let app = app_with_stub(pool, StubVideoProcessor::default()).await;
    let (id, old) = card_with_stub_video_header(&app).await;
    let res = reframe(
        &app,
        "alice",
        &id,
        old["id"].as_str().unwrap(),
        &[crop_part(0.125, 0.0, 0.75, 1.0)],
    )
    .await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);
    let new = res.json;

    let (old_name, new_name) = (source_file_name(&old), source_file_name(&new));
    assert!(
        cartouche_domain::is_video_source_name(&new_name),
        "{new_name}"
    );
    assert_ne!(new_name, old_name);
    let kept = app
        .media
        .get(&key_of(&old["source"]["url"]), None)
        .await
        .unwrap();
    let copy = app
        .media
        .get(&key_of(&new["source"]["url"]), None)
        .await
        .unwrap();
    assert_eq!(copy.bytes, kept.bytes);
    assert_eq!(new["source"]["width"], old["source"]["width"]);
}

// spec: MED-003
#[sqlx::test(migrations = "./migrations")]
async fn a_re_frame_with_a_poster_part_is_refused(pool: PgPool) {
    let app = app_with_stub(pool.clone(), StubVideoProcessor::default()).await;
    let (id, old) = card_with_stub_video_header(&app).await;
    let before = stored_files(&app).await;
    let res = reframe(
        &app,
        "alice",
        &id,
        old["id"].as_str().unwrap(),
        &[
            crop_part(0.125, 0.0, 0.75, 1.0),
            Part::file("poster", "poster.png", "image/png", png(64, 48)),
        ],
    )
    .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(error_code(&res), "invalid_request");
    assert_eq!(stored_files(&app).await, before);
    assert_eq!(media_rows(&pool).await, 1);
}

// spec: MED-028
#[sqlx::test(migrations = "./migrations")]
async fn a_video_re_frame_checks_its_loop_and_poster_time(pool: PgPool) {
    let app = app_with_stub(pool.clone(), StubVideoProcessor::default()).await;
    let (id, old) = card_with_stub_video_header(&app).await;
    let media = old["id"].as_str().unwrap();
    for (field, value, code) in [
        (
            "loop",
            json!({ "start": 0.5, "end": 1.0 }).to_string(),
            "invalid_loop",
        ),
        ("poster_time", "3".to_string(), "invalid_poster_time"),
    ] {
        let res = reframe(
            &app,
            "alice",
            &id,
            media,
            &[crop_part(0.125, 0.0, 0.75, 1.0), Part::text(field, &value)],
        )
        .await;
        assert_eq!(res.status, StatusCode::BAD_REQUEST, "{field}");
        assert_eq!(
            res.json["error"]["fields"],
            json!([{ "field": field, "code": code }])
        );
    }
    let res = reframe(
        &app,
        "alice",
        &id,
        media,
        &[Part::text("poster_time", "0.5")],
    )
    .await;
    assert_eq!(
        res.json["error"]["fields"],
        json!([{ "field": "crop", "code": "required" }])
    );
    // Without them: the whole video and the first frame.
    let res = reframe(
        &app,
        "alice",
        &id,
        media,
        &[crop_part(0.125, 0.0, 0.75, 1.0)],
    )
    .await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);
    assert_close(&res.json["loop"]["start"], 0.0, "loop start");
    assert_close(&res.json["poster_time"], 0.0, "poster time");
    assert_eq!(media_rows(&pool).await, 2);
}

/// Records a video the way plan 6 stored it, with a `.webp` source, and attaches it to the card.
async fn legacy_video(app: &TestApp, pool: &PgPool, card: &str) -> uuid::Uuid {
    let card_uuid: uuid::Uuid = card.parse().unwrap();
    let media_id = uuid::Uuid::now_v7();
    let source = cartouche_domain::source_name(&"a".repeat(32));
    sqlx::query(
        "insert into media (id, card_id, slot, kind, variants, source, duration_ms) \
         values ($1, $2, 'header', 'video', \
         '[{\"name\":\"w750.webp\",\"width\":750,\"format\":\"webp\"},\
           {\"name\":\"video.mp4\",\"width\":0,\"format\":\"mp4\"}]', \
         jsonb_build_object('name', $3::text, 'width', 960, 'height', 540), 2000)",
    )
    .bind(media_id)
    .bind(card_uuid)
    .bind(&source)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("update cards set header_media_id = $1 where id = $2")
        .bind(media_id)
        .bind(card_uuid)
        .execute(pool)
        .await
        .unwrap();
    for (name, bytes) in [
        ("w750.webp", png(750, 563)),
        ("video.mp4", header_clip()),
        (source.as_str(), png(960, 540)),
    ] {
        app.media
            .put(
                &cartouche_domain::storage_key(card_uuid, media_id, name),
                bytes::Bytes::from(bytes),
            )
            .await
            .unwrap();
    }
    media_id
}

// spec: MED-030, MED-033
#[sqlx::test(migrations = "./migrations")]
async fn a_video_uploaded_before_plan_7_cannot_be_re_framed(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card_id(&card);
    let media_id = legacy_video(&app, &pool, id).await;

    let owner = get_card(&app, id).await;
    assert_eq!(owner["header"]["kind"], "video");
    assert_no_source(&owner["header"], "owner view of a legacy video");
    let before = stored_files(&app).await;

    let res = reframe(
        &app,
        "alice",
        id,
        &media_id.to_string(),
        &[crop_part(0.125, 0.0, 0.75, 1.0)],
    )
    .await;
    assert_eq!(res.status, StatusCode::CONFLICT);
    assert_eq!(error_code(&res), "media_not_reframable");
    assert_eq!(stored_files(&app).await, before);
    assert_eq!(media_rows(&pool).await, 1);
}

// spec: MED-030
#[sqlx::test(migrations = "./migrations")]
async fn a_video_whose_original_is_missing_cannot_be_re_framed(pool: PgPool) {
    let app = app_with_stub(pool.clone(), StubVideoProcessor::default()).await;
    let (id, old) = card_with_stub_video_header(&app).await;
    let old_id: uuid::Uuid = old["id"].as_str().unwrap().parse().unwrap();
    let card: uuid::Uuid = id.parse().unwrap();
    app.media.delete_media(card, old_id).await.unwrap();
    assert!(app.media.list_private_keys().await.is_empty());

    let res = reframe(
        &app,
        "alice",
        &id,
        &old_id.to_string(),
        &[crop_part(0.125, 0.0, 0.75, 1.0)],
    )
    .await;
    assert_eq!(res.status, StatusCode::CONFLICT);
    assert_eq!(error_code(&res), "media_not_reframable");
    assert_eq!(media_rows(&pool).await, 1);
}

// spec: MED-036, EDI-014
#[sqlx::test(migrations = "./migrations")]
async fn duplicating_a_card_copies_its_video_original(pool: PgPool) {
    let app = app_with_stub(pool.clone(), StubVideoProcessor::default()).await;
    let (id, old) = card_with_stub_video_header(&app).await;
    let res = app
        .request(
            "POST",
            &format!("/api/cards/{id}/duplicate"),
            Some(&token("alice")),
            Some(json!({ "slug": "alice-copie" })),
        )
        .await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);
    let copy = res.json["header"].clone();
    let new_card = res.json["id"].as_str().unwrap().to_string();
    assert_ne!(copy["id"], old["id"]);

    let (old_name, copy_name) = (source_file_name(&old), source_file_name(&copy));
    assert!(
        cartouche_domain::is_video_source_name(&copy_name),
        "{copy_name}"
    );
    assert_ne!(copy_name, old_name);

    let private = app.media.list_private_keys().await;
    assert_eq!(private.len(), 2, "{private:?}");
    let copied = media_files_of(&private, &copy);
    assert_eq!(copied.len(), 1, "{private:?}");
    assert!(copied[0].starts_with(&format!("cards/{new_card}/")));
    let original = app.media.get_private(&copied[0], None).await.unwrap();
    assert_eq!(original.bytes.as_ref(), header_clip().as_slice());

    // The copy can be re-framed.
    let res = reframe(
        &app,
        "alice",
        &new_card,
        copy["id"].as_str().unwrap(),
        &[crop_part(0.125, 0.0, 0.75, 1.0)],
    )
    .await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);
}

// spec: MED-018
#[sqlx::test(migrations = "./migrations")]
async fn saving_away_a_re_framed_video_deletes_its_private_original(pool: PgPool) {
    let app = app_with_stub(pool.clone(), StubVideoProcessor::default()).await;
    let (id, old) = card_with_stub_video_header(&app).await;
    let res = reframe(
        &app,
        "alice",
        &id,
        old["id"].as_str().unwrap(),
        &[crop_part(0.125, 0.0, 0.75, 1.0)],
    )
    .await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);
    let new = res.json;
    assert_eq!(app.media.list_private_keys().await.len(), 2);

    let res = put_card(&app, "alice", &id, json!({ "header_media_id": new["id"] })).await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.json);

    let private = app.media.list_private_keys().await;
    assert_eq!(private.len(), 1, "{private:?}");
    assert!(media_files_of(&private, &old).is_empty(), "{private:?}");
    assert_eq!(media_files_of(&private, &new).len(), 1);
    assert_eq!(media_rows(&pool).await, 1);
}

// spec: MED-026
#[sqlx::test(migrations = "./migrations")]
async fn reframing_checks_the_crop_of_an_image(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let (id, old) = card_with_quadrants_header(&app).await;
    let before = stored_files(&app).await;
    let media = old["id"].as_str().unwrap();

    let res = reframe(
        &app,
        "alice",
        &id,
        media,
        &[crop_part(0.5, 0.0, 0.75, 0.75)],
    )
    .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        res.json["error"]["fields"],
        json!([{ "field": "crop", "code": "invalid_crop" }])
    );
    // The crop is required.
    let res = reframe(&app, "alice", &id, media, &[]).await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        res.json["error"]["fields"],
        json!([{ "field": "crop", "code": "required" }])
    );
    // A loop only makes sense for a video.
    let res = reframe(
        &app,
        "alice",
        &id,
        media,
        &[
            crop_part(0.0, 0.0, 0.5, 0.5),
            Part::text("loop", &json!({ "start": 0, "end": 1 }).to_string()),
        ],
    )
    .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(error_code(&res), "invalid_request");

    assert_eq!(stored_files(&app).await, before);
    assert_eq!(media_rows(&pool).await, 1);
}

// spec: LNK-036
#[sqlx::test(migrations = "./migrations")]
async fn a_card_blocked_by_support_takes_no_upload_or_reframe(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let (id, old) = card_with_quadrants_header(&app).await;
    sqlx::query("update cards set support_disabled_at = now() where id = $1::uuid")
        .bind(&id)
        .execute(&pool)
        .await
        .unwrap();
    let files = stored_files(&app).await;
    let rows = media_rows(&pool).await;

    let uploaded = upload_image(&app, &id, "avatar", png(400, 400)).await;
    assert_eq!(uploaded.status, StatusCode::CONFLICT);
    assert_eq!(error_code(&uploaded), "card_disabled_by_support");

    let reframed = reframe(
        &app,
        "alice",
        &id,
        old["id"].as_str().unwrap(),
        &[crop_part(0.5, 0.5, 0.5, 0.5)],
    )
    .await;
    assert_eq!(reframed.status, StatusCode::CONFLICT);
    assert_eq!(error_code(&reframed), "card_disabled_by_support");

    // Nothing was stored; another owner's request is still a 404.
    assert_eq!(media_rows(&pool).await, rows);
    assert_eq!(stored_files(&app).await, files);
    let other = upload(
        &app,
        "bob",
        &id,
        &[
            Part::text("slot", "avatar"),
            Part::file("file", "photo.png", "image/png", png(400, 400)),
        ],
    )
    .await;
    assert_eq!(other.status, StatusCode::NOT_FOUND);
}
