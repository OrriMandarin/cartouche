use sqlx::PgPool;
use uuid::Uuid;

async fn insert_user(pool: &PgPool, subject: &str, status: &str) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        "insert into users (issuer, subject, status) values ('iss', $1, $2) returning id",
    )
    .bind(subject)
    .bind(status)
    .fetch_one(pool)
    .await
}

#[sqlx::test(migrations = "./migrations")]
async fn users_status_is_constrained(pool: PgPool) {
    for status in ["pending", "approved", "rejected", "suspended"] {
        insert_user(&pool, status, status).await.unwrap();
    }
    assert!(insert_user(&pool, "x", "admin").await.is_err());
}

#[sqlx::test(migrations = "./migrations")]
async fn users_issuer_and_subject_are_unique(pool: PgPool) {
    insert_user(&pool, "same", "pending").await.unwrap();
    assert!(insert_user(&pool, "same", "pending").await.is_err());
}

// Deleting a card or a media checks the foreign keys that point at it: each needs an index.
#[sqlx::test(migrations = "./migrations")]
async fn card_foreign_keys_are_indexed(pool: PgPool) {
    let indexes: Vec<String> = sqlx::query_scalar(
        "select indexname from pg_indexes where schemaname = current_schema() order by indexname",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    for expected in [
        "card_slugs_card_id_idx",
        "cards_header_media_idx",
        "cards_avatar_media_idx",
    ] {
        assert!(
            indexes.iter().any(|name| name == expected),
            "missing {expected} in {indexes:?}"
        );
    }
}
