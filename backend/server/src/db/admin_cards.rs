//! Cards as support sees them: any user's, without an owner filter. This is the documented
//! exception to the owner rule; it is called only from the `/api/admin/*` routes.

use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use super::cards::{Card, CardRow};

/// The cards of `user_id` (or only `card_id` when given), oldest first, each with its
/// current slug.
async fn select_cards(
    conn: &mut PgConnection,
    user_id: Option<Uuid>,
    card_id: Option<Uuid>,
) -> Result<Vec<Card>, sqlx::Error> {
    sqlx::query_as!(
        CardRow,
        "select c.id, c.owner_id, s.slug, c.template, c.settings, c.theme, \
                c.first_name, c.last_name, c.job_title, c.company, c.description, c.email, c.phone, \
                c.links, c.header_media_id, c.avatar_media_id, \
                c.owner_disabled_at, c.support_disabled_at, c.created_at, c.updated_at \
         from cards c join card_slugs s on s.card_id = c.id and s.is_current \
         where ($1::uuid is null or c.owner_id = $1) and ($2::uuid is null or c.id = $2) \
         order by c.created_at, c.id",
        user_id,
        card_id,
    )
    .fetch_all(conn)
    .await?
    .into_iter()
    .map(Card::try_from)
    .collect()
}

/// All the cards of a user, oldest first, whatever their state.
pub async fn list_for_user(pool: &PgPool, user_id: Uuid) -> Result<Vec<Card>, sqlx::Error> {
    select_cards(&mut *pool.acquire().await?, Some(user_id), None).await
}

pub async fn find(pool: &PgPool, card_id: Uuid) -> Result<Option<Card>, sqlx::Error> {
    let mut found = select_cards(&mut *pool.acquire().await?, None, Some(card_id)).await?;
    Ok(found.pop())
}

/// Loads a card and locks its row until the end of the transaction, so concurrent support
/// actions on the same card validate against fresh state.
pub async fn find_for_update(
    tx: &mut PgConnection,
    card_id: Uuid,
) -> Result<Option<Card>, sqlx::Error> {
    let locked = sqlx::query!("select id from cards where id = $1 for update", card_id)
        .fetch_optional(&mut *tx)
        .await?;
    if locked.is_none() {
        return Ok(None);
    }
    Ok(select_cards(tx, None, Some(card_id)).await?.pop())
}

/// Sets (`Some(at)`) or clears (`None`) support's block. The owner's own switch is left
/// alone (LNK-028). The caller holds the row lock (`find_for_update`).
pub async fn set_support_disabled(
    tx: &mut PgConnection,
    card_id: Uuid,
    at: Option<DateTime<Utc>>,
) -> Result<Card, sqlx::Error> {
    sqlx::query!(
        "update cards set support_disabled_at = $2, updated_at = now() where id = $1",
        card_id,
        at,
    )
    .execute(&mut *tx)
    .await?;
    select_cards(tx, None, Some(card_id))
        .await?
        .pop()
        .ok_or(sqlx::Error::RowNotFound)
}
