//! The `cards` table. Every function takes the owner and puts it in the `where`; a card of
//! another owner is simply absent.

use cartouche_domain::{CardContent, CardStatus, Link, ValidCard};
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
struct CardRow {
    id: Uuid,
    owner_id: Uuid,
    slug: String,
    template: String,
    settings: serde_json::Value,
    theme: serde_json::Value,
    first_name: Option<String>,
    last_name: Option<String>,
    job_title: Option<String>,
    company: Option<String>,
    description: Option<String>,
    email: Option<String>,
    phone: Option<String>,
    links: serde_json::Value,
    header_media_id: Option<Uuid>,
    avatar_media_id: Option<Uuid>,
    owner_disabled_at: Option<DateTime<Utc>>,
    support_disabled_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
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

/// Overwrites the content of the owner's card and its two media. `None` when the owner has
/// no such card. The returned `slug` is the current one at that moment: apply a slug claim
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
         where id = $1 and owner_id = $2",
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
    pool: &PgPool,
    owner_id: Uuid,
    card_id: Uuid,
    at: Option<DateTime<Utc>>,
) -> Result<Option<Card>, sqlx::Error> {
    let mut conn = pool.acquire().await?;
    let updated = sqlx::query!(
        "update cards set owner_disabled_at = $3, updated_at = now() \
         where id = $1 and owner_id = $2",
        card_id,
        owner_id,
        at,
    )
    .execute(&mut *conn)
    .await?;
    if updated.rows_affected() == 0 {
        return Ok(None);
    }
    Ok(select_cards(&mut conn, owner_id, Some(card_id))
        .await?
        .pop())
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
