//! Seed scenarios and database reset, shared by the `/api/test/*` routes and the
//! `cartouche-seed` binary.

use std::future::Future;
use std::pin::Pin;

use cartouche_domain::{
    AnswerSnapshot, CardContent, CustomField, CustomFieldKind, DEFAULT_TEMPLATE,
    DEFAULT_THEME_PRESET, FieldMode, StandardFields, UserStatus, consent_text, normalize,
};
use chrono::{DateTime, TimeDelta, Utc};
use serde::Serialize;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::config::AppEnv;
use crate::startup::TEST_ISSUER;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Tables emptied by `reset`, in one place: later plans add theirs here.
pub const RESET_TABLES: &[&str] = &[
    "audit_log",
    "leads",
    "events",
    "media",
    "card_slugs",
    "cards",
    "users",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SeededUser {
    pub subject: String,
    pub status: UserStatus,
}

/// A card created by a scenario, with its current slug and the subject of its owner.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SeededCard {
    pub id: Uuid,
    pub slug: String,
    pub owner: String,
}

/// An event created by a scenario, with the slug of its card.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SeededEvent {
    pub id: Uuid,
    pub card_slug: String,
    pub title: String,
}

/// What a scenario created. A scenario reports only its own rows: `base` the users, `cards`
/// the cards, `events` the events.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SeedReport {
    pub users: Vec<SeededUser>,
    pub cards: Vec<SeededCard>,
    pub events: Vec<SeededEvent>,
}

/// A scenario receives the current time of the API clock, so that the dates it seeds are
/// relative to it (the `events` ones) and stay meaningful under a frozen test clock.
pub type Scenario = fn(&PgPool, DateTime<Utc>) -> BoxFuture<'_, Result<SeedReport, sqlx::Error>>;

/// Every scenario, by name.
pub const SCENARIOS: &[(&str, Scenario)] = &[
    ("base", |pool, _| Box::pin(base(pool))),
    ("cards", |pool, now| Box::pin(cards(pool, now))),
    ("events", |pool, now| Box::pin(events(pool, now))),
];

pub fn scenario(name: &str) -> Option<Scenario> {
    SCENARIOS
        .iter()
        .find(|(candidate, _)| *candidate == name)
        .map(|(_, run)| *run)
}

/// Whether the seed tool may touch the database: only in `development` or `test`. Uses the
/// canonical `APP_ENV` parser, so absent, empty or unrecognized values mean production.
pub fn seed_allowed(app_env: Option<&str>) -> bool {
    AppEnv::parse(app_env) != AppEnv::Production
}

/// Empties every table in `RESET_TABLES` and restarts identities.
pub async fn reset(pool: &PgPool) -> Result<(), sqlx::Error> {
    let statement = format!(
        "truncate {} restart identity cascade",
        RESET_TABLES.join(", ")
    );
    // Safe: built from the `RESET_TABLES` constant only, never from input.
    sqlx::query(sqlx::AssertSqlSafe(statement))
        .execute(pool)
        .await?;
    Ok(())
}

/// (subject, display name, email, status) of the users of the `base` scenario.
const BASE_USERS: &[(&str, &str, &str, UserStatus)] = &[
    (
        "seed-admin",
        "Ada Admin",
        "ada@example.test",
        UserStatus::Approved,
    ),
    (
        "seed-alice",
        "Alice Durand",
        "alice@example.test",
        UserStatus::Approved,
    ),
    (
        "seed-bob",
        "Bob Martin",
        "bob@example.test",
        UserStatus::Approved,
    ),
    (
        "seed-carol",
        "Carole Lefèvre",
        "carole@example.test",
        UserStatus::Pending,
    ),
    (
        "seed-dan",
        "Dan Moreau",
        "dan@example.test",
        UserStatus::Suspended,
    ),
    (
        "seed-erin",
        "Érin D'Aubigné-Müller",
        "erin@example.test",
        UserStatus::Rejected,
    ),
];

/// The users of every end-to-end test: an administrator and one user per status.
/// Meant for a freshly reset database; seeding again puts these users back to the values
/// above instead of failing.
async fn base(pool: &PgPool) -> Result<SeedReport, sqlx::Error> {
    let mut users = Vec::with_capacity(BASE_USERS.len());
    for (subject, name, email, status) in BASE_USERS {
        sqlx::query!(
            "insert into users (issuer, subject, email, display_name, status) \
             values ($1, $2, $3, $4, $5) \
             on conflict (issuer, subject) do update set \
                 email = excluded.email, \
                 display_name = excluded.display_name, \
                 status = excluded.status, \
                 updated_at = now()",
            TEST_ISSUER,
            subject,
            normalize(email),
            normalize(name),
            status.as_str(),
        )
        .execute(pool)
        .await?;
        users.push(SeededUser {
            subject: (*subject).to_string(),
            status: *status,
        });
    }
    Ok(SeedReport {
        users,
        cards: Vec::new(),
        events: Vec::new(),
    })
}

/// How a seeded card is served, which decides its disabled timestamps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CardState {
    Active,
    DisabledByOwner,
    DisabledBySupport,
}

struct SeedCard {
    /// Fixed so that seeding again updates the same row.
    id: Uuid,
    owner: &'static str,
    slug: &'static str,
    /// Former slugs of the card: they redirect to the current one.
    old_slugs: &'static [&'static str],
    state: CardState,
    first_name: &'static str,
    last_name: &'static str,
    job_title: Option<&'static str>,
    company: Option<&'static str>,
    description: Option<&'static str>,
    email: Option<&'static str>,
    phone: Option<&'static str>,
    /// (kind, url, label) as stored in the `links` column.
    links: &'static [(&'static str, &'static str, Option<&'static str>)],
}

const CARDS: &[SeedCard] = &[
    SeedCard {
        id: uuid::uuid!("0198c8a0-0000-7000-8000-000000000001"),
        owner: "seed-alice",
        slug: "alice-durand",
        old_slugs: &["alice"],
        state: CardState::Active,
        first_name: "Alice",
        last_name: "Durand",
        job_title: Some("Fondatrice"),
        company: Some("Atelier Durand & Fils"),
        description: Some("Créatrice de cartes ✨ — l'artisanat d'aujourd'hui"),
        email: Some("alice@example.test"),
        phone: Some("+33612345678"),
        links: &[
            ("linkedin", "https://www.linkedin.com/in/alice", None),
            ("custom", "https://alice.example.test", Some("Portfolio")),
        ],
    },
    SeedCard {
        id: uuid::uuid!("0198c8a0-0000-7000-8000-000000000002"),
        owner: "seed-alice",
        slug: "alice-archive",
        old_slugs: &[],
        state: CardState::DisabledByOwner,
        first_name: "Alice",
        last_name: "Durand",
        job_title: Some("Ancien poste"),
        company: None,
        description: None,
        email: None,
        phone: None,
        links: &[],
    },
    SeedCard {
        id: uuid::uuid!("0198c8a0-0000-7000-8000-000000000003"),
        owner: "seed-bob",
        slug: "bob-martin",
        old_slugs: &[],
        state: CardState::DisabledBySupport,
        first_name: "Bob",
        last_name: "Martin",
        job_title: None,
        company: None,
        description: None,
        email: None,
        phone: None,
        links: &[],
    },
    SeedCard {
        id: uuid::uuid!("0198c8a0-0000-7000-8000-000000000004"),
        owner: "seed-dan",
        slug: "dan-moreau",
        old_slugs: &[],
        state: CardState::Active,
        first_name: "Dan",
        last_name: "Moreau",
        job_title: None,
        company: None,
        description: None,
        email: None,
        phone: None,
        links: &[],
    },
];

/// Slugs of deleted cards, still reserved to their owner: (owner subject, slug).
const DELETED_CARD_SLUGS: &[(&str, &str)] = &[("seed-alice", "alice-ancienne")];

/// One card per state, completing `base` (load it first, the cards need its users): the
/// active card of Alice with an old slug, her card disabled by herself, a reserved slug of a
/// deleted card, Bob's card disabled by the support and Dan's card (Dan is suspended). No
/// media. The disabled cards were disabled at `now`. Seeding again puts these cards back to the
/// values above.
async fn cards(pool: &PgPool, now: DateTime<Utc>) -> Result<SeedReport, sqlx::Error> {
    let mut report = Vec::with_capacity(CARDS.len());
    for card in CARDS {
        let owner_id = user_id(pool, card.owner).await?;
        let owner_disabled_at = (card.state == CardState::DisabledByOwner).then_some(now);
        let support_disabled_at = (card.state == CardState::DisabledBySupport).then_some(now);
        let links = json!(
            card.links
                .iter()
                .map(|(kind, url, label)| json!({
                    "kind": kind,
                    "url": url,
                    "label": label.map(normalize),
                }))
                .collect::<Vec<_>>()
        );
        sqlx::query!(
            "insert into cards (id, owner_id, template, settings, theme, first_name, last_name, \
                 job_title, company, description, email, phone, links, \
                 owner_disabled_at, support_disabled_at) \
             values ($1, $2, $3, '{}', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) \
             on conflict (id) do update set \
                 owner_id = excluded.owner_id, \
                 template = excluded.template, \
                 settings = excluded.settings, \
                 theme = excluded.theme, \
                 first_name = excluded.first_name, \
                 last_name = excluded.last_name, \
                 job_title = excluded.job_title, \
                 company = excluded.company, \
                 description = excluded.description, \
                 email = excluded.email, \
                 phone = excluded.phone, \
                 links = excluded.links, \
                 owner_disabled_at = excluded.owner_disabled_at, \
                 support_disabled_at = excluded.support_disabled_at, \
                 updated_at = now()",
            card.id,
            owner_id,
            DEFAULT_TEMPLATE,
            json!({ "preset": DEFAULT_THEME_PRESET }),
            normalize(card.first_name),
            normalize(card.last_name),
            card.job_title.map(normalize),
            card.company.map(normalize),
            card.description.map(normalize),
            card.email.map(normalize),
            card.phone.map(normalize),
            links,
            owner_disabled_at,
            support_disabled_at,
        )
        .execute(pool)
        .await?;
        for old in card.old_slugs {
            reserve_slug(pool, old, owner_id, Some(card.id), false).await?;
        }
        reserve_slug(pool, card.slug, owner_id, Some(card.id), true).await?;
        report.push(SeededCard {
            id: card.id,
            slug: card.slug.to_string(),
            owner: card.owner.to_string(),
        });
    }
    for (owner, slug) in DELETED_CARD_SLUGS {
        let owner_id = user_id(pool, owner).await?;
        reserve_slug(pool, slug, owner_id, None, false).await?;
    }
    Ok(SeedReport {
        users: Vec::new(),
        cards: report,
        events: Vec::new(),
    })
}

async fn user_id(pool: &PgPool, subject: &str) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar!(
        "select id from users where issuer = $1 and subject = $2",
        TEST_ISSUER,
        subject,
    )
    .fetch_one(pool)
    .await
}

async fn reserve_slug(
    pool: &PgPool,
    slug: &str,
    owner_id: Uuid,
    card_id: Option<Uuid>,
    is_current: bool,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "insert into card_slugs (slug, owner_id, card_id, is_current) values ($1, $2, $3, $4) \
         on conflict (slug) do update set \
             owner_id = excluded.owner_id, \
             card_id = excluded.card_id, \
             is_current = excluded.is_current",
        normalize(slug),
        owner_id,
        card_id,
        is_current,
    )
    .execute(pool)
    .await?;
    Ok(())
}

const MINUTE: i64 = 1;
const HOUR: i64 = 60 * MINUTE;
const DAY: i64 = 24 * HOUR;

const fn standard_fields(
    first_name: FieldMode,
    last_name: FieldMode,
    email: FieldMode,
    phone: FieldMode,
    address: FieldMode,
) -> StandardFields {
    StandardFields {
        first_name,
        last_name,
        birth_date: FieldMode::Off,
        email,
        phone,
        address,
    }
}

const EMAIL_ONLY: StandardFields = standard_fields(
    FieldMode::Off,
    FieldMode::Off,
    FieldMode::Required,
    FieldMode::Off,
    FieldMode::Off,
);
const FIRST_NAME_AND_EMAIL: StandardFields = standard_fields(
    FieldMode::Required,
    FieldMode::Off,
    FieldMode::Required,
    FieldMode::Off,
    FieldMode::Off,
);
const FULL_NAME_AND_EMAIL: StandardFields = standard_fields(
    FieldMode::Required,
    FieldMode::Required,
    FieldMode::Required,
    FieldMode::Off,
    FieldMode::Off,
);

struct SeedCustomField {
    /// Fixed so that the answers of the seeded contacts keep pointing at the field.
    id: Uuid,
    label: &'static str,
    kind: CustomFieldKind,
    options: &'static [&'static str],
}

/// The custom field of the "Démonstration en boutique" event.
const SHOP_DEMO_FIELDS: &[SeedCustomField] = &[SeedCustomField {
    id: uuid::uuid!("0198c8a1-0000-7000-8000-000000000005"),
    label: "Rendez-vous souhaité",
    kind: CustomFieldKind::Datetime,
    options: &[],
}];

/// The custom fields of the `mariage` event, one of each kind.
const WEDDING_FIELDS: &[SeedCustomField] = &[
    SeedCustomField {
        id: uuid::uuid!("0198c8a1-0000-7000-8000-000000000001"),
        label: "Date du mariage",
        kind: CustomFieldKind::Date,
        options: &[],
    },
    SeedCustomField {
        id: uuid::uuid!("0198c8a1-0000-7000-8000-000000000002"),
        label: "Nombre d'invités",
        kind: CustomFieldKind::Number,
        options: &[],
    },
    SeedCustomField {
        id: uuid::uuid!("0198c8a1-0000-7000-8000-000000000003"),
        label: "Formule",
        kind: CustomFieldKind::SingleChoice,
        options: &["Essentielle", "Prestige"],
    },
    SeedCustomField {
        id: uuid::uuid!("0198c8a1-0000-7000-8000-000000000004"),
        label: "Recevoir la brochure",
        kind: CustomFieldKind::Checkbox,
        options: &[],
    },
];

/// The answer of a seeded contact to a custom field.
#[derive(Clone, Copy)]
enum SeedAnswer {
    Empty,
    Text(&'static str),
    Number(i64),
    Flag(bool),
}

impl SeedAnswer {
    fn to_json(self) -> serde_json::Value {
        match self {
            SeedAnswer::Empty => serde_json::Value::Null,
            SeedAnswer::Text(text) => json!(normalize(text)),
            SeedAnswer::Number(number) => json!(number),
            SeedAnswer::Flag(flag) => json!(flag),
        }
    }
}

struct SeedLead {
    id: Uuid,
    device_id: Uuid,
    /// Minutes from T0 (negative: in the past).
    submitted_minutes: i64,
    first_name: &'static str,
    last_name: Option<&'static str>,
    email: &'static str,
    phone: Option<&'static str>,
    /// One answer per custom field of the event, in order.
    custom: &'static [SeedAnswer],
    spam: bool,
}

struct SeedEvent {
    /// Fixed so that seeding again updates the same row.
    id: Uuid,
    /// Slug of the card the event belongs to.
    card_slug: &'static str,
    title: &'static str,
    /// Minutes from T0 (negative: in the past).
    starts_minutes: i64,
    /// Minutes from T0; `None`: until the owner ends it.
    ends_minutes: Option<i64>,
    access_code: Option<&'static str>,
    device_limit: i32,
    standard: StandardFields,
    custom: &'static [SeedCustomField],
    consent_text: Option<&'static str>,
    leads: &'static [SeedLead],
}

const EVENTS: &[SeedEvent] = &[
    SeedEvent {
        id: uuid::uuid!("0198c8a2-0000-7000-8000-000000000001"),
        card_slug: "alice-durand",
        title: "Salon du Mariage Clermont 2027",
        starts_minutes: -2 * HOUR,
        ends_minutes: Some(6 * HOUR),
        access_code: None,
        device_limit: 1,
        standard: standard_fields(
            FieldMode::Required,
            FieldMode::Required,
            FieldMode::Required,
            FieldMode::Optional,
            FieldMode::Optional,
        ),
        custom: WEDDING_FIELDS,
        consent_text: None,
        leads: &[
            SeedLead {
                id: uuid::uuid!("0198c8a3-0000-7000-8000-000000000001"),
                device_id: uuid::uuid!("0198c8a4-0000-7000-8000-000000000001"),
                submitted_minutes: -90 * MINUTE,
                first_name: "Éloïse",
                last_name: Some("D’Aubigné-Müller"),
                email: "eloise@example.test",
                phone: Some("+33612345678"),
                custom: &[
                    SeedAnswer::Text("2027-09-18"),
                    SeedAnswer::Number(120),
                    SeedAnswer::Text("Prestige"),
                    SeedAnswer::Flag(true),
                ],
                spam: false,
            },
            SeedLead {
                id: uuid::uuid!("0198c8a3-0000-7000-8000-000000000002"),
                device_id: uuid::uuid!("0198c8a4-0000-7000-8000-000000000002"),
                submitted_minutes: -60 * MINUTE,
                first_name: "Zoé",
                last_name: Some("Lefèvre ✨"),
                email: "zoe@example.test",
                phone: None,
                custom: &[
                    SeedAnswer::Empty,
                    SeedAnswer::Empty,
                    SeedAnswer::Empty,
                    SeedAnswer::Flag(false),
                ],
                spam: false,
            },
            SeedLead {
                id: uuid::uuid!("0198c8a3-0000-7000-8000-000000000003"),
                device_id: uuid::uuid!("0198c8a4-0000-7000-8000-000000000003"),
                submitted_minutes: -30 * MINUTE,
                first_name: "Bot",
                last_name: Some("Spam"),
                email: "bot@example.test",
                phone: None,
                custom: &[
                    SeedAnswer::Empty,
                    SeedAnswer::Empty,
                    SeedAnswer::Empty,
                    SeedAnswer::Flag(false),
                ],
                spam: true,
            },
        ],
    },
    SeedEvent {
        id: uuid::uuid!("0198c8a2-0000-7000-8000-000000000002"),
        card_slug: "alice-durand",
        title: "Portes ouvertes de l'Atelier",
        starts_minutes: -HOUR,
        ends_minutes: None,
        access_code: Some("Château"),
        device_limit: 2,
        standard: FIRST_NAME_AND_EMAIL,
        custom: &[],
        consent_text: Some(
            "Vos coordonnées restent chez l'Atelier Durand & Fils, qui ne les partage avec personne.",
        ),
        leads: &[],
    },
    SeedEvent {
        id: uuid::uuid!("0198c8a2-0000-7000-8000-000000000003"),
        card_slug: "alice-durand",
        title: "Démonstration en boutique",
        starts_minutes: -5 * MINUTE,
        ends_minutes: Some(2 * HOUR),
        access_code: None,
        device_limit: 1,
        standard: EMAIL_ONLY,
        custom: SHOP_DEMO_FIELDS,
        consent_text: None,
        leads: &[],
    },
    SeedEvent {
        id: uuid::uuid!("0198c8a2-0000-7000-8000-000000000004"),
        card_slug: "alice-durand",
        title: "Atelier découverte",
        starts_minutes: -3 * HOUR,
        ends_minutes: Some(-10 * MINUTE),
        access_code: None,
        device_limit: 1,
        standard: FIRST_NAME_AND_EMAIL,
        custom: &[],
        consent_text: None,
        leads: &[],
    },
    SeedEvent {
        id: uuid::uuid!("0198c8a2-0000-7000-8000-000000000005"),
        card_slug: "alice-durand",
        title: "Foire de Lyon",
        starts_minutes: 10 * DAY,
        ends_minutes: Some(12 * DAY),
        access_code: None,
        device_limit: 1,
        standard: EMAIL_ONLY,
        custom: &[],
        consent_text: None,
        leads: &[],
    },
    SeedEvent {
        id: uuid::uuid!("0198c8a2-0000-7000-8000-000000000006"),
        card_slug: "alice-durand",
        title: "Salon de Paris 2026",
        starts_minutes: -40 * DAY,
        ends_minutes: Some(-38 * DAY),
        access_code: None,
        device_limit: 1,
        standard: FULL_NAME_AND_EMAIL,
        custom: &[],
        consent_text: None,
        leads: &[SeedLead {
            id: uuid::uuid!("0198c8a3-0000-7000-8000-000000000004"),
            device_id: uuid::uuid!("0198c8a4-0000-7000-8000-000000000004"),
            submitted_minutes: -39 * DAY,
            first_name: "Jean-Michel",
            last_name: Some("Hébert"),
            email: "jean-michel@example.test",
            phone: None,
            custom: &[],
            spam: false,
        }],
    },
    SeedEvent {
        id: uuid::uuid!("0198c8a2-0000-7000-8000-000000000007"),
        card_slug: "alice-archive",
        title: "Événement archivé",
        starts_minutes: -HOUR,
        ends_minutes: Some(HOUR),
        access_code: None,
        device_limit: 1,
        standard: EMAIL_ONLY,
        custom: &[],
        consent_text: None,
        leads: &[],
    },
    SeedEvent {
        id: uuid::uuid!("0198c8a2-0000-7000-8000-000000000008"),
        card_slug: "bob-martin",
        title: "Salon bloqué",
        starts_minutes: -HOUR,
        ends_minutes: Some(HOUR),
        access_code: None,
        device_limit: 1,
        standard: EMAIL_ONLY,
        custom: &[],
        consent_text: None,
        leads: &[],
    },
];

/// Events of the seeded cards, completing `cards` (load it first), with dates relative to
/// `t0`, the current time of the API clock. At T0 the card `alice-durand` has exactly three
/// events running (`mariage`, `portes-ouvertes`, `demonstration`, the simultaneous-event limit),
/// one ended ten minutes ago and still taking submissions (`decouverte`), one upcoming and one
/// past; the disabled cards have an event each. Four contacts, one of them spam. Seeding again
/// puts everything back to the values above. Freeze the API clock before seeding: the dates
/// are relative to it.
async fn events(pool: &PgPool, t0: DateTime<Utc>) -> Result<SeedReport, sqlx::Error> {
    let mut report = Vec::with_capacity(EVENTS.len());
    for event in EVENTS {
        let card_id = sqlx::query_scalar!(
            r#"select card_id as "card_id!" from card_slugs where slug = $1 and is_current"#,
            normalize(event.card_slug),
        )
        .fetch_one(pool)
        .await?;
        let custom_fields: Vec<CustomField> = event
            .custom
            .iter()
            .map(|field| CustomField {
                id: field.id,
                label: normalize(field.label),
                kind: field.kind,
                required: false,
                help: None,
                options: field.options.iter().map(|o| normalize(o)).collect(),
            })
            .collect();
        let encode = |e| sqlx::Error::Encode(Box::new(e));
        sqlx::query!(
            "insert into events (id, card_id, title, starts_at, ends_at, access_code, \
                 device_limit, standard_fields, custom_fields, consent_text) \
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) \
             on conflict (id) do update set \
                 card_id = excluded.card_id, \
                 title = excluded.title, \
                 description = null, \
                 starts_at = excluded.starts_at, \
                 ends_at = excluded.ends_at, \
                 access_code = excluded.access_code, \
                 device_limit = excluded.device_limit, \
                 standard_fields = excluded.standard_fields, \
                 custom_fields = excluded.custom_fields, \
                 consent_text = excluded.consent_text, \
                 updated_at = now()",
            event.id,
            card_id,
            normalize(event.title),
            t0 + TimeDelta::minutes(event.starts_minutes),
            event
                .ends_minutes
                .map(|minutes| t0 + TimeDelta::minutes(minutes)),
            event.access_code.map(normalize),
            event.device_limit,
            serde_json::to_value(event.standard).map_err(encode)?,
            serde_json::to_value(&custom_fields).map_err(encode)?,
            event.consent_text.map(normalize),
        )
        .execute(pool)
        .await?;
        let card_content = seed_card_content(event.card_slug);
        for lead in event.leads {
            seed_lead(pool, event, &custom_fields, &card_content, lead, t0).await?;
        }
        report.push(SeededEvent {
            id: event.id,
            card_slug: event.card_slug.to_string(),
            title: normalize(event.title),
        });
    }
    Ok(SeedReport {
        users: Vec::new(),
        cards: Vec::new(),
        events: report,
    })
}

/// The content of the seeded card with this slug, as `cards` stored it.
fn seed_card_content(slug: &str) -> CardContent {
    let card = CARDS
        .iter()
        .find(|card| card.slug == slug)
        .expect("every seeded event belongs to a seeded card");
    let text = |value: Option<&str>| value.map(normalize);
    CardContent {
        first_name: Some(normalize(card.first_name)),
        last_name: Some(normalize(card.last_name)),
        job_title: text(card.job_title),
        company: text(card.company),
        description: text(card.description),
        email: text(card.email),
        phone: text(card.phone),
    }
}

async fn seed_lead(
    pool: &PgPool,
    event: &SeedEvent,
    custom_fields: &[CustomField],
    card_content: &CardContent,
    lead: &SeedLead,
    t0: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    let submitted_at = t0 + TimeDelta::minutes(lead.submitted_minutes);
    let spam_at = lead.spam.then_some(submitted_at + TimeDelta::minutes(5));
    let answers: Vec<AnswerSnapshot> = custom_fields
        .iter()
        .zip(lead.custom)
        .map(|(field, answer)| AnswerSnapshot {
            field_id: field.id,
            label: field.label.clone(),
            kind: field.kind,
            value: answer.to_json(),
        })
        .collect();
    // The text a real submission records: the owner's custom text, or the default one.
    let consent_text = consent_text(
        event.consent_text.map(normalize).as_deref(),
        card_content,
        event.title,
    );
    sqlx::query!(
        "insert into leads (id, event_id, device_id, submitted_at, first_name, last_name, email, \
             phone, custom_answers, consent_at, consent_text, spam_at) \
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $4, $10, $11) \
         on conflict (id) do update set \
             event_id = excluded.event_id, \
             device_id = excluded.device_id, \
             submitted_at = excluded.submitted_at, \
             first_name = excluded.first_name, \
             last_name = excluded.last_name, \
             email = excluded.email, \
             phone = excluded.phone, \
             custom_answers = excluded.custom_answers, \
             consent_at = excluded.consent_at, \
             consent_text = excluded.consent_text, \
             spam_at = excluded.spam_at",
        lead.id,
        event.id,
        lead.device_id,
        submitted_at,
        normalize(lead.first_name),
        lead.last_name.map(normalize),
        normalize(lead.email),
        lead.phone.map(normalize),
        serde_json::to_value(&answers).map_err(|e| sqlx::Error::Encode(Box::new(e)))?,
        consent_text,
        spam_at,
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_requires_development_or_test() {
        assert!(seed_allowed(Some("development")));
        assert!(seed_allowed(Some("test")));
        for value in [
            None,
            Some(""),
            Some("prod"),
            Some("production"),
            Some("PRODUCTION"),
            Some("Development"),
        ] {
            assert!(!seed_allowed(value), "{value:?}");
        }
    }

    #[test]
    fn base_is_registered() {
        assert!(scenario("base").is_some());
        assert!(scenario("missing").is_none());
    }

    #[test]
    fn cards_is_registered() {
        assert!(scenario("cards").is_some());
    }

    #[test]
    fn seeded_cards_are_already_nfc() {
        for card in CARDS {
            for text in [card.slug, card.first_name, card.last_name]
                .into_iter()
                .chain(
                    [
                        card.job_title,
                        card.company,
                        card.description,
                        card.email,
                        card.phone,
                    ]
                    .into_iter()
                    .flatten(),
                )
            {
                assert_eq!(normalize(text), text);
            }
        }
    }

    #[test]
    fn events_is_registered() {
        assert!(scenario("events").is_some());
    }

    #[test]
    fn seeded_events_are_already_nfc() {
        for event in EVENTS {
            for text in [event.card_slug, event.title]
                .into_iter()
                .chain(event.access_code)
                .chain(event.consent_text)
                .chain(event.custom.iter().map(|field| field.label))
                .chain(
                    event
                        .custom
                        .iter()
                        .flat_map(|field| field.options.iter().copied()),
                )
                .chain(event.leads.iter().flat_map(|lead| {
                    [lead.first_name, lead.email]
                        .into_iter()
                        .chain(lead.last_name)
                        .chain(lead.phone)
                }))
            {
                assert_eq!(normalize(text), text);
            }
        }
    }

    #[test]
    fn seeded_leads_answer_every_custom_field() {
        for event in EVENTS {
            for lead in event.leads {
                assert_eq!(lead.custom.len(), event.custom.len(), "{}", event.title);
            }
        }
    }

    #[test]
    fn seeded_names_are_already_nfc() {
        for (_, name, email, _) in BASE_USERS {
            assert_eq!(normalize(name), *name);
            assert_eq!(normalize(email), *email);
        }
    }
}
