//! The `users` table. Accounts are keyed by (issuer, subject); the status is never cached.

use cartouche_domain::UserStatus;
use chrono::{DateTime, Utc};
use sqlx::postgres::PgRow;
use sqlx::{FromRow, PgPool, Row};
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
