//! The `media` table: uploaded images and videos with the variants stored for each, their
//! source and their framing. Every function is scoped to the card owner through the `cards`
//! table.

use cartouche_domain::{Framing, MediaKind, Slot, VariantFormat, is_video_source_name};
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

/// The source of a media (MED-025): `name` (`source-<token>.webp`, MED-031) is the last
/// segment of its storage key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceFile {
    pub name: String,
    pub width: u32,
    pub height: u32,
}

/// A media. `source`, `framing` and `duration_ms` are `None` for a media uploaded before plan 6
/// (MED-033); `duration_ms` is only set for a video.
#[derive(Debug, Clone, PartialEq)]
pub struct MediaRecord {
    pub id: Uuid,
    pub card_id: Uuid,
    pub slot: Slot,
    pub kind: MediaKind,
    pub variants: Vec<StoredVariant>,
    pub source: Option<SourceFile>,
    pub framing: Option<Framing>,
    pub duration_ms: Option<u32>,
}

impl MediaRecord {
    /// `true` for a video that has an edit copy and so a private original (MED-030, MED-036);
    /// a video uploaded before plan 7 has a still-image source and neither.
    pub fn has_video_original(&self) -> bool {
        self.kind == MediaKind::Video
            && self
                .source
                .as_ref()
                .is_some_and(|file| is_video_source_name(&file.name))
    }

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
    source: Option<serde_json::Value>,
    framing: Option<serde_json::Value>,
    duration_ms: Option<i32>,
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
            source: row
                .source
                .map(serde_json::from_value)
                .transpose()
                .map_err(|e| decode_error("source", e))?,
            framing: row
                .framing
                .map(serde_json::from_value)
                .transpose()
                .map_err(|e| decode_error("framing", e))?,
            duration_ms: row
                .duration_ms
                .map(u32::try_from)
                .transpose()
                .map_err(|e| decode_error("duration_ms", e))?,
        })
    }
}

fn to_json(value: &impl Serialize) -> Result<serde_json::Value, sqlx::Error> {
    serde_json::to_value(value).map_err(|e| sqlx::Error::Encode(Box::new(e)))
}

fn optional_json(value: Option<&impl Serialize>) -> Result<Option<serde_json::Value>, sqlx::Error> {
    value.map(to_json).transpose()
}

/// Records a media on `media.card_id`, only when that card belongs to `owner_id`: `None`
/// (and no row) otherwise.
pub async fn insert(
    tx: &mut PgConnection,
    owner_id: Uuid,
    media: MediaRecord,
) -> Result<Option<MediaRecord>, sqlx::Error> {
    let duration_ms = media
        .duration_ms
        .map(i32::try_from)
        .transpose()
        .map_err(|e| sqlx::Error::Encode(Box::new(e)))?;
    sqlx::query_as!(
        MediaRow,
        "insert into media (id, card_id, slot, kind, variants, source, framing, duration_ms) \
         select $1, c.id, $3, $4, $5, $7, $8, $9 from cards c \
         where c.id = $2 and c.owner_id = $6 \
         returning id, card_id, slot, kind, variants, source, framing, duration_ms",
        media.id,
        media.card_id,
        media.slot.as_str(),
        media.kind.as_str(),
        to_json(&media.variants)?,
        owner_id,
        optional_json(media.source.as_ref())?,
        optional_json(media.framing.as_ref())?,
        duration_ms,
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
        "select m.id, m.card_id, m.slot, m.kind, m.variants, m.source, m.framing, m.duration_ms \
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
        "select m.id, m.card_id, m.slot, m.kind, m.variants, m.source, m.framing, m.duration_ms \
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
        "select m.id, m.card_id, m.slot, m.kind, m.variants, m.source, m.framing, m.duration_ms \
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
         returning m.id, m.card_id, m.slot, m.kind, m.variants, m.source, m.framing, \
         m.duration_ms",
        card_id,
        owner_id,
    )
    .fetch_all(tx)
    .await?
    .into_iter()
    .map(MediaRecord::try_from)
    .collect()
}
