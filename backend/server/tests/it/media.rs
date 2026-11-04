use crate::common;

use axum::http::StatusCode;
use common::cards::{cards_app, create_card, put_card, token};
use common::media_fixtures::{
    header_clip, jpeg, jpeg_with_exif, mp4, mp4_with_brands, png, png_claiming, quadrants_png,
};
use common::{Part, TestApp, TestResponse, test_state_with};
use serde_json::{Value, json};
use sqlx::PgPool;

const BASE: &str = "http://localhost:3000";

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
            Part::file("poster", "poster.jpg", "image/jpeg", jpeg(640, 360)),
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
            Part::file("poster", "poster.jpg", "image/jpeg", jpeg(640, 360)),
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
            Part::file("poster", "poster.jpg", "image/jpeg", jpeg(640, 360)),
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

// spec: MED-002, MED-004, MED-013
#[sqlx::test(migrations = "./migrations")]
async fn video_rules(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card_id(&card);
    let poster = || Part::file("poster", "poster.jpg", "image/jpeg", jpeg(1280, 720));
    let video = |bytes: Vec<u8>| Part::file("file", "clip.mp4", "video/mp4", bytes);
    let header = Part::text("slot", "header");

    let res = upload(&app, "alice", id, &[header, video(mp4(31_000)), poster()]).await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        res.json["error"]["fields"],
        json!([{ "field": "file", "code": "video_too_long" }])
    );

    let res = upload(
        &app,
        "alice",
        id,
        &[Part::text("slot", "header"), video(mp4(2_000))],
    )
    .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        res.json["error"]["fields"],
        json!([{ "field": "poster", "code": "poster_required" }])
    );

    let mut heavy = mp4(2_000);
    heavy.resize(26 << 20, 0);
    let res = upload(
        &app,
        "alice",
        id,
        &[Part::text("slot", "header"), video(heavy), poster()],
    )
    .await;
    assert_eq!(res.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert!(
        app.media_keys().await.is_empty(),
        "a refused upload stores nothing"
    );

    let clip = mp4(2_000);
    let res = upload(
        &app,
        "alice",
        id,
        &[Part::text("slot", "header"), video(clip.clone()), poster()],
    )
    .await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);
    assert_eq!(res.json["kind"], "video");
    // The poster is the waiting image, cut 4:3 (960 × 720) and never larger than its crop.
    assert_eq!(widths(&res.json), [750, 960]);
    let video_url = unsigned(res.json["video_url"].as_str().unwrap());
    assert!(video_url.ends_with("/video.mp4"), "{video_url}");
    let key = video_url.strip_prefix(&format!("{BASE}/media/")).unwrap();
    let stored = app.media.get(key, None).await.unwrap();
    assert_eq!(stored.bytes.as_ref(), clip.as_slice());
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
            Part::file("poster", "poster.jpg", "image/jpeg", jpeg(640, 360)),
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
    let clip = mp4(2_000);
    let video = upload(
        &app,
        "alice",
        card_id(&card),
        &[
            Part::text("slot", "header"),
            Part::file("file", "clip.mp4", "video/mp4", clip.clone()),
            Part::file("poster", "poster.jpg", "image/jpeg", jpeg(640, 360)),
        ],
    )
    .await;
    assert_eq!(video.status, StatusCode::CREATED);
    let path = unsigned(media_path(&video.json["video_url"]));
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
            Part::file("poster", "poster.jpg", "image/jpeg", jpeg(640, 360)),
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

fn video_parts(poster: Vec<u8>, extra: &[(&str, String)]) -> Vec<Part> {
    let mut parts = vec![
        Part::text("slot", "header"),
        Part::file("file", "clip.mp4", "video/mp4", header_clip()),
        Part::file("poster", "poster.jpg", "image/jpeg", poster),
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

// spec: MED-028, MED-029
#[sqlx::test(migrations = "./migrations")]
async fn a_video_keeps_its_framing_and_its_poster_is_cut(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let parts = video_parts(
        jpeg(1280, 720),
        &[
            (
                "crop",
                json!({ "x": 0.125, "y": 0.0, "width": 0.75, "height": 1.0 }).to_string(),
            ),
            ("loop", json!({ "start": 0.2, "end": 1.8 }).to_string()),
            ("poster_time", "1".to_string()),
        ],
    );
    let res = upload(&app, "alice", card_id(&card), &parts).await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);
    let media = res.json;

    assert_eq!(media["kind"], "video");
    assert_crop(&media, 0.125, 0.0, 0.75, 1.0);
    assert_close(&media["loop"]["start"], 0.2, "loop start");
    assert_close(&media["loop"]["end"], 1.8, "loop end");
    assert_close(&media["poster_time"], 1.0, "poster time");
    let duration = media["duration_seconds"].as_f64().unwrap();
    assert!((duration - 2.0).abs() < 0.05, "{duration}");
    let duration_ms: Option<i32> = sqlx::query_scalar("select duration_ms from media")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!((duration_ms.unwrap() - 2000).abs() < 50, "{duration_ms:?}");

    // The waiting image is the source; its files are cut 4:3 along the video's crop.
    assert_eq!(media["source"]["width"], 1280);
    assert_eq!(media["source"]["height"], 720);
    assert_eq!(widths(&media), [750, 960]);
    let w960 = variant(&app, &media, 960).await;
    assert_eq!((w960.width(), w960.height()), (960, 720));
    let w750 = variant(&app, &media, 750).await;
    assert_eq!((w750.width(), w750.height()), (750, 563));
    // The video is stored as uploaded.
    let video = app
        .media
        .get(&key_of(&media["video_url"]), None)
        .await
        .unwrap();
    assert_eq!(video.bytes.as_ref(), header_clip().as_slice());
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
        let res = upload(
            &app,
            "alice",
            id,
            &video_parts(jpeg(1280, 720), &[(field, value.clone())]),
        )
        .await;
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
        &video_parts(jpeg(1280, 720), &[("poster_time", "soon".to_string())]),
    )
    .await;
    assert_eq!(error_code(&res), "invalid_request");
    assert!(app.media_keys().await.is_empty());
    assert_eq!(media_rows(&pool).await, 0);

    // Without them: the whole video, and the first frame.
    let res = upload(&app, "alice", id, &video_parts(jpeg(1280, 720), &[])).await;
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

// spec: MED-030, MED-029
#[sqlx::test(migrations = "./migrations")]
async fn a_video_is_reframed_with_or_without_a_new_frame(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card_id(&card);
    let res = upload(
        &app,
        "alice",
        id,
        &video_parts(quadrants_png(1280, 720), &[]),
    )
    .await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);
    let old = res.json;
    let old_id = old["id"].as_str().unwrap();
    let old_video = key_of(&old["video_url"]);

    // Without a new frame: the files are cut again from the stored source.
    let res = reframe(
        &app,
        "alice",
        id,
        old_id,
        &[
            crop_part(0.0, 0.0, 0.75, 1.0),
            Part::text("loop", &json!({ "start": 0.2, "end": 1.8 }).to_string()),
            Part::text("poster_time", "1"),
        ],
    )
    .await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);
    let same_frame = res.json;
    assert_eq!(same_frame["kind"], "video");
    assert_ne!(same_frame["id"], old["id"]);
    assert_crop(&same_frame, 0.0, 0.0, 0.75, 1.0);
    assert_close(&same_frame["loop"]["end"], 1.8, "loop end");
    assert_close(&same_frame["poster_time"], 1.0, "poster time");
    assert_eq!(same_frame["source"]["width"], 1280);
    assert_ne!(source_file_name(&same_frame), source_file_name(&old));
    let kept = app.media.get(&old_video, None).await.unwrap();
    let copied = app
        .media
        .get(&key_of(&same_frame["video_url"]), None)
        .await
        .unwrap();
    assert_eq!(copied.bytes, kept.bytes);
    assert_eq!(copied.bytes.as_ref(), header_clip().as_slice());
    let duration = same_frame["duration_seconds"].as_f64().unwrap();
    assert!((duration - 2.0).abs() < 0.05, "{duration}");
    let w960 = variant(&app, &same_frame, 960).await;
    assert_eq!((w960.width(), w960.height()), (960, 720));

    // With a new frame: it becomes the source.
    let res = reframe(
        &app,
        "alice",
        id,
        old_id,
        &[
            crop_part(0.125, 0.0, 0.75, 1.0),
            Part::text("poster_time", "0.5"),
            Part::file("poster", "poster.jpg", "image/jpeg", jpeg(640, 360)),
        ],
    )
    .await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.json);
    let new_frame = res.json;
    assert_eq!(new_frame["source"]["width"], 640);
    assert_close(&new_frame["poster_time"], 0.5, "poster time");
    // No loop sent: the whole video.
    assert_close(&new_frame["loop"]["start"], 0.0, "loop start");
    assert_eq!(media_rows(&pool).await, 3);
    // The previous media keeps its source and its video.
    assert!(app.media.get(&old_video, None).await.is_ok());
    assert!(
        app.media
            .get(&key_of(&old["source"]["url"]), None)
            .await
            .is_ok()
    );
}

// spec: MED-026, MED-028
#[sqlx::test(migrations = "./migrations")]
async fn reframing_checks_the_crop_and_the_video_framing(pool: PgPool) {
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

    // A video with a loop past its end.
    let card = create_card(&app, "alice", "alice-video").await;
    let res = upload(
        &app,
        "alice",
        card_id(&card),
        &video_parts(jpeg(1280, 720), &[]),
    )
    .await;
    let video = res.json;
    let before = stored_files(&app).await;
    let res = reframe(
        &app,
        "alice",
        card_id(&card),
        video["id"].as_str().unwrap(),
        &[
            crop_part(0.125, 0.0, 0.75, 1.0),
            Part::text("loop", &json!({ "start": 0.0, "end": 99.0 }).to_string()),
        ],
    )
    .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        res.json["error"]["fields"],
        json!([{ "field": "loop", "code": "invalid_loop" }])
    );
    assert_eq!(stored_files(&app).await, before);
    assert_eq!(media_rows(&pool).await, 2);
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
