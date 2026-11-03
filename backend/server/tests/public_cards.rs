mod common;

use axum::http::StatusCode;
use base64::Engine as _;
use common::cards::{cards_app, create_card, put_card, token};
use common::media_fixtures::jpeg;
use common::{Part, TestApp, TestResponse, capture_logs};
use serde_json::{Value, json};
use sqlx::PgPool;

fn error_code(res: &TestResponse) -> &str {
    res.json["error"]["code"].as_str().unwrap_or_default()
}

fn header<'a>(res: &'a TestResponse, name: &str) -> &'a str {
    res.headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
}

async fn public(app: &TestApp, path: &str) -> TestResponse {
    app.request("GET", path, None, None).await
}

/// Fills the card of `sub` with the content the vCard tests look for.
async fn fill_card(app: &TestApp, sub: &str, card: &Value) {
    let saved = put_card(
        app,
        sub,
        card["id"].as_str().unwrap(),
        json!({
            "content": {
                "first_name": "Éloïse",
                "last_name": "D’Aubigné-Müller",
                "job_title": "Directrice ✨",
                "company": "Atelier Lumière",
                "email": "eloise@example.com",
                "phone": "+33612345678",
            },
            "links": [
                { "kind": "linkedin", "url": "https://www.linkedin.com/in/alice" },
                { "kind": "custom", "url": "https://example.com/portfolio", "label": "Portfolio" },
                { "kind": "website", "url": "https://alice.example" },
            ],
        }),
    )
    .await;
    assert_eq!(saved.status, StatusCode::OK, "{}", saved.json);
}

async fn set_owner_status(pool: &PgPool, sub: &str, status: &str) {
    sqlx::query("update users set status = $1 where subject = $2")
        .bind(status)
        .bind(sub)
        .execute(pool)
        .await
        .unwrap();
}

async fn support_disable(pool: &PgPool, id: &str) {
    sqlx::query("update cards set support_disabled_at = now() where id = $1::uuid")
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
}

async fn act(app: &TestApp, sub: &str, id: &str, action: &str) {
    let res = app
        .request(
            "POST",
            &format!("/api/cards/{id}/{action}"),
            Some(&token(sub)),
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::OK, "{action}: {}", res.json);
}

/// Unfolds the vCard lines (a continuation starts with one space) and splits them.
fn vcard_lines(res: &TestResponse) -> Vec<String> {
    let text = String::from_utf8(res.body.to_vec()).unwrap();
    text.replace("\r\n ", "")
        .split("\r\n")
        .map(str::to_owned)
        .collect()
}

// spec: PUB-011, PUB-018
#[sqlx::test(migrations = "./migrations")]
async fn active_card_is_public_without_token(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    fill_card(&app, "alice", &card).await;

    let res = public(&app, "/api/public/cards/alice-durand").await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    assert_eq!(res.json["state"], "active");
    let card = &res.json["card"];
    assert_eq!(card["slug"], "alice-durand");
    assert_eq!(card["public_url"], "http://localhost:3000/c/alice-durand");
    assert_eq!(card["template"], "classique");
    assert_eq!(card["content"]["first_name"], "Éloïse");
    assert_eq!(card["content"]["last_name"], "D’Aubigné-Müller");
    assert_eq!(card["content"]["phone_display"], "+33 6 12 34 56 78");
    assert_eq!(card["vcard_url"], "/api/public/cards/alice-durand/vcard");
    let kinds: Vec<&str> = card["links"]
        .as_array()
        .unwrap()
        .iter()
        .map(|link| link["kind"].as_str().unwrap())
        .collect();
    assert_eq!(kinds, ["linkedin", "custom", "website"]);
    assert!(card["header"].is_null() && card["avatar"].is_null());
    // Nothing internal: no card or owner id, no dates.
    for key in ["id", "owner_id", "status", "created_at", "updated_at"] {
        assert!(card.get(key).is_none(), "{key} leaked: {card}");
    }
}

// spec: LNK-003, LNK-021
#[sqlx::test(migrations = "./migrations")]
async fn old_and_uppercase_slugs_redirect(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice").await;
    let saved = put_card(
        &app,
        "alice",
        card["id"].as_str().unwrap(),
        json!({ "slug": "alice-durand" }),
    )
    .await;
    assert_eq!(saved.status, StatusCode::OK, "{}", saved.json);

    let old = public(&app, "/api/public/cards/alice").await;
    assert_eq!(old.status, StatusCode::OK);
    assert_eq!(
        old.json,
        json!({ "state": "redirect", "slug": "alice-durand" })
    );

    let upper = public(&app, "/api/public/cards/Alice-Durand").await;
    assert_eq!(upper.status, StatusCode::OK);
    assert_eq!(
        upper.json,
        json!({ "state": "redirect", "slug": "alice-durand" })
    );

    // An old slug in capitals goes straight to the current slug.
    let both = public(&app, "/api/public/cards/ALICE").await;
    assert_eq!(
        both.json,
        json!({ "state": "redirect", "slug": "alice-durand" })
    );
}

// spec: LNK-006, LNK-010, LNK-012, ADM-011, LNK-026, LNK-027
#[sqlx::test(migrations = "./migrations")]
async fn unserved_cards_are_inactive_without_data(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let disabled = create_card(&app, "owner-off", "owner-off").await;
    let supported = create_card(&app, "support-off", "support-off").await;
    let deleted = create_card(&app, "deleter", "deleted-card").await;
    create_card(&app, "suspended", "suspended-card").await;

    act(
        &app,
        "owner-off",
        disabled["id"].as_str().unwrap(),
        "disable",
    )
    .await;
    support_disable(&pool, supported["id"].as_str().unwrap()).await;
    let removed = app
        .request(
            "DELETE",
            &format!("/api/cards/{}", deleted["id"].as_str().unwrap()),
            Some(&token("deleter")),
            None,
        )
        .await;
    assert_eq!(removed.status, StatusCode::NO_CONTENT, "{}", removed.json);
    set_owner_status(&pool, "suspended", "suspended").await;

    for slug in ["owner-off", "support-off", "deleted-card", "suspended-card"] {
        let res = public(&app, &format!("/api/public/cards/{slug}")).await;
        assert_eq!(res.status, StatusCode::OK, "{slug}");
        assert_eq!(res.body.as_ref(), br#"{"state":"inactive"}"#, "{slug}");
    }
    // Capitals on a deleted card's slug: neutral page, not a redirect loop.
    let upper = public(&app, "/api/public/cards/Deleted-Card").await;
    assert_eq!(upper.body.as_ref(), br#"{"state":"inactive"}"#);
}

// spec: LNK-023
#[sqlx::test(migrations = "./migrations")]
async fn unknown_slug_is_404(pool: PgPool) {
    let app = cards_app(pool).await;
    let res = public(&app, "/api/public/cards/never-used").await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&res), "not_found");
    let vcard = public(&app, "/api/public/cards/never-used/vcard").await;
    assert_eq!(vcard.status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&vcard), "not_found");
}

// spec: PUB-014, PUB-015, PUB-024, PUB-027
#[sqlx::test(migrations = "./migrations")]
async fn vcard_is_downloadable(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    fill_card(&app, "alice", &card).await;

    let res = public(&app, "/api/public/cards/alice-durand/vcard").await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(header(&res, "content-type"), "text/vcard; charset=utf-8");
    assert_eq!(
        header(&res, "content-disposition"),
        "attachment; filename=\"alice-durand.vcf\""
    );
    let lines = vcard_lines(&res);
    for expected in [
        "BEGIN:VCARD",
        "VERSION:3.0",
        "FN:Éloïse D’Aubigné-Müller",
        "ORG:Atelier Lumière",
        "TITLE:Directrice ✨",
        "TEL;TYPE=CELL:+33612345678",
        "EMAIL;TYPE=INTERNET:eloise@example.com",
    ] {
        assert!(
            lines.iter().any(|line| line == expected),
            "{expected}: {lines:?}"
        );
    }
    // One URL per link, in order.
    let urls: Vec<&str> = lines
        .iter()
        .filter_map(|line| line.strip_prefix("URL:"))
        .collect();
    assert_eq!(
        urls,
        [
            "https://www.linkedin.com/in/alice",
            "https://example.com/portfolio",
            "https://alice.example"
        ]
    );
    // No description, no NOTE; no avatar, no PHOTO.
    assert!(!lines.iter().any(|line| line.starts_with("NOTE")));
    assert!(!lines.iter().any(|line| line.starts_with("PHOTO")));
}

// spec: PUB-025
#[sqlx::test(migrations = "./migrations")]
async fn vcard_photo_is_the_256_jpeg(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card["id"].as_str().unwrap();
    let upload = app
        .request_multipart(
            "POST",
            &format!("/api/cards/{id}/media"),
            Some(&token("alice")),
            &[
                Part::text("slot", "avatar"),
                Part::file("file", "me.jpg", "image/jpeg", jpeg(600, 600)),
            ],
        )
        .await;
    assert_eq!(upload.status, StatusCode::CREATED, "{}", upload.json);
    let saved = put_card(
        &app,
        "alice",
        id,
        json!({ "avatar_media_id": upload.json["id"] }),
    )
    .await;
    assert_eq!(saved.status, StatusCode::OK, "{}", saved.json);

    let res = public(&app, "/api/public/cards/alice-durand/vcard").await;
    assert_eq!(res.status, StatusCode::OK);
    let lines = vcard_lines(&res);
    let photo = lines
        .iter()
        .find_map(|line| line.strip_prefix("PHOTO;ENCODING=b;TYPE=JPEG:"))
        .expect("a PHOTO line");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(photo)
        .unwrap();
    let decoded = image::load_from_memory_with_format(&bytes, image::ImageFormat::Jpeg).unwrap();
    assert_eq!((decoded.width(), decoded.height()), (256, 256));
}

// spec: PUB-025
#[sqlx::test(migrations = "./migrations")]
async fn vcard_is_served_without_photo_when_the_file_is_unreadable(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card["id"].as_str().unwrap();
    let upload = app
        .request_multipart(
            "POST",
            &format!("/api/cards/{id}/media"),
            Some(&token("alice")),
            &[
                Part::text("slot", "avatar"),
                Part::file("file", "me.jpg", "image/jpeg", jpeg(600, 600)),
            ],
        )
        .await;
    let saved = put_card(
        &app,
        "alice",
        id,
        json!({ "avatar_media_id": upload.json["id"] }),
    )
    .await;
    assert_eq!(saved.status, StatusCode::OK, "{}", saved.json);
    app.media.delete_card(id.parse().unwrap()).await.unwrap();

    let (logs, _guard) = capture_logs();
    let res = public(&app, "/api/public/cards/alice-durand/vcard").await;
    assert_eq!(res.status, StatusCode::OK);
    assert!(
        logs.contents().contains("vCard photo unreadable"),
        "{}",
        logs.contents()
    );
    assert!(
        !vcard_lines(&res)
            .iter()
            .any(|line| line.starts_with("PHOTO"))
    );
}

// spec: LNK-024
#[sqlx::test(migrations = "./migrations")]
async fn vcard_of_old_slug_redirects_308(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice").await;
    let saved = put_card(
        &app,
        "alice",
        card["id"].as_str().unwrap(),
        json!({ "slug": "alice-durand" }),
    )
    .await;
    assert_eq!(saved.status, StatusCode::OK, "{}", saved.json);

    for path in ["alice", "Alice-Durand"] {
        let res = public(&app, &format!("/api/public/cards/{path}/vcard")).await;
        assert_eq!(res.status, StatusCode::PERMANENT_REDIRECT, "{path}");
        assert_eq!(
            header(&res, "location"),
            "/api/public/cards/alice-durand/vcard"
        );
    }
}

// spec: LNK-007, LNK-026
#[sqlx::test(migrations = "./migrations")]
async fn vcard_of_unserved_card_is_410(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let disabled = create_card(&app, "owner-off", "owner-off").await;
    let deleted = create_card(&app, "deleter", "deleted-card").await;
    create_card(&app, "suspended", "suspended-card").await;
    act(
        &app,
        "owner-off",
        disabled["id"].as_str().unwrap(),
        "disable",
    )
    .await;
    let removed = app
        .request(
            "DELETE",
            &format!("/api/cards/{}", deleted["id"].as_str().unwrap()),
            Some(&token("deleter")),
            None,
        )
        .await;
    assert_eq!(removed.status, StatusCode::NO_CONTENT, "{}", removed.json);
    set_owner_status(&pool, "suspended", "suspended").await;

    for slug in [
        "owner-off",
        "deleted-card",
        "suspended-card",
        "Deleted-Card",
    ] {
        let res = public(&app, &format!("/api/public/cards/{slug}/vcard")).await;
        assert_eq!(res.status, StatusCode::GONE, "{slug}");
        assert_eq!(error_code(&res), "card_inactive", "{slug}");
    }
}

/// The three ways a live card stops being served, each on a card whose slug was renamed:
/// `(owner, old slug, current slug)`.
async fn renamed_unserved_cards(app: &TestApp, pool: &PgPool) -> Vec<(&'static str, &'static str)> {
    let mut cases = Vec::new();
    for (sub, old, current) in [
        ("owner-off", "owner-off-old", "owner-off"),
        ("support-off", "support-off-old", "support-off"),
        ("suspended", "suspended-old", "suspended"),
    ] {
        let card = create_card(app, sub, old).await;
        let saved = put_card(
            app,
            sub,
            card["id"].as_str().unwrap(),
            json!({ "slug": current }),
        )
        .await;
        assert_eq!(saved.status, StatusCode::OK, "{}", saved.json);
        match sub {
            "owner-off" => act(app, sub, card["id"].as_str().unwrap(), "disable").await,
            "support-off" => support_disable(pool, card["id"].as_str().unwrap()).await,
            _ => set_owner_status(pool, sub, "suspended").await,
        }
        cases.push((old, current));
    }
    cases
}

// spec: LNK-027, LNK-006, LNK-010, ADM-011
#[sqlx::test(migrations = "./migrations")]
async fn unserved_card_is_neutral_from_old_and_uppercase_slugs(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    for (old, current) in renamed_unserved_cards(&app, &pool).await {
        let uppercase = current.to_uppercase();
        for address in [old, uppercase.as_str(), current] {
            let res = public(&app, &format!("/api/public/cards/{address}")).await;
            assert_eq!(res.status, StatusCode::OK, "{address}");
            assert_eq!(res.body.as_ref(), br#"{"state":"inactive"}"#, "{address}");
        }
    }
}

// spec: LNK-027, LNK-007, LNK-010, ADM-011
#[sqlx::test(migrations = "./migrations")]
async fn unserved_card_vcard_is_410_from_old_and_uppercase_slugs(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    for (old, current) in renamed_unserved_cards(&app, &pool).await {
        let uppercase = current.to_uppercase();
        for address in [old, uppercase.as_str(), current] {
            let res = public(&app, &format!("/api/public/cards/{address}/vcard")).await;
            assert_eq!(res.status, StatusCode::GONE, "{address}");
            assert_eq!(error_code(&res), "card_inactive", "{address}");
            assert!(res.headers.get("location").is_none(), "{address}");
        }
    }
}
