//! Seed scenarios and database reset, shared by the `/api/test/*` routes and the
//! `cartouche-seed` binary.

use std::future::Future;
use std::pin::Pin;

use cartouche_domain::{UserStatus, normalize};
use serde::Serialize;
use sqlx::PgPool;

use crate::config::AppEnv;
use crate::startup::TEST_ISSUER;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Tables emptied by `reset`, in one place: later plans add theirs here.
pub const RESET_TABLES: &[&str] = &["audit_log", "media", "card_slugs", "cards", "users"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SeededUser {
    pub subject: String,
    pub status: UserStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SeedReport {
    pub users: Vec<SeededUser>,
}

pub type Scenario = fn(&PgPool) -> BoxFuture<'_, Result<SeedReport, sqlx::Error>>;

/// Every scenario, by name.
pub const SCENARIOS: &[(&str, Scenario)] = &[("base", |pool| Box::pin(base(pool)))];

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
    Ok(SeedReport { users })
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
    fn seeded_names_are_already_nfc() {
        for (_, name, email, _) in BASE_USERS {
            assert_eq!(normalize(name), *name);
            assert_eq!(normalize(email), *email);
        }
    }
}
