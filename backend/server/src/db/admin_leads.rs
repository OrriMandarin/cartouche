//! Events and leads as support sees them: any user's, without an owner filter. This is a
//! documented exception to the owner rule, like `admin_cards`; it is called only from the
//! `/api/admin/*` routes, which audit every read of leads (ADM-008, ADM-019).

use sqlx::PgConnection;
use uuid::Uuid;

use super::events::{Event, EventRow, EventWithCount};
use super::leads::{Lead, LeadRow};

/// The leads of an event or of a card, with the card and its owner they belong to.
#[derive(Debug, Clone, PartialEq)]
pub struct LeadScope {
    pub card_id: Uuid,
    pub owner_id: Uuid,
    /// Newest first, spam ones included.
    pub leads: Vec<Lead>,
}

/// The events of any card, by start, each with its lead count. `None` when there is no such
/// card.
pub async fn list_events_of_card(
    conn: &mut PgConnection,
    card_id: Uuid,
) -> Result<Option<Vec<EventWithCount>>, sqlx::Error> {
    let exists = sqlx::query_scalar!(
        r#"select exists (select 1 from cards where id = $1) as "exists!""#,
        card_id,
    )
    .fetch_one(&mut *conn)
    .await?;
    if !exists {
        return Ok(None);
    }
    let rows = sqlx::query!(
        r#"select e.id, e.card_id, e.title, e.description, e.starts_at, e.ends_at, e.access_code,
                  e.device_limit, e.standard_fields, e.custom_fields, e.consent_text,
                  e.created_at, e.updated_at,
                  (select count(*) from leads l where l.event_id = e.id) as "lead_count!"
           from events e
           where e.card_id = $1
           order by e.starts_at, e.id"#,
        card_id,
    )
    .fetch_all(conn)
    .await?;
    rows.into_iter()
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
        .collect::<Result<_, sqlx::Error>>()
        .map(Some)
}

/// The leads of any event. `None` when there is no such event.
pub async fn list_for_event(
    conn: &mut PgConnection,
    event_id: Uuid,
) -> Result<Option<LeadScope>, sqlx::Error> {
    let Some(owner) = sqlx::query!(
        "select e.card_id, c.owner_id from events e join cards c on c.id = e.card_id \
         where e.id = $1",
        event_id,
    )
    .fetch_optional(&mut *conn)
    .await?
    else {
        return Ok(None);
    };
    let rows = sqlx::query_as!(
        LeadRow,
        "select l.id, l.event_id, e.title as event_title, l.device_id, l.submitted_at, \
                l.first_name, l.last_name, l.birth_date, l.email, l.phone, l.street, \
                l.postal_code, l.city, l.country, l.custom_answers, l.consent_at, \
                l.consent_text, l.spam_at \
         from leads l join events e on e.id = l.event_id \
         where l.event_id = $1 \
         order by l.submitted_at desc, l.id desc",
        event_id,
    )
    .fetch_all(conn)
    .await?;
    scope(owner.card_id, owner.owner_id, rows).map(Some)
}

/// The leads of every event of any card. `None` when there is no such card.
pub async fn list_for_card(
    conn: &mut PgConnection,
    card_id: Uuid,
) -> Result<Option<LeadScope>, sqlx::Error> {
    let Some(owner_id) = sqlx::query_scalar!("select owner_id from cards where id = $1", card_id)
        .fetch_optional(&mut *conn)
        .await?
    else {
        return Ok(None);
    };
    let rows = sqlx::query_as!(
        LeadRow,
        "select l.id, l.event_id, e.title as event_title, l.device_id, l.submitted_at, \
                l.first_name, l.last_name, l.birth_date, l.email, l.phone, l.street, \
                l.postal_code, l.city, l.country, l.custom_answers, l.consent_at, \
                l.consent_text, l.spam_at \
         from leads l join events e on e.id = l.event_id \
         where e.card_id = $1 \
         order by l.submitted_at desc, l.id desc",
        card_id,
    )
    .fetch_all(conn)
    .await?;
    scope(card_id, owner_id, rows).map(Some)
}

fn scope(card_id: Uuid, owner_id: Uuid, rows: Vec<LeadRow>) -> Result<LeadScope, sqlx::Error> {
    Ok(LeadScope {
        card_id,
        owner_id,
        leads: rows
            .into_iter()
            .map(Lead::try_from)
            .collect::<Result<_, _>>()?,
    })
}
