mod common;

use axum::http::StatusCode;
use common::cards::{cards_app, create_card, put_card, token};
use common::media_fixtures::{jpeg, mp4, mp4_with_brands, png, png_claiming};
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
    // Three WebP and two JPEG files are stored; the upload itself is not.
    assert_eq!(app.media_keys().await.len(), 5);
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
    // The poster is the waiting image, never larger than itself.
    assert_eq!(widths(&res.json), [640, 1080, 1280]);
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
