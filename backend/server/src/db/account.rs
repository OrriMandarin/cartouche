//! Account deletion queries (ACC-018, ACC-022, ACC-024). Unlike the other `db/` files they work
//! on the caller's own user ID, which is the owner: nobody else's data is reachable.

use sqlx::PgConnection;
use uuid::Uuid;

/// Every card of the user, whatever its state.
pub async fn card_ids(tx: &mut PgConnection, user_id: Uuid) -> Result<Vec<Uuid>, sqlx::Error> {
    sqlx::query_scalar!("select id from cards where owner_id = $1", user_id)
        .fetch_all(tx)
        .await
}

/// Removes the slug from the metadata of every audit entry about the user's cards, so the log
/// keeps no link to a deleted card's address (ACC-024). Returns the number of entries changed.
pub async fn strip_slugs_from_audit(
    tx: &mut PgConnection,
    user_id: Uuid,
) -> Result<u64, sqlx::Error> {
    let updated = sqlx::query!(
        "update audit_log set metadata = metadata - 'slug' where metadata->>'owner_id' = $1::text",
        user_id.to_string(),
    )
    .execute(tx)
    .await?;
    Ok(updated.rows_affected())
}

/// Deletes the user; the database cascades to their cards, slugs, media rows, events and leads.
/// Returns whether the user existed.
pub async fn delete_user(tx: &mut PgConnection, user_id: Uuid) -> Result<bool, sqlx::Error> {
    let deleted = sqlx::query!("delete from users where id = $1", user_id)
        .execute(tx)
        .await?;
    Ok(deleted.rows_affected() == 1)
}
