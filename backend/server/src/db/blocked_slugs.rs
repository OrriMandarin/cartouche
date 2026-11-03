//! The `blocked_slugs` table: the SHA-256 hash of every slug of a deleted account, so that
//! nobody can take it again (LNK-015, LNK-031).
//!
//! Like `slugs.rs`, this table is global and holds no owner by design: a hash cannot lead back
//! to a person. `block_all_of_owner` takes the owner of the slugs to block; `is_blocked` is
//! asked about any slug, by anyone.

use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

/// Blocks every slug of the owner (current, former and reserved) and returns how many were
/// newly blocked. Meant to run in the transaction that deletes the account.
pub async fn block_all_of_owner(tx: &mut PgConnection, owner_id: Uuid) -> Result<u64, sqlx::Error> {
    let blocked = sqlx::query!(
        "insert into blocked_slugs (slug_hash) \
         select sha256(convert_to(slug, 'UTF8')) from card_slugs where owner_id = $1 \
         on conflict do nothing",
        owner_id,
    )
    .execute(tx)
    .await?;
    Ok(blocked.rows_affected())
}

/// Whether `slug` (as stored: lowercase) is blocked.
pub async fn is_blocked(conn: impl PgExecutor<'_>, slug: &str) -> Result<bool, sqlx::Error> {
    let blocked = sqlx::query_scalar!(
        r#"select exists (
               select 1 from blocked_slugs where slug_hash = sha256(convert_to($1, 'UTF8'))
           ) as "blocked!""#,
        slug,
    )
    .fetch_one(conn)
    .await?;
    Ok(blocked)
}
