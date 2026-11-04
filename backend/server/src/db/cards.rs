//! The `cards` table. Every function takes the owner and puts it in the `where`; a card of
//! another owner is simply absent.

use std::collections::HashMap;

use cartouche_domain::{CardContent, CardStatus, EventPhase, Link, Period, ValidCard};
use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq)]
pub struct Card {
    pub id: Uuid,
    pub owner_id: Uuid,
    /// The current slug.
    pub slug: String,
    pub template: String,
    pub settings: serde_json::Value,
    pub theme: serde_json::Value,
    pub content: CardContent,
    pub links: Vec<Link>,
    pub header_media_id: Option<Uuid>,
    pub avatar_media_id: Option<Uuid>,
    pub owner_disabled_at: Option<DateTime<Utc>>,
    pub support_disabled_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Card {
    pub fn status(&self) -> CardStatus {
        CardStatus::of(
            self.owner_disabled_at.is_some(),
            self.support_disabled_at.is_some(),
        )
    }
}

/// A `cards` row joined with its current slug, as the database returns it.
pub(crate) struct CardRow {
    pub(crate) id: Uuid,
    pub(crate) owner_id: Uuid,
    pub(crate) slug: String,
    pub(crate) template: String,
    pub(crate) settings: serde_json::Value,
    pub(crate) theme: serde_json::Value,
    pub(crate) first_name: Option<String>,
    pub(crate) last_name: Option<String>,
    pub(crate) job_title: Option<String>,
    pub(crate) company: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) email: Option<String>,
    pub(crate) phone: Option<String>,
    pub(crate) links: serde_json::Value,
    pub(crate) header_media_id: Option<Uuid>,
    pub(crate) avatar_media_id: Option<Uuid>,
    pub(crate) owner_disabled_at: Option<DateTime<Utc>>,
    pub(crate) support_disabled_at: Option<DateTime<Utc>>,
    pub(crate) created_at: DateTime<Utc>,
    pub(crate) updated_at: DateTime<Utc>,
}

impl TryFrom<CardRow> for Card {
    type Error = sqlx::Error;

    fn try_from(row: CardRow) -> Result<Self, sqlx::Error> {
        let links = serde_json::from_value(row.links).map_err(|e| sqlx::Error::ColumnDecode {
            index: "links".into(),
            source: Box::new(e),
        })?;
        Ok(Card {
            id: row.id,
            owner_id: row.owner_id,
            slug: row.slug,
            template: row.template,
            settings: row.settings,
            theme: row.theme,
            content: CardContent {
                first_name: row.first_name,
                last_name: row.last_name,
                job_title: row.job_title,
                company: row.company,
                description: row.description,
                email: row.email,
                phone: row.phone,
            },
            links,
            header_media_id: row.header_media_id,
            avatar_media_id: row.avatar_media_id,
            owner_disabled_at: row.owner_disabled_at,
            support_disabled_at: row.support_disabled_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }
}

fn links_json(links: &[Link]) -> Result<serde_json::Value, sqlx::Error> {
    serde_json::to_value(links).map_err(|e| sqlx::Error::Encode(Box::new(e)))
}

fn theme_json(card: &ValidCard) -> Result<serde_json::Value, sqlx::Error> {
    serde_json::to_value(&card.theme).map_err(|e| sqlx::Error::Encode(Box::new(e)))
}

/// The owner's cards (all of them, or only `card_id` when given), oldest first, each with
/// its current slug.
async fn select_cards(
    conn: &mut PgConnection,
    owner_id: Uuid,
    card_id: Option<Uuid>,
) -> Result<Vec<Card>, sqlx::Error> {
    sqlx::query_as!(
        CardRow,
        "select c.id, c.owner_id, s.slug, c.template, c.settings, c.theme, \
                c.first_name, c.last_name, c.job_title, c.company, c.description, c.email, c.phone, \
                c.links, c.header_media_id, c.avatar_media_id, \
                c.owner_disabled_at, c.support_disabled_at, c.created_at, c.updated_at \
         from cards c join card_slugs s on s.card_id = c.id and s.is_current \
         where c.owner_id = $1 and ($2::uuid is null or c.id = $2) \
         order by c.created_at, c.id",
        owner_id,
        card_id,
    )
    .fetch_all(conn)
    .await?
    .into_iter()
    .map(Card::try_from)
    .collect()
}

/// What the card list shows of a card's events and leads (EDI-023).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CardCounts {
    pub running: u32,
    pub upcoming: u32,
    pub past: u32,
    /// Every lead of the card's events, spam ones included.
    pub lead_count: i64,
}

/// The counts of the owner's cards `card_ids`, the phases of the events being those of `now`
/// (EVT-020). A card without event or lead gets the default (zero) counts.
pub async fn counts_for_owner(
    pool: &PgPool,
    owner_id: Uuid,
    card_ids: &[Uuid],
    now: DateTime<Utc>,
) -> Result<HashMap<Uuid, CardCounts>, sqlx::Error> {
    let mut counts: HashMap<Uuid, CardCounts> = HashMap::new();
    let events = sqlx::query!(
        "select e.card_id, e.starts_at, e.ends_at \
         from events e join cards c on c.id = e.card_id \
         where c.owner_id = $1 and e.card_id = any($2)",
        owner_id,
        card_ids,
    )
    .fetch_all(pool)
    .await?;
    for event in events {
        let period = Period {
            starts_at: event.starts_at,
            ends_at: event.ends_at,
        };
        let entry = counts.entry(event.card_id).or_default();
        match period.phase(now) {
            EventPhase::Running => entry.running += 1,
            EventPhase::Upcoming => entry.upcoming += 1,
            EventPhase::Past => entry.past += 1,
        }
    }
    let leads = sqlx::query!(
        r#"select e.card_id, count(*) as "count!"
           from leads l join events e on e.id = l.event_id join cards c on c.id = e.card_id
           where c.owner_id = $1 and e.card_id = any($2)
           group by e.card_id"#,
        owner_id,
        card_ids,
    )
    .fetch_all(pool)
    .await?;
    for lead in leads {
        counts.entry(lead.card_id).or_default().lead_count = lead.count;
    }
    Ok(counts)
}

pub async fn list_for_owner(pool: &PgPool, owner_id: Uuid) -> Result<Vec<Card>, sqlx::Error> {
    select_cards(&mut *pool.acquire().await?, owner_id, None).await
}

pub async fn find_for_owner(
    pool: &PgPool,
    owner_id: Uuid,
    card_id: Uuid,
) -> Result<Option<Card>, sqlx::Error> {
    let mut found = select_cards(&mut *pool.acquire().await?, owner_id, Some(card_id)).await?;
    Ok(found.pop())
}

/// Inserts a card. Its slug is not recorded here: the caller claims it right after with
/// `slugs::apply_claim` in the same transaction (a slug row needs its card to exist), so
/// the returned `slug` is the one being claimed.
pub async fn insert(
    tx: &mut PgConnection,
    owner_id: Uuid,
    card_id: Uuid,
    card: &ValidCard,
) -> Result<Card, sqlx::Error> {
    let row = sqlx::query_as!(
        CardRow,
        r#"insert into cards (id, owner_id, template, settings, theme, first_name, last_name,
                              job_title, company, description, email, phone, links)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           returning id, owner_id, $14::text as "slug!", template, settings, theme, first_name,
                     last_name, job_title, company, description, email, phone, links,
                     header_media_id, avatar_media_id, owner_disabled_at, support_disabled_at,
                     created_at, updated_at"#,
        card_id,
        owner_id,
        card.template,
        card.settings,
        theme_json(card)?,
        card.content.first_name,
        card.content.last_name,
        card.content.job_title,
        card.content.company,
        card.content.description,
        card.content.email,
        card.content.phone,
        links_json(&card.links)?,
        card.slug.as_str(),
    )
    .fetch_one(tx)
    .await?;
    row.try_into()
}

/// What the lock on a card reveals.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LockedCard {
    /// Whether support has disabled the card (LNK-028).
    pub support_disabled: bool,
}

/// Locks the owner's card until the transaction ends, so a save cannot race a deletion or
/// an upload. `None` when the owner has no such card.
pub async fn lock_for_owner(
    tx: &mut PgConnection,
    owner_id: Uuid,
    card_id: Uuid,
) -> Result<Option<LockedCard>, sqlx::Error> {
    let locked = sqlx::query!(
        r#"select support_disabled_at is not null as "support_disabled!"
           from cards where id = $1 and owner_id = $2 for update"#,
        card_id,
        owner_id,
    )
    .fetch_optional(tx)
    .await?;
    Ok(locked.map(|row| LockedCard {
        support_disabled: row.support_disabled,
    }))
}

/// Overwrites the content of the owner's card and its two media. `None` when the owner has
/// no such card, or when a media is not one of this card's, in the matching slot. The returned `slug` is the current one at that moment: apply a slug claim
/// first if the save changes it.
pub async fn update(
    tx: &mut PgConnection,
    owner_id: Uuid,
    card_id: Uuid,
    card: &ValidCard,
    header_media_id: Option<Uuid>,
    avatar_media_id: Option<Uuid>,
) -> Result<Option<Card>, sqlx::Error> {
    let updated = sqlx::query!(
        "update cards set template = $3, settings = $4, theme = $5, first_name = $6, \
             last_name = $7, job_title = $8, company = $9, description = $10, email = $11, \
             phone = $12, links = $13, header_media_id = $14, avatar_media_id = $15, \
             updated_at = now() \
         where id = $1 and owner_id = $2 \
           and ($14::uuid is null or exists ( \
                select 1 from media where id = $14 and card_id = $1 and slot = 'header')) \
           and ($15::uuid is null or exists ( \
                select 1 from media where id = $15 and card_id = $1 and slot = 'avatar'))",
        card_id,
        owner_id,
        card.template,
        card.settings,
        theme_json(card)?,
        card.content.first_name,
        card.content.last_name,
        card.content.job_title,
        card.content.company,
        card.content.description,
        card.content.email,
        card.content.phone,
        links_json(&card.links)?,
        header_media_id,
        avatar_media_id,
    )
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Ok(None);
    }
    Ok(select_cards(tx, owner_id, Some(card_id)).await?.pop())
}

/// Sets (`Some(at)`) or clears (`None`) the owner's own switch.
pub async fn set_owner_disabled(
    tx: &mut PgConnection,
    owner_id: Uuid,
    card_id: Uuid,
    at: Option<DateTime<Utc>>,
) -> Result<Option<Card>, sqlx::Error> {
    let updated = sqlx::query!(
        "update cards set owner_disabled_at = $3, updated_at = now() \
         where id = $1 and owner_id = $2",
        card_id,
        owner_id,
        at,
    )
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Ok(None);
    }
    Ok(select_cards(tx, owner_id, Some(card_id)).await?.pop())
}

/// Copies the owner's card `source_id` into a new, active card `new_id`: template, settings,
/// theme, content and links, but no media (the caller copies those, then calls
/// `set_media`). `None` when the owner has no such card. Like `insert`, the slug is not
/// recorded here: the caller claims `slug` right after in the same transaction.
pub async fn duplicate(
    tx: &mut PgConnection,
    owner_id: Uuid,
    source_id: Uuid,
    new_id: Uuid,
    slug: &str,
) -> Result<Option<Card>, sqlx::Error> {
    let row = sqlx::query_as!(
        CardRow,
        r#"insert into cards (id, owner_id, template, settings, theme, first_name, last_name,
                              job_title, company, description, email, phone, links)
           select $1, owner_id, template, settings, theme, first_name, last_name,
                  job_title, company, description, email, phone, links
           from cards where id = $2 and owner_id = $3
           returning id, owner_id, $4::text as "slug!", template, settings, theme, first_name,
                     last_name, job_title, company, description, email, phone, links,
                     header_media_id, avatar_media_id, owner_disabled_at, support_disabled_at,
                     created_at, updated_at"#,
        new_id,
        source_id,
        owner_id,
        slug,
    )
    .fetch_optional(tx)
    .await?;
    row.map(Card::try_from).transpose()
}

/// Sets the header and avatar of the owner's card. `None` when the owner has no such card,
/// or when a media is not one of this card's, in the matching slot.
pub async fn set_media(
    tx: &mut PgConnection,
    owner_id: Uuid,
    card_id: Uuid,
    header_media_id: Option<Uuid>,
    avatar_media_id: Option<Uuid>,
) -> Result<Option<Card>, sqlx::Error> {
    let updated = sqlx::query!(
        "update cards set header_media_id = $3, avatar_media_id = $4, updated_at = now() \
         where id = $1 and owner_id = $2 \
           and ($3::uuid is null or exists ( \
                select 1 from media where id = $3 and card_id = $1 and slot = 'header')) \
           and ($4::uuid is null or exists ( \
                select 1 from media where id = $4 and card_id = $1 and slot = 'avatar'))",
        card_id,
        owner_id,
        header_media_id,
        avatar_media_id,
    )
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Ok(None);
    }
    Ok(select_cards(tx, owner_id, Some(card_id)).await?.pop())
}

/// Deletes the owner's card and its media. Its slugs stay reserved to the owner, no longer
/// current (LNK-013, LNK-014). `false` when the owner has no such card.
pub async fn delete_for_owner(
    tx: &mut PgConnection,
    owner_id: Uuid,
    card_id: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query!(
        "update card_slugs set is_current = false where card_id = $1 and owner_id = $2",
        card_id,
        owner_id,
    )
    .execute(&mut *tx)
    .await?;
    let deleted = sqlx::query!(
        "delete from cards where id = $1 and owner_id = $2",
        card_id,
        owner_id,
    )
    .execute(tx)
    .await?;
    Ok(deleted.rows_affected() > 0)
}
