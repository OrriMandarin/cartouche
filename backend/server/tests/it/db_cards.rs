//! Owner-scoped card, slug and media queries against a real database.

use cartouche_api::db::cards::{self, Card};
use cartouche_api::db::media::{self, MediaRecord, StoredVariant};
use cartouche_api::db::slugs;
use cartouche_domain::{
    CardInput, MediaKind, Slot, SlugClaim, ValidCard, VariantFormat, validate_card,
};
use sqlx::PgPool;
use uuid::Uuid;

async fn insert_user(pool: &PgPool, subject: &str) -> Uuid {
    sqlx::query_scalar(
        "insert into users (issuer, subject, status) values ('iss', $1, 'approved') returning id",
    )
    .bind(subject)
    .fetch_one(pool)
    .await
    .unwrap()
}

fn valid_card(slug: &str) -> ValidCard {
    validate_card(CardInput::new_card(
        slug,
        Some("Éloïse".to_string()),
        Some("D’Aubigné-Müller ✨".to_string()),
    ))
    .expect("valid card")
}

/// Creates a card for `owner` and claims `slug` for it, in one committed transaction.
async fn create_card(pool: &PgPool, owner: Uuid, slug: &str) -> Card {
    let valid = valid_card(slug);
    let card_id = Uuid::now_v7();
    let mut tx = pool.begin().await.unwrap();
    let card = cards::insert(&mut tx, owner, card_id, &valid)
        .await
        .unwrap();
    slugs::apply_claim(&mut tx, owner, card_id, &valid.slug, SlugClaim::New)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    card
}

fn media_record(card_id: Uuid, slot: Slot) -> MediaRecord {
    MediaRecord {
        id: Uuid::now_v7(),
        card_id,
        slot,
        kind: MediaKind::Image,
        variants: vec![StoredVariant {
            name: "s256.webp".to_string(),
            width: 256,
            format: VariantFormat::Webp,
        }],
    }
}

async fn count(pool: &PgPool, table: &str) -> i64 {
    // Safe: `table` is a literal chosen by the tests.
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!("select count(*) from {table}")))
        .fetch_one(pool)
        .await
        .unwrap()
}

// spec: ACC-017
#[sqlx::test(migrations = "./migrations")]
async fn find_for_owner_ignores_other_owners(pool: PgPool) {
    let alice = insert_user(&pool, "alice").await;
    let bob = insert_user(&pool, "bob").await;
    let card = create_card(&pool, alice, "alice").await;

    assert_eq!(
        cards::find_for_owner(&pool, alice, card.id)
            .await
            .unwrap()
            .unwrap()
            .slug,
        "alice"
    );
    assert!(
        cards::find_for_owner(&pool, bob, card.id)
            .await
            .unwrap()
            .is_none()
    );
    assert!(cards::list_for_owner(&pool, bob).await.unwrap().is_empty());

    let mut tx = pool.begin().await.unwrap();
    let changed = valid_card("alice");
    assert!(
        cards::update(&mut tx, bob, card.id, &changed, None, None)
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        cards::set_owner_disabled(&mut tx, bob, card.id, Some(chrono::Utc::now()))
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        !cards::delete_for_owner(&mut tx, bob, card.id)
            .await
            .unwrap()
    );
    tx.commit().await.unwrap();

    let intact = cards::find_for_owner(&pool, alice, card.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(intact.owner_disabled_at, None);
    assert_eq!(count(&pool, "cards").await, 1);
}

// spec: LNK-003, LNK-004
#[sqlx::test(migrations = "./migrations")]
async fn new_slug_demotes_the_previous_one(pool: PgPool) {
    let alice = insert_user(&pool, "alice").await;
    let card = create_card(&pool, alice, "alice").await;

    let mut tx = pool.begin().await.unwrap();
    let longer = valid_card("alice-durand");
    slugs::apply_claim(&mut tx, alice, card.id, &longer.slug, SlugClaim::New)
        .await
        .unwrap();
    tx.commit().await.unwrap();

    let current: Vec<String> =
        sqlx::query_scalar("select slug from card_slugs where card_id = $1 and is_current")
            .bind(card.id)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(current, ["alice-durand"]);
    let old = slugs::find(&pool, "alice").await.unwrap().unwrap();
    assert_eq!(
        (old.owner_id, old.card_id, old.is_current),
        (alice, Some(card.id), false)
    );
    let reloaded = cards::find_for_owner(&pool, alice, card.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(reloaded.slug, "alice-durand");
}

// spec: LNK-025
#[sqlx::test(migrations = "./migrations")]
async fn reclaiming_an_old_slug_makes_it_current_again(pool: PgPool) {
    let alice = insert_user(&pool, "alice").await;
    let card = create_card(&pool, alice, "alice").await;
    let mut tx = pool.begin().await.unwrap();
    let longer = valid_card("alice-durand");
    slugs::apply_claim(&mut tx, alice, card.id, &longer.slug, SlugClaim::New)
        .await
        .unwrap();
    let first = valid_card("alice");
    slugs::apply_claim(&mut tx, alice, card.id, &first.slug, SlugClaim::ReclaimOwn)
        .await
        .unwrap();
    tx.commit().await.unwrap();

    let reloaded = cards::find_for_owner(&pool, alice, card.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(reloaded.slug, "alice");
    assert!(
        !slugs::find(&pool, "alice-durand")
            .await
            .unwrap()
            .unwrap()
            .is_current
    );
}

// spec: LNK-013, LNK-014
#[sqlx::test(migrations = "./migrations")]
async fn deleting_a_card_keeps_its_slugs_reserved(pool: PgPool) {
    let alice = insert_user(&pool, "alice").await;
    let card = create_card(&pool, alice, "alice").await;

    let mut tx = pool.begin().await.unwrap();
    assert!(
        cards::delete_for_owner(&mut tx, alice, card.id)
            .await
            .unwrap()
    );
    tx.commit().await.unwrap();

    assert_eq!(count(&pool, "cards").await, 0);
    let record = slugs::find(&pool, "alice").await.unwrap().unwrap();
    assert_eq!(
        (record.owner_id, record.card_id, record.is_current),
        (alice, None, false)
    );

    // The owner can attach the reserved slug to a new card.
    let again = valid_card("alice");
    let new_id = Uuid::now_v7();
    let mut tx = pool.begin().await.unwrap();
    cards::insert(&mut tx, alice, new_id, &again).await.unwrap();
    let existing = slugs::find_for_update(&mut tx, "alice").await.unwrap();
    assert_eq!(existing, Some(record));
    slugs::apply_claim(
        &mut tx,
        alice,
        new_id,
        &again.slug,
        SlugClaim::AttachReserved,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    let reattached = cards::find_for_owner(&pool, alice, new_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(reattached.slug, "alice");
}

// spec: LNK-022, Review Focus 3
#[sqlx::test(migrations = "./migrations")]
async fn concurrent_inserts_of_one_slug_fail_with_unique_violation(pool: PgPool) {
    let alice = insert_user(&pool, "alice").await;
    let bob = insert_user(&pool, "bob").await;
    let first = create_card(&pool, alice, "alice").await;
    let second = create_card(&pool, bob, "bob").await;
    let contested = valid_card("contested");

    let claim = |owner: Uuid, card_id: Uuid| {
        let pool = pool.clone();
        let slug = contested.slug.clone();
        async move {
            let mut tx = pool.begin().await?;
            slugs::apply_claim(&mut tx, owner, card_id, &slug, SlugClaim::New).await?;
            tx.commit().await?;
            Ok::<(), sqlx::Error>(())
        }
    };
    let (a, b) = tokio::join!(claim(alice, first.id), claim(bob, second.id));

    let results = [a, b];
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    let error = results.iter().find_map(|r| r.as_ref().err()).unwrap();
    assert!(slugs::is_unique_violation(error), "{error:?}");
}

// spec: MED-018
#[sqlx::test(migrations = "./migrations")]
async fn delete_unreferenced_keeps_attached_media(pool: PgPool) {
    let alice = insert_user(&pool, "alice").await;
    let bob = insert_user(&pool, "bob").await;
    let card = create_card(&pool, alice, "alice").await;

    let mut tx = pool.begin().await.unwrap();
    let attached = media::insert(&mut tx, alice, media_record(card.id, Slot::Header))
        .await
        .unwrap()
        .unwrap();
    let orphan_a = media::insert(&mut tx, alice, media_record(card.id, Slot::Avatar))
        .await
        .unwrap()
        .unwrap();
    let orphan_b = media::insert(&mut tx, alice, media_record(card.id, Slot::Avatar))
        .await
        .unwrap()
        .unwrap();
    let updated = cards::update(
        &mut tx,
        alice,
        card.id,
        &valid_card("alice"),
        Some(attached.id),
        None,
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(updated.header_media_id, Some(attached.id));
    tx.commit().await.unwrap();

    // Another owner removes nothing.
    let mut tx = pool.begin().await.unwrap();
    assert!(
        media::delete_unreferenced(&mut tx, bob, card.id)
            .await
            .unwrap()
            .is_empty()
    );
    tx.rollback().await.unwrap();
    assert_eq!(
        media::list_for_card(&pool, alice, card.id)
            .await
            .unwrap()
            .len(),
        3
    );

    let mut tx = pool.begin().await.unwrap();
    let mut removed: Vec<Uuid> = media::delete_unreferenced(&mut tx, alice, card.id)
        .await
        .unwrap()
        .into_iter()
        .map(|m| m.id)
        .collect();
    tx.commit().await.unwrap();
    removed.sort();
    let mut expected = vec![orphan_a.id, orphan_b.id];
    expected.sort();
    assert_eq!(removed, expected);

    let left = media::list_for_card(&pool, alice, card.id).await.unwrap();
    assert_eq!(left, vec![attached.clone()]);
    assert_eq!(
        media::find_for_owner(&pool, alice, attached.id)
            .await
            .unwrap(),
        Some(attached.clone())
    );
    assert!(
        media::find_for_owner(&pool, bob, attached.id)
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        media::list_for_card(&pool, bob, card.id)
            .await
            .unwrap()
            .is_empty()
    );
}

// spec: ACC-017
#[sqlx::test(migrations = "./migrations")]
async fn deleting_a_card_deletes_its_media_and_status_follows_the_switches(pool: PgPool) {
    use cartouche_domain::CardStatus;
    let alice = insert_user(&pool, "alice").await;
    let card = create_card(&pool, alice, "alice").await;
    let mut tx = pool.begin().await.unwrap();
    media::insert(&mut tx, alice, media_record(card.id, Slot::Avatar))
        .await
        .unwrap()
        .unwrap();
    tx.commit().await.unwrap();

    let mut tx = pool.begin().await.unwrap();
    let disabled = cards::set_owner_disabled(&mut tx, alice, card.id, Some(chrono::Utc::now()))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(disabled.status(), CardStatus::Disabled);
    let enabled = cards::set_owner_disabled(&mut tx, alice, card.id, None)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(enabled.status(), CardStatus::Active);
    tx.commit().await.unwrap();

    let mut tx = pool.begin().await.unwrap();
    assert!(
        cards::delete_for_owner(&mut tx, alice, card.id)
            .await
            .unwrap()
    );
    tx.commit().await.unwrap();
    assert_eq!(count(&pool, "media").await, 0);
}

// spec: ACC-017
#[sqlx::test(migrations = "./migrations")]
async fn content_and_links_round_trip(pool: PgPool) {
    let alice = insert_user(&pool, "alice").await;
    let card = create_card(&pool, alice, "alice").await;
    let mut input = CardInput::new_card(
        "alice",
        Some("Éloïse".into()),
        Some("D’Aubigné-Müller ✨".into()),
    );
    input.content.phone = Some("+33 6 12 34 56 78".into());
    input.content.email = Some("eloise@example.com".into());
    input.links = vec![cartouche_domain::LinkInput {
        kind: cartouche_domain::LinkKind::Linkedin,
        url: "https://linkedin.com/in/eloise".into(),
        label: Some("LinkedIn ✨".into()),
    }];
    let valid = validate_card(input).unwrap();

    let mut tx = pool.begin().await.unwrap();
    let saved = cards::update(&mut tx, alice, card.id, &valid, None, None)
        .await
        .unwrap()
        .unwrap();
    tx.commit().await.unwrap();

    assert_eq!(saved.content, valid.content);
    assert_eq!(saved.links, valid.links);
    assert_eq!(saved.template, valid.template);
    assert_eq!(saved.theme, serde_json::to_value(&valid.theme).unwrap());
    assert!(saved.updated_at >= card.updated_at);
}

#[cfg(feature = "test-support")]
#[sqlx::test(migrations = "./migrations")]
async fn reset_empties_card_tables(pool: PgPool) {
    let alice = insert_user(&pool, "alice").await;
    let card = create_card(&pool, alice, "alice").await;
    let mut tx = pool.begin().await.unwrap();
    media::insert(&mut tx, alice, media_record(card.id, Slot::Header))
        .await
        .unwrap()
        .unwrap();
    tx.commit().await.unwrap();

    cartouche_api::test_support::seed::reset(&pool)
        .await
        .unwrap();

    for table in ["cards", "card_slugs", "media", "users"] {
        assert_eq!(count(&pool, table).await, 0, "{table}");
    }
}

// spec: ACC-017
#[sqlx::test(migrations = "./migrations")]
async fn media_insert_is_scoped_to_the_card_owner(pool: PgPool) {
    let alice = insert_user(&pool, "alice").await;
    let bob = insert_user(&pool, "bob").await;
    let card = create_card(&pool, alice, "alice").await;

    let mut tx = pool.begin().await.unwrap();
    let refused = media::insert(&mut tx, bob, media_record(card.id, Slot::Header))
        .await
        .unwrap();
    tx.commit().await.unwrap();

    assert!(refused.is_none());
    assert_eq!(count(&pool, "media").await, 0);
}

// spec: ACC-017
#[sqlx::test(migrations = "./migrations")]
async fn update_refuses_media_of_another_card_or_slot(pool: PgPool) {
    let alice = insert_user(&pool, "alice").await;
    let bob = insert_user(&pool, "bob").await;
    let alices = create_card(&pool, alice, "alice").await;
    let bobs = create_card(&pool, bob, "bob").await;
    let mut tx = pool.begin().await.unwrap();
    let bobs_header = media::insert(&mut tx, bob, media_record(bobs.id, Slot::Header))
        .await
        .unwrap()
        .unwrap();
    let alices_avatar = media::insert(&mut tx, alice, media_record(alices.id, Slot::Avatar))
        .await
        .unwrap()
        .unwrap();
    let alices_header = media::insert(&mut tx, alice, media_record(alices.id, Slot::Header))
        .await
        .unwrap()
        .unwrap();
    tx.commit().await.unwrap();

    let valid = valid_card("alice");
    let mut tx = pool.begin().await.unwrap();
    // A media of Bob's card, a media in the wrong slot, and the wrong slot for avatar.
    assert!(
        cards::update(
            &mut tx,
            alice,
            alices.id,
            &valid,
            Some(bobs_header.id),
            None
        )
        .await
        .unwrap()
        .is_none()
    );
    assert!(
        cards::update(
            &mut tx,
            alice,
            alices.id,
            &valid,
            Some(alices_avatar.id),
            None
        )
        .await
        .unwrap()
        .is_none()
    );
    assert!(
        cards::update(
            &mut tx,
            alice,
            alices.id,
            &valid,
            None,
            Some(alices_header.id)
        )
        .await
        .unwrap()
        .is_none()
    );
    tx.commit().await.unwrap();

    let unchanged = cards::find_for_owner(&pool, alice, alices.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        (unchanged.header_media_id, unchanged.avatar_media_id),
        (None, None)
    );
    assert_eq!(unchanged.updated_at, alices.updated_at);

    let mut tx = pool.begin().await.unwrap();
    let saved = cards::update(
        &mut tx,
        alice,
        alices.id,
        &valid,
        Some(alices_header.id),
        Some(alices_avatar.id),
    )
    .await
    .unwrap()
    .unwrap();
    tx.commit().await.unwrap();
    assert_eq!(
        (saved.header_media_id, saved.avatar_media_id),
        (Some(alices_header.id), Some(alices_avatar.id))
    );
}
