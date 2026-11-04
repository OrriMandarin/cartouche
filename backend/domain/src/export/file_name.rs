//! The name of an export file (LEA-022).

use chrono::NaiveDate;

use super::{ExportFormat, labels};
use crate::slug::slug_form;

const MAX_EVENT_CHARS: usize = 40;

/// `contacts-<slug>-<event>-<date>.<ext>` for an event, `contacts-<slug>-<date>.<ext>` for the
/// whole card.
pub fn export_file_name(
    card_slug: &str,
    event_title: Option<&str>,
    today: NaiveDate,
    format: ExportFormat,
) -> String {
    let date = today.format("%Y-%m-%d");
    let extension = format.extension();
    match event_title {
        Some(title) => {
            let event = slug_form(title, MAX_EVENT_CHARS)
                .unwrap_or_else(|| labels::EVENT_SLUG_FALLBACK.to_string());
            format!("contacts-{card_slug}-{event}-{date}.{extension}")
        }
        None => format!("contacts-{card_slug}-{date}.{extension}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date() -> NaiveDate {
        NaiveDate::from_ymd_opt(2027, 3, 15).unwrap()
    }

    // spec: LEA-022
    #[test]
    fn file_names() {
        assert_eq!(
            export_file_name(
                "alice-durand",
                Some("Salon du Mariage Clermont 2027"),
                date(),
                ExportFormat::Csv
            ),
            "contacts-alice-durand-salon-du-mariage-clermont-2027-2027-03-15.csv"
        );
        assert_eq!(
            export_file_name("alice-durand", None, date(), ExportFormat::Xlsx),
            "contacts-alice-durand-2027-03-15.xlsx"
        );
        assert_eq!(
            export_file_name(
                "alice-durand",
                Some("Fête d’été ✨"),
                date(),
                ExportFormat::Json
            ),
            "contacts-alice-durand-fete-d-ete-2027-03-15.json"
        );
    }

    // spec: LEA-022
    #[test]
    fn a_title_without_letters_gives_the_fallback() {
        assert_eq!(
            export_file_name("alice-durand", Some("!!!"), date(), ExportFormat::Csv),
            "contacts-alice-durand-evenement-2027-03-15.csv"
        );
    }

    // spec: LEA-022
    #[test]
    fn a_long_title_is_cut_to_40_characters_without_a_trailing_hyphen() {
        let title = format!("{} {}", "a".repeat(39), "b".repeat(20));
        assert_eq!(
            export_file_name("alice-durand", Some(&title), date(), ExportFormat::Csv),
            format!("contacts-alice-durand-{}-2027-03-15.csv", "a".repeat(39))
        );
        let title = "c".repeat(60);
        assert_eq!(
            export_file_name("alice-durand", Some(&title), date(), ExportFormat::Csv),
            format!("contacts-alice-durand-{}-2027-03-15.csv", "c".repeat(40))
        );
    }
}
