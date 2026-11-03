mod common;

use axum::http::StatusCode;
use common::{TestApp, TestResponse, sign_test_token, test_app_with};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

const ISSUER: &str = "cartouche-test-issuer";
const ADMIN: &str = "boss";

fn token(sub: &str) -> String {
    sign_test_token(json!({
        "iss": ISSUER,
        "sub": sub,
        "exp": 1_768_478_400i64 + 3600, // 2026-01-15 12:00 UTC + 1 h
        "email": format!("{sub}@example.com"),
        "name": format!("User {sub}"),
    }))
}

/// App configured with `boss` and `boss2` as administrators, signup in approval mode.
async fn app(pool: &PgPool) -> TestApp {
    test_app_with(pool.clone(), &[("ADMIN_USER_IDS", "boss,boss2")]).await
}

/// Inserts a user directly, `age_minutes` old, with the given status.
async fn insert_user(pool: &PgPool, sub: &str, status: &str, age_minutes: i32) -> Uuid {
    sqlx::query_scalar(
        "insert into users (issuer, subject, email, display_name, status, created_at) \
         values ($1, $2, $3, $4, $5, now() - make_interval(mins => $6)) returning id",
    )
    .bind(ISSUER)
    .bind(sub)
    .bind(format!("{sub}@example.com"))
    .bind(format!("User {sub}"))
    .bind(status)
    .bind(age_minutes)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn stored_status(pool: &PgPool, id: Uuid) -> String {
    sqlx::query_scalar("select status from users where id = $1")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn audit_count(pool: &PgPool) -> i64 {
    sqlx::query_scalar("select count(*) from audit_log")
        .fetch_one(pool)
        .await
        .unwrap()
}

fn error_code(res: &TestResponse) -> &str {
    res.json["error"]["code"].as_str().unwrap_or_default()
}

async fn set_status(
    app: &TestApp,
    as_sub: &str,
    id: impl std::fmt::Display,
    body: Value,
) -> TestResponse {
    app.request(
        "POST",
        &format!("/api/admin/users/{id}/status"),
        Some(&token(as_sub)),
        Some(body),
    )
    .await
}

// spec: ADM-001
#[sqlx::test(migrations = "./migrations")]
async fn non_admin_gets_403_forbidden(pool: PgPool) {
    let app = app(&pool).await;
    let target = insert_user(&pool, "u1", "pending", 1).await;
    // Even an approved regular user is refused.
    insert_user(&pool, "u2", "approved", 1).await;
    for sub in ["u1", "u2"] {
        let res = app
            .request("GET", "/api/admin/users", Some(&token(sub)), None)
            .await;
        assert_eq!(res.status, StatusCode::FORBIDDEN, "{sub}");
        assert_eq!(error_code(&res), "forbidden");
        assert!(res.json["error"]["request_id"].as_str().is_some());

        let res = set_status(&app, sub, target, json!({"status": "approved"})).await;
        assert_eq!(res.status, StatusCode::FORBIDDEN, "{sub}");
        assert_eq!(error_code(&res), "forbidden");
    }
    assert_eq!(stored_status(&pool, target).await, "pending");
    assert_eq!(audit_count(&pool).await, 0);
}

// spec: ADM-001
#[sqlx::test(migrations = "./migrations")]
async fn anonymous_gets_401(pool: PgPool) {
    let app = app(&pool).await;
    let res = app.request("GET", "/api/admin/users", None, None).await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);
    assert_eq!(error_code(&res), "token_invalid");
}

// spec: ADM-002
#[sqlx::test(migrations = "./migrations")]
async fn admin_lists_users_filtered_with_counts(pool: PgPool) {
    let app = app(&pool).await;
    insert_user(&pool, "p-old", "pending", 30).await;
    insert_user(&pool, "p-new", "pending", 10).await;
    insert_user(&pool, "a1", "approved", 20).await;

    let res = app
        .request(
            "GET",
            "/api/admin/users?status=pending",
            Some(&token(ADMIN)),
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::OK, "{:?}", res.json);
    let users = res.json["users"].as_array().unwrap();
    let subjects: Vec<&str> = users
        .iter()
        .map(|u| u["subject"].as_str().unwrap())
        .collect();
    // Newest first.
    assert_eq!(subjects, ["p-new", "p-old"]);
    assert!(users.iter().all(|u| u["status"] == "pending"));
    // The admin was created approved by their own request: counts cover all statuses.
    assert_eq!(res.json["counts"]["pending"], 2);
    assert_eq!(res.json["counts"]["approved"], 2);
    assert_eq!(res.json["counts"]["rejected"], 0);
    assert_eq!(res.json["counts"]["suspended"], 0);

    // Without filter: everyone, including the admin.
    let res = app
        .request("GET", "/api/admin/users", Some(&token(ADMIN)), None)
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json["users"].as_array().unwrap().len(), 4);
}

// spec: ADM-002
#[sqlx::test(migrations = "./migrations")]
async fn user_view_has_the_documented_fields(pool: PgPool) {
    let app = app(&pool).await;
    let id = insert_user(&pool, "u1", "rejected", 5).await;
    insert_user(&pool, "boss2", "approved", 5).await;

    let res = app
        .request(
            "GET",
            "/api/admin/users?status=rejected",
            Some(&token(ADMIN)),
            None,
        )
        .await;
    let user = &res.json["users"][0];
    assert_eq!(user["id"], id.to_string());
    assert_eq!(user["email"], "u1@example.com");
    assert_eq!(user["display_name"], "User u1");
    assert_eq!(user["subject"], "u1");
    assert_eq!(user["status"], "rejected");
    assert_eq!(user["is_admin"], false);
    assert!(user["created_at"].as_str().is_some());
    assert!(user.get("issuer").is_none());

    // is_admin follows the configuration.
    let res = app
        .request(
            "GET",
            "/api/admin/users?status=approved",
            Some(&token(ADMIN)),
            None,
        )
        .await;
    let users = res.json["users"].as_array().unwrap();
    let flag = |sub: &str| users.iter().find(|u| u["subject"] == sub).unwrap()["is_admin"].clone();
    assert_eq!(flag("boss"), true);
    assert_eq!(flag("boss2"), true);
}

// spec: ADM-002
#[sqlx::test(migrations = "./migrations")]
async fn counts_include_every_status_even_when_zero(pool: PgPool) {
    let app = app(&pool).await;
    let res = app
        .request(
            "GET",
            "/api/admin/users?status=suspended",
            Some(&token(ADMIN)),
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json["users"], json!([]));
    assert_eq!(
        res.json["counts"],
        json!({"pending": 0, "approved": 1, "rejected": 0, "suspended": 0})
    );
}

// spec: ADM-003
// Needs the `/api/test/approved-check` probe, mounted only with `test-support`.
#[cfg(feature = "test-support")]
#[sqlx::test(migrations = "./migrations")]
async fn admin_approves_pending_user(pool: PgPool) {
    let app = app(&pool).await;
    let id = insert_user(&pool, "u1", "pending", 1).await;
    // Before: the user is blocked from approved-only routes.
    let before = app
        .request("GET", "/api/test/approved-check", Some(&token("u1")), None)
        .await;
    assert_eq!(error_code(&before), "account_pending");

    let res = set_status(&app, ADMIN, id, json!({"status": "approved"})).await;
    assert_eq!(res.status, StatusCode::OK, "{:?}", res.json);
    assert_eq!(res.json["id"], id.to_string());
    assert_eq!(res.json["status"], "approved");
    assert_eq!(res.json["subject"], "u1");
    assert_eq!(stored_status(&pool, id).await, "approved");

    let after = app
        .request("GET", "/api/test/approved-check", Some(&token("u1")), None)
        .await;
    assert_eq!(after.status, StatusCode::NO_CONTENT);
}

// spec: ADM-003
#[sqlx::test(migrations = "./migrations")]
async fn every_allowed_transition_succeeds(pool: PgPool) {
    let app = app(&pool).await;
    for (from, to) in [
        ("pending", "approved"),
        ("pending", "rejected"),
        ("rejected", "approved"),
        ("approved", "suspended"),
        ("suspended", "approved"),
    ] {
        let id = insert_user(&pool, &format!("{from}-{to}"), from, 1).await;
        let res = set_status(&app, ADMIN, id, json!({"status": to})).await;
        assert_eq!(res.status, StatusCode::OK, "{from} -> {to}: {:?}", res.json);
        assert_eq!(stored_status(&pool, id).await, to);
    }
}

// spec: ADM-003
#[sqlx::test(migrations = "./migrations")]
async fn forbidden_transition_is_409(pool: PgPool) {
    let app = app(&pool).await;
    let id = insert_user(&pool, "u1", "pending", 1).await;
    let res = set_status(&app, ADMIN, id, json!({"status": "suspended"})).await;
    assert_eq!(res.status, StatusCode::CONFLICT);
    assert_eq!(error_code(&res), "invalid_transition");
    assert!(res.json["error"]["request_id"].as_str().is_some());
    assert_eq!(stored_status(&pool, id).await, "pending");
    assert_eq!(audit_count(&pool).await, 0);
}

// spec: ADM-003
#[sqlx::test(migrations = "./migrations")]
async fn same_status_is_not_a_transition(pool: PgPool) {
    let app = app(&pool).await;
    let id = insert_user(&pool, "u1", "approved", 1).await;
    let res = set_status(&app, ADMIN, id, json!({"status": "approved"})).await;
    assert_eq!(res.status, StatusCode::CONFLICT);
    assert_eq!(error_code(&res), "invalid_transition");
    assert_eq!(audit_count(&pool).await, 0);
}

// spec: ADM-003
#[sqlx::test(migrations = "./migrations")]
async fn unknown_user_is_404(pool: PgPool) {
    let app = app(&pool).await;
    let res = set_status(&app, ADMIN, Uuid::now_v7(), json!({"status": "approved"})).await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&res), "not_found");
    assert_eq!(audit_count(&pool).await, 0);
}

// spec: ADM-004
#[sqlx::test(migrations = "./migrations")]
async fn admin_cannot_moderate_an_admin(pool: PgPool) {
    let app = app(&pool).await;
    let other = insert_user(&pool, "boss2", "approved", 1).await;
    let res = set_status(&app, ADMIN, other, json!({"status": "suspended"})).await;
    assert_eq!(res.status, StatusCode::FORBIDDEN);
    assert_eq!(error_code(&res), "cannot_moderate_admin");
    assert_eq!(stored_status(&pool, other).await, "approved");
    assert_eq!(audit_count(&pool).await, 0);
}

// spec: ADM-004
#[sqlx::test(migrations = "./migrations")]
async fn admin_cannot_moderate_themself(pool: PgPool) {
    let app = app(&pool).await;
    // Create the admin's own row through a first request.
    let me = app
        .request("GET", "/api/me", Some(&token(ADMIN)), None)
        .await;
    let id = me.json["id"].as_str().unwrap().to_string();
    let res = set_status(&app, ADMIN, &id, json!({"status": "suspended"})).await;
    assert_eq!(res.status, StatusCode::FORBIDDEN);
    assert_eq!(error_code(&res), "cannot_moderate_admin");
    let stored: String = sqlx::query_scalar("select status from users where id = $1::uuid")
        .bind(&id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(stored, "approved");
}

// spec: ADM-004
#[sqlx::test(migrations = "./migrations")]
async fn admin_check_comes_before_transition_check(pool: PgPool) {
    let app = app(&pool).await;
    // approved -> approved would be a 409, but the target is an admin: 403 wins.
    let other = insert_user(&pool, "boss2", "approved", 1).await;
    let res = set_status(&app, ADMIN, other, json!({"status": "approved"})).await;
    assert_eq!(res.status, StatusCode::FORBIDDEN);
    assert_eq!(error_code(&res), "cannot_moderate_admin");
}

// spec: ADM-005
#[sqlx::test(migrations = "./migrations")]
async fn status_change_writes_audit_entry(pool: PgPool) {
    let app = app(&pool).await;
    let id = insert_user(&pool, "u1", "pending", 1).await;
    let res = set_status(&app, ADMIN, id, json!({"status": "approved"})).await;
    assert_eq!(res.status, StatusCode::OK);

    let rows: Vec<(Uuid, String, String, Uuid, Value)> = sqlx::query_as(
        "select actor_user_id, action, target_type, target_id, metadata from audit_log",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 1);
    let admin_id: Uuid = sqlx::query_scalar("select id from users where subject = $1")
        .bind(ADMIN)
        .fetch_one(&pool)
        .await
        .unwrap();
    let (actor, action, target_type, target_id, metadata) = &rows[0];
    assert_eq!(*actor, admin_id);
    assert_eq!(action, "user.status_changed");
    assert_eq!(target_type, "user");
    assert_eq!(*target_id, id);
    assert_eq!(metadata, &json!({"from": "pending", "to": "approved"}));
}

// spec: ADM-005
#[sqlx::test(migrations = "./migrations")]
async fn failed_change_writes_no_audit_entry(pool: PgPool) {
    let app = app(&pool).await;
    let pending = insert_user(&pool, "u1", "pending", 1).await;
    let admin2 = insert_user(&pool, "boss2", "approved", 1).await;
    for (id, body) in [
        (pending, json!({"status": "suspended"})),
        (pending, json!({"status": "pending"})),
        (admin2, json!({"status": "suspended"})),
        (Uuid::now_v7(), json!({"status": "approved"})),
    ] {
        let res = set_status(&app, ADMIN, id, body).await;
        assert!(res.status.is_client_error(), "{:?}", res.json);
    }
    assert_eq!(audit_count(&pool).await, 0);
}

// spec: ADM-005
#[sqlx::test(migrations = "./migrations")]
async fn audit_failure_rolls_back_the_status_change(pool: PgPool) {
    let app = app(&pool).await;
    let id = insert_user(&pool, "u1", "pending", 1).await;
    // Make the audit insert fail, whatever the data.
    sqlx::query("alter table audit_log add constraint audit_always_fails check (false) not valid")
        .execute(&pool)
        .await
        .unwrap();
    let res = set_status(&app, ADMIN, id, json!({"status": "approved"})).await;
    assert_eq!(res.status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(error_code(&res), "internal_error");
    assert_eq!(stored_status(&pool, id).await, "pending");
    assert_eq!(audit_count(&pool).await, 0);
}

// spec: ADM-003, ADM-005
#[sqlx::test(migrations = "./migrations")]
async fn concurrent_identical_changes_apply_once(pool: PgPool) {
    let app = app(&pool).await;
    let id = insert_user(&pool, "u1", "pending", 1).await;
    // Create the admin row up front so both requests race on the target only.
    app.request("GET", "/api/me", Some(&token(ADMIN)), None)
        .await;
    let responses = futures_util::future::join_all(
        (0..6).map(|_| set_status(&app, ADMIN, id, json!({"status": "approved"}))),
    )
    .await;
    let ok = responses
        .iter()
        .filter(|r| r.status == StatusCode::OK)
        .count();
    let conflict = responses
        .iter()
        .filter(|r| r.status == StatusCode::CONFLICT)
        .count();
    assert_eq!(
        (ok, conflict),
        (1, 5),
        "{:?}",
        responses.iter().map(|r| r.status).collect::<Vec<_>>()
    );
    assert_eq!(audit_count(&pool).await, 1);
    assert_eq!(stored_status(&pool, id).await, "approved");
}

// Malformed input yields the global JSON error shape (Ruling R8).

#[sqlx::test(migrations = "./migrations")]
async fn malformed_json_body_is_400_invalid_request(pool: PgPool) {
    let app = app(&pool).await;
    let id = insert_user(&pool, "u1", "pending", 1).await;
    let res = app
        .request_with_raw_body(
            "POST",
            &format!("/api/admin/users/{id}/status"),
            Some(&token(ADMIN)),
            "{not json",
        )
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(error_code(&res), "invalid_request");
    assert!(
        res.json["error"]["request_id"]
            .as_str()
            .is_some_and(|s| !s.is_empty())
    );
    assert_eq!(stored_status(&pool, id).await, "pending");
}

#[sqlx::test(migrations = "./migrations")]
async fn unknown_status_value_in_body_is_400_invalid_request(pool: PgPool) {
    let app = app(&pool).await;
    let id = insert_user(&pool, "u1", "pending", 1).await;
    for body in [
        json!({"status": "banned"}),
        json!({}),
        json!({"status": null}),
    ] {
        let res = set_status(&app, ADMIN, id, body).await;
        assert_eq!(res.status, StatusCode::BAD_REQUEST);
        assert_eq!(error_code(&res), "invalid_request");
        // No serde detail leaks.
        assert!(
            !res.json["error"]["message"]
                .as_str()
                .unwrap()
                .contains("banned")
        );
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn non_uuid_path_id_is_400_invalid_request(pool: PgPool) {
    let app = app(&pool).await;
    let res = set_status(&app, ADMIN, "not-a-uuid", json!({"status": "approved"})).await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(error_code(&res), "invalid_request");
    assert!(
        res.json["error"]["request_id"]
            .as_str()
            .is_some_and(|s| !s.is_empty())
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn unknown_status_filter_is_400_invalid_request(pool: PgPool) {
    let app = app(&pool).await;
    let res = app
        .request(
            "GET",
            "/api/admin/users?status=foo",
            Some(&token(ADMIN)),
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(error_code(&res), "invalid_request");
    assert!(
        res.json["error"]["request_id"]
            .as_str()
            .is_some_and(|s| !s.is_empty())
    );
}
