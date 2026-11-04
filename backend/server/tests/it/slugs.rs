use crate::common;

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
        json!({ "slug": "alice-pro", "status": "free" })
    );
    // The card's own current slug.
    assert_eq!(
        availability(&app, "alice", &format!("slug=alice-durand&card_id={id}")).await,
        json!({ "slug": "alice-durand", "status": "current" })
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
        json!({ "slug": null, "status": "invalid" })
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
