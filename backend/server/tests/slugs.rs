mod common;

use axum::http::StatusCode;
use common::cards::{cards_app, create_card, put_card, token};
use serde_json::json;
use sqlx::PgPool;

// spec: LNK-019
#[sqlx::test(migrations = "./migrations")]
async fn suggestion_skips_taken_slugs(pool: PgPool) {
    let app = cards_app(pool).await;
    create_card(&app, "alice", "alice-durand").await;

    let res = app
        .request(
            "GET",
            "/api/slugs/suggestion?first_name=Alice&last_name=Durand",
            Some(&token("bob")),
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json, json!({ "slug": "alice-durand-2" }));

    // Free as is, accents folded.
    let free = app
        .request(
            "GET",
            "/api/slugs/suggestion?first_name=%C3%89lo%C3%AFse&last_name=Martin",
            Some(&token("bob")),
            None,
        )
        .await;
    assert_eq!(free.json, json!({ "slug": "eloise-martin" }));

    // Nothing usable in the name: no suggestion.
    let none = app
        .request(
            "GET",
            "/api/slugs/suggestion?first_name=%E2%9C%A8",
            Some(&token("bob")),
            None,
        )
        .await;
    assert_eq!(none.status, StatusCode::OK);
    assert_eq!(none.json, json!({ "slug": null }));

    let anonymous = app
        .request("GET", "/api/slugs/suggestion?first_name=Alice", None, None)
        .await;
    assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED);
}

async fn availability(app: &common::TestApp, sub: &str, query: &str) -> serde_json::Value {
    let res = app
        .request(
            "GET",
            &format!("/api/slugs/availability?{query}"),
            Some(&token(sub)),
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::OK, "{query}: {}", res.json);
    res.json
}

// spec: LNK-020
#[sqlx::test(migrations = "./migrations")]
async fn availability_statuses(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", "alice-durand").await;
    let id = card["id"].as_str().unwrap();
    create_card(&app, "bob", "bob-martin").await;

    // Free, and normalized in the answer.
    assert_eq!(
        availability(&app, "alice", "slug=%20Alice-Pro%20").await,
        json!({ "slug": "alice-pro", "status": "free", "suggestions": [] })
    );
    // The card's own current slug.
    assert_eq!(
        availability(&app, "alice", &format!("slug=alice-durand&card_id={id}")).await,
        json!({ "slug": "alice-durand", "status": "current", "suggestions": [] })
    );
    // Without the card being edited, the same slug is not claimable.
    assert_eq!(
        availability(&app, "alice", "slug=alice-durand").await["status"],
        "reserved"
    );
    // Someone else's slug.
    assert_eq!(
        availability(&app, "alice", "slug=bob-martin").await["status"],
        "taken"
    );
    // Bad shape: no normalized slug.
    assert_eq!(
        availability(&app, "alice", "slug=a").await,
        json!({ "slug": null, "status": "invalid", "suggestions": [] })
    );

    // An old slug of the same card is free to take back; of another card of Alice, reserved.
    assert_eq!(
        put_card(&app, "alice", id, json!({ "slug": "alice-old" }))
            .await
            .status,
        StatusCode::OK
    );
    let other = create_card(&app, "alice", "alice-second").await;
    let other_id = other["id"].as_str().unwrap();
    assert_eq!(
        availability(&app, "alice", &format!("slug=alice-durand&card_id={id}")).await["status"],
        "free"
    );
    assert_eq!(
        availability(
            &app,
            "alice",
            &format!("slug=alice-durand&card_id={other_id}")
        )
        .await["status"],
        "reserved"
    );
}

// spec: LNK-035
#[sqlx::test(migrations = "./migrations")]
async fn a_taken_slug_comes_with_three_suggestions(pool: PgPool) {
    let app = cards_app(pool).await;
    create_card(&app, "alice", "alice-durand").await;

    let taken = availability(&app, "bob", "slug=alice-durand").await;
    assert_eq!(taken["status"], "taken");
    assert_eq!(
        taken["suggestions"],
        json!(["alice-durand-2", "alice-durand-3", "alice-durand-4"])
    );

    // The slug of the caller's other card is reserved: suggestions too.
    let reserved = availability(&app, "alice", "slug=alice-durand").await;
    assert_eq!(reserved["status"], "reserved");
    assert_eq!(
        reserved["suggestions"],
        json!(["alice-durand-2", "alice-durand-3", "alice-durand-4"])
    );

    // Taken suffixes are skipped.
    create_card(&app, "carol", "alice-durand-2").await;
    let skipped = availability(&app, "bob", "slug=alice-durand").await;
    assert_eq!(
        skipped["suggestions"],
        json!(["alice-durand-3", "alice-durand-4", "alice-durand-5"])
    );
}

// spec: LNK-035, LNK-031
#[sqlx::test(migrations = "./migrations")]
async fn suggestions_skip_blocked_slugs(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    create_card(&app, "alice", "alice-durand").await;
    sqlx::query("insert into blocked_slugs (slug_hash) values (sha256(convert_to($1, 'UTF8')))")
        .bind("alice-durand-3")
        .execute(&pool)
        .await
        .unwrap();

    let taken = availability(&app, "bob", "slug=alice-durand").await;
    assert_eq!(
        taken["suggestions"],
        json!(["alice-durand-2", "alice-durand-4", "alice-durand-5"])
    );
}

// spec: LNK-035
#[sqlx::test(migrations = "./migrations")]
async fn a_free_or_invalid_slug_has_no_suggestions(pool: PgPool) {
    let app = cards_app(pool).await;
    assert_eq!(
        availability(&app, "alice", "slug=alice-pro").await["suggestions"],
        json!([])
    );
    assert_eq!(
        availability(&app, "alice", "slug=a").await["suggestions"],
        json!([])
    );
    let card = create_card(&app, "alice", "alice-durand").await;
    let own = availability(
        &app,
        "alice",
        &format!("slug=alice-durand&card_id={}", card["id"].as_str().unwrap()),
    )
    .await;
    assert_eq!(own["status"], "current");
    assert_eq!(own["suggestions"], json!([]));
}

// spec: LNK-035, LNK-018
#[sqlx::test(migrations = "./migrations")]
async fn suggestions_of_a_long_slug_fit_64_characters(pool: PgPool) {
    let app = cards_app(pool).await;
    let long = "a".repeat(64);
    create_card(&app, "alice", &long).await;

    let taken = availability(&app, "bob", &format!("slug={long}")).await;
    let suggestions: Vec<&str> = taken["suggestions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s.as_str().unwrap())
        .collect();
    assert_eq!(suggestions.len(), 3);
    for (suggestion, suffix) in suggestions.iter().zip(["-2", "-3", "-4"]) {
        assert_eq!(suggestion.len(), 64);
        assert!(suggestion.ends_with(suffix), "{suggestion}");
    }
}
