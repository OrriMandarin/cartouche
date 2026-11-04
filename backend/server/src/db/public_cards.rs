//! Reading a card by its slug for the public page and the vCard, and whether a card is served
//! for its public media files. This is the one place, with `slugs` and `admin_cards`, where a
//! card is found without its owner: the caller is anyone. Whether the card may be shown is
//! decided from the owner's status, read with it.

use cartouche_domain::{CardStatus, UserStatus, is_served};
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use super::blocked_slugs;
use super::cards::{Card, CardRow};
use super::users::parse_status;

/// What a slug stands for. Values live for one request, so the size gap between variants is
/// not worth a `Box`.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq)]
pub enum Resolution {
    /// The current slug of a card, with the status of the card's owner.
    Current(Card, UserStatus),
    /// An old slug of a card; `card.slug` is its current slug.
    Old { card: Card, owner: UserStatus },
    /// A slug of a card that no longer exists.
    Deleted,
}

/// The slug row with the card, its current slug and its owner's status. Every column of the
/// joined tables is absent when the card was deleted.
struct ResolutionRow {
    is_current: bool,
    current_slug: Option<String>,
    id: Option<Uuid>,
    owner_id: Option<Uuid>,
    template: Option<String>,
    settings: Option<serde_json::Value>,
    theme: Option<serde_json::Value>,
    first_name: Option<String>,
    last_name: Option<String>,
    job_title: Option<String>,
    company: Option<String>,
    description: Option<String>,
    email: Option<String>,
    phone: Option<String>,
    links: Option<serde_json::Value>,
    header_media_id: Option<Uuid>,
    avatar_media_id: Option<Uuid>,
    owner_disabled_at: Option<DateTime<Utc>>,
    support_disabled_at: Option<DateTime<Utc>>,
    created_at: Option<DateTime<Utc>>,
    updated_at: Option<DateTime<Utc>>,
    owner_status: Option<String>,
}

impl ResolutionRow {
    /// The card with the status of its owner; `None` when the card is gone.
    fn into_current(self) -> Option<Result<(Card, UserStatus), sqlx::Error>> {
        let owner_status = self.owner_status?;
        let row = CardRow {
            id: self.id?,
            owner_id: self.owner_id?,
            slug: self.current_slug?,
            template: self.template?,
            settings: self.settings?,
            theme: self.theme?,
            first_name: self.first_name,
            last_name: self.last_name,
            job_title: self.job_title,
            company: self.company,
            description: self.description,
            email: self.email,
            phone: self.phone,
            links: self.links?,
            header_media_id: self.header_media_id,
            avatar_media_id: self.avatar_media_id,
            owner_disabled_at: self.owner_disabled_at,
            support_disabled_at: self.support_disabled_at,
            created_at: self.created_at?,
            updated_at: self.updated_at?,
        };
        Some(
            Card::try_from(row)
                .and_then(|card| parse_status(&owner_status).map(|status| (card, status))),
        )
    }
}

/// Resolves `slug` (exactly as stored: lowercase). A blocked slug (LNK-015) resolves like a
/// deleted card (LNK-033). `None` when it was never attributed.
pub async fn resolve(pool: &PgPool, slug: &str) -> Result<Option<Resolution>, sqlx::Error> {
    let Some(row) = sqlx::query_as!(
        ResolutionRow,
        "select s.is_current, cur.slug as current_slug, \
                c.id, c.owner_id, c.template, c.settings, c.theme, \
                c.first_name, c.last_name, c.job_title, c.company, c.description, c.email, c.phone, \
                c.links, c.header_media_id, c.avatar_media_id, \
                c.owner_disabled_at, c.support_disabled_at, c.created_at, c.updated_at, \
                u.status as owner_status \
         from card_slugs s \
         left join cards c on c.id = s.card_id \
         left join card_slugs cur on cur.card_id = c.id and cur.is_current \
         left join users u on u.id = c.owner_id \
         where s.slug = $1",
        slug,
    )
    .fetch_optional(pool)
    .await?
    else {
        return Ok(blocked_slugs::is_blocked(pool, slug)
            .await?
            .then_some(Resolution::Deleted));
    };
    let is_current = row.is_current;
    Ok(Some(match row.into_current().transpose()? {
        None => Resolution::Deleted,
        Some((card, owner)) if is_current => Resolution::Current(card, owner),
        Some((card, owner)) => Resolution::Old { card, owner },
    }))
}

/// Whether the card `card_id` is publicly served (active, owner approved, LNK-026); `None`
/// when there is no such card. Read on every unsigned `/media/*` request (MED-023).
pub async fn card_is_served(pool: &PgPool, card_id: Uuid) -> Result<Option<bool>, sqlx::Error> {
    let Some(row) = sqlx::query!(
        "select c.owner_disabled_at, c.support_disabled_at, u.status as owner_status \
         from cards c \
         join users u on u.id = c.owner_id \
         where c.id = $1",
        card_id,
    )
    .fetch_optional(pool)
    .await?
    else {
        return Ok(None);
    };
    let status = CardStatus::of(
        row.owner_disabled_at.is_some(),
        row.support_disabled_at.is_some(),
    );
    Ok(Some(is_served(status, parse_status(&row.owner_status)?)))
}
