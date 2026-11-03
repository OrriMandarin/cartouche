//! vCard 3.0 rendering for the public "add to contacts" endpoint (PUB-014 to PUB-016, PUB-024
//! to PUB-026).

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;

use crate::CardContent;

/// Maximum size of a physical line, excluding the CRLF (RFC 2425 section 5.8.1).
const MAX_LINE_BYTES: usize = 75;

/// What goes into a vCard: the card content, its link URLs and an optional JPEG avatar.
#[derive(Debug, Clone)]
pub struct VCard<'a> {
    pub content: &'a CardContent,
    pub urls: Vec<&'a str>,
    pub photo_jpeg: Option<&'a [u8]>,
}

/// Renders a vCard 3.0: CRLF line endings, escaped values, lines folded at 75 bytes.
pub fn render(card: &VCard) -> String {
    let content = card.content;
    let first = content.first_name.as_deref();
    let last = content.last_name.as_deref();
    let mut out = String::new();

    push_line(&mut out, "BEGIN:VCARD");
    push_line(&mut out, "VERSION:3.0");
    push_line(
        &mut out,
        &format!(
            "N:{};{};;;",
            escape(last.unwrap_or_default()),
            escape(first.unwrap_or_default())
        ),
    );
    let full_name = [first, last]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ");
    push_line(&mut out, &format!("FN:{}", escape(&full_name)));

    if let Some(company) = &content.company {
        push_line(&mut out, &format!("ORG:{}", escape(company)));
    }
    if let Some(title) = &content.job_title {
        push_line(&mut out, &format!("TITLE:{}", escape(title)));
    }
    if let Some(email) = &content.email {
        push_line(&mut out, &format!("EMAIL;TYPE=INTERNET:{}", escape(email)));
    }
    if let Some(phone) = &content.phone {
        push_line(&mut out, &format!("TEL;TYPE=CELL:{}", escape(phone)));
    }
    for url in &card.urls {
        push_line(&mut out, &format!("URL:{}", escape(url)));
    }
    if let Some(description) = &content.description {
        push_line(&mut out, &format!("NOTE:{}", escape(description)));
    }
    if let Some(photo) = card.photo_jpeg {
        push_line(
            &mut out,
            &format!("PHOTO;ENCODING=b;TYPE=JPEG:{}", STANDARD.encode(photo)),
        );
    }
    push_line(&mut out, "END:VCARD");
    out
}

/// Escapes a value: `\`, `,` and `;` are backslash-escaped, line breaks become `\n`.
/// `:` is left alone.
fn escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\\' => out.push_str("\\\\"),
            ',' => out.push_str("\\,"),
            ';' => out.push_str("\\;"),
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                out.push_str("\\n");
            }
            '\n' => out.push_str("\\n"),
            c => out.push(c),
        }
    }
    out
}

/// Appends a logical line folded to [`MAX_LINE_BYTES`] per physical line, never splitting a
/// UTF-8 character. Continuation lines start with one space, which counts toward the limit.
fn push_line(out: &mut String, line: &str) {
    let mut rest = line;
    let mut budget = MAX_LINE_BYTES;
    loop {
        if rest.len() <= budget {
            out.push_str(rest);
            out.push_str("\r\n");
            return;
        }
        let mut cut = budget;
        while !rest.is_char_boundary(cut) {
            cut -= 1;
        }
        out.push_str(&rest[..cut]);
        out.push_str("\r\n ");
        rest = &rest[cut..];
        budget = MAX_LINE_BYTES - 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blank() -> CardContent {
        CardContent {
            first_name: None,
            last_name: None,
            job_title: None,
            company: None,
            description: None,
            email: None,
            phone: None,
        }
    }

    fn full_content() -> CardContent {
        CardContent {
            first_name: Some("Éloïse".into()),
            last_name: Some("D'Aubigné-Müller".into()),
            ..blank()
        }
    }

    fn render_content(content: &CardContent) -> String {
        render(&VCard {
            content,
            urls: vec![],
            photo_jpeg: None,
        })
    }

    // spec: PUB-014, PUB-024
    #[test]
    fn renders_version_3_with_structured_name() {
        let out = render_content(&full_content());
        assert!(out.starts_with("BEGIN:VCARD\r\nVERSION:3.0\r\n"));
        assert!(out.contains("N:D'Aubigné-Müller;Éloïse;;;\r\n"));
        assert!(out.contains("FN:Éloïse D'Aubigné-Müller\r\n"));
    }

    // spec: PUB-024
    #[test]
    fn first_name_only_gives_empty_family_name() {
        let content = CardContent {
            first_name: Some("Éloïse".into()),
            ..blank()
        };
        let out = render_content(&content);
        assert!(out.contains("N:;Éloïse;;;\r\n"));
        assert!(out.contains("FN:Éloïse\r\n"));
    }

    // spec: PUB-024
    #[test]
    fn full_card_renders_every_property_in_order() {
        let content = CardContent {
            first_name: Some("Éloïse".into()),
            last_name: Some("Durand".into()),
            job_title: Some("Directrice".into()),
            company: Some("Durand SA".into()),
            description: Some("Bonjour ✨".into()),
            email: Some("eloise@example.com".into()),
            phone: Some("+33612345678".into()),
        };
        let out = render(&VCard {
            content: &content,
            urls: vec!["https://example.com/a?b=1,2", "https://linkedin.com/in/x"],
            photo_jpeg: Some(&[0xFF, 0xD8, 0xFF]),
        });
        let expected = "BEGIN:VCARD\r\nVERSION:3.0\r\nN:Durand;Éloïse;;;\r\nFN:Éloïse Durand\r\n\
ORG:Durand SA\r\nTITLE:Directrice\r\nEMAIL;TYPE=INTERNET:eloise@example.com\r\n\
TEL;TYPE=CELL:+33612345678\r\nURL:https://example.com/a?b=1\\,2\r\n\
URL:https://linkedin.com/in/x\r\nNOTE:Bonjour ✨\r\n\
PHOTO;ENCODING=b;TYPE=JPEG:/9j/\r\nEND:VCARD\r\n";
        assert_eq!(out, expected);
    }

    // spec: PUB-015
    #[test]
    fn absent_fields_are_omitted() {
        let out = render_content(&full_content());
        for prefix in ["ORG", "TITLE", "EMAIL", "TEL", "URL", "NOTE", "PHOTO"] {
            assert!(
                !out.lines().any(|l| l.starts_with(prefix)),
                "unexpected {prefix} line in {out:?}"
            );
        }
    }

    // spec: PUB-016
    #[test]
    fn text_values_are_escaped() {
        let content = CardContent {
            first_name: Some("A".into()),
            company: Some("Durand, Fils; & Cie\\".into()),
            description: Some("ligne un\nligne deux\r\nligne trois".into()),
            ..blank()
        };
        let out = render_content(&content);
        assert!(out.contains("ORG:Durand\\, Fils\\; & Cie\\\\\r\n"));
        assert!(out.contains("NOTE:ligne un\\nligne deux\\nligne trois\r\n"));
    }

    // spec: PUB-016
    #[test]
    fn colons_are_not_escaped() {
        let content = CardContent {
            first_name: Some("A".into()),
            job_title: Some("Chef: adjoint".into()),
            ..blank()
        };
        assert!(render_content(&content).contains("TITLE:Chef: adjoint\r\n"));
    }

    // spec: PUB-026
    #[test]
    fn long_lines_fold_without_splitting_characters() {
        let description = "é✨".repeat(200);
        let content = CardContent {
            first_name: Some("A".into()),
            description: Some(description.clone()),
            ..blank()
        };
        let out = render_content(&content);
        let physical: Vec<&str> = out.split("\r\n").collect();
        assert!(physical.iter().all(|l| l.len() <= 75), "line over 75 bytes");
        let start = physical
            .iter()
            .position(|l| l.starts_with("NOTE:"))
            .unwrap();
        assert!(physical.len() > start + 2, "NOTE was not folded");
        assert!(physical[start + 1].starts_with(' '));
        let unfolded = out.replace("\r\n ", "");
        assert!(unfolded.contains(&format!("NOTE:{description}\r\n")));
    }

    // spec: PUB-026
    #[test]
    fn folding_is_exact_on_ascii_boundaries() {
        let content = CardContent {
            first_name: Some("A".into()),
            description: Some("x".repeat(70 + 74)),
            ..blank()
        };
        let out = render_content(&content);
        // "NOTE:" + 70 chars = 75 bytes, then one continuation of space + 74 chars.
        let lines: Vec<&str> = out.split("\r\n").collect();
        let start = lines.iter().position(|l| l.starts_with("NOTE:")).unwrap();
        assert_eq!(lines[start].len(), 75);
        assert_eq!(lines[start + 1].len(), 75);
        assert!(lines[start + 2].starts_with("END:VCARD"));
    }

    // spec: PUB-026
    #[test]
    fn every_line_ends_with_crlf() {
        let out = render_content(&full_content());
        assert!(out.ends_with("END:VCARD\r\n"));
        let bytes = out.as_bytes();
        for (i, b) in bytes.iter().enumerate() {
            if *b == b'\n' {
                assert!(i > 0 && bytes[i - 1] == b'\r', "bare LF at {i}");
            }
        }
    }

    // spec: PUB-025
    #[test]
    fn photo_is_base64_jpeg() {
        use base64::Engine as _;
        let photo: Vec<u8> = (0..=255u8).cycle().take(1000).collect();
        let mut jpeg = vec![0xFF, 0xD8];
        jpeg.extend(&photo);
        let content = full_content();
        let out = render(&VCard {
            content: &content,
            urls: vec![],
            photo_jpeg: Some(&jpeg),
        });
        let unfolded = out.replace("\r\n ", "");
        let line = unfolded
            .split("\r\n")
            .find(|l| l.starts_with("PHOTO;ENCODING=b;TYPE=JPEG:"))
            .expect("photo line");
        let b64 = line.trim_start_matches("PHOTO;ENCODING=b;TYPE=JPEG:");
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .unwrap();
        assert_eq!(decoded, jpeg);
    }
}
