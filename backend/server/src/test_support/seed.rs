//! Seed scenarios and database reset, shared by the `/api/test/*` routes and the
//! `cartouche-seed` binary.

use std::future::Future;
use std::pin::Pin;

use cartouche_domain::{DEFAULT_TEMPLATE, DEFAULT_THEME_PRESET, UserStatus, normalize};
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

/// What a scenario created. A scenario reports only its own rows: `base` the users, `cards`
/// the cards.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SeedReport {
    pub users: Vec<SeededUser>,
    pub cards: Vec<SeededCard>,
}

pub type Scenario = fn(&PgPool) -> BoxFuture<'_, Result<SeedReport, sqlx::Error>>;

/// Every scenario, by name.
pub const SCENARIOS: &[(&str, Scenario)] = &[
    ("base", |pool| Box::pin(base(pool))),
    ("cards", |pool| Box::pin(cards(pool))),
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
/// media. Seeding again puts these cards back to the values above.
async fn cards(pool: &PgPool) -> Result<SeedReport, sqlx::Error> {
    let mut report = Vec::with_capacity(CARDS.len());
    for card in CARDS {
        let owner_id = user_id(pool, card.owner).await?;
        let now = chrono::Utc::now();
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
    fn seeded_names_are_already_nfc() {
        for (_, name, email, _) in BASE_USERS {
            assert_eq!(normalize(name), *name);
            assert_eq!(normalize(email), *email);
        }
    }
}
