//! Account deletion: `DELETE /api/me` (Task 8 of plan 4).

use crate::common;

use std::sync::Arc;
use std::sync::atomic::Ordering;

use aws_lc_rs::digest::{SHA256, digest};
use axum::http::StatusCode;
use cartouche_api::media::MediaService;
use common::cards::{cards_app, create_card, put_card, token};
use common::events::{create_event, event_body, send_lead};
use common::failing_store::FailingStore;
use common::media_fixtures::jpeg;
use common::{Part, TestApp, TestResponse, test_app_with, test_state_with};
use futures_util::future::join_all;
use serde_json::{Value, json};
use sqlx::PgPool;
use std::collections::BTreeSet;
use uuid::Uuid;

fn error_code(res: &TestResponse) -> &str {
    res.json["error"]["code"].as_str().unwrap_or_default()
}

fn id_of(value: &Value) -> &str {
    value["id"].as_str().expect("an id")
}

fn hash_of(slug: &str) -> Vec<u8> {
    digest(&SHA256, slug.as_bytes()).as_ref().to_vec()
}

async fn user_id(pool: &PgPool, subject: &str) -> Uuid {
    sqlx::query_scalar("select id from users where subject = $1")
        .bind(subject)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn delete_me(app: &TestApp, sub: &str) -> TestResponse {
    app.request("DELETE", "/api/me", Some(&token(sub)), None)
        .await
}

async fn upload_avatar(app: &TestApp, sub: &str, card: &str) -> Value {
    let res = app
        .request_multipart(
            "POST",
            &format!("/api/cards/{card}/media"),
            Some(&token(sub)),
            &[
                Part::text("slot", "avatar"),
                Part::file("file", "photo.jpg", "image/jpeg", jpeg(600, 600)),
            ],
        )
        .await;
    assert_eq!(res.status, StatusCode::CREATED, "upload: {}", res.json);
    res.json
}

/// Everything a user owns, so that a test can compare it before and after.
struct Holdings {
    user_id: Uuid,
    card_ids: Vec<Uuid>,
    event_ids: Vec<Uuid>,
}

impl Holdings {
    /// Rows left for this user: users, cards, card_slugs, media, events, leads.
    async fn row_counts(&self, pool: &PgPool) -> [i64; 6] {
        let count = |sql: &'static str, ids: Vec<Uuid>| async move {
            sqlx::query_scalar::<_, i64>(sql)
                .bind(ids)
                .fetch_one(pool)
                .await
                .unwrap()
        };
        let user = vec![self.user_id];
        [
            count(
                "select count(*) from users where id = any($1)",
                user.clone(),
            )
            .await,
            count(
                "select count(*) from cards where owner_id = any($1)",
                user.clone(),
            )
            .await,
            count(
                "select count(*) from card_slugs where owner_id = any($1)",
                user,
            )
            .await,
            count(
                "select count(*) from media where card_id = any($1)",
                self.card_ids.clone(),
            )
            .await,
            count(
                "select count(*) from events where card_id = any($1)",
                self.card_ids.clone(),
            )
            .await,
            count(
                "select count(*) from leads where event_id = any($1)",
                self.event_ids.clone(),
            )
            .await,
        ]
    }
}

/// The slugs `bob` ends up with: a current one, a former one and a reserved one.
const BOB_SLUGS: [&str; 3] = ["bob-martin", "bob-ancien-nom", "bob-reserve"];

/// Builds an account for `sub` named after `slug_prefix`: card A (an avatar, a former slug, an
/// event with two leads), card B (deleted, its slug stays reserved).
async fn populate(app: &TestApp, sub: &str, slugs: [&str; 3]) -> Holdings {
    let [current, former, reserved] = slugs;
    let card = create_card(app, sub, former).await;
    let card_id = id_of(&card).to_string();
    let avatar = upload_avatar(app, sub, &card_id).await;
    // An upload not attached by a save is removed at the next save.
    let saved = put_card(
        app,
        sub,
        &card_id,
        json!({ "slug": current, "avatar_media_id": avatar["id"] }),
    )
    .await;
    assert_eq!(saved.status, StatusCode::OK, "{}", saved.json);

    let other = create_card(app, sub, reserved).await;
    let removed = app
        .request(
            "DELETE",
            &format!("/api/cards/{}", id_of(&other)),
            Some(&token(sub)),
            None,
        )
        .await;
    assert_eq!(removed.status, StatusCode::NO_CONTENT, "{}", removed.json);

    let event = create_event(app, sub, &card_id, event_body("2026-01-15T10:00:00Z", None)).await;
    for first_name in ["Éloïse", "Zoé"] {
        send_lead(
            app,
            current,
            id_of(&event),
            json!({ "answers": { "first_name": first_name } }),
        )
        .await;
    }
    Holdings {
        user_id: user_id(&app.pool, sub).await,
        card_ids: vec![card_id.parse().unwrap(), id_of(&other).parse().unwrap()],
        event_ids: vec![id_of(&event).parse().unwrap()],
    }
}

async fn blocked_hashes(pool: &PgPool) -> BTreeSet<Vec<u8>> {
    sqlx::query_scalar("select slug_hash from blocked_slugs")
        .fetch_all(pool)
        .await
        .unwrap()
        .into_iter()
        .collect()
}

fn keys_under(keys: &[String], card_ids: &[Uuid]) -> Vec<String> {
    keys.iter()
        .filter(|key| {
            card_ids
                .iter()
                .any(|id| key.starts_with(&format!("cards/{id}/")))
        })
        .cloned()
        .collect()
}

// spec: ACC-018, ACC-022, LNK-015, LNK-016, MED-019
#[sqlx::test(migrations = "./migrations")]
async fn deleting_an_account_deletes_everything(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let bob = populate(&app, "bob", BOB_SLUGS).await;
    let alice = populate(
        &app,
        "alice",
        ["alice-durand", "alice-ancien", "alice-reserve"],
    )
    .await;
    let alice_rows = alice.row_counts(&pool).await;
    assert_eq!(alice_rows, [1, 1, 3, 1, 1, 2]);
    assert_eq!(bob.row_counts(&pool).await, [1, 1, 3, 1, 1, 2]);
    let before = app.media_keys().await;
    assert!(!keys_under(&before, &bob.card_ids).is_empty());
    let alice_keys = keys_under(&before, &alice.card_ids);
    assert!(!alice_keys.is_empty());

    let res = delete_me(&app, "bob").await;

    assert_eq!(res.status, StatusCode::NO_CONTENT, "{}", res.json);
    assert_eq!(bob.row_counts(&pool).await, [0; 6]);
    let after = app.media_keys().await;
    assert!(keys_under(&after, &bob.card_ids).is_empty());
    assert_eq!(keys_under(&after, &alice.card_ids), alice_keys);
    assert_eq!(
        blocked_hashes(&pool).await,
        BOB_SLUGS.iter().map(|slug| hash_of(slug)).collect()
    );
    assert_eq!(alice.row_counts(&pool).await, alice_rows);
}

// spec: ACC-021, ACC-004
#[sqlx::test(migrations = "./migrations")]
async fn every_status_can_delete_itself(pool: PgPool) {
    let app = test_app_with(pool.clone(), &[("ADMIN_USER_IDS", "boss")]).await;
    for status in ["pending", "rejected", "suspended"] {
        let sub = format!("user-{status}");
        // The first request creates the account (pending in approval mode).
        let me = app
            .request("GET", "/api/me", Some(&token(&sub)), None)
            .await;
        assert_eq!(me.status, StatusCode::OK, "{}", me.json);
        sqlx::query("update users set status = $1 where subject = $2")
            .bind(status)
            .bind(&sub)
            .execute(&pool)
            .await
            .unwrap();

        let res = delete_me(&app, &sub).await;

        assert_eq!(res.status, StatusCode::NO_CONTENT, "{status}: {}", res.json);
    }
    let left: i64 = sqlx::query_scalar("select count(*) from users")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(left, 0);
}

// spec: ACC-021
#[sqlx::test(migrations = "./migrations")]
async fn a_current_admin_is_refused(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let boss = populate(&app, "boss", ["boss-martin", "boss-ancien", "boss-reserve"]).await;
    let rows = boss.row_counts(&pool).await;

    let res = delete_me(&app, "boss").await;

    assert_eq!(res.status, StatusCode::FORBIDDEN, "{}", res.json);
    assert_eq!(error_code(&res), "cannot_delete_admin");
    assert_eq!(boss.row_counts(&pool).await, rows);
    assert!(blocked_hashes(&pool).await.is_empty());
}

// spec: ACC-022
#[sqlx::test(migrations = "./migrations")]
async fn a_storage_failure_deletes_nothing(pool: PgPool) {
    let (store, failing) = FailingStore::new();
    let media = MediaService::with_store(
        Arc::new(store),
        "http://localhost:3000/media/".parse().unwrap(),
        true,
    );
    let (mut state, clock) = test_state_with(
        pool.clone(),
        &[("SIGNUP_MODE", "open"), ("ADMIN_USER_IDS", "boss")],
    );
    state.media = media;
    let app = TestApp::from_state(state, clock);
    let bob = populate(&app, "bob", BOB_SLUGS).await;
    let rows = bob.row_counts(&pool).await;
    assert_eq!(rows, [1, 1, 3, 1, 1, 2]);
    let keys = app.media_keys().await;
    assert!(!keys.is_empty());

    failing.store(true, Ordering::SeqCst);
    let res = delete_me(&app, "bob").await;

    assert_eq!(
        res.status,
        StatusCode::INTERNAL_SERVER_ERROR,
        "{}",
        res.json
    );
    assert_eq!(error_code(&res), "internal_error");
    assert_eq!(bob.row_counts(&pool).await, rows);
    assert!(blocked_hashes(&pool).await.is_empty());
    assert_eq!(app.media_keys().await.len(), keys.len());

    // The storage is back: the same request now succeeds.
    failing.store(false, Ordering::SeqCst);
    let retry = delete_me(&app, "bob").await;
    assert_eq!(retry.status, StatusCode::NO_CONTENT, "{}", retry.json);
    assert_eq!(bob.row_counts(&pool).await, [0; 6]);
    assert!(keys_under(&app.media_keys().await, &bob.card_ids).is_empty());
    assert_eq!(blocked_hashes(&pool).await.len(), 3);
}

async fn audit_rows(pool: &PgPool) -> Vec<(String, Uuid, Uuid, Value)> {
    sqlx::query_as(
        "select action, actor_user_id, target_id, metadata from audit_log order by created_at, id",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

// spec: ACC-024
#[sqlx::test(migrations = "./migrations")]
async fn audit_entries_survive_without_slugs(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, "bob", "bob-martin").await;
    let bob = user_id(&pool, "bob").await;
    create_card(&app, "boss", "boss-card").await;
    let boss = user_id(&pool, "boss").await;
    let disabled = app
        .request(
            "POST",
            &format!("/api/admin/cards/{}/support-disable", id_of(&card)),
            Some(&token("boss")),
            None,
        )
        .await;
    assert_eq!(disabled.status, StatusCode::OK, "{}", disabled.json);
    for status in ["suspended", "approved"] {
        let res = app
            .request(
                "POST",
                &format!("/api/admin/users/{bob}/status"),
                Some(&token("boss")),
                Some(json!({ "status": status })),
            )
            .await;
        assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    }
    let before = audit_rows(&pool).await;
    assert_eq!(before.len(), 3);
    assert_eq!(
        before[0].3,
        json!({ "owner_id": bob, "slug": "bob-martin" })
    );

    let res = delete_me(&app, "bob").await;

    assert_eq!(res.status, StatusCode::NO_CONTENT, "{}", res.json);
    let after = audit_rows(&pool).await;
    assert_eq!(after.len(), 3);
    let (action, actor, target, metadata) = &after[0];
    assert_eq!(action, "card.support_disabled");
    assert_eq!((*actor, *target), (boss, id_of(&card).parse().unwrap()));
    assert_eq!(*metadata, json!({ "owner_id": bob }));
    // The status changes name no slug: they are untouched.
    assert_eq!(after[1..], before[1..]);
}

// spec: ACC-024
#[sqlx::test(migrations = "./migrations")]
async fn a_former_admin_with_audit_entries_can_delete(pool: PgPool) {
    // Carol is no longer in `ADMIN_USER_IDS`.
    let app = cards_app(pool.clone()).await;
    let me = app
        .request("GET", "/api/me", Some(&token("carol")), None)
        .await;
    assert_eq!(me.status, StatusCode::OK, "{}", me.json);
    let carol = user_id(&pool, "carol").await;
    for action in ["user.status_changed", "card.support_enabled"] {
        sqlx::query(
            "insert into audit_log (actor_user_id, action, target_type, target_id, metadata) \
             values ($1, $2, 'user', $3, '{}')",
        )
        .bind(carol)
        .bind(action)
        .bind(Uuid::now_v7())
        .execute(&pool)
        .await
        .unwrap();
    }

    let res = delete_me(&app, "carol").await;

    assert_eq!(res.status, StatusCode::NO_CONTENT, "{}", res.json);
    let rows = audit_rows(&pool).await;
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().all(|row| row.1 == carol));
    let users: i64 = sqlx::query_scalar("select count(*) from users where id = $1")
        .bind(carol)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(users, 0);
}

// spec: ACC-023, ACC-001
#[sqlx::test(migrations = "./migrations")]
async fn signing_in_again_creates_a_new_empty_account(pool: PgPool) {
    let app = test_app_with(pool.clone(), &[("ADMIN_USER_IDS", "boss")]).await;
    let first = app
        .request("GET", "/api/me", Some(&token("bob")), None)
        .await;
    assert_eq!(first.json["status"], "pending");
    sqlx::query("update users set status = 'approved' where subject = 'bob'")
        .execute(&pool)
        .await
        .unwrap();
    create_card(&app, "bob", "bob-martin").await;

    let res = delete_me(&app, "bob").await;
    assert_eq!(res.status, StatusCode::NO_CONTENT, "{}", res.json);

    let again = app
        .request("GET", "/api/me", Some(&token("bob")), None)
        .await;
    assert_eq!(again.status, StatusCode::OK, "{}", again.json);
    assert_ne!(again.json["id"], first.json["id"]);
    assert_eq!(again.json["status"], "pending");
    sqlx::query("update users set status = 'approved' where subject = 'bob'")
        .execute(&pool)
        .await
        .unwrap();
    let cards = app
        .request("GET", "/api/cards", Some(&token("bob")), None)
        .await;
    assert_eq!(cards.status, StatusCode::OK, "{}", cards.json);
    assert_eq!(cards.json, json!({ "cards": [] }));
}

// spec: LNK-033
#[sqlx::test(migrations = "./migrations")]
async fn the_deleted_accounts_links_are_neutral(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    populate(&app, "bob", BOB_SLUGS).await;
    let before = app
        .request("GET", "/api/public/cards/bob-martin", None, None)
        .await;
    assert_eq!(before.status, StatusCode::OK, "{}", before.json);

    let res = delete_me(&app, "bob").await;
    assert_eq!(res.status, StatusCode::NO_CONTENT, "{}", res.json);

    for slug in BOB_SLUGS {
        let page = app
            .request("GET", &format!("/api/public/cards/{slug}"), None, None)
            .await;
        assert_eq!(page.status, StatusCode::OK, "{slug}");
        assert_eq!(page.body.as_ref(), br#"{"state":"inactive"}"#, "{slug}");
        let vcard = app
            .request(
                "GET",
                &format!("/api/public/cards/{slug}/vcard"),
                None,
                None,
            )
            .await;
        assert_eq!(vcard.status, StatusCode::GONE, "{slug}");
        assert_eq!(error_code(&vcard), "card_inactive", "{slug}");
    }
}

// spec: ACC-022
#[sqlx::test(migrations = "./migrations")]
async fn two_simultaneous_deletions_leave_no_account(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    populate(&app, "bob", BOB_SLUGS).await;

    let results = join_all([delete_me(&app, "bob"), delete_me(&app, "bob")]).await;

    for res in &results {
        assert!(
            matches!(res.status, StatusCode::NO_CONTENT | StatusCode::NOT_FOUND),
            "{}: {}",
            res.status,
            res.json
        );
    }
    assert!(
        results
            .iter()
            .any(|res| res.status == StatusCode::NO_CONTENT)
    );
    let left: i64 = sqlx::query_scalar("select count(*) from users where subject = 'bob'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(left, 0);
    assert_eq!(blocked_hashes(&pool).await.len(), 3);
}
