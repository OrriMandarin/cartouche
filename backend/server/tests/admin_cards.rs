mod common;

use axum::http::StatusCode;
use cartouche_api::openapi::ApiDoc;
use cartouche_domain::Clock;
use chrono::{DateTime, Utc};
use common::cards::{cards_app, create_card, put_card, token};
use common::media_fixtures::png;
use common::{Part, TestApp, TestResponse};
use serde_json::{Value, json};
use sqlx::PgPool;
use utoipa::OpenApi;
use uuid::Uuid;

const ADMIN: &str = "boss";

fn error_code(res: &TestResponse) -> &str {
    res.json["error"]["code"].as_str().unwrap_or_default()
}

fn card_id(card: &Value) -> &str {
    card["id"].as_str().unwrap()
}

async fn admin_get(app: &TestApp, path: &str) -> TestResponse {
    app.request("GET", path, Some(&token(ADMIN)), None).await
}

async fn support(app: &TestApp, sub: &str, id: &str, action: &str) -> TestResponse {
    app.request(
        "POST",
        &format!("/api/admin/cards/{id}/support-{action}"),
        Some(&token(sub)),
        None,
    )
    .await
}

async fn owner_act(app: &TestApp, sub: &str, id: &str, action: &str) {
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

async fn user_id(pool: &PgPool, sub: &str) -> Uuid {
    sqlx::query_scalar("select id from users where subject = $1")
        .bind(sub)
        .fetch_one(pool)
        .await
        .unwrap()
}

type AuditRow = (Uuid, String, String, Uuid, Value);

async fn audit_rows(pool: &PgPool) -> Vec<AuditRow> {
    sqlx::query_as(
        "select actor_user_id, action, target_type, target_id, metadata from audit_log \
         order by created_at, id",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

// spec: ADM-001
#[sqlx::test(migrations = "./migrations")]
async fn card_admin_routes_need_an_admin(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card_id(&card);
    let alice = user_id(&pool, "alice").await;

    let routes = [
        ("GET", format!("/api/admin/users/{alice}")),
        ("GET", format!("/api/admin/cards/{id}")),
        ("POST", format!("/api/admin/cards/{id}/support-disable")),
        ("POST", format!("/api/admin/cards/{id}/support-enable")),
    ];
    for (method, path) in routes {
        let res = app
            .request(method, &path, Some(&token("alice")), None)
            .await;
        assert_eq!(res.status, StatusCode::FORBIDDEN, "{method} {path}");
        assert_eq!(error_code(&res), "forbidden", "{method} {path}");
        let anonymous = app.request(method, &path, None, None).await;
        assert_eq!(
            anonymous.status,
            StatusCode::UNAUTHORIZED,
            "{method} {path}"
        );
    }
    let stored: Option<DateTime<Utc>> =
        sqlx::query_scalar("select support_disabled_at from cards where id = $1::uuid")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(stored.is_none());
    assert!(audit_rows(&pool).await.is_empty());
}

// spec: ADM-006, ADM-013, ACC-017
#[sqlx::test(migrations = "./migrations")]
async fn admin_sees_a_users_cards_read_only(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let first = create_card(&app, "alice", "alice-durand").await;
    let second = create_card(&app, "alice", "alice-perso").await;
    create_card(&app, "bob", "bob-martin").await;
    // The card read below carries content and an attached photo.
    let upload = app
        .request_multipart(
            "POST",
            &format!("/api/cards/{}/media", card_id(&first)),
            Some(&token("alice")),
            &[
                Part::text("slot", "avatar"),
                Part::file("file", "photo.png", "image/png", png(400, 400)),
            ],
        )
        .await;
    assert_eq!(upload.status, StatusCode::CREATED, "{}", upload.json);
    let saved = put_card(
        &app,
        "alice",
        card_id(&first),
        json!({
            "content": { "first_name": "Éloïse", "last_name": "D’Aubigné-Müller", "email": "eloise@example.com" },
            "avatar_media_id": upload.json["id"],
        }),
    )
    .await;
    assert_eq!(saved.status, StatusCode::OK, "{}", saved.json);
    owner_act(&app, "alice", card_id(&second), "disable").await;

    let alice = user_id(&pool, "alice").await;
    let res = admin_get(&app, &format!("/api/admin/users/{alice}")).await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    assert_eq!(res.json["user"]["id"], alice.to_string());
    assert_eq!(res.json["user"]["subject"], "alice");
    assert_eq!(res.json["user"]["is_admin"], false);
    let cards = res.json["cards"].as_array().unwrap();
    // Only Alice's cards, oldest first, the disabled one included with its status.
    assert_eq!(cards.len(), 2);
    assert_eq!(cards[0]["id"], first["id"]);
    assert_eq!(cards[0]["status"], "active");
    assert_eq!(cards[1]["id"], second["id"]);
    assert_eq!(cards[1]["status"], "disabled");
    assert!(cards[0]["avatar"]["id"].is_string());

    let detail = admin_get(&app, &format!("/api/admin/cards/{}", card_id(&first))).await;
    assert_eq!(detail.status, StatusCode::OK, "{}", detail.json);
    assert_eq!(detail.json["card"]["slug"], "alice-durand");
    assert_eq!(detail.json["card"]["content"]["first_name"], "Éloïse");
    assert_eq!(
        detail.json["card"]["content"]["email"],
        "eloise@example.com"
    );
    assert_eq!(detail.json["card"]["avatar"], saved.json["avatar"]);
    assert_eq!(detail.json["owner"]["id"], alice.to_string());
    assert_eq!(detail.json["owner"]["email"], "alice@example.com");

    // The disabled card is readable too.
    let off = admin_get(&app, &format!("/api/admin/cards/{}", card_id(&second))).await;
    assert_eq!(off.status, StatusCode::OK);
    assert_eq!(off.json["card"]["status"], "disabled");

    // Reading changes nothing and writes no audit entry.
    assert!(audit_rows(&pool).await.is_empty());
}

// spec: ADM-006, ADM-013
#[sqlx::test(migrations = "./migrations")]
async fn unknown_user_or_card_is_404(pool: PgPool) {
    let app = cards_app(pool).await;
    let unknown = Uuid::now_v7();
    for (method, path) in [
        ("GET", format!("/api/admin/users/{unknown}")),
        ("GET", format!("/api/admin/cards/{unknown}")),
        (
            "POST",
            format!("/api/admin/cards/{unknown}/support-disable"),
        ),
        ("POST", format!("/api/admin/cards/{unknown}/support-enable")),
    ] {
        let res = app.request(method, &path, Some(&token(ADMIN)), None).await;
        assert_eq!(res.status, StatusCode::NOT_FOUND, "{method} {path}");
        assert_eq!(error_code(&res), "not_found", "{method} {path}");
    }
    let malformed = admin_get(&app, "/api/admin/cards/not-a-uuid").await;
    assert_eq!(malformed.status, StatusCode::BAD_REQUEST);
}

// spec: ADM-009, LNK-010
#[sqlx::test(migrations = "./migrations")]
async fn support_disable_makes_the_card_inactive(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card_id(&card);
    let served = app
        .request("GET", "/api/public/cards/alice-durand", None, None)
        .await;
    assert_eq!(served.status, StatusCode::OK);
    assert_ne!(served.body.as_ref(), br#"{"state":"inactive"}"#);

    let res = support(&app, ADMIN, id, "disable").await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    assert_eq!(res.json["status"], "disabled_by_support");
    assert_eq!(res.json["content"], card["content"]);

    let public = app
        .request("GET", "/api/public/cards/alice-durand", None, None)
        .await;
    assert_eq!(public.body.as_ref(), br#"{"state":"inactive"}"#);

    // The owner sees the support state and cannot undo it.
    let mine = app
        .request(
            "GET",
            &format!("/api/cards/{id}"),
            Some(&token("alice")),
            None,
        )
        .await;
    assert_eq!(mine.json["status"], "disabled_by_support");
    // The time comes from the application clock.
    let at: DateTime<Utc> =
        sqlx::query_scalar("select support_disabled_at from cards where id = $1::uuid")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(at, app.clock.now());
}

// spec: ADM-010, LNK-028
#[sqlx::test(migrations = "./migrations")]
async fn lifting_restores_the_owner_state(pool: PgPool) {
    let app = cards_app(pool).await;
    let owner_off = create_card(&app, "alice", "alice-off").await;
    let owner_on = create_card(&app, "alice", "alice-on").await;
    owner_act(&app, "alice", card_id(&owner_off), "disable").await;

    for (card, expected) in [(&owner_off, "disabled"), (&owner_on, "active")] {
        let id = card_id(card);
        let blocked = support(&app, ADMIN, id, "disable").await;
        assert_eq!(blocked.json["status"], "disabled_by_support");
        let lifted = support(&app, ADMIN, id, "enable").await;
        assert_eq!(lifted.status, StatusCode::OK, "{}", lifted.json);
        assert_eq!(lifted.json["status"], expected);
    }
}

// spec: ADM-014, ADM-005
#[sqlx::test(migrations = "./migrations")]
async fn support_actions_are_audited(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card_id(&card);
    support(&app, ADMIN, id, "disable").await;
    support(&app, ADMIN, id, "enable").await;

    let admin = user_id(&pool, ADMIN).await;
    let alice = user_id(&pool, "alice").await;
    let rows = audit_rows(&pool).await;
    assert_eq!(rows.len(), 2);
    for ((actor, action, target_type, target_id, metadata), expected) in rows
        .iter()
        .zip(["card.support_disabled", "card.support_enabled"])
    {
        assert_eq!(*actor, admin);
        assert_eq!(action, expected);
        assert_eq!(target_type, "card");
        assert_eq!(target_id.to_string(), id);
        assert_eq!(
            metadata,
            &json!({ "owner_id": alice.to_string(), "slug": "alice-durand" })
        );
    }
}

// spec: ADM-015
#[sqlx::test(migrations = "./migrations")]
async fn repeated_support_action_is_409_without_audit(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card_id(&card);

    // Lifting a block that does not exist.
    let early = support(&app, ADMIN, id, "enable").await;
    assert_eq!(early.status, StatusCode::CONFLICT);
    assert_eq!(error_code(&early), "invalid_transition");
    assert!(audit_rows(&pool).await.is_empty());

    assert_eq!(
        support(&app, ADMIN, id, "disable").await.status,
        StatusCode::OK
    );
    let again = support(&app, ADMIN, id, "disable").await;
    assert_eq!(again.status, StatusCode::CONFLICT);
    assert_eq!(error_code(&again), "invalid_transition");
    assert_eq!(audit_rows(&pool).await.len(), 1);
}

// spec: ADM-012
#[test]
fn admin_api_cannot_edit_card_content() {
    let doc = ApiDoc::openapi();
    let card_paths: Vec<_> = doc
        .paths
        .paths
        .iter()
        .filter(|(path, _)| path.starts_with("/api/admin/cards"))
        .collect();
    assert!(
        !card_paths.is_empty(),
        "the admin card routes are documented"
    );
    for (path, item) in card_paths {
        assert!(
            item.put.is_none() && item.patch.is_none() && item.delete.is_none(),
            "{path} must be read-only apart from the moderation actions"
        );
    }
}
