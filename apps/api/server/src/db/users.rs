//! The `users` table. Accounts are keyed by (issuer, subject); the status is never cached.

use std::collections::HashMap;

use cartouche_domain::UserStatus;
use chrono::{DateTime, Utc};
use sqlx::postgres::PgRow;
use sqlx::{FromRow, PgConnection, PgPool, Row};
use uuid::Uuid;

use crate::auth::VerifiedClaims;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct User {
    pub id: Uuid,
    pub issuer: String,
    pub subject: String,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub status: UserStatus,
    pub created_at: DateTime<Utc>,
}

impl FromRow<'_, PgRow> for User {
    fn from_row(row: &PgRow) -> Result<Self, sqlx::Error> {
        let status: String = row.try_get("status")?;
        Ok(User {
            id: row.try_get("id")?,
            issuer: row.try_get("issuer")?,
            subject: row.try_get("subject")?,
            email: row.try_get("email")?,
            display_name: row.try_get("display_name")?,
            status: status.parse().map_err(|e| sqlx::Error::ColumnDecode {
                index: "status".into(),
                source: Box::new(e),
            })?,
            created_at: row.try_get("created_at")?,
        })
    }
}

/// Creates the account on first sight, otherwise refreshes email and display name from the
/// claims (an absent claim keeps the stored value). One atomic statement, so concurrent
/// first requests of a new user yield exactly one row. The status of an existing account is
/// never modified here; `status_if_new` only applies to the insert.
///
/// `claims` must already be normalized (NFC, trimmed, empty as `None`).
pub async fn upsert_on_login(
    pool: &PgPool,
    claims: &VerifiedClaims,
    status_if_new: UserStatus,
) -> Result<User, sqlx::Error> {
    sqlx::query_as(
        "insert into users (issuer, subject, email, display_name, status) \
         values ($1, $2, $3, $4, $5) \
         on conflict (issuer, subject) do update set \
             email = coalesce(excluded.email, users.email), \
             display_name = coalesce(excluded.display_name, users.display_name), \
             updated_at = now() \
         returning *",
    )
    .bind(&claims.issuer)
    .bind(&claims.subject)
    .bind(&claims.email)
    .bind(&claims.name)
    .bind(status_if_new.as_str())
    .fetch_one(pool)
    .await
}

pub async fn exists(pool: &PgPool, issuer: &str, subject: &str) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("select exists (select 1 from users where issuer = $1 and subject = $2)")
        .bind(issuer)
        .bind(subject)
        .fetch_one(pool)
        .await
}

pub async fn find_by_id(pool: &PgPool, id: Uuid) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as("select * from users where id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

/// Sets the status to `approved` (administrators are always approved, ACC-003).
pub async fn approve(pool: &PgPool, id: Uuid) -> Result<User, sqlx::Error> {
    sqlx::query_as(
        "update users set status = 'approved', updated_at = now() where id = $1 returning *",
    )
    .bind(id)
    .fetch_one(pool)
    .await
}

/// All users, newest first, optionally restricted to one status.
pub async fn list_by_status(
    pool: &PgPool,
    status: Option<UserStatus>,
) -> Result<Vec<User>, sqlx::Error> {
    sqlx::query_as(
        "select * from users where ($1::text is null or status = $1) \
         order by created_at desc, id desc",
    )
    .bind(status.map(UserStatus::as_str))
    .fetch_all(pool)
    .await
}

/// Number of users per status. Statuses without any user are absent from the map.
pub async fn count_by_status(pool: &PgPool) -> Result<HashMap<UserStatus, i64>, sqlx::Error> {
    let rows: Vec<(String, i64)> =
        sqlx::query_as("select status, count(*) from users group by status")
            .fetch_all(pool)
            .await?;
    rows.into_iter()
        .map(|(status, count)| {
            let status = status.parse().map_err(|e| sqlx::Error::ColumnDecode {
                index: "status".into(),
                source: Box::new(e),
            })?;
            Ok((status, count))
        })
        .collect()
}

/// Loads a user and locks the row until the end of the transaction, so concurrent status
/// changes on the same user are serialized and each one validates against fresh state.
pub async fn find_for_update(tx: &mut PgConnection, id: Uuid) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as("select * from users where id = $1 for update")
        .bind(id)
        .fetch_optional(tx)
        .await
}

/// Sets the status of a user. The caller validates the transition (`check_transition`)
/// and holds the row lock (`find_for_update`).
pub async fn set_status(
    tx: &mut PgConnection,
    id: Uuid,
    status: UserStatus,
) -> Result<User, sqlx::Error> {
    sqlx::query_as("update users set status = $2, updated_at = now() where id = $1 returning *")
        .bind(id)
        .bind(status.as_str())
        .fetch_one(tx)
        .await
}
