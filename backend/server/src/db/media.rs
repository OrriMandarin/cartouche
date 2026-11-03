//! The `media` table: uploaded images and videos with the variants stored for each. Every
//! function is scoped to the card owner through the `cards` table.

use cartouche_domain::{MediaKind, Slot, VariantFormat};
use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, PgExecutor, PgPool};
use uuid::Uuid;

/// One stored file of a media: `name` is the last segment of its storage key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredVariant {
    pub name: String,
    pub width: u32,
    pub format: VariantFormat,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaRecord {
    pub id: Uuid,
    pub card_id: Uuid,
    pub slot: Slot,
    pub kind: MediaKind,
    pub variants: Vec<StoredVariant>,
}

impl MediaRecord {
    /// The smallest JPEG file of a profile photo (what the vCard embeds).
    pub fn smallest_jpeg(&self) -> Option<&StoredVariant> {
        self.variants
            .iter()
            .filter(|v| v.format == VariantFormat::Jpeg)
            .min_by_key(|v| v.width)
    }
}

/// A `media` row as the database returns it.
struct MediaRow {
    id: Uuid,
    card_id: Uuid,
    slot: String,
    kind: String,
    variants: serde_json::Value,
}

fn decode_error(
    column: &str,
    source: impl std::error::Error + Send + Sync + 'static,
) -> sqlx::Error {
    sqlx::Error::ColumnDecode {
        index: column.into(),
        source: Box::new(source),
    }
}

impl TryFrom<MediaRow> for MediaRecord {
    type Error = sqlx::Error;

    fn try_from(row: MediaRow) -> Result<Self, sqlx::Error> {
        Ok(MediaRecord {
            id: row.id,
            card_id: row.card_id,
            slot: row.slot.parse().map_err(|e| decode_error("slot", e))?,
            kind: row.kind.parse().map_err(|e| decode_error("kind", e))?,
            variants: serde_json::from_value(row.variants)
                .map_err(|e| decode_error("variants", e))?,
        })
    }
}

fn variants_json(variants: &[StoredVariant]) -> Result<serde_json::Value, sqlx::Error> {
    serde_json::to_value(variants).map_err(|e| sqlx::Error::Encode(Box::new(e)))
}

/// Records a media on `media.card_id`, only when that card belongs to `owner_id`: `None`
/// (and no row) otherwise.
pub async fn insert(
    tx: &mut PgConnection,
    owner_id: Uuid,
    media: MediaRecord,
) -> Result<Option<MediaRecord>, sqlx::Error> {
    sqlx::query_as!(
        MediaRow,
        "insert into media (id, card_id, slot, kind, variants) \
         select $1, c.id, $3, $4, $5 from cards c where c.id = $2 and c.owner_id = $6 \
         returning id, card_id, slot, kind, variants",
        media.id,
        media.card_id,
        media.slot.as_str(),
        media.kind.as_str(),
        variants_json(&media.variants)?,
        owner_id,
    )
    .fetch_optional(tx)
    .await?
    .map(MediaRecord::try_from)
    .transpose()
}

pub async fn find_for_owner(
    pool: &PgPool,
    owner_id: Uuid,
    media_id: Uuid,
) -> Result<Option<MediaRecord>, sqlx::Error> {
    sqlx::query_as!(
        MediaRow,
        "select m.id, m.card_id, m.slot, m.kind, m.variants \
         from media m join cards c on c.id = m.card_id \
         where m.id = $1 and c.owner_id = $2",
        media_id,
        owner_id,
    )
    .fetch_optional(pool)
    .await?
    .map(MediaRecord::try_from)
    .transpose()
}

pub async fn list_for_card(
    db: impl PgExecutor<'_>,
    owner_id: Uuid,
    card_id: Uuid,
) -> Result<Vec<MediaRecord>, sqlx::Error> {
    sqlx::query_as!(
        MediaRow,
        "select m.id, m.card_id, m.slot, m.kind, m.variants \
         from media m join cards c on c.id = m.card_id \
         where c.id = $1 and c.owner_id = $2 \
         order by m.created_at, m.id",
        card_id,
        owner_id,
    )
    .fetch_all(db)
    .await?
    .into_iter()
    .map(MediaRecord::try_from)
    .collect()
}

/// The media currently shown on the owner's cards `card_ids`: their header and avatar.
pub async fn list_attached(
    db: impl PgExecutor<'_>,
    owner_id: Uuid,
    card_ids: &[Uuid],
) -> Result<Vec<MediaRecord>, sqlx::Error> {
    sqlx::query_as!(
        MediaRow,
        "select m.id, m.card_id, m.slot, m.kind, m.variants \
         from media m join cards c on c.id = m.card_id \
         where c.owner_id = $1 and c.id = any($2) \
           and (c.header_media_id = m.id or c.avatar_media_id = m.id)",
        owner_id,
        card_ids,
    )
    .fetch_all(db)
    .await?
    .into_iter()
    .map(MediaRecord::try_from)
    .collect()
}

/// Deletes the card's media that are neither its header nor its avatar, and returns them
/// so the caller can remove their files (MED-018).
pub async fn delete_unreferenced(
    tx: &mut PgConnection,
    owner_id: Uuid,
    card_id: Uuid,
) -> Result<Vec<MediaRecord>, sqlx::Error> {
    sqlx::query_as!(
        MediaRow,
        "delete from media m using cards c \
         where m.card_id = c.id and c.id = $1 and c.owner_id = $2 \
           and c.header_media_id is distinct from m.id \
           and c.avatar_media_id is distinct from m.id \
         returning m.id, m.card_id, m.slot, m.kind, m.variants",
        card_id,
        owner_id,
    )
    .fetch_all(tx)
    .await?
    .into_iter()
    .map(MediaRecord::try_from)
    .collect()
}
