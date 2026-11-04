//! The XLSX writer (LEA-008, LEA-029).

use rust_xlsxwriter::{Format, Workbook, XlsxError};

use super::{Cell, ExportError, ExportTable, labels};

const DATE_FORMAT: &str = "yyyy-mm-dd";
const DATE_TIME_FORMAT: &str = "yyyy-mm-dd hh:mm:ss";

impl From<XlsxError> for ExportError {
    fn from(error: XlsxError) -> Self {
        ExportError::Xlsx(error.to_string())
    }
}

/// Writes the table as an XLSX workbook with a single sheet: bold and frozen header row, typed
/// cells, and no formula (LEA-029).
pub fn write(table: &ExportTable) -> Result<Vec<u8>, ExportError> {
    let mut workbook = Workbook::new();
    let sheet = workbook.add_worksheet();
    sheet.set_name(labels::SHEET)?;
    sheet.set_freeze_panes(1, 0)?;

    let header_format = Format::new().set_bold();
    let date_format = Format::new().set_num_format(DATE_FORMAT);
    let date_time_format = Format::new().set_num_format(DATE_TIME_FORMAT);

    for (column, header) in table.headers.iter().enumerate() {
        sheet.write_string_with_format(0, column_index(column), header, &header_format)?;
    }
    for (index, row) in table.rows.iter().enumerate() {
        let row_number = u32::try_from(index + 1).map_err(|e| ExportError::Xlsx(e.to_string()))?;
        for (column, cell) in row.iter().enumerate() {
            let column = column_index(column);
            match cell {
                Cell::Empty => {}
                Cell::Text(text) | Cell::Phone(text) => {
                    sheet.write_string(row_number, column, text)?;
                }
                Cell::Date(date) => {
                    sheet.write_datetime_with_format(row_number, column, *date, &date_format)?;
                }
                Cell::DateTime(instant) => {
                    sheet.write_datetime_with_format(
                        row_number,
                        column,
                        *instant,
                        &date_time_format,
                    )?;
                }
                Cell::Number(number) => match number.as_f64() {
                    Some(value) => {
                        sheet.write_number(row_number, column, value)?;
                    }
                    None => {
                        sheet.write_string(row_number, column, number.to_string())?;
                    }
                },
                Cell::Bool(value) => {
                    sheet.write_boolean(row_number, column, *value)?;
                }
            }
        }
    }
    Ok(workbook.save_to_buffer()?)
}

fn column_index(column: usize) -> u16 {
    u16::try_from(column).expect("an export has far fewer than 65 536 columns")
}

#[cfg(test)]
mod tests {
    use std::io::{Cursor, Read};

    use calamine::{Data, Reader, Xlsx, open_workbook_from_rs};
    use chrono::{NaiveDate, NaiveDateTime};
    use serde_json::Number;

    use super::*;
    use crate::export::{Cell, Column};

    fn table(headers: &[&str], rows: Vec<Vec<Cell>>) -> ExportTable {
        ExportTable {
            columns: vec![Column::Event; headers.len()],
            headers: headers.iter().map(|h| h.to_string()).collect(),
            rows,
        }
    }

    fn open(bytes: Vec<u8>) -> Xlsx<Cursor<Vec<u8>>> {
        open_workbook_from_rs(Cursor::new(bytes)).unwrap()
    }

    // spec: LEA-008, LEA-029
    #[test]
    fn xlsx_has_typed_cells_and_no_formula() {
        let date = NaiveDate::from_ymd_opt(2027, 9, 18).unwrap();
        let instant =
            NaiveDateTime::parse_from_str("2027-03-15 09:30:00", "%Y-%m-%d %H:%M:%S").unwrap();
        let table = table(
            &[
                "Nom",
                "Téléphone",
                "Naissance",
                "Envoi",
                "Budget",
                "Spam",
                "Vide",
            ],
            vec![
                vec![
                    Cell::Text("=1+1".to_string()),
                    Cell::Phone("+33612345678".to_string()),
                    Cell::Date(date),
                    Cell::DateTime(instant),
                    Cell::Number(Number::from_f64(12.5).unwrap()),
                    Cell::Bool(true),
                    Cell::Empty,
                ],
                vec![
                    Cell::Text("Zoé Lefèvre ✨".to_string()),
                    Cell::Empty,
                    Cell::Empty,
                    Cell::Empty,
                    Cell::Number(Number::from(120)),
                    Cell::Bool(false),
                    Cell::Empty,
                ],
            ],
        );

        let mut workbook = open(write(&table).unwrap());

        assert_eq!(workbook.sheet_names(), ["Contacts"]);
        let range = workbook.worksheet_range("Contacts").unwrap();
        let cell = |row: u32, column: u32| range.get_value((row, column)).unwrap().clone();

        let headers: Vec<String> = (0..7).map(|c| cell(0, c).to_string()).collect();
        assert_eq!(
            headers,
            [
                "Nom",
                "Téléphone",
                "Naissance",
                "Envoi",
                "Budget",
                "Spam",
                "Vide"
            ]
        );
        assert_eq!(cell(1, 0), Data::String("=1+1".to_string()));
        assert_eq!(cell(1, 1), Data::String("+33612345678".to_string()));
        let Data::DateTime(birth) = cell(1, 2) else {
            panic!("a date cell")
        };
        assert!(birth.is_datetime());
        assert_eq!(birth.as_f64().fract(), 0.0);
        assert_eq!(birth.as_f64(), 46_648.0, "2027-09-18");
        let Data::DateTime(sent) = cell(1, 3) else {
            panic!("a date-time cell")
        };
        assert!(
            (sent.as_f64().fract() - 9.5 / 24.0).abs() < 1e-6,
            "09:30:00"
        );
        assert_eq!(cell(1, 4), Data::Float(12.5));
        assert_eq!(cell(1, 5), Data::Bool(true));
        assert_eq!(cell(1, 6), Data::Empty);
        assert_eq!(cell(2, 0), Data::String("Zoé Lefèvre ✨".to_string()));
        assert_eq!(cell(2, 1), Data::Empty);
        assert_eq!(cell(2, 4), Data::Float(120.0));
        assert_eq!(cell(2, 5), Data::Bool(false));

        let styles = workbook.worksheet_style("Contacts").unwrap();
        let format_of = |row: u32, column: u32| {
            styles
                .get((row, column))
                .and_then(|style| style.number_format.as_ref())
                .map(|format| format.format_code.clone())
        };
        assert_eq!(format_of(1, 2).as_deref(), Some("yyyy-mm-dd"));
        assert_eq!(format_of(1, 3).as_deref(), Some("yyyy-mm-dd hh:mm:ss"));

        let formulas = workbook.worksheet_formula("Contacts").unwrap();
        assert!(
            formulas
                .used_cells()
                .all(|(_, _, formula)| formula.is_empty()),
            "no formula"
        );
    }

    // spec: LEA-029
    #[test]
    fn the_header_row_is_bold_and_frozen() {
        let bytes = write(&table(
            &["Nom", "Email"],
            vec![vec![Cell::Text("Alice".to_string()), Cell::Empty]],
        ))
        .unwrap();

        let mut workbook = open(bytes.clone());
        let styles = workbook.worksheet_style("Contacts").unwrap();
        let is_bold = |row: u32, column: u32| {
            styles
                .get((row, column))
                .and_then(|style| style.font.as_ref())
                .is_some_and(|font| font.is_bold())
        };
        assert!(is_bold(0, 0) && is_bold(0, 1), "header row");
        assert!(!is_bold(1, 0), "data row");

        let mut sheet = String::new();
        zip::ZipArchive::new(Cursor::new(bytes))
            .unwrap()
            .by_name("xl/worksheets/sheet1.xml")
            .unwrap()
            .read_to_string(&mut sheet)
            .unwrap();
        assert!(sheet.contains("ySplit=\"1\""), "{sheet}");
        assert!(sheet.contains("state=\"frozen\""), "{sheet}");
    }

    // spec: LEA-031
    #[test]
    fn an_empty_xlsx_has_the_header_row_only() {
        let mut workbook = open(write(&table(&["Nom", "Email"], vec![])).unwrap());
        let range = workbook.worksheet_range("Contacts").unwrap();
        assert_eq!(range.height(), 1);
        assert_eq!(range.get_value((0, 1)), Some(&Data::String("Email".into())));
    }
}
