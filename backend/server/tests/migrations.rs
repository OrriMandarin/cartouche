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

#[sqlx::test(migrations = "./migrations")]
async fn audit_log_requires_an_existing_actor(pool: PgPool) {
    let insert = |actor: Uuid| {
        let pool = pool.clone();
        async move {
            sqlx::query(
                "insert into audit_log (actor_user_id, action, target_type, target_id) \
                 values ($1, 'approve', 'user', $2)",
            )
            .bind(actor)
            .bind(Uuid::now_v7())
            .execute(&pool)
            .await
        }
    };
    assert!(insert(Uuid::now_v7()).await.is_err());
    let actor = insert_user(&pool, "admin", "approved").await.unwrap();
    insert(actor).await.unwrap();
}
