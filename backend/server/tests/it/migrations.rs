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

// spec: TPL-025
#[sqlx::test(migrations = "./migrations")]
async fn theme_identifiers_are_renamed(pool: PgPool) {
    let owner = insert_user(&pool, "themes", "approved").await.unwrap();
    let cases = [
        (r#"{"preset":"clair"}"#, r#"{"preset":"craie"}"#),
        (
            r#"{"preset":"ocean"}"#,
            r#"{"preset":"minuit","font":"inter"}"#,
        ),
        (
            r#"{"preset":"ocean","font":"editorial"}"#,
            r#"{"preset":"minuit","font":"playfair"}"#,
        ),
        (
            r##"{"preset":"sable","font":"moderne","accent":"#123456"}"##,
            r##"{"preset":"ivoire","font":"inter","accent":"#123456"}"##,
        ),
        (
            r#"{"preset":"corail","header_gradient":10}"#,
            r#"{"preset":"terracotta","header_gradient":10}"#,
        ),
        (r#"{"preset":"zzz"}"#, r#"{"preset":"zzz"}"#),
    ];
    let mut ids = Vec::new();
    for (before, _) in cases {
        let id = Uuid::now_v7();
        sqlx::query(
            "insert into cards (id, owner_id, template, settings, theme) \
             values ($1, $2, 'classic', '{}', $3::jsonb)",
        )
        .bind(id)
        .bind(owner)
        .bind(before)
        .execute(&pool)
        .await
        .unwrap();
        ids.push(id);
    }
    let themes = |pool: PgPool, ids: Vec<Uuid>| async move {
        let mut out = Vec::new();
        for id in ids {
            let theme: serde_json::Value =
                sqlx::query_scalar("select theme from cards where id = $1")
                    .bind(id)
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            out.push(theme);
        }
        out
    };
    let expected: Vec<serde_json::Value> = cases
        .iter()
        .map(|(_, after)| serde_json::from_str(after).unwrap())
        .collect();

    sqlx::raw_sql(include_str!("../../migrations/0007_theme_ids.sql"))
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(themes(pool.clone(), ids.clone()).await, expected);

    sqlx::raw_sql(include_str!("../../migrations/0007_theme_ids.sql"))
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(themes(pool.clone(), ids).await, expected);
}
