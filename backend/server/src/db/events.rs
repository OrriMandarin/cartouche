//! The `events` table. Every owner function puts the owner in the `where` (through
//! `events.card_id -> cards.owner_id`): an event of another owner is simply absent.
//!
//! Documented exceptions, which take no owner: `find_public` and `candidates_public` read the
//! events of a card the caller has already resolved from its slug.

use cartouche_domain::{CustomField, FormDefinition, Period, StandardFields, ValidEvent};
use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq)]
pub struct Event {
    pub id: Uuid,
    pub card_id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub period: Period,
    pub access_code: Option<String>,
    pub device_limit: u32,
    pub form: FormDefinition,
    pub consent_text: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EventWithCount {
    pub event: Event,
    /// Every lead of the event, spam ones included.
    pub lead_count: i64,
}

/// What the public listing of a card needs from an event: no access code, no form.
#[derive(Debug, Clone, PartialEq)]
pub struct PublicCandidate {
    pub id: Uuid,
    pub title: String,
    pub period: Period,
}

/// An `events` row as the database returns it.
struct EventRow {
    id: Uuid,
    card_id: Uuid,
    title: String,
    description: Option<String>,
    starts_at: DateTime<Utc>,
    ends_at: Option<DateTime<Utc>>,
    access_code: Option<String>,
    device_limit: i32,
    standard_fields: serde_json::Value,
    custom_fields: serde_json::Value,
    consent_text: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
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

impl TryFrom<EventRow> for Event {
    type Error = sqlx::Error;

    fn try_from(row: EventRow) -> Result<Self, sqlx::Error> {
        let standard: StandardFields = serde_json::from_value(row.standard_fields)
            .map_err(|e| decode_error("standard_fields", e))?;
        let custom: Vec<CustomField> = serde_json::from_value(row.custom_fields)
            .map_err(|e| decode_error("custom_fields", e))?;
        let device_limit =
            u32::try_from(row.device_limit).map_err(|e| decode_error("device_limit", e))?;
        Ok(Event {
            id: row.id,
            card_id: row.card_id,
            title: row.title,
            description: row.description,
            period: Period {
                starts_at: row.starts_at,
                ends_at: row.ends_at,
            },
            access_code: row.access_code,
            device_limit,
            form: FormDefinition { standard, custom },
            consent_text: row.consent_text,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }
}

/// The JSON columns and the integer limit of a validated event, ready to bind.
struct EventColumns {
    standard_fields: serde_json::Value,
    custom_fields: serde_json::Value,
    device_limit: i32,
}

fn columns(event: &ValidEvent) -> Result<EventColumns, sqlx::Error> {
    let encode = |e| sqlx::Error::Encode(Box::new(e));
    Ok(EventColumns {
        standard_fields: serde_json::to_value(event.form.standard).map_err(encode)?,
        custom_fields: serde_json::to_value(&event.form.custom).map_err(encode)?,
        device_limit: i32::try_from(event.device_limit)
            .map_err(|e| sqlx::Error::Encode(Box::new(e)))?,
    })
}

/// The owner's events (all of them, or those of `card_id`; only `event_id` when given), by
/// start then identifier, each with its lead count.
async fn select_events(
    conn: &mut PgConnection,
    owner_id: Uuid,
    card_id: Option<Uuid>,
    event_id: Option<Uuid>,
) -> Result<Vec<EventWithCount>, sqlx::Error> {
    sqlx::query!(
        r#"select e.id, e.card_id, e.title, e.description, e.starts_at, e.ends_at, e.access_code,
                  e.device_limit, e.standard_fields, e.custom_fields, e.consent_text,
                  e.created_at, e.updated_at,
                  (select count(*) from leads l where l.event_id = e.id) as "lead_count!"
           from events e join cards c on c.id = e.card_id
           where c.owner_id = $1
             and ($2::uuid is null or e.card_id = $2)
             and ($3::uuid is null or e.id = $3)
           order by e.starts_at, e.id"#,
        owner_id,
        card_id,
        event_id,
    )
    .fetch_all(conn)
    .await?
    .into_iter()
    .map(|r| {
        Ok(EventWithCount {
            event: Event::try_from(EventRow {
                id: r.id,
                card_id: r.card_id,
                title: r.title,
                description: r.description,
                starts_at: r.starts_at,
                ends_at: r.ends_at,
                access_code: r.access_code,
                device_limit: r.device_limit,
                standard_fields: r.standard_fields,
                custom_fields: r.custom_fields,
                consent_text: r.consent_text,
                created_at: r.created_at,
                updated_at: r.updated_at,
            })?,
            lead_count: r.lead_count,
        })
    })
    .collect()
}

/// The events of the owner's card, by start. `None` when the owner has no such card.
pub async fn list_for_card(
    pool: &PgPool,
    owner_id: Uuid,
    card_id: Uuid,
) -> Result<Option<Vec<EventWithCount>>, sqlx::Error> {
    let mut conn = pool.acquire().await?;
    let owns_card = sqlx::query_scalar!(
        r#"select exists (select 1 from cards where id = $1 and owner_id = $2) as "owns!""#,
        card_id,
        owner_id,
    )
    .fetch_one(&mut *conn)
    .await?;
    if !owns_card {
        return Ok(None);
    }
    select_events(&mut conn, owner_id, Some(card_id), None)
        .await
        .map(Some)
}

pub async fn find_for_owner(
    pool: &PgPool,
    owner_id: Uuid,
    event_id: Uuid,
) -> Result<Option<EventWithCount>, sqlx::Error> {
    let mut found =
        select_events(&mut *pool.acquire().await?, owner_id, None, Some(event_id)).await?;
    Ok(found.pop())
}

/// Locks the card of the owner's event until the transaction ends and returns its id: the
/// same lock as `cards::lock_for_owner`, taken first so two requests never deadlock. `None`
/// when the owner has no such event.
pub async fn lock_card_of_event(
    tx: &mut PgConnection,
    owner_id: Uuid,
    event_id: Uuid,
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar!(
        "select c.id from events e join cards c on c.id = e.card_id \
         where e.id = $1 and c.owner_id = $2 for update of c",
        event_id,
        owner_id,
    )
    .fetch_optional(tx)
    .await
}

/// The periods of the events of the owner's card, except `except` (the event being edited),
/// to check the simultaneous-event limit. Empty when the owner has no such card.
pub async fn periods_of_card(
    tx: &mut PgConnection,
    owner_id: Uuid,
    card_id: Uuid,
    except: Option<Uuid>,
) -> Result<Vec<Period>, sqlx::Error> {
    let rows = sqlx::query!(
        "select e.starts_at, e.ends_at from events e join cards c on c.id = e.card_id \
         where c.id = $1 and c.owner_id = $2 and ($3::uuid is null or e.id <> $3) \
         order by e.starts_at, e.id",
        card_id,
        owner_id,
        except,
    )
    .fetch_all(tx)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| Period {
            starts_at: row.starts_at,
            ends_at: row.ends_at,
        })
        .collect())
}

/// Inserts an event on the owner's card. `None` when the owner has no such card.
pub async fn insert(
    tx: &mut PgConnection,
    owner_id: Uuid,
    card_id: Uuid,
    id: Uuid,
    event: &ValidEvent,
) -> Result<Option<Event>, sqlx::Error> {
    let cols = columns(event)?;
    let inserted = sqlx::query!(
        "insert into events (id, card_id, title, description, starts_at, ends_at, access_code, \
                             device_limit, standard_fields, custom_fields, consent_text) \
         select $1, id, $3, $4, $5, $6, $7, $8, $9, $10, $11 \
         from cards where id = $2 and owner_id = $12",
        id,
        card_id,
        event.title,
        event.description,
        event.period.starts_at,
        event.period.ends_at,
        event.access_code,
        cols.device_limit,
        cols.standard_fields,
        cols.custom_fields,
        event.consent_text,
        owner_id,
    )
    .execute(&mut *tx)
    .await?;
    if inserted.rows_affected() == 0 {
        return Ok(None);
    }
    find_written(tx, owner_id, id).await
}

/// Overwrites the owner's event. `None` when the owner has no such event.
pub async fn update(
    tx: &mut PgConnection,
    owner_id: Uuid,
    event_id: Uuid,
    event: &ValidEvent,
) -> Result<Option<Event>, sqlx::Error> {
    let cols = columns(event)?;
    let updated = sqlx::query!(
        "update events e set title = $3, description = $4, starts_at = $5, ends_at = $6, \
             access_code = $7, device_limit = $8, standard_fields = $9, custom_fields = $10, \
             consent_text = $11, updated_at = now() \
         from cards c \
         where e.id = $1 and c.id = e.card_id and c.owner_id = $2",
        event_id,
        owner_id,
        event.title,
        event.description,
        event.period.starts_at,
        event.period.ends_at,
        event.access_code,
        cols.device_limit,
        cols.standard_fields,
        cols.custom_fields,
        event.consent_text,
    )
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Ok(None);
    }
    find_written(tx, owner_id, event_id).await
}

/// Sets the end of the owner's event (EVT-006). `None` when the owner has no such event.
pub async fn set_end(
    tx: &mut PgConnection,
    owner_id: Uuid,
    event_id: Uuid,
    ends_at: Option<DateTime<Utc>>,
) -> Result<Option<Event>, sqlx::Error> {
    let updated = sqlx::query!(
        "update events e set ends_at = $3, updated_at = now() \
         from cards c \
         where e.id = $1 and c.id = e.card_id and c.owner_id = $2",
        event_id,
        owner_id,
        ends_at,
    )
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Ok(None);
    }
    find_written(tx, owner_id, event_id).await
}

async fn find_written(
    tx: &mut PgConnection,
    owner_id: Uuid,
    event_id: Uuid,
) -> Result<Option<Event>, sqlx::Error> {
    let mut found = select_events(tx, owner_id, None, Some(event_id)).await?;
    Ok(found.pop().map(|counted| counted.event))
}

/// Deletes the owner's event and its leads (EVT-024). `false` when the owner has no such event.
pub async fn delete_for_owner(
    pool: &PgPool,
    owner_id: Uuid,
    event_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let deleted = sqlx::query!(
        "delete from events e using cards c \
         where e.id = $1 and c.id = e.card_id and c.owner_id = $2",
        event_id,
        owner_id,
    )
    .execute(pool)
    .await?;
    Ok(deleted.rows_affected() > 0)
}

/// Public: one event of a card already resolved by its slug. The caller decides what the
/// visitor may see (the access code never leaves the server).
pub async fn find_public(
    pool: &PgPool,
    card_id: Uuid,
    event_id: Uuid,
) -> Result<Option<Event>, sqlx::Error> {
    let row = sqlx::query_as!(
        EventRow,
        "select id, card_id, title, description, starts_at, ends_at, access_code, device_limit, \
                standard_fields, custom_fields, consent_text, created_at, updated_at \
         from events where id = $1 and card_id = $2",
        event_id,
        card_id,
    )
    .fetch_optional(pool)
    .await?;
    row.map(Event::try_from).transpose()
}

/// Public: every event of a card already resolved by its slug, by start, title then
/// identifier (PUB-029). The phase is not decided here: the caller keeps the running events
/// with `Period::is_running` (EVT-002).
pub async fn candidates_public(
    pool: &PgPool,
    card_id: Uuid,
) -> Result<Vec<PublicCandidate>, sqlx::Error> {
    let rows = sqlx::query!(
        "select id, title, starts_at, ends_at from events where card_id = $1 \
         order by starts_at, title, id",
        card_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| PublicCandidate {
            id: row.id,
            title: row.title,
            period: Period {
                starts_at: row.starts_at,
                ends_at: row.ends_at,
            },
        })
        .collect())
}
