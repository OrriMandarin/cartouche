use std::time::Duration;

use sqlx::PgPool;
use sqlx::migrate::Migrator;
use sqlx::postgres::PgPoolOptions;

pub static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

pub async fn connect(database_url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(5))
        .connect(database_url)
        .await
}

pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    MIGRATOR.run(pool).await
}

/// Cheap liveness check of the database connection, bounded in time.
pub async fn ping(pool: &PgPool) -> Result<(), sqlx::Error> {
    let query = sqlx::query_scalar::<_, i32>("select 1").fetch_one(pool);
    match tokio::time::timeout(Duration::from_secs(2), query).await {
        Ok(result) => result.map(|_| ()),
        Err(_) => Err(sqlx::Error::PoolTimedOut),
    }
}
