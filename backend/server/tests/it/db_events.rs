//! Owner-scoped event and lead queries against a real database.

use std::time::Duration;

use cartouche_api::db::cards;
use cartouche_api::db::events::{self, Event};
use cartouche_api::db::leads::{self, NewLead};
use cartouche_api::db::slugs;
use cartouche_api::test_support::seed;
use cartouche_domain::{
    AnswerSnapshot, CardInput, CustomField, CustomFieldKind, EventInput, FieldMode, Period,
    SlugClaim, StandardAnswers, StandardFields, ValidEvent, ValidLead, validate_card,
    validate_event,
};
use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use serde_json::json;
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

async fn create_card(pool: &PgPool, owner: Uuid, slug: &str) -> Uuid {
    let valid = validate_card(CardInput::new_card(slug, Some("Éloïse".to_string()), None))
        .expect("valid card");
    let card_id = Uuid::now_v7();
    let mut tx = pool.begin().await.unwrap();
    cards::insert(&mut tx, owner, card_id, &valid)
        .await
        .unwrap();
    slugs::apply_claim(&mut tx, owner, card_id, &valid.slug, SlugClaim::New)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    card_id
}

fn at(hour: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2027, 5, 10, hour, 0, 0).unwrap()
}

fn standard_fields() -> StandardFields {
    StandardFields {
        first_name: FieldMode::Required,
        last_name: FieldMode::Optional,
        birth_date: FieldMode::Optional,
        email: FieldMode::Required,
        phone: FieldMode::Off,
        address: FieldMode::Off,
    }
}

fn valid_event(
    title: &str,
    starts_at: DateTime<Utc>,
    ends_at: Option<DateTime<Utc>>,
) -> ValidEvent {
    validate_event(EventInput {
        title: title.to_string(),
        description: Some("Un salon d’été ✨".to_string()),
        starts_at: Some(starts_at),
        ends_at,
        access_code: Some("Château".to_string()),
        device_limit: 2,
        standard_fields: standard_fields(),
        custom_fields: vec![CustomField {
            id: Uuid::now_v7(),
            label: "Votre métier".to_string(),
            kind: CustomFieldKind::SingleChoice,
            required: false,
            help: Some("Une seule réponse".to_string()),
            options: vec!["Dév".to_string(), "Désigner".to_string()],
        }],
        consent_text: Some("J’accepte d’être recontacté·e".to_string()),
    })
    .expect("valid event")
}

async fn create_event(pool: &PgPool, owner: Uuid, card_id: Uuid, event: &ValidEvent) -> Event {
    let mut tx = pool.begin().await.unwrap();
    let created = events::insert(&mut tx, owner, card_id, Uuid::now_v7(), event)
        .await
        .unwrap()
        .expect("owner's card");
    tx.commit().await.unwrap();
    created
}

fn valid_lead(first_name: &str) -> ValidLead {
    ValidLead {
        standard: StandardAnswers {
            first_name: Some(first_name.to_string()),
            last_name: Some("D’Aubigné-Müller".to_string()),
            birth_date: NaiveDate::from_ymd_opt(1990, 2, 28),
            email: Some("eloise@example.com".to_string()),
            ..StandardAnswers::default()
        },
        custom: Vec::new(),
    }
}

async fn create_lead(
    pool: &PgPool,
    event_id: Uuid,
    device_id: Uuid,
    submitted_at: DateTime<Utc>,
    lead: &ValidLead,
) -> Uuid {
    let id = Uuid::now_v7();
    let mut tx = pool.begin().await.unwrap();
    leads::insert(
        &mut tx,
        &NewLead {
            id,
            event_id,
            device_id,
            submitted_at,
            lead,
            consent_text: "Consentement",
        },
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    id
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
async fn events_are_owner_scoped(pool: PgPool) {
    let alice = insert_user(&pool, "alice").await;
    let bob = insert_user(&pool, "bob").await;
    let card = create_card(&pool, alice, "alice").await;
    let original = valid_event("Salon", at(9), Some(at(17)));
    let event = create_event(&pool, alice, card, &original).await;

    // Reads.
    assert!(
        events::find_for_owner(&pool, bob, event.id)
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        events::list_for_card(&pool, bob, card)
            .await
            .unwrap()
            .is_none()
    );
    let own = events::list_for_card(&pool, alice, card)
        .await
        .unwrap()
        .expect("alice's card");
    assert_eq!(own.len(), 1);
    assert_eq!(own[0].event, event);

    // Writes.
    let mut tx = pool.begin().await.unwrap();
    assert!(
        events::lock_card_of_event(&mut tx, bob, event.id)
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        events::periods_of_card(&mut tx, bob, card, None)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        events::insert(&mut tx, bob, card, Uuid::now_v7(), &original)
            .await
            .unwrap()
            .is_none()
    );
    let other = valid_event("Piraté", at(10), None);
    assert!(
        events::update(&mut tx, bob, event.id, &other)
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        events::set_end(&mut tx, bob, event.id, Some(at(12)))
            .await
            .unwrap()
            .is_none()
    );
    tx.commit().await.unwrap();
    assert!(
        !events::delete_for_owner(&pool, bob, event.id)
            .await
            .unwrap()
    );

    // The row is intact, and Alice sees her own through the same functions.
    let intact = events::find_for_owner(&pool, alice, event.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(intact.event, event);
    let mut tx = pool.begin().await.unwrap();
    assert_eq!(
        events::lock_card_of_event(&mut tx, alice, event.id)
            .await
            .unwrap(),
        Some(card)
    );
    tx.commit().await.unwrap();
}

// spec: EVT-009
#[sqlx::test(migrations = "./migrations")]
async fn event_round_trip_update_and_end(pool: PgPool) {
    let alice = insert_user(&pool, "alice").await;
    let card = create_card(&pool, alice, "alice").await;
    let original = valid_event("Salon d’été ✨", at(9), None);
    let event = create_event(&pool, alice, card, &original).await;

    assert_eq!(event.title, "Salon d’été ✨");
    assert_eq!(event.description.as_deref(), Some("Un salon d’été ✨"));
    assert_eq!(event.period, original.period);
    assert_eq!(event.access_code.as_deref(), Some("Château"));
    assert_eq!(event.device_limit, 2);
    assert_eq!(event.form, original.form);
    assert_eq!(
        event.consent_text.as_deref(),
        Some("J’accepte d’être recontacté·e")
    );

    let replacement = valid_event("Salon d’automne", at(10), Some(at(18)));
    let mut tx = pool.begin().await.unwrap();
    let updated = events::update(&mut tx, alice, event.id, &replacement)
        .await
        .unwrap()
        .expect("owner's event");
    tx.commit().await.unwrap();
    assert_eq!(updated.id, event.id);
    assert_eq!(updated.title, "Salon d’automne");
    assert_eq!(updated.period, replacement.period);
    assert_eq!(updated.form, replacement.form);

    // « Terminer maintenant » at the very instant of the start is allowed (ends_at >= starts_at).
    let mut tx = pool.begin().await.unwrap();
    let ended = events::set_end(&mut tx, alice, event.id, Some(at(10)))
        .await
        .unwrap()
        .expect("owner's event");
    tx.commit().await.unwrap();
    assert_eq!(
        ended.period,
        Period {
            starts_at: at(10),
            ends_at: Some(at(10)),
        }
    );

    let periods = {
        let mut tx = pool.begin().await.unwrap();
        let all = events::periods_of_card(&mut tx, alice, card, None)
            .await
            .unwrap();
        let except = events::periods_of_card(&mut tx, alice, card, Some(event.id))
            .await
            .unwrap();
        (all, except)
    };
    assert_eq!(periods.0, vec![ended.period]);
    assert!(periods.1.is_empty());
}

// spec: EVT-009, EVT-024
#[sqlx::test(migrations = "./migrations")]
async fn deleting_an_event_deletes_its_leads(pool: PgPool) {
    let alice = insert_user(&pool, "alice").await;
    let card = create_card(&pool, alice, "alice").await;
    let kept = create_event(&pool, alice, card, &valid_event("Gardé", at(9), None)).await;
    let doomed = create_event(&pool, alice, card, &valid_event("Supprimé", at(10), None)).await;
    let lead = valid_lead("Éloïse");
    create_lead(&pool, kept.id, Uuid::now_v7(), at(11), &lead).await;
    create_lead(&pool, doomed.id, Uuid::now_v7(), at(11), &lead).await;
    create_lead(&pool, doomed.id, Uuid::now_v7(), at(12), &lead).await;

    let counted = events::find_for_owner(&pool, alice, doomed.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(counted.lead_count, 2);

    assert!(
        events::delete_for_owner(&pool, alice, doomed.id)
            .await
            .unwrap()
    );
    assert!(
        events::find_for_owner(&pool, alice, doomed.id)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(count(&pool, "events").await, 1);
    assert_eq!(count(&pool, "leads").await, 1);
}

// spec: LNK-012, MED-019
#[sqlx::test(migrations = "./migrations")]
async fn deleting_a_card_deletes_its_events_and_leads(pool: PgPool) {
    let alice = insert_user(&pool, "alice").await;
    let card = create_card(&pool, alice, "alice").await;
    let event = create_event(&pool, alice, card, &valid_event("Salon", at(9), None)).await;
    create_lead(&pool, event.id, Uuid::now_v7(), at(11), &valid_lead("Zoé")).await;

    let mut tx = pool.begin().await.unwrap();
    assert!(cards::delete_for_owner(&mut tx, alice, card).await.unwrap());
    tx.commit().await.unwrap();

    assert_eq!(count(&pool, "events").await, 0);
    assert_eq!(count(&pool, "leads").await, 0);
}

// spec: FRM-022, FRM-038, FRM-016
#[sqlx::test(migrations = "./migrations")]
async fn lead_round_trip_keeps_snapshots(pool: PgPool) {
    let alice = insert_user(&pool, "alice").await;
    let card = create_card(&pool, alice, "alice").await;
    let event = create_event(&pool, alice, card, &valid_event("Salon", at(9), None)).await;
    let snapshot = |label: &str, kind, value| AnswerSnapshot {
        field_id: Uuid::now_v7(),
        label: label.to_string(),
        kind,
        value,
    };
    let mut lead = valid_lead("Éloïse");
    lead.standard.last_name = Some("D’Aubigné-Müller".to_string());
    lead.standard.phone = Some("+33612345678".to_string());
    lead.standard.street = Some("12 rue de l’Église".to_string());
    lead.standard.postal_code = Some("75015".to_string());
    lead.standard.city = Some("Paris".to_string());
    lead.standard.country = Some("France".to_string());
    lead.custom = vec![
        snapshot("Zoé ✨", CustomFieldKind::Text, json!("Zoé ✨")),
        snapshot("Né le", CustomFieldKind::Date, json!("1990-02-28")),
        snapshot("Budget", CustomFieldKind::Number, json!(12.5)),
        snapshot("Métier", CustomFieldKind::SingleChoice, json!("Dév")),
        snapshot("Rappel ?", CustomFieldKind::Checkbox, json!(true)),
        snapshot("Remarque", CustomFieldKind::LongText, json!(null)),
    ];
    let device = Uuid::now_v7();
    let id = create_lead(&pool, event.id, device, at(11), &lead).await;

    let listed = leads::list_for_event(&pool, alice, event.id)
        .await
        .unwrap()
        .expect("alice's event");
    assert_eq!(listed.len(), 1);
    let stored = &listed[0];
    assert_eq!(stored.id, id);
    assert_eq!(stored.event_id, event.id);
    assert_eq!(stored.device_id, device);
    assert_eq!(stored.submitted_at, at(11));
    assert_eq!(stored.standard, lead.standard);
    assert_eq!(stored.custom, lead.custom);
    assert_eq!(stored.consent_text, "Consentement");
    assert_eq!(stored.consent_at, at(11));
    assert_eq!(stored.spam_at, None);
}

// spec: EVT-029, Review Focus 2
#[sqlx::test(migrations = "./migrations")]
async fn device_lock_serializes_submissions(pool: PgPool) {
    let alice = insert_user(&pool, "alice").await;
    let card = create_card(&pool, alice, "alice").await;
    let event = create_event(&pool, alice, card, &valid_event("Salon", at(9), None)).await;
    let device = Uuid::now_v7();
    let lead = valid_lead("Éloïse");

    let mut first = pool.begin().await.unwrap();
    leads::lock_device(&mut first, event.id, device)
        .await
        .unwrap();
    assert_eq!(
        leads::count_for_device(&mut first, event.id, device)
            .await
            .unwrap(),
        0
    );
    leads::insert(
        &mut first,
        &NewLead {
            id: Uuid::now_v7(),
            event_id: event.id,
            device_id: device,
            submitted_at: at(11),
            lead: &lead,
            consent_text: "Consentement",
        },
    )
    .await
    .unwrap();

    let second_pool = pool.clone();
    let second = tokio::spawn(async move {
        let mut tx = second_pool.begin().await.unwrap();
        leads::lock_device(&mut tx, event.id, device).await.unwrap();
        leads::count_for_device(&mut tx, event.id, device)
            .await
            .unwrap()
    });
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(!second.is_finished(), "the second submission must wait");

    first.commit().await.unwrap();
    assert_eq!(second.await.unwrap(), 1);
}

// spec: EVT-029
#[sqlx::test(migrations = "./migrations")]
async fn device_count_includes_spam_and_ignores_deleted_and_other_devices(pool: PgPool) {
    let alice = insert_user(&pool, "alice").await;
    let card = create_card(&pool, alice, "alice").await;
    let event = create_event(&pool, alice, card, &valid_event("Salon", at(9), None)).await;
    let device = Uuid::now_v7();
    let lead = valid_lead("Éloïse");
    let spam = create_lead(&pool, event.id, device, at(10), &lead).await;
    let deleted = create_lead(&pool, event.id, device, at(11), &lead).await;
    create_lead(&pool, event.id, Uuid::now_v7(), at(12), &lead).await;
    leads::set_spam(&pool, alice, spam, Some(at(13)))
        .await
        .unwrap()
        .unwrap();
    assert!(
        leads::delete_for_owner(&pool, alice, deleted)
            .await
            .unwrap()
    );

    let mut tx = pool.begin().await.unwrap();
    assert_eq!(
        leads::count_for_device(&mut tx, event.id, device)
            .await
            .unwrap(),
        1
    );
}

// spec: ABU-003, ABU-004, ACC-017
#[sqlx::test(migrations = "./migrations")]
async fn spam_and_delete_are_owner_scoped(pool: PgPool) {
    let alice = insert_user(&pool, "alice").await;
    let bob = insert_user(&pool, "bob").await;
    let card = create_card(&pool, alice, "alice").await;
    let event = create_event(&pool, alice, card, &valid_event("Salon", at(9), None)).await;
    let old = create_lead(
        &pool,
        event.id,
        Uuid::now_v7(),
        at(10),
        &valid_lead("Ancien"),
    )
    .await;
    let recent = create_lead(
        &pool,
        event.id,
        Uuid::now_v7(),
        at(11),
        &valid_lead("Récent"),
    )
    .await;

    assert!(
        leads::list_for_event(&pool, bob, event.id)
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        leads::set_spam(&pool, bob, old, Some(at(12)))
            .await
            .unwrap()
            .is_none()
    );
    assert!(!leads::delete_for_owner(&pool, bob, old).await.unwrap());
    assert_eq!(count(&pool, "leads").await, 2);

    // Newest first; the owner can mark and unmark.
    let listed = leads::list_for_event(&pool, alice, event.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        listed.iter().map(|lead| lead.id).collect::<Vec<_>>(),
        vec![recent, old]
    );
    assert_eq!(listed[0].spam_at, None);
    let marked = leads::set_spam(&pool, alice, old, Some(at(12)))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(marked.spam_at, Some(at(12)));
    let unmarked = leads::set_spam(&pool, alice, old, None)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(unmarked.spam_at, None);
    assert!(leads::delete_for_owner(&pool, alice, old).await.unwrap());
    assert_eq!(count(&pool, "leads").await, 1);
}

// spec: PUB-029
#[sqlx::test(migrations = "./migrations")]
async fn public_candidates_are_the_cards_events_by_start_then_title(pool: PgPool) {
    let alice = insert_user(&pool, "alice").await;
    let card = create_card(&pool, alice, "alice").await;
    let other_card = create_card(&pool, alice, "autre").await;
    let b = create_event(&pool, alice, card, &valid_event("B", at(10), None)).await;
    let a = create_event(&pool, alice, card, &valid_event("A", at(10), None)).await;
    let earlier = create_event(&pool, alice, card, &valid_event("Z", at(8), None)).await;
    let future = create_event(&pool, alice, card, &valid_event("Futur", at(20), None)).await;
    create_event(
        &pool,
        alice,
        other_card,
        &valid_event("Ailleurs", at(9), None),
    )
    .await;

    let candidates = events::candidates_public(&pool, card).await.unwrap();
    assert_eq!(
        candidates
            .iter()
            .map(|candidate| (candidate.id, candidate.title.as_str()))
            .collect::<Vec<_>>(),
        vec![
            (earlier.id, "Z"),
            (a.id, "A"),
            (b.id, "B"),
            (future.id, "Futur")
        ]
    );
    assert_eq!(candidates[0].period, earlier.period);

    // The public read of one event is scoped to its card.
    assert_eq!(
        events::find_public(&pool, card, a.id).await.unwrap(),
        Some(a.clone())
    );
    assert!(
        events::find_public(&pool, other_card, a.id)
            .await
            .unwrap()
            .is_none()
    );
}

// spec: ACC-008
#[sqlx::test(migrations = "./migrations")]
async fn reset_empties_event_tables(pool: PgPool) {
    let alice = insert_user(&pool, "alice").await;
    let card = create_card(&pool, alice, "alice").await;
    let event = create_event(&pool, alice, card, &valid_event("Salon", at(9), None)).await;
    create_lead(&pool, event.id, Uuid::now_v7(), at(11), &valid_lead("Zoé")).await;

    seed::reset(&pool).await.unwrap();

    assert_eq!(count(&pool, "events").await, 0);
    assert_eq!(count(&pool, "leads").await, 0);
}
