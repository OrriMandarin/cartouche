//! The feature-gated test support: token issuer, JWKS, reset, seed and controllable clock.
#![cfg(feature = "test-support")]

use crate::common;

use std::sync::Arc;

use axum::http::StatusCode;
use cartouche_api::app::build_router;
use cartouche_api::rate_limit::{Bucket, InMemoryRateLimiter, RateLimiter};
use cartouche_api::state::AppState;
use cartouche_domain::{Clock, ManualClock, OverridableClock, Period, max_simultaneous};
use chrono::{Duration, TimeZone, Utc};
use common::{TestApp, test_app, test_app_with, test_config_with, test_verifier};
use serde_json::{Value, json};
use sqlx::PgPool;

async fn issue(app: &TestApp, body: Value) -> common::TestResponse {
    app.request("POST", "/api/test/token", None, Some(body))
        .await
}

async fn token_for(app: &TestApp, body: Value) -> String {
    let response = issue(app, body).await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.json);
    response.json["token"].as_str().unwrap().to_string()
}

async fn user_count(pool: &PgPool) -> i64 {
    sqlx::query_scalar("select count(*) from users")
        .fetch_one(pool)
        .await
        .unwrap()
}

// spec: ACC-008
#[sqlx::test]
async fn token_from_test_issuer_authenticates(pool: PgPool) {
    let app = test_app(pool).await;
    let token = token_for(
        &app,
        json!({"subject": "x", "email": "x@example.test", "name": "Xavier"}),
    )
    .await;
    let me = app.request("GET", "/api/me", Some(&token), None).await;
    assert_eq!(me.status, StatusCode::OK, "{}", me.json);
    assert_eq!(me.json["email"], "x@example.test");
    assert_eq!(me.json["display_name"], "Xavier");
}

// spec: ACC-008
#[sqlx::test]
async fn token_requires_a_non_blank_subject(pool: PgPool) {
    let app = test_app(pool).await;
    for body in [json!({"subject": ""}), json!({"subject": "  \t"})] {
        let response = issue(&app, body).await;
        assert_eq!(response.status, StatusCode::BAD_REQUEST);
        assert_eq!(response.json["error"]["code"], "invalid_request");
    }
    let missing = issue(&app, json!({})).await;
    assert_eq!(missing.status, StatusCode::BAD_REQUEST);
    assert_eq!(missing.json["error"]["code"], "invalid_request");
}

// spec: ACC-008
#[sqlx::test]
async fn token_lifetime_is_bounded(pool: PgPool) {
    let app = test_app(pool).await;
    let too_long = issue(&app, json!({"subject": "x", "expires_in_secs": 86_401})).await;
    assert_eq!(too_long.status, StatusCode::BAD_REQUEST);
    assert_eq!(too_long.json["error"]["code"], "invalid_request");
    let max = issue(&app, json!({"subject": "x", "expires_in_secs": 86_400})).await;
    assert_eq!(max.status, StatusCode::OK);
}

// spec: ACC-008
#[sqlx::test]
async fn token_claims_come_from_the_state_clock(pool: PgPool) {
    use base64::Engine;
    let app = test_app(pool).await;
    let token = token_for(&app, json!({"subject": "x"})).await;
    let payload = token.split('.').nth(1).unwrap();
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .unwrap();
    let claims: Value = serde_json::from_slice(&bytes).unwrap();
    let now = app.clock.now().timestamp();
    assert_eq!(claims["iss"], "cartouche-test-issuer");
    assert_eq!(claims["sub"], "x");
    assert_eq!(claims["iat"], now);
    assert_eq!(claims["exp"], now + 3600);
}

// spec: ACC-008
#[sqlx::test]
async fn jwks_exposes_test_key(pool: PgPool) {
    let app = test_app(pool).await;
    let response = app.request("GET", "/api/test/jwks.json", None, None).await;
    assert_eq!(response.status, StatusCode::OK);
    let keys = response.json["keys"].as_array().unwrap();
    assert_eq!(keys.len(), 1);
    assert_eq!(keys[0]["kid"], "cartouche-test-1");
    assert_eq!(keys[0]["alg"], "ES256");
    assert!(
        keys[0].get("d").is_none(),
        "the private part must not be served"
    );
}

// spec: ACC-008
#[sqlx::test]
async fn seed_base_creates_expected_users(pool: PgPool) {
    let app = test_app(pool.clone()).await;
    let response = app.seed("base").await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.json);
    let users: Vec<(&str, &str)> = response.json["users"]
        .as_array()
        .unwrap()
        .iter()
        .map(|u| {
            (
                u["subject"].as_str().unwrap(),
                u["status"].as_str().unwrap(),
            )
        })
        .collect();
    let expected = [
        ("seed-admin", "approved"),
        ("seed-alice", "approved"),
        ("seed-bob", "approved"),
        ("seed-carol", "pending"),
        ("seed-dan", "suspended"),
        ("seed-erin", "rejected"),
    ];
    assert_eq!(users, expected);

    let rows: Vec<(String, String, String, String, String)> = sqlx::query_as(
        "select subject, issuer, display_name, email, status from users order by subject",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 6);
    assert!(rows.iter().all(|r| r.1 == "cartouche-test-issuer"));
    let erin = rows.iter().find(|r| r.0 == "seed-erin").unwrap();
    assert_eq!(erin.2, "Érin D'Aubigné-Müller");
    assert_eq!(erin.3, "erin@example.test");
    assert_eq!(
        rows.iter().find(|r| r.0 == "seed-carol").unwrap().2,
        "Carole Lefèvre"
    );
}

// spec: ACC-008
#[sqlx::test]
async fn seeded_user_can_sign_in_with_a_test_token(pool: PgPool) {
    let app = test_app(pool.clone()).await;
    app.seed("base").await;
    let token = token_for(&app, json!({"subject": "seed-dan"})).await;
    let me = app.request("GET", "/api/me", Some(&token), None).await;
    assert_eq!(me.status, StatusCode::OK);
    assert_eq!(me.json["status"], "suspended");
    assert_eq!(
        user_count(&pool).await,
        6,
        "signing in created no duplicate"
    );
}

// spec: ACC-008
#[sqlx::test]
async fn seeding_twice_resets_the_seeded_users(pool: PgPool) {
    let app = test_app(pool.clone()).await;
    assert_eq!(app.seed("base").await.status, StatusCode::OK);
    sqlx::query(
        "update users set status = 'rejected', display_name = 'x' where subject = 'seed-alice'",
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(app.seed("base").await.status, StatusCode::OK);
    assert_eq!(user_count(&pool).await, 6);
    let (status, name): (String, String) =
        sqlx::query_as("select status, display_name from users where subject = 'seed-alice'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        (status.as_str(), name.as_str()),
        ("approved", "Alice Durand")
    );
}

// spec: ACC-008
#[sqlx::test]
async fn reset_empties_tables(pool: PgPool) {
    let app = test_app(pool.clone()).await;
    app.seed("base").await;
    let admin: uuid::Uuid = sqlx::query_scalar("select id from users where subject = 'seed-admin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    sqlx::query(
        "insert into audit_log (actor_user_id, action, target_type, target_id) \
         values ($1, 'user.approve', 'user', $1)",
    )
    .bind(admin)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("insert into blocked_slugs (slug_hash) values (sha256('ancien-lien'::bytea))")
        .execute(&pool)
        .await
        .unwrap();

    let response = app.request("POST", "/api/test/reset", None, None).await;
    assert_eq!(response.status, StatusCode::NO_CONTENT);
    assert_eq!(user_count(&pool).await, 0);
    let audits: i64 = sqlx::query_scalar("select count(*) from audit_log")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(audits, 0);
    let blocked: i64 = sqlx::query_scalar("select count(*) from blocked_slugs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(blocked, 0);
}

// spec: ABU-006
#[sqlx::test]
async fn reset_clears_the_rate_limiter(pool: PgPool) {
    let (mut state, clock) = common::test_state(pool);
    let limiter = Arc::new(InMemoryRateLimiter::default());
    state.rate_limiter = limiter.clone();
    let app = TestApp::from_state(state, clock.clone());
    let visitor = "203.0.113.7".parse().unwrap();
    let bucket = Bucket::LeadSubmission;
    for _ in 0..bucket.limit().max {
        limiter.hit(bucket, visitor, clock.now()).unwrap();
    }
    assert!(limiter.hit(bucket, visitor, clock.now()).is_err());

    let response = app.request("POST", "/api/test/reset", None, None).await;
    assert_eq!(response.status, StatusCode::NO_CONTENT);
    assert_eq!(limiter.hit(bucket, visitor, clock.now()), Ok(()));
}

// spec: ACC-008
#[sqlx::test]
async fn unknown_scenario_is_404(pool: PgPool) {
    let app = test_app(pool.clone()).await;
    let response = app.seed("nope").await;
    assert_eq!(response.status, StatusCode::NOT_FOUND);
    assert_eq!(response.json["error"]["code"], "unknown_scenario");
    assert_eq!(user_count(&pool).await, 0);
}

// spec: ACC-008
#[sqlx::test]
async fn clock_controls_token_expiry(pool: PgPool) {
    // A state whose clock is the overridable one, shared with the clock route.
    let clock = Arc::new(OverridableClock::new());
    let config = test_config_with(&[]);
    let state = AppState {
        db: pool.clone(),
        verifier: test_verifier(&config, clock.clone()),
        config: Arc::new(config),
        clock: clock.clone(),
        media: common::test_media(),
        rate_limiter: Arc::new(InMemoryRateLimiter::default()),
        test_clock: Some(clock),
    };
    let app = TestApp {
        media: state.media.clone(),
        router: build_router(state),
        pool,
        // Unused here: time is driven through `/api/test/clock`.
        clock: Arc::new(ManualClock::new(Utc::now())),
    };

    let t0 = Utc.with_ymd_and_hms(2030, 5, 1, 9, 0, 0).unwrap();
    let set = |at: Option<chrono::DateTime<Utc>>| {
        app.request("POST", "/api/test/clock", None, Some(json!({ "now": at })))
    };
    let frozen = set(Some(t0)).await;
    assert_eq!(frozen.status, StatusCode::OK, "{}", frozen.json);
    assert_eq!(frozen.json["now"], "2030-05-01T09:00:00Z");

    let token = token_for(&app, json!({"subject": "x", "expires_in_secs": 60})).await;
    let ok = app.request("GET", "/api/me", Some(&token), None).await;
    assert_eq!(ok.status, StatusCode::OK, "{}", ok.json);

    set(Some(t0 + Duration::minutes(10))).await;
    let expired = app.request("GET", "/api/me", Some(&token), None).await;
    assert_eq!(expired.status, StatusCode::UNAUTHORIZED);
    assert_eq!(expired.json["error"]["code"], "token_expired");

    // `null` goes back to the system time (2030 is in the future of the real clock).
    let reset = set(None).await;
    assert_eq!(reset.status, StatusCode::OK);
    let now: chrono::DateTime<Utc> = reset.json["now"].as_str().unwrap().parse().unwrap();
    assert!((Utc::now() - now).num_seconds().abs() < 5);
}

// spec: ACC-008
#[sqlx::test]
async fn clock_body_must_carry_now(pool: PgPool) {
    let app = test_app(pool).await;
    for body in [json!({}), json!({"now": "yesterday"})] {
        let response = app
            .request("POST", "/api/test/clock", None, Some(body))
            .await;
        assert_eq!(response.status, StatusCode::BAD_REQUEST);
        assert_eq!(response.json["error"]["code"], "invalid_request");
    }
}

// spec: ACC-008
#[sqlx::test]
async fn clock_route_without_overridable_clock_is_404(pool: PgPool) {
    // The default test state has a frozen manual clock and no overridable one.
    let app = test_app(pool).await;
    let response = app
        .request("POST", "/api/test/clock", None, Some(json!({"now": null})))
        .await;
    assert_eq!(response.status, StatusCode::NOT_FOUND);
    assert_eq!(response.json["error"]["code"], "not_found");
}

// spec: ACC-008
#[sqlx::test]
async fn test_routes_absent_in_production_env(pool: PgPool) {
    let app = test_app_with(pool, &[("APP_ENV", "production")]).await;
    let probes = [
        ("POST", "/api/test/token", Some(json!({"subject": "x"}))),
        ("GET", "/api/test/jwks.json", None),
        ("POST", "/api/test/reset", None),
        ("POST", "/api/test/seed", Some(json!({"scenario": "base"}))),
        ("POST", "/api/test/clock", Some(json!({"now": null}))),
        ("GET", "/api/test/approved-check", None),
    ];
    for (method, path, body) in probes {
        let response = app.request(method, path, None, body).await;
        assert_eq!(response.status, StatusCode::NOT_FOUND, "{method} {path}");
        assert_eq!(response.json["error"]["code"], "not_found", "{path}");
    }
}

async fn public_card(app: &TestApp, slug: &str) -> common::TestResponse {
    app.request("GET", &format!("/api/public/cards/{slug}"), None, None)
        .await
}

// spec: ACC-008
#[sqlx::test]
async fn cards_scenario_seeds_every_card_state(pool: PgPool) {
    let app = test_app(pool.clone()).await;
    assert_eq!(app.seed("base").await.status, StatusCode::OK);
    let response = app.seed("cards").await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.json);

    let mut seeded: Vec<(&str, &str)> = response.json["cards"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| (c["slug"].as_str().unwrap(), c["owner"].as_str().unwrap()))
        .collect();
    seeded.sort();
    assert_eq!(
        seeded,
        [
            ("alice-archive", "seed-alice"),
            ("alice-durand", "seed-alice"),
            ("bob-martin", "seed-bob"),
            ("dan-moreau", "seed-dan"),
        ]
    );
    for card in response.json["cards"].as_array().unwrap() {
        assert!(card["id"].as_str().is_some(), "every card reports its id");
    }

    let cards: i64 = sqlx::query_scalar("select count(*) from cards")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(cards, 4);
    let slugs: i64 = sqlx::query_scalar("select count(*) from card_slugs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(slugs, 6, "four current slugs, one old, one reserved");

    let alice = public_card(&app, "alice-durand").await;
    assert_eq!(alice.status, StatusCode::OK, "{}", alice.json);
    assert_eq!(alice.json["state"], "active");
    let content = &alice.json["card"]["content"];
    assert_eq!(content["first_name"], "Alice");
    assert_eq!(content["last_name"], "Durand");
    assert_eq!(content["job_title"], "Fondatrice");
    assert_eq!(content["company"], "Atelier Durand & Fils");
    assert_eq!(content["email"], "alice@example.test");
    assert_eq!(content["phone"], "+33612345678");
    assert_eq!(
        content["description"],
        "Créatrice de cartes ✨ — l'artisanat d'aujourd'hui"
    );
    let links = alice.json["card"]["links"].as_array().unwrap();
    assert_eq!(links.len(), 2);
    assert_eq!(links[0]["kind"], "linkedin");
    assert_eq!(links[0]["url"], "https://www.linkedin.com/in/alice");
    assert_eq!(links[1]["kind"], "custom");
    assert_eq!(links[1]["label"], "Portfolio");
    assert_eq!(links[1]["url"], "https://alice.example.test");

    let old = public_card(&app, "alice").await;
    assert_eq!(old.status, StatusCode::OK, "{}", old.json);
    assert_eq!(old.json["state"], "redirect");
    assert_eq!(old.json["slug"], "alice-durand");

    for inactive in [
        "alice-archive",
        "alice-ancienne",
        "bob-martin",
        "dan-moreau",
    ] {
        let response = public_card(&app, inactive).await;
        assert_eq!(response.status, StatusCode::OK, "{inactive}");
        assert_eq!(response.json["state"], "inactive", "{inactive}");
    }
}

// spec: ACC-008
#[sqlx::test]
async fn cards_scenario_is_replayable(pool: PgPool) {
    let app = test_app(pool.clone()).await;
    app.seed("base").await;
    let first = app.seed("cards").await;
    assert_eq!(first.status, StatusCode::OK, "{}", first.json);
    sqlx::query("update cards set first_name = 'x', owner_disabled_at = now()")
        .execute(&pool)
        .await
        .unwrap();
    let second = app.seed("cards").await;
    assert_eq!(second.status, StatusCode::OK, "{}", second.json);
    assert_eq!(first.json["cards"], second.json["cards"]);

    let cards: i64 = sqlx::query_scalar("select count(*) from cards")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(cards, 4);
    let slugs: i64 = sqlx::query_scalar("select count(*) from card_slugs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(slugs, 6);
    let alice = public_card(&app, "alice-durand").await;
    assert_eq!(alice.json["state"], "active");
    assert_eq!(alice.json["card"]["content"]["first_name"], "Alice");
}

/// T0 of the `events` scenario: every date of the scenario is relative to it.
fn events_now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2027, 3, 15, 10, 0, 0).unwrap()
}

/// Freezes the clock at T0, seeds `base`, `cards` and `events`, and returns the report of the
/// `events` scenario.
async fn seed_events_at_t0(app: &TestApp) -> Value {
    app.clock.set(events_now());
    let mut report = Value::Null;
    for scenario in ["base", "cards", "events"] {
        let response = app.seed(scenario).await;
        assert_eq!(
            response.status,
            StatusCode::OK,
            "{scenario}: {}",
            response.json
        );
        report = response.json;
    }
    report
}

async fn public_event(app: &TestApp, slug: &str, event_id: &str) -> common::TestResponse {
    app.request(
        "GET",
        &format!("/api/public/cards/{slug}/events/{event_id}"),
        None,
        None,
    )
    .await
}

fn event_id(report: &Value, title: &str) -> String {
    report["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["title"] == title)
        .unwrap_or_else(|| panic!("no seeded event titled {title}"))["id"]
        .as_str()
        .unwrap()
        .to_string()
}

// spec: EVT-004, PUB-029, EVT-008
#[sqlx::test]
async fn events_scenario_is_relative_to_the_clock(pool: PgPool) {
    let app = test_app(pool.clone()).await;
    let report = seed_events_at_t0(&app).await;

    let mut titles: Vec<&str> = report["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["title"].as_str().unwrap())
        .collect();
    titles.sort();
    let mut expected = [
        "Salon du Mariage Clermont 2027",
        "Portes ouvertes de l'Atelier",
        "Démonstration en boutique",
        "Atelier découverte",
        "Foire de Lyon",
        "Salon de Paris 2026",
        "Événement archivé",
        "Salon bloqué",
    ];
    expected.sort();
    assert_eq!(titles, expected);
    assert!(report["users"].as_array().unwrap().is_empty());
    assert!(report["cards"].as_array().unwrap().is_empty());

    // Exactly the three events running at T0 are on the public card, by start.
    let card = public_card(&app, "alice-durand").await;
    assert_eq!(card.status, StatusCode::OK, "{}", card.json);
    let buttons: Vec<&str> = card.json["card"]["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["title"].as_str().unwrap())
        .collect();
    assert_eq!(
        buttons,
        [
            "Salon du Mariage Clermont 2027",
            "Portes ouvertes de l'Atelier",
            "Démonstration en boutique",
        ]
    );

    // An event ended 10 minutes ago still takes submissions; a future one does not.
    let discovery = event_id(&report, "Atelier découverte");
    let open = public_event(&app, "alice-durand", &discovery).await;
    assert_eq!(open.json["state"], "open", "{}", open.json);
    let lyon = event_id(&report, "Foire de Lyon");
    let closed = public_event(&app, "alice-durand", &lyon).await;
    assert_eq!(closed.json["state"], "closed", "{}", closed.json);
    let open_house = event_id(&report, "Portes ouvertes de l'Atelier");
    let coded = public_event(&app, "alice-durand", &open_house).await;
    assert_eq!(coded.json["state"], "code_required", "{}", coded.json);

    // The disabled card of Alice is gone for the public, whatever its events.
    let archived = event_id(&report, "Événement archivé");
    let gone = public_event(&app, "alice-archive", &archived).await;
    assert_eq!(gone.status, StatusCode::GONE, "{}", gone.json);

    // No instant has more than three of Alice's events at once (the EVT-004 limit).
    let rows: Vec<(chrono::DateTime<Utc>, Option<chrono::DateTime<Utc>>)> = sqlx::query_as(
        "select e.starts_at, e.ends_at from events e join cards c on c.id = e.card_id \
         join users u on u.id = c.owner_id where u.subject = 'seed-alice' \
         and c.id = (select card_id from card_slugs where slug = 'alice-durand') \
         order by e.starts_at, e.title",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 6);
    let periods: Vec<Period> = rows
        .iter()
        .map(|(starts_at, ends_at)| Period {
            starts_at: *starts_at,
            ends_at: *ends_at,
        })
        .collect();
    for (index, period) in periods.iter().enumerate() {
        let others: Vec<Period> = periods
            .iter()
            .enumerate()
            .filter(|(other, _)| *other != index)
            .map(|(_, p)| *p)
            .collect();
        assert!(max_simultaneous(period, &others) <= 3, "event {index}");
    }
    let running = periods
        .iter()
        .filter(|p| p.is_running(events_now()))
        .count();
    assert_eq!(running, 3);

    // Four contacts, one of them spam, with accents kept as typed.
    let leads: Vec<(String, Option<String>, bool)> = sqlx::query_as(
        "select first_name, last_name, spam_at is not null from leads order by submitted_at",
    )
    .fetch_all(&pool)
    .await
    .unwrap()
    .into_iter()
    .map(|(f, l, s): (Option<String>, Option<String>, bool)| (f.unwrap_or_default(), l, s))
    .collect();
    assert_eq!(leads.len(), 4);
    assert_eq!(leads.iter().filter(|(_, _, spam)| *spam).count(), 1);
    assert!(leads.contains(&("Éloïse".into(), Some("D’Aubigné-Müller".into()), false)));
    assert!(leads.contains(&("Zoé".into(), Some("Lefèvre ✨".into()), false)));
    assert!(leads.contains(&("Bot".into(), Some("Spam".into()), true)));
    assert!(leads.contains(&("Jean-Michel".into(), Some("Hébert".into()), false)));
}

// spec: EDI-020, ABU-003, FRM-026, FRM-027
#[sqlx::test]
async fn events_scenario_contacts_are_listed_for_their_owner(pool: PgPool) {
    let app = test_app(pool).await;
    let report = seed_events_at_t0(&app).await;
    let token = token_for(&app, json!({"subject": "seed-alice"})).await;
    let wedding = event_id(&report, "Salon du Mariage Clermont 2027");
    let listed = app
        .request(
            "GET",
            &format!("/api/events/{wedding}/leads"),
            Some(&token),
            None,
        )
        .await;
    assert_eq!(listed.status, StatusCode::OK, "{}", listed.json);
    let leads = listed.json["leads"].as_array().unwrap();
    assert_eq!(leads.len(), 3);
    assert_eq!(leads[0]["answers"]["first_name"], "Bot");
    assert_eq!(leads[0]["spam"], true);
    assert_eq!(leads[1]["answers"]["last_name"], "Lefèvre ✨");
    assert_eq!(leads[2]["answers"]["first_name"], "Éloïse");
    assert_eq!(leads[2]["answers"]["phone"], "+33612345678");
    let custom = leads[2]["custom"].as_array().unwrap();
    assert_eq!(custom.len(), 4);
    assert_eq!(custom[2]["label"], "Formule");
    assert_eq!(custom[2]["value"], "Prestige");

    // The recorded consent is the text a real submission records: the one the owner's view
    // gives as the default for this card and title.
    let event = app
        .request("GET", &format!("/api/events/{wedding}"), Some(&token), None)
        .await;
    assert_eq!(event.status, StatusCode::OK, "{}", event.json);
    assert!(event.json["consent_text"].is_null());
    let default_text = event.json["default_consent_text"].as_str().unwrap();
    assert!(default_text.contains("« Salon du Mariage Clermont 2027 »"));
    assert!(default_text.contains("est responsable de ce traitement"));
    for lead in leads {
        assert_eq!(lead["consent_text"], default_text);
    }
}

// spec: FRM-008
#[sqlx::test]
async fn seeded_consent_texts_are_the_ones_a_submission_records(pool: PgPool) {
    let app = test_app(pool).await;
    let report = seed_events_at_t0(&app).await;
    let token = token_for(&app, json!({"subject": "seed-alice"})).await;
    let mut checked = 0;
    for event in report["events"].as_array().unwrap() {
        if event["card_slug"] != "alice-durand" {
            continue;
        }
        let id = event["id"].as_str().unwrap();
        let view = app
            .request("GET", &format!("/api/events/{id}"), Some(&token), None)
            .await;
        assert_eq!(view.status, StatusCode::OK, "{}", view.json);
        // What the public form shows, hence what a submission records: the custom text, or the default.
        let expected = view.json["consent_text"]
            .as_str()
            .unwrap_or_else(|| view.json["default_consent_text"].as_str().unwrap());
        let listed = app
            .request(
                "GET",
                &format!("/api/events/{id}/leads"),
                Some(&token),
                None,
            )
            .await;
        assert_eq!(listed.status, StatusCode::OK, "{}", listed.json);
        for lead in listed.json["leads"].as_array().unwrap() {
            assert_eq!(lead["consent_text"], expected, "{}", event["title"]);
            checked += 1;
        }
    }
    assert_eq!(checked, 4);
}

// spec: FRM-023
#[sqlx::test]
async fn jean_michel_keeps_his_deleted_answer(pool: PgPool) {
    let app = test_app(pool).await;
    let report = seed_events_at_t0(&app).await;
    let token = token_for(&app, json!({"subject": "seed-alice"})).await;
    let paris = event_id(&report, "Salon de Paris 2026");
    let listed = app
        .request(
            "GET",
            &format!("/api/events/{paris}/leads"),
            Some(&token),
            None,
        )
        .await;
    assert_eq!(listed.status, StatusCode::OK, "{}", listed.json);
    let leads = listed.json["leads"].as_array().unwrap();
    assert_eq!(leads.len(), 1);
    assert_eq!(leads[0]["answers"]["first_name"], "Jean-Michel");
    let custom = leads[0]["custom"].as_array().unwrap();
    assert_eq!(custom.len(), 1);
    assert_eq!(
        custom[0]["field_id"],
        "0198c8a1-0000-7000-8000-000000000005"
    );
    assert_eq!(custom[0]["label"], "Entreprise");
    assert_eq!(custom[0]["kind"], "text");
    assert_eq!(custom[0]["value"], "Hébert & Fils");
}

// spec: ACC-008
#[sqlx::test]
async fn events_scenario_is_replayable(pool: PgPool) {
    let app = test_app(pool.clone()).await;
    let first = seed_events_at_t0(&app).await;
    sqlx::query("update events set title = 'x', starts_at = starts_at + interval '1 day', ends_at = null, device_limit = 9")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("update leads set first_name = 'x', spam_at = null")
        .execute(&pool)
        .await
        .unwrap();
    let second = app.seed("events").await;
    assert_eq!(second.status, StatusCode::OK, "{}", second.json);
    assert_eq!(first["events"], second.json["events"]);

    let events: i64 = sqlx::query_scalar("select count(*) from events")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(events, 8);
    let leads: i64 = sqlx::query_scalar("select count(*) from leads")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(leads, 4);
    let spam: i64 = sqlx::query_scalar("select count(*) from leads where spam_at is not null")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(spam, 1);
    let card = public_card(&app, "alice-durand").await;
    assert_eq!(card.json["card"]["events"].as_array().unwrap().len(), 3);
}

// spec: ACC-008
#[sqlx::test]
async fn cards_scenario_dates_follow_the_clock(pool: PgPool) {
    let app = test_app(pool.clone()).await;
    seed_events_at_t0(&app).await;
    let disabled_at: chrono::DateTime<Utc> = sqlx::query_scalar(
        "select owner_disabled_at from cards where id = '0198c8a0-0000-7000-8000-000000000002'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(disabled_at, events_now());
}
