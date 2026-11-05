use crate::common;

use std::collections::BTreeSet;
use std::sync::Arc;
use std::time::Duration;

use aws_lc_rs::digest::{SHA256, digest};
use axum::http::StatusCode;
use cartouche_api::db::blocked_slugs;
use common::cards::{cards_app, create_card, put_card, token};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

fn hash_of(slug: &str) -> Vec<u8> {
    digest(&SHA256, slug.as_bytes()).as_ref().to_vec()
}

async fn block(pool: &PgPool, slug: &str) {
    sqlx::query("insert into blocked_slugs (slug_hash) values ($1)")
        .bind(hash_of(slug))
        .execute(pool)
        .await
        .unwrap();
}

async fn user_id(pool: &PgPool, subject: &str) -> Uuid {
    sqlx::query_scalar("select id from users where subject = $1")
        .bind(subject)
        .fetch_one(pool)
        .await
        .unwrap()
}

fn error_code(res: &common::TestResponse) -> &str {
    res.json["error"]["code"].as_str().unwrap_or_default()
}

// spec: LNK-031
#[sqlx::test(migrations = "./migrations")]
async fn blocked_slugs_hold_only_the_sha256(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    // A current slug, a former slug (LNK-003) and a reserved slug (LNK-013).
    let card = create_card(&app, "alice", "alice").await;
    let saved = put_card(
        &app,
        "alice",
        card["id"].as_str().unwrap(),
        json!({ "slug": "alice-durand" }),
    )
    .await;
    assert_eq!(saved.status, StatusCode::OK, "{}", saved.json);
    let ancien = create_card(&app, "alice", "alice-ancien").await;
    let removed = app
        .request(
            "DELETE",
            &format!("/api/cards/{}", ancien["id"].as_str().unwrap()),
            Some(&token("alice")),
            None,
        )
        .await;
    assert_eq!(removed.status, StatusCode::NO_CONTENT, "{}", removed.json);
    // Someone else's slug is not touched.
    create_card(&app, "bob", "bob-martin").await;

    let alice = user_id(&pool, "alice").await;
    let mut tx = pool.begin().await.unwrap();
    let inserted = blocked_slugs::block_all_of_owner(&mut tx, alice)
        .await
        .unwrap();
    // Blocking twice changes nothing.
    let again = blocked_slugs::block_all_of_owner(&mut tx, alice)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert_eq!((inserted, again), (3, 0));

    let stored: BTreeSet<Vec<u8>> = sqlx::query_scalar("select slug_hash from blocked_slugs")
        .fetch_all(&pool)
        .await
        .unwrap()
        .into_iter()
        .collect();
    let expected: BTreeSet<Vec<u8>> = ["alice-durand", "alice", "alice-ancien"]
        .into_iter()
        .map(hash_of)
        .collect();
    assert_eq!(stored, expected);

    let columns: Vec<String> = sqlx::query_scalar(
        "select column_name::text from information_schema.columns \
         where table_schema = current_schema() and table_name = 'blocked_slugs'",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(columns, ["slug_hash"]);

    assert!(
        blocked_slugs::is_blocked(&pool, "alice-durand")
            .await
            .unwrap()
    );
    assert!(
        !blocked_slugs::is_blocked(&pool, "bob-martin")
            .await
            .unwrap()
    );
}

// spec: LNK-032
#[sqlx::test(migrations = "./migrations")]
async fn a_blocked_slug_cannot_be_claimed(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    block(&pool, "bob-martin").await;

    let created = app
        .request(
            "POST",
            "/api/cards",
            Some(&token("carol")),
            Some(json!({ "slug": "Bob-Martin", "first_name": "Carol", "last_name": "Roux" })),
        )
        .await;
    assert_eq!(created.status, StatusCode::CONFLICT, "{}", created.json);
    assert_eq!(error_code(&created), "slug_taken");

    let changed = put_card(
        &app,
        "alice",
        card["id"].as_str().unwrap(),
        json!({ "slug": "bob-martin" }),
    )
    .await;
    assert_eq!(changed.status, StatusCode::CONFLICT, "{}", changed.json);
    assert_eq!(error_code(&changed), "slug_taken");

    let duplicated = app
        .request(
            "POST",
            &format!("/api/cards/{}/duplicate", card["id"].as_str().unwrap()),
            Some(&token("alice")),
            Some(json!({ "slug": "bob-martin" })),
        )
        .await;
    assert_eq!(
        duplicated.status,
        StatusCode::CONFLICT,
        "{}",
        duplicated.json
    );
    assert_eq!(error_code(&duplicated), "slug_taken");

    let availability = app
        .request(
            "GET",
            "/api/slugs/availability?slug=bob-martin",
            Some(&token("alice")),
            None,
        )
        .await;
    assert_eq!(availability.json["slug"], "bob-martin");
    assert_eq!(availability.json["status"], "taken");

    let suggestion = app
        .request(
            "GET",
            "/api/slugs/suggestion?first_name=Bob&last_name=Martin",
            Some(&token("alice")),
            None,
        )
        .await;
    assert_eq!(suggestion.json, json!({ "slug": "bob-martin-2" }));
}

// spec: LNK-032
#[sqlx::test(migrations = "./migrations")]
async fn a_claim_racing_a_deletion_never_gets_the_slug(pool: PgPool) {
    let app = Arc::new(cards_app(pool.clone()).await);
    create_card(&app, "bob", "bob-martin").await;
    create_card(&app, "alice", "alice-durand").await;
    let bob = user_id(&pool, "bob").await;

    // The deletion of Bob's account, in progress: his slugs are blocked and his rows deleted,
    // but nothing is committed yet.
    let mut deletion = pool.begin().await.unwrap();
    blocked_slugs::block_all_of_owner(&mut deletion, bob)
        .await
        .unwrap();
    sqlx::query("delete from users where id = $1")
        .bind(bob)
        .execute(&mut *deletion)
        .await
        .unwrap();

    let claim = {
        let app = app.clone();
        tokio::spawn(async move {
            app.request(
                "POST",
                "/api/cards",
                Some(&token("carol")),
                Some(json!({ "slug": "bob-martin", "first_name": "Carol", "last_name": "Roux" })),
            )
            .await
        })
    };

    // Wait until the claim is blocked on a lock held by the deletion.
    let mut waiting = false;
    for _ in 0..100 {
        let locked: i64 = sqlx::query_scalar(
            "select count(*) from pg_stat_activity \
             where datname = current_database() and wait_event_type = 'Lock'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        if locked > 0 {
            waiting = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(waiting, "the claim never waited for the deletion");
    assert!(!claim.is_finished());

    deletion.commit().await.unwrap();
    let res = claim.await.unwrap();
    assert_eq!(res.status, StatusCode::CONFLICT, "{}", res.json);
    assert_eq!(error_code(&res), "slug_taken");
    let held: i64 = sqlx::query_scalar("select count(*) from card_slugs where slug = 'bob-martin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(held, 0);
}

// spec: LNK-033, LNK-023
#[sqlx::test(migrations = "./migrations")]
async fn a_blocked_slug_shows_like_a_deleted_card(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    block(&pool, "ancien-lien").await;

    let page = app
        .request("GET", "/api/public/cards/ancien-lien", None, None)
        .await;
    assert_eq!(page.status, StatusCode::OK);
    assert_eq!(page.body.as_ref(), br#"{"state":"inactive"}"#);

    let vcard = app
        .request("GET", "/api/public/cards/ancien-lien/vcard", None, None)
        .await;
    assert_eq!(vcard.status, StatusCode::GONE);
    assert_eq!(error_code(&vcard), "card_inactive");

    let event = app
        .request(
            "GET",
            &format!("/api/public/cards/ancien-lien/events/{}", Uuid::now_v7()),
            None,
            None,
        )
        .await;
    assert_eq!(event.status, StatusCode::GONE);
    assert_eq!(error_code(&event), "card_inactive");

    // Written with capitals, as for a deleted card: neutral page, not a redirect.
    let upper = app
        .request("GET", "/api/public/cards/Ancien-Lien", None, None)
        .await;
    assert_eq!(upper.body.as_ref(), br#"{"state":"inactive"}"#);

    let never = app
        .request("GET", "/api/public/cards/jamais-attribue", None, None)
        .await;
    assert_eq!(never.status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&never), "not_found");
}

// spec: ACC-024
#[sqlx::test(migrations = "./migrations")]
async fn audit_actor_is_no_longer_a_foreign_key(pool: PgPool) {
    sqlx::query(
        "insert into audit_log (actor_user_id, action, target_type, target_id) \
         values ($1, 'user.approve', 'user', $2)",
    )
    .bind(Uuid::now_v7())
    .bind(Uuid::now_v7())
    .execute(&pool)
    .await
    .unwrap();
}
