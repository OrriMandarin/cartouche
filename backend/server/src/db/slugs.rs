//! The `card_slugs` table: every slug ever used, unique across the instance. A slug stays
//! reserved to its owner after its card is deleted (LNK-013, LNK-014).
//!
//! Reads by slug are the one place besides public cards where rows are found without an
//! owner: slug uniqueness is global, and they expose only `owner_id`, `card_id` and
//! `is_current`.

use cartouche_domain::{Slug, SlugClaim, SlugRecord};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

struct SlugRow {
    owner_id: Uuid,
    card_id: Option<Uuid>,
    is_current: bool,
}

impl From<SlugRow> for SlugRecord {
    fn from(row: SlugRow) -> SlugRecord {
        SlugRecord {
            owner_id: row.owner_id,
            card_id: row.card_id,
            is_current: row.is_current,
        }
    }
}

/// Reads a slug and locks its row until the end of the transaction. A slug nobody holds
/// has no row to lock: the primary key then settles a race (see [`is_unique_violation`]).
pub async fn find_for_update(
    tx: &mut PgConnection,
    slug: &str,
) -> Result<Option<SlugRecord>, sqlx::Error> {
    let row = sqlx::query_as!(
        SlugRow,
        "select owner_id, card_id, is_current from card_slugs where slug = $1 for update",
        slug,
    )
    .fetch_optional(tx)
    .await?;
    Ok(row.map(SlugRecord::from))
}

pub async fn find(pool: &PgPool, slug: &str) -> Result<Option<SlugRecord>, sqlx::Error> {
    let row = sqlx::query_as!(
        SlugRow,
        "select owner_id, card_id, is_current from card_slugs where slug = $1",
        slug,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(SlugRecord::from))
}

/// Carries out a claim decided by `decide_claim`: the card's current slug, if any, stops
/// being current, then the slug is inserted (`New`) or attached to the card
/// (`ReclaimOwn`, `AttachReserved`). `AlreadyCurrent` changes nothing.
pub async fn apply_claim(
    tx: &mut PgConnection,
    owner_id: Uuid,
    card_id: Uuid,
    slug: &Slug,
    claim: SlugClaim,
) -> Result<(), sqlx::Error> {
    if claim == SlugClaim::AlreadyCurrent {
        return Ok(());
    }
    sqlx::query!(
        "update card_slugs set is_current = false \
         where card_id = $1 and owner_id = $2 and is_current",
        card_id,
        owner_id,
    )
    .execute(&mut *tx)
    .await?;
    match claim {
        SlugClaim::New => {
            sqlx::query!(
                "insert into card_slugs (slug, owner_id, card_id, is_current) \
                 values ($1, $2, $3, true)",
                slug.as_str(),
                owner_id,
                card_id,
            )
            .execute(tx)
            .await?;
        }
        SlugClaim::ReclaimOwn | SlugClaim::AttachReserved => {
            let attached = sqlx::query!(
                "update card_slugs set card_id = $1, is_current = true \
                 where slug = $2 and owner_id = $3",
                card_id,
                slug.as_str(),
                owner_id,
            )
            .execute(tx)
            .await?;
            if attached.rows_affected() != 1 {
                return Err(sqlx::Error::RowNotFound);
            }
        }
        SlugClaim::AlreadyCurrent => unreachable!("returned above"),
    }
    Ok(())
}

/// Whether the error is a unique-constraint violation: two requests inserted the same new
/// slug at once and this one lost (LNK-022).
pub fn is_unique_violation(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .is_some_and(|e| e.is_unique_violation())
}
