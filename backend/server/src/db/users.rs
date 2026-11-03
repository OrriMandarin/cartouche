//! The `users` table. Accounts are keyed by (issuer, subject); the status is never cached.

use std::collections::HashMap;

use cartouche_domain::UserStatus;
use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgPool};
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

/// A `users` row as the database returns it; `status` is parsed into `User`.
struct UserRow {
    id: Uuid,
    issuer: String,
    subject: String,
    email: Option<String>,
    display_name: Option<String>,
    status: String,
    created_at: DateTime<Utc>,
}

impl TryFrom<UserRow> for User {
    type Error = sqlx::Error;

    fn try_from(row: UserRow) -> Result<Self, sqlx::Error> {
        Ok(User {
            id: row.id,
            issuer: row.issuer,
            subject: row.subject,
            email: row.email,
            display_name: row.display_name,
            status: parse_status(&row.status)?,
            created_at: row.created_at,
        })
    }
}

pub(crate) fn parse_status(status: &str) -> Result<UserStatus, sqlx::Error> {
    status.parse().map_err(|e| sqlx::Error::ColumnDecode {
        index: "status".into(),
        source: Box::new(e),
    })
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
    sqlx::query_as!(
        UserRow,
        "insert into users (issuer, subject, email, display_name, status) \
         values ($1, $2, $3, $4, $5) \
         on conflict (issuer, subject) do update set \
             email = coalesce(excluded.email, users.email), \
             display_name = coalesce(excluded.display_name, users.display_name), \
             updated_at = now() \
         returning id, issuer, subject, email, display_name, status, created_at",
        claims.issuer,
        claims.subject,
        claims.email,
        claims.name,
        status_if_new.as_str(),
    )
    .fetch_one(pool)
    .await?
    .try_into()
}

pub async fn exists(pool: &PgPool, issuer: &str, subject: &str) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar!(
        r#"select exists (select 1 from users where issuer = $1 and subject = $2) as "exists!""#,
        issuer,
        subject,
    )
    .fetch_one(pool)
    .await
}

pub async fn find_by_id(pool: &PgPool, id: Uuid) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as!(UserRow, "select id, issuer, subject, email, display_name, status, created_at from users where id = $1", id)
        .fetch_optional(pool)
        .await?
        .map(User::try_from)
        .transpose()
}

/// Sets the status to `approved` (administrators are always approved, ACC-003).
pub async fn approve(pool: &PgPool, id: Uuid) -> Result<User, sqlx::Error> {
    sqlx::query_as!(
        UserRow,
        "update users set status = 'approved', updated_at = now() where id = $1 \
         returning id, issuer, subject, email, display_name, status, created_at",
        id,
    )
    .fetch_one(pool)
    .await?
    .try_into()
}

/// All users, newest first, optionally restricted to one status.
pub async fn list_by_status(
    pool: &PgPool,
    status: Option<UserStatus>,
) -> Result<Vec<User>, sqlx::Error> {
    sqlx::query_as!(
        UserRow,
        "select id, issuer, subject, email, display_name, status, created_at from users \
         where ($1::text is null or status = $1) \
         order by created_at desc, id desc",
        status.map(UserStatus::as_str),
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(User::try_from)
    .collect()
}

/// Number of users per status. Statuses without any user are absent from the map.
pub async fn count_by_status(pool: &PgPool) -> Result<HashMap<UserStatus, i64>, sqlx::Error> {
    sqlx::query!(r#"select status, count(*) as "count!" from users group by status"#)
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|row| Ok((parse_status(&row.status)?, row.count)))
        .collect()
}

/// Loads a user and locks the row until the end of the transaction, so concurrent status
/// changes on the same user are serialized and each one validates against fresh state.
pub async fn find_for_update(tx: &mut PgConnection, id: Uuid) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as!(UserRow, "select id, issuer, subject, email, display_name, status, created_at from users where id = $1 for update", id)
        .fetch_optional(tx)
        .await?
        .map(User::try_from)
        .transpose()
}

/// Sets the status of a user. The caller validates the transition (`check_transition`)
/// and holds the row lock (`find_for_update`).
pub async fn set_status(
    tx: &mut PgConnection,
    id: Uuid,
    status: UserStatus,
) -> Result<User, sqlx::Error> {
    sqlx::query_as!(
        UserRow,
        "update users set status = $2, updated_at = now() where id = $1 \
         returning id, issuer, subject, email, display_name, status, created_at",
        id,
        status.as_str(),
    )
    .fetch_one(tx)
    .await?
    .try_into()
}
