//! The `leads` table. Owner functions put the owner in the `where` (through
//! `leads.event_id -> events.card_id -> cards.owner_id`).
//!
//! Documented exceptions, which take no owner: `lock_device`, `count_for_device` and `insert`
//! are the writes of an anonymous prospect, always for an event the caller has already
//! resolved with `events::find_public`.

use cartouche_domain::{AnswerSnapshot, StandardAnswers, ValidLead};
use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq)]
pub struct Lead {
    pub id: Uuid,
    pub event_id: Uuid,
    pub device_id: Uuid,
    pub submitted_at: DateTime<Utc>,
    pub standard: StandardAnswers,
    pub custom: Vec<AnswerSnapshot>,
    pub consent_at: DateTime<Utc>,
    pub consent_text: String,
    pub spam_at: Option<DateTime<Utc>>,
}

/// A lead to store. The consent timestamp is the submission time (FRM-038).
#[derive(Debug, Clone, Copy)]
pub struct NewLead<'a> {
    pub id: Uuid,
    pub event_id: Uuid,
    pub device_id: Uuid,
    pub submitted_at: DateTime<Utc>,
    pub lead: &'a ValidLead,
    pub consent_text: &'a str,
}

/// A `leads` row as the database returns it.
struct LeadRow {
    id: Uuid,
    event_id: Uuid,
    device_id: Uuid,
    submitted_at: DateTime<Utc>,
    first_name: Option<String>,
    last_name: Option<String>,
    birth_date: Option<NaiveDate>,
    email: Option<String>,
    phone: Option<String>,
    street: Option<String>,
    postal_code: Option<String>,
    city: Option<String>,
    country: Option<String>,
    custom_answers: serde_json::Value,
    consent_at: DateTime<Utc>,
    consent_text: String,
    spam_at: Option<DateTime<Utc>>,
}

impl TryFrom<LeadRow> for Lead {
    type Error = sqlx::Error;

    fn try_from(row: LeadRow) -> Result<Self, sqlx::Error> {
        let custom =
            serde_json::from_value(row.custom_answers).map_err(|e| sqlx::Error::ColumnDecode {
                index: "custom_answers".into(),
                source: Box::new(e),
            })?;
        Ok(Lead {
            id: row.id,
            event_id: row.event_id,
            device_id: row.device_id,
            submitted_at: row.submitted_at,
            standard: StandardAnswers {
                first_name: row.first_name,
                last_name: row.last_name,
                birth_date: row.birth_date,
                email: row.email,
                phone: row.phone,
                street: row.street,
                postal_code: row.postal_code,
                city: row.city,
                country: row.country,
            },
            custom,
            consent_at: row.consent_at,
            consent_text: row.consent_text,
            spam_at: row.spam_at,
        })
    }
}

/// Serializes submissions of one device for one event until the transaction ends, so two
/// simultaneous sends cannot both pass the device limit (EVT-029). Call it before
/// `count_for_device`.
pub async fn lock_device(
    tx: &mut PgConnection,
    event_id: Uuid,
    device_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "select pg_advisory_xact_lock(hashtextextended($1::uuid::text || ':' || $2::uuid::text, 0))",
        event_id,
        device_id,
    )
    .execute(tx)
    .await?;
    Ok(())
}

/// The leads of the event from this device, spam ones included (EVT-029).
pub async fn count_for_device(
    tx: &mut PgConnection,
    event_id: Uuid,
    device_id: Uuid,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar!(
        r#"select count(*) as "count!" from leads where event_id = $1 and device_id = $2"#,
        event_id,
        device_id,
    )
    .fetch_one(tx)
    .await
}

pub async fn insert(tx: &mut PgConnection, new: &NewLead<'_>) -> Result<(), sqlx::Error> {
    let standard = &new.lead.standard;
    let custom =
        serde_json::to_value(&new.lead.custom).map_err(|e| sqlx::Error::Encode(Box::new(e)))?;
    sqlx::query!(
        "insert into leads (id, event_id, device_id, submitted_at, first_name, last_name, \
                            birth_date, email, phone, street, postal_code, city, country, \
                            custom_answers, consent_at, consent_text) \
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $4, $15)",
        new.id,
        new.event_id,
        new.device_id,
        new.submitted_at,
        standard.first_name,
        standard.last_name,
        standard.birth_date,
        standard.email,
        standard.phone,
        standard.street,
        standard.postal_code,
        standard.city,
        standard.country,
        custom,
        new.consent_text,
    )
    .execute(tx)
    .await?;
    Ok(())
}

/// Whether `insert` failed because the event no longer exists: it was deleted after the caller
/// resolved it (the event is the only foreign key of a lead).
pub fn is_missing_event(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .is_some_and(|e| e.is_foreign_key_violation())
}

/// The leads of the owner's event, newest first. `None` when the owner has no such event.
pub async fn list_for_event(
    pool: &PgPool,
    owner_id: Uuid,
    event_id: Uuid,
) -> Result<Option<Vec<Lead>>, sqlx::Error> {
    let owns_event = sqlx::query_scalar!(
        r#"select exists (select 1 from events e join cards c on c.id = e.card_id
                          where e.id = $1 and c.owner_id = $2) as "owns!""#,
        event_id,
        owner_id,
    )
    .fetch_one(pool)
    .await?;
    if !owns_event {
        return Ok(None);
    }
    let rows = sqlx::query_as!(
        LeadRow,
        "select l.id, l.event_id, l.device_id, l.submitted_at, l.first_name, l.last_name, \
                l.birth_date, l.email, l.phone, l.street, l.postal_code, l.city, l.country, \
                l.custom_answers, l.consent_at, l.consent_text, l.spam_at \
         from leads l join events e on e.id = l.event_id join cards c on c.id = e.card_id \
         where l.event_id = $1 and c.owner_id = $2 \
         order by l.submitted_at desc, l.id desc",
        event_id,
        owner_id,
    )
    .fetch_all(pool)
    .await?;
    rows.into_iter()
        .map(Lead::try_from)
        .collect::<Result<_, _>>()
        .map(Some)
}

/// Marks (`Some(at)`) or unmarks (`None`) the owner's lead as spam. `None` when the owner has
/// no such lead.
pub async fn set_spam(
    pool: &PgPool,
    owner_id: Uuid,
    lead_id: Uuid,
    at: Option<DateTime<Utc>>,
) -> Result<Option<Lead>, sqlx::Error> {
    let row = sqlx::query_as!(
        LeadRow,
        "update leads l set spam_at = $3 \
         from events e, cards c \
         where l.id = $1 and e.id = l.event_id and c.id = e.card_id and c.owner_id = $2 \
         returning l.id, l.event_id, l.device_id, l.submitted_at, l.first_name, l.last_name, \
                   l.birth_date, l.email, l.phone, l.street, l.postal_code, l.city, l.country, \
                   l.custom_answers, l.consent_at, l.consent_text, l.spam_at",
        lead_id,
        owner_id,
        at,
    )
    .fetch_optional(pool)
    .await?;
    row.map(Lead::try_from).transpose()
}

/// Deletes the owner's lead. `false` when the owner has no such lead.
pub async fn delete_for_owner(
    pool: &PgPool,
    owner_id: Uuid,
    lead_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let deleted = sqlx::query!(
        "delete from leads l using events e, cards c \
         where l.id = $1 and e.id = l.event_id and c.id = e.card_id and c.owner_id = $2",
        lead_id,
        owner_id,
    )
    .execute(pool)
    .await?;
    Ok(deleted.rows_affected() > 0)
}
