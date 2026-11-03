//! `cartouche-seed <reset | seed <scenario> | list>`: the same operations as the
//! `/api/test/*` routes, against `DATABASE_URL`. Test builds only (`test-support` feature).

use std::process::ExitCode;

use cartouche_api::db;
use cartouche_api::test_support::seed;

const USAGE: &str = "usage: cartouche-seed <reset | seed <scenario> | list>";

#[tokio::main]
async fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}

async fn run(args: &[String]) -> Result<(), String> {
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    match args.as_slice() {
        ["list"] => {
            for (name, _) in seed::SCENARIOS {
                println!("{name}");
            }
            Ok(())
        }
        ["reset"] => {
            let pool = connect().await?;
            seed::reset(&pool)
                .await
                .map_err(|e| format!("reset failed: {e}"))?;
            println!("reset: emptied {}", seed::RESET_TABLES.join(", "));
            Ok(())
        }
        ["seed", name] => {
            let run = seed::scenario(name).ok_or_else(|| {
                let known: Vec<&str> = seed::SCENARIOS.iter().map(|(n, _)| *n).collect();
                format!("unknown scenario `{name}` (known: {})", known.join(", "))
            })?;
            let pool = connect().await?;
            let report = run(&pool, chrono::Utc::now())
                .await
                .map_err(|e| format!("seed failed: {e}"))?;
            println!("seeded `{name}`: {} users", report.users.len());
            for user in &report.users {
                println!("  {} ({})", user.subject, user.status.as_str());
            }
            for card in &report.cards {
                println!("  card {} ({})", card.slug, card.owner);
            }
            for event in &report.events {
                println!("  event {} ({})", event.title, event.card_slug);
            }
            Ok(())
        }
        _ => Err(USAGE.to_string()),
    }
}

/// Connects to `DATABASE_URL` and brings the schema up to date, so that it works on a fresh
/// database. Refuses to run unless `APP_ENV` is `development` or `test`: `reset` is destructive.
async fn connect() -> Result<sqlx::PgPool, String> {
    if !seed::seed_allowed(std::env::var("APP_ENV").ok().as_deref()) {
        return Err(
            "refusing to run: APP_ENV must be `development` or `test` (absent or invalid means production)"
                .to_string(),
        );
    }
    let url = std::env::var("DATABASE_URL").map_err(|_| "DATABASE_URL is not set".to_string())?;
    let pool = db::connect(&url)
        .await
        .map_err(|e| format!("cannot connect to the database: {e}"))?;
    db::migrate(&pool)
        .await
        .map_err(|e| format!("migrations failed: {e}"))?;
    Ok(pool)
}
