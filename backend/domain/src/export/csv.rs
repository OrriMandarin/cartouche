//! The CSV writer (LEA-007, LEA-027, LEA-028).

use ::csv::{QuoteStyle, Terminator, WriterBuilder};

use super::{Cell, ExportTable, labels};

const BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];

/// Writes the table as CSV: UTF-8 with a BOM, CRLF line ends, header row first.
pub fn write(table: &ExportTable) -> Vec<u8> {
    let mut writer = WriterBuilder::new()
        .terminator(Terminator::CRLF)
        .quote_style(QuoteStyle::Necessary)
        .from_writer(BOM.to_vec());
    writer
        .write_record(table.headers.iter().map(|header| neutralize(header)))
        .expect("writing to memory cannot fail");
    for row in &table.rows {
        writer
            .write_record(row.iter().map(text_of))
            .expect("writing to memory cannot fail");
    }
    writer.into_inner().expect("writing to memory cannot fail")
}

/// A cell as CSV text (LEA-027). Only free text is neutralized (LEA-028): the phone number and
/// the numbers were validated by the server.
fn text_of(cell: &Cell) -> String {
    match cell {
        Cell::Empty => String::new(),
        Cell::Text(text) => neutralize(text),
        Cell::Phone(phone) => phone.clone(),
        Cell::Date(date) => date.format("%Y-%m-%d").to_string(),
        Cell::DateTime(instant) => instant.format("%Y-%m-%d %H:%M:%S").to_string(),
        Cell::LocalDateTime(local) => local.format("%Y-%m-%d %H:%M").to_string(),
        Cell::Number(number) => number.to_string(),
        Cell::Bool(true) => labels::YES.to_string(),
        Cell::Bool(false) => labels::NO.to_string(),
    }
}

/// Prefixes with an apostrophe a text that a spreadsheet would run as a formula (LEA-028).
fn neutralize(text: &str) -> String {
    if text.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{text}")
    } else {
        text.to_string()
    }
}

#[cfg(test)]
mod tests {
    use chrono::{NaiveDate, NaiveDateTime};
    use serde_json::Number;

    use super::*;
    use crate::export::Column;

    fn table(headers: &[&str], rows: Vec<Vec<Cell>>) -> ExportTable {
        ExportTable {
            columns: vec![Column::Event; headers.len()],
            headers: headers.iter().map(|h| h.to_string()).collect(),
            rows,
        }
    }

    fn text(value: &str) -> Cell {
        Cell::Text(value.to_string())
    }

    fn body(bytes: &[u8]) -> &str {
        assert_eq!(&bytes[..3], [0xEF, 0xBB, 0xBF], "BOM");
        std::str::from_utf8(&bytes[3..]).unwrap()
    }

    // spec: LEA-007, LEA-027
    #[test]
    fn csv_is_rfc4180_with_bom() {
        let table = table(
            &["Nom", "Naissance", "Envoi", "Montant", "Spam", "Téléphone"],
            vec![
                vec![
                    text("Hébert, Fils"),
                    Cell::Date(NaiveDate::from_ymd_opt(2027, 9, 18).unwrap()),
                    Cell::DateTime(
                        NaiveDateTime::parse_from_str("2027-03-15 09:30:00", "%Y-%m-%d %H:%M:%S")
                            .unwrap(),
                    ),
                    Cell::Number(Number::from_f64(12.5).unwrap()),
                    Cell::Bool(true),
                    Cell::Phone("+33612345678".to_string()),
                ],
                vec![
                    text("dit \"Zoé\"\nLefèvre ✨"),
                    Cell::Empty,
                    Cell::Empty,
                    Cell::Number(Number::from(7)),
                    Cell::Bool(false),
                    Cell::Empty,
                ],
                vec![
                    text("Éloïse D’Aubigné-Müller"),
                    Cell::Empty,
                    Cell::Empty,
                    Cell::Empty,
                    Cell::Empty,
                    Cell::Empty,
                ],
            ],
        );

        let bytes = write(&table);
        assert_eq!(
            body(&bytes),
            "Nom,Naissance,Envoi,Montant,Spam,Téléphone\r\n\
             \"Hébert, Fils\",2027-09-18,2027-03-15 09:30:00,12.5,Oui,+33612345678\r\n\
             \"dit \"\"Zoé\"\"\nLefèvre ✨\",,,7,Non,\r\n\
             Éloïse D’Aubigné-Müller,,,,,\r\n"
        );
    }

    // spec: LEA-033
    #[test]
    fn csv_writes_a_local_date_time_without_seconds() {
        let local = NaiveDateTime::parse_from_str("2027-03-20 14:30", "%Y-%m-%d %H:%M").unwrap();
        let bytes = write(&table(
            &["Rendez-vous"],
            vec![vec![Cell::LocalDateTime(local)]],
        ));
        assert_eq!(body(&bytes), "Rendez-vous\r\n2027-03-20 14:30\r\n");
    }

    // spec: LEA-028
    #[test]
    fn csv_neutralizes_formulas_but_not_phone_or_numbers() {
        let formulas = table(
            &["Nom", "=cmd", "Téléphone", "Nombre"],
            vec![vec![
                text("=HYPERLINK(\"http://x\")"),
                text("-5 rue des Lilas"),
                Cell::Phone("+33612345678".to_string()),
                Cell::Number(Number::from(-3)),
            ]],
        );
        assert_eq!(
            body(&write(&formulas)),
            "Nom,'=cmd,Téléphone,Nombre\r\n\
             \"'=HYPERLINK(\"\"http://x\"\")\",'-5 rue des Lilas,+33612345678,-3\r\n"
        );

        let first_characters = table(
            &["a", "b", "c", "d", "e"],
            vec![vec![
                text("@x"),
                text("+x"),
                text("\tx"),
                text("\rx"),
                text("ok-=@"),
            ]],
        );
        assert_eq!(
            body(&write(&first_characters)),
            "a,b,c,d,e\r\n'@x,'+x,'\tx,\"'\rx\",ok-=@\r\n"
        );
    }

    // spec: LEA-031
    #[test]
    fn an_empty_csv_is_the_header_line() {
        let bytes = write(&table(&["Nom", "Email"], vec![]));
        assert_eq!(body(&bytes), "Nom,Email\r\n");
    }
}
