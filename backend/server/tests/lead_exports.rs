mod common;

use axum::http::StatusCode;
use common::cards::{cards_app, create_card, merge, token};
use common::events::{
    create_event, delete_lead, event_body, get_leads, put_event, put_spam, send_lead,
};
use common::{TestApp, TestResponse};
use serde_json::{Value, json};
use sqlx::PgPool;

const SLUG: &str = "alice-durand";
const CSV_TYPE: &str = "text/csv; charset=utf-8";
const XLSX_TYPE: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

fn id_of(value: &Value) -> &str {
    value["id"].as_str().expect("an id")
}

fn error_code(res: &TestResponse) -> &str {
    res.json["error"]["code"].as_str().unwrap_or_default()
}

fn header_of<'a>(res: &'a TestResponse, name: &str) -> &'a str {
    res.headers
        .get(name)
        .unwrap_or_else(|| panic!("no {name} header"))
        .to_str()
        .expect("a text header")
}

/// An event of Alice's card running since 10:00 without end (the clock is at 12:00), with the
/// given title.
async fn running_event(app: &TestApp, card: &Value, title: &str) -> Value {
    let mut body = event_body("2026-01-15T10:00:00Z", None);
    merge(&mut body, json!({ "title": title }));
    create_event(app, "alice", id_of(card), body).await
}

/// Sends a lead with a distinct e-mail address and returns that address.
async fn send_to(app: &TestApp, event: &Value, email: &str) -> String {
    send_lead(
        app,
        SLUG,
        id_of(event),
        json!({ "answers": { "email": email } }),
    )
    .await;
    app.clock.advance(chrono::Duration::seconds(1));
    email.to_string()
}

async fn export(app: &TestApp, sub: &str, path: &str, query: &str) -> TestResponse {
    let url = if query.is_empty() {
        path.to_string()
    } else {
        format!("{path}?{query}")
    };
    app.request("GET", &url, Some(&token(sub)), None).await
}

fn event_path(event: &Value) -> String {
    format!("/api/events/{}/leads/export", id_of(event))
}

fn card_path(card: &Value) -> String {
    format!("/api/cards/{}/leads/export", id_of(card))
}

/// The CSV text without its byte order mark, one entry per line.
fn csv_lines(res: &TestResponse) -> Vec<String> {
    let text = std::str::from_utf8(&res.body).expect("UTF-8");
    text.strip_prefix('\u{feff}')
        .expect("a byte order mark")
        .lines()
        .map(str::to_string)
        .collect()
}

/// An event with two leads and a third one marked as spam.
async fn event_with_three_leads(app: &TestApp) -> (Value, Value, [String; 3]) {
    let card = create_card(app, "alice", SLUG).await;
    let event = running_event(app, &card, "Salon du Mariage Clermont 2027").await;
    let first = send_to(app, &event, "eloise@example.com").await;
    let second = send_to(app, &event, "zoe@example.com").await;
    let spam = send_to(app, &event, "pub@example.com").await;
    let listed = get_leads(app, "alice", id_of(&event)).await;
    let spam_lead = listed.json["leads"]
        .as_array()
        .unwrap()
        .iter()
        .find(|lead| lead["answers"]["email"] == spam.as_str())
        .unwrap()
        .clone();
    let marked = put_spam(app, "alice", id_of(&spam_lead), true).await;
    assert_eq!(marked.status, StatusCode::OK, "{}", marked.json);
    (card, event, [first, second, spam])
}

// spec: LEA-006, LEA-021, LEA-032
#[sqlx::test(migrations = "./migrations")]
async fn event_csv_download(pool: PgPool) {
    let app = cards_app(pool).await;
    let (_, event, [first, second, spam]) = event_with_three_leads(&app).await;

    let res = export(&app, "alice", &event_path(&event), "format=csv").await;

    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    assert_eq!(header_of(&res, "content-type"), CSV_TYPE);
    assert_eq!(
        header_of(&res, "content-disposition"),
        "attachment; filename=\"contacts-alice-durand-salon-du-mariage-clermont-2027-2026-01-15.csv\""
    );
    assert_eq!(header_of(&res, "cache-control"), "no-store");
    assert_eq!(&res.body[..3], [0xEF, 0xBB, 0xBF], "a byte order mark");
    let lines = csv_lines(&res);
    assert_eq!(lines.len(), 3, "one header and two contacts: {lines:?}");
    // Oldest submission first.
    assert!(lines[1].contains(&first), "{}", lines[1]);
    assert!(lines[2].contains(&second), "{}", lines[2]);
    assert!(!res.body.windows(spam.len()).any(|w| w == spam.as_bytes()));
}

// spec: LEA-012
#[sqlx::test(migrations = "./migrations")]
async fn spam_is_included_only_on_request(pool: PgPool) {
    let app = cards_app(pool).await;
    let (_, event, [.., spam]) = event_with_three_leads(&app).await;

    let res = export(
        &app,
        "alice",
        &event_path(&event),
        "format=csv&include_spam=true",
    )
    .await;

    assert_eq!(res.status, StatusCode::OK, "{}", res.json);
    let lines = csv_lines(&res);
    assert_eq!(lines.len(), 4, "{lines:?}");
    assert!(lines[3].contains(&spam), "{}", lines[3]);
    assert!(lines[3].ends_with("Oui"), "{}", lines[3]);
    assert!(lines[1].ends_with("Non"), "{}", lines[1]);

    let explicit = export(
        &app,
        "alice",
        &event_path(&event),
        "format=csv&include_spam=false",
    )
    .await;
    assert_eq!(csv_lines(&explicit).len(), 3);
}

// spec: LEA-006, LEA-013, LEA-030
#[sqlx::test(migrations = "./migrations")]
async fn card_exports_in_xlsx_and_json(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", SLUG).await;
    let salon = running_event(&app, &card, "Salon du Mariage").await;
    let forum = running_event(&app, &card, "Forum des Mariés").await;
    send_to(&app, &salon, "eloise@example.com").await;
    send_to(&app, &forum, "zoe@example.com").await;

    let xlsx = export(&app, "alice", &card_path(&card), "format=xlsx").await;
    assert_eq!(xlsx.status, StatusCode::OK, "{}", xlsx.json);
    assert_eq!(header_of(&xlsx, "content-type"), XLSX_TYPE);
    assert_eq!(
        header_of(&xlsx, "content-disposition"),
        "attachment; filename=\"contacts-alice-durand-2026-01-15.xlsx\""
    );
    assert_eq!(&xlsx.body[..2], b"PK");

    let json = export(&app, "alice", &card_path(&card), "format=json").await;
    assert_eq!(json.status, StatusCode::OK);
    assert_eq!(header_of(&json, "content-type"), "application/json");
    assert_eq!(header_of(&json, "cache-control"), "no-store");
    assert_eq!(json.json["event"], Value::Null);
    assert_eq!(json.json["card"]["slug"], SLUG);
    assert_eq!(json.json["card"]["id"], card["id"]);
    let leads = json.json["leads"].as_array().expect("leads");
    assert_eq!(leads.len(), 2);
    let titles: Vec<&str> = leads
        .iter()
        .map(|lead| lead["event"]["title"].as_str().unwrap())
        .collect();
    assert_eq!(titles, ["Salon du Mariage", "Forum des Mariés"]);
}

// spec: ACC-017
#[sqlx::test(migrations = "./migrations")]
async fn exports_of_another_user_are_404(pool: PgPool) {
    let app = cards_app(pool).await;
    let (card, event, _) = event_with_three_leads(&app).await;
    create_card(&app, "bob", "bob-martin").await;

    for sub in ["bob", "boss"] {
        for format in ["csv", "xlsx", "json"] {
            let query = format!("format={format}");
            for path in [event_path(&event), card_path(&card)] {
                let res = export(&app, sub, &path, &query).await;
                assert_eq!(res.status, StatusCode::NOT_FOUND, "{sub} {path} {format}");
                assert_eq!(error_code(&res), "not_found");
                assert!(res.headers.get("content-disposition").is_none());
            }
        }
    }

    let anonymous = app
        .request(
            "GET",
            &format!("{}?format=csv", event_path(&event)),
            None,
            None,
        )
        .await;
    assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED);
}

// spec: LNK-008
#[sqlx::test(migrations = "./migrations")]
async fn disabled_card_stays_exportable(pool: PgPool) {
    let app = cards_app(pool.clone()).await;
    let (card, event, _) = event_with_three_leads(&app).await;
    let disabled = app
        .request(
            "POST",
            &format!("/api/cards/{}/disable", id_of(&card)),
            Some(&token("alice")),
            None,
        )
        .await;
    assert_eq!(disabled.status, StatusCode::OK);

    let by_owner = export(&app, "alice", &event_path(&event), "format=csv").await;
    assert_eq!(by_owner.status, StatusCode::OK, "{}", by_owner.json);

    sqlx::query("update cards set support_disabled_at = now() where id = $1::uuid")
        .bind(id_of(&card))
        .execute(&pool)
        .await
        .unwrap();
    for path in [event_path(&event), card_path(&card)] {
        let res = export(&app, "alice", &path, "format=json").await;
        assert_eq!(res.status, StatusCode::OK, "{path}: {}", res.json);
    }
}

// spec: LEA-005
#[sqlx::test(migrations = "./migrations")]
async fn deleted_lead_is_not_exported(pool: PgPool) {
    let app = cards_app(pool).await;
    let (card, event, [first, second, _]) = event_with_three_leads(&app).await;
    let listed = get_leads(&app, "alice", id_of(&event)).await;
    let doomed = listed.json["leads"]
        .as_array()
        .unwrap()
        .iter()
        .find(|lead| lead["answers"]["email"] == first.as_str())
        .unwrap();
    let deleted = delete_lead(&app, "alice", id_of(doomed)).await;
    assert_eq!(deleted.status, StatusCode::NO_CONTENT);

    for path in [event_path(&event), card_path(&card)] {
        for format in ["csv", "json"] {
            let res = export(&app, "alice", &path, &format!("format={format}")).await;
            assert_eq!(res.status, StatusCode::OK);
            let text = std::str::from_utf8(&res.body).unwrap();
            assert!(!text.contains(&first), "{path} {format}");
            assert!(text.contains(&second), "{path} {format}");
        }
    }
}

// spec: LEA-026
#[sqlx::test(migrations = "./migrations")]
async fn time_zone_parameter(pool: PgPool) {
    let app = cards_app(pool).await;
    let (_, event, _) = event_with_three_leads(&app).await;
    // 04:30 UTC: already the 15th in Paris, still the 14th in New York.
    app.clock.set("2026-01-15T04:30:00Z".parse().unwrap());

    let paris = export(&app, "alice", &event_path(&event), "format=csv").await;
    let new_york = export(
        &app,
        "alice",
        &event_path(&event),
        "format=csv&tz=America/New_York",
    )
    .await;
    let unknown = export(
        &app,
        "alice",
        &event_path(&event),
        "format=csv&tz=Nowhere/Land",
    )
    .await;

    for (res, zone) in [(&paris, "Europe/Paris"), (&unknown, "Europe/Paris")] {
        assert_eq!(res.status, StatusCode::OK);
        assert!(csv_lines(res)[0].contains(&format!("Date d'envoi ({zone})")));
        assert!(header_of(res, "content-disposition").ends_with("-2026-01-15.csv\""));
    }
    assert_eq!(new_york.status, StatusCode::OK);
    let header = &csv_lines(&new_york)[0];
    assert!(
        header.contains("Date d'envoi (America/New_York)"),
        "{header}"
    );
    assert!(header_of(&new_york, "content-disposition").ends_with("-2026-01-14.csv\""));
    // The leads were sent at 12:00 UTC: 13:00 in Paris, 07:00 in New York.
    assert!(
        csv_lines(&paris)[1].contains("13:00"),
        "{}",
        csv_lines(&paris)[1]
    );
    assert!(
        csv_lines(&new_york)[1].contains("07:00"),
        "{}",
        csv_lines(&new_york)[1]
    );
}

// spec: LEA-006
#[sqlx::test(migrations = "./migrations")]
async fn format_is_required_and_checked(pool: PgPool) {
    let app = cards_app(pool).await;
    let (card, event, _) = event_with_three_leads(&app).await;

    for path in [event_path(&event), card_path(&card)] {
        for query in [
            "",
            "format=pdf",
            "format=CSV",
            "format=csv&include_spam=maybe",
        ] {
            let res = export(&app, "alice", &path, query).await;
            assert_eq!(res.status, StatusCode::BAD_REQUEST, "{path}?{query}");
            assert_eq!(error_code(&res), "invalid_request");
        }
    }
}

// spec: FRM-023, LEA-024
#[sqlx::test(migrations = "./migrations")]
async fn a_deleted_field_keeps_its_column(pool: PgPool) {
    let app = cards_app(pool).await;
    let card = create_card(&app, "alice", SLUG).await;
    let event = running_event(&app, &card, "Salon du Mariage").await;
    send_to(&app, &event, "eloise@example.com").await;
    let saved = put_event(&app, "alice", id_of(&event), json!({ "custom_fields": [] })).await;
    assert_eq!(saved.status, StatusCode::OK, "{}", saved.json);

    let res = export(&app, "alice", &event_path(&event), "format=csv").await;

    assert_eq!(res.status, StatusCode::OK);
    let lines = csv_lines(&res);
    assert!(lines[0].contains("Formule"), "{}", lines[0]);
    assert!(lines[1].contains("Essentielle"), "{}", lines[1]);
}
