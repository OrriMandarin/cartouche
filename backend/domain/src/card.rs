//! Card content: validation of everything an owner can submit for a card (PUB-018 to PUB-022,
//! EDI-008, TPL-015 to TPL-017).

use serde::{Deserialize, Serialize};

use crate::{FieldError, Slug, Theme, is_valid_email, normalize, normalize_phone};

pub const DEFAULT_TEMPLATE: &str = "classique";
pub const DEFAULT_THEME_PRESET: &str = "craie";
pub const MAX_LINKS: usize = 20;
pub const MAX_SETTINGS_BYTES: usize = 8192;

const MAX_NAME_CHARS: usize = 100;
const MAX_DESCRIPTION_CHARS: usize = 1000;
const MAX_URL_CHARS: usize = 2048;
const MAX_LABEL_CHARS: usize = 50;
const MAX_TEMPLATE_LEN: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub enum LinkKind {
    Website,
    Linkedin,
    Instagram,
    Facebook,
    Tiktok,
    Youtube,
    X,
    Custom,
}

/// Card content as submitted: free text, not yet normalized.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub struct ContentInput {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub job_title: Option<String>,
    pub company: Option<String>,
    pub description: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub struct LinkInput {
    pub kind: LinkKind,
    pub url: String,
    pub label: Option<String>,
}

/// Everything an owner submits when saving a card.
#[derive(Debug, Clone, PartialEq)]
pub struct CardInput {
    pub slug: String,
    pub template: String,
    pub settings: serde_json::Value,
    pub theme: serde_json::Value,
    pub content: ContentInput,
    pub links: Vec<LinkInput>,
}

impl CardInput {
    /// A new card: default template and theme, empty settings, only the names filled in.
    pub fn new_card(
        slug: impl Into<String>,
        first_name: Option<String>,
        last_name: Option<String>,
    ) -> CardInput {
        CardInput {
            slug: slug.into(),
            template: DEFAULT_TEMPLATE.to_string(),
            settings: serde_json::json!({}),
            theme: serde_json::to_value(Theme::default_theme()).expect("a theme always serializes"),
            content: ContentInput {
                first_name,
                last_name,
                ..ContentInput::default()
            },
            links: Vec::new(),
        }
    }
}

/// Validated, normalized card content. An empty field is `None`; `phone` is E.164.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub struct CardContent {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub job_title: Option<String>,
    pub company: Option<String>,
    pub description: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub struct Link {
    pub kind: LinkKind,
    pub url: String,
    pub label: Option<String>,
}

/// A card that passed [`validate_card`].
#[derive(Debug, Clone, PartialEq)]
pub struct ValidCard {
    pub slug: Slug,
    pub template: String,
    pub settings: serde_json::Value,
    pub theme: Theme,
    pub content: CardContent,
    pub links: Vec<Link>,
}

/// Validates and normalizes a submitted card, reporting every invalid field at once.
pub fn validate_card(input: CardInput) -> Result<ValidCard, Vec<FieldError>> {
    let mut errors = Vec::new();

    let slug = Slug::parse(&input.slug)
        .map_err(|_| errors.push(FieldError::new("slug", "invalid_slug")))
        .ok();

    let template = input.template.trim().to_string();
    if !is_template_id(&template) {
        errors.push(FieldError::new("template", "invalid_template"));
    }

    if !is_small_object(&input.settings) {
        errors.push(FieldError::new("settings", "invalid_settings"));
    }

    let theme = Theme::parse(&input.theme)
        .map_err(|_| errors.push(FieldError::new("theme", "invalid_theme")))
        .ok();
    if theme.as_ref().is_some_and(|t| t.check_readable().is_err()) {
        errors.push(FieldError::new("theme", "low_contrast"));
    }

    let content = validate_content(input.content, &mut errors);
    let links = validate_links(input.links, &mut errors);

    match (slug, theme) {
        (Some(slug), Some(theme)) if errors.is_empty() => Ok(ValidCard {
            slug,
            template,
            settings: input.settings,
            theme,
            content,
            links,
        }),
        _ => Err(errors),
    }
}

/// `^[a-z][a-z0-9-]{0,31}$`; an unknown identifier is accepted (TPL-015).
fn is_template_id(value: &str) -> bool {
    let mut bytes = value.bytes();
    bytes.next().is_some_and(|b| b.is_ascii_lowercase())
        && value.len() <= MAX_TEMPLATE_LEN
        && bytes.all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn is_small_object(settings: &serde_json::Value) -> bool {
    settings.is_object()
        && serde_json::to_vec(settings).is_ok_and(|bytes| bytes.len() <= MAX_SETTINGS_BYTES)
}

/// Normalizes an optional text field: empty after normalization means absent.
fn clean(value: Option<String>) -> Option<String> {
    value.map(|v| normalize(&v)).filter(|v| !v.is_empty())
}

fn check_length(value: &Option<String>, max: usize, field: &str, errors: &mut Vec<FieldError>) {
    if value.as_ref().is_some_and(|v| v.chars().count() > max) {
        errors.push(FieldError::new(field, "too_long"));
    }
}

fn validate_content(input: ContentInput, errors: &mut Vec<FieldError>) -> CardContent {
    let first_name = clean(input.first_name);
    let last_name = clean(input.last_name);
    let job_title = clean(input.job_title);
    let company = clean(input.company);
    let description = clean(input.description);
    let email = clean(input.email);
    let phone = clean(input.phone);

    if first_name.is_none() && last_name.is_none() {
        errors.push(FieldError::new("content.first_name", "required"));
    }
    check_length(&first_name, MAX_NAME_CHARS, "content.first_name", errors);
    check_length(&last_name, MAX_NAME_CHARS, "content.last_name", errors);
    check_length(&job_title, MAX_NAME_CHARS, "content.job_title", errors);
    check_length(&company, MAX_NAME_CHARS, "content.company", errors);
    check_length(
        &description,
        MAX_DESCRIPTION_CHARS,
        "content.description",
        errors,
    );

    if email.as_deref().is_some_and(|e| !is_valid_email(e)) {
        errors.push(FieldError::new("content.email", "invalid_email"));
    }
    let phone = phone.and_then(|p| match normalize_phone(&p) {
        Ok(e164) => Some(e164),
        Err(_) => {
            errors.push(FieldError::new("content.phone", "invalid_phone"));
            None
        }
    });

    CardContent {
        first_name,
        last_name,
        job_title,
        company,
        description,
        email,
        phone,
    }
}

fn validate_links(input: Vec<LinkInput>, errors: &mut Vec<FieldError>) -> Vec<Link> {
    if input.len() > MAX_LINKS {
        errors.push(FieldError::new("links", "too_many_links"));
        return Vec::new();
    }
    input
        .into_iter()
        .enumerate()
        .map(|(i, link)| {
            let url = normalize(&link.url);
            if !is_http_url(&url) {
                errors.push(FieldError::new(format!("links[{i}].url"), "invalid_url"));
            }
            let label = clean(link.label);
            if link.kind == LinkKind::Custom && label.is_none() {
                errors.push(FieldError::new(format!("links[{i}].label"), "required"));
            }
            check_length(
                &label,
                MAX_LABEL_CHARS,
                &format!("links[{i}].label"),
                errors,
            );
            Link {
                kind: link.kind,
                url,
                label,
            }
        })
        .collect()
}

/// An absolute `http(s)` URL with a host, no whitespace or control characters, at most
/// 2 048 characters (PUB-022).
fn is_http_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    (lower.starts_with("http://") || lower.starts_with("https://"))
        && url.chars().count() <= MAX_URL_CHARS
        && !url.chars().any(|c| c.is_whitespace() || c.is_control())
        && url::Url::parse(url).is_ok_and(|parsed| parsed.host_str().is_some())
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::FieldError;

    fn base() -> CardInput {
        CardInput::new_card("alice-martin", Some("Alice".into()), Some("Martin".into()))
    }

    fn err(field: &str, code: &'static str) -> FieldError {
        FieldError::new(field, code)
    }

    fn errors(input: CardInput) -> Vec<FieldError> {
        validate_card(input).expect_err("input should be invalid")
    }

    fn link(kind: LinkKind, url: &str, label: Option<&str>) -> LinkInput {
        LinkInput {
            kind,
            url: url.to_string(),
            label: label.map(str::to_string),
        }
    }

    // spec: PUB-018
    #[test]
    fn first_or_last_name_is_required() {
        let mut input = base();
        input.content.first_name = None;
        input.content.last_name = Some("  ".into());
        assert_eq!(errors(input), vec![err("content.first_name", "required")]);

        let mut only_last = base();
        only_last.content.first_name = Some("   ".into());
        let card = validate_card(only_last).unwrap();
        assert_eq!(card.content.first_name, None);
        assert_eq!(card.content.last_name.as_deref(), Some("Martin"));
    }

    // spec: PUB-019, EDI-008
    #[test]
    fn lengths_are_counted_in_characters_after_nfc() {
        let decomposed = "e\u{0301}".repeat(100);
        let mut input = base();
        input.content.first_name = Some(decomposed);
        let card = validate_card(input).unwrap();
        assert_eq!(card.content.first_name, Some("é".repeat(100)));

        let mut too_long = base();
        too_long.content.first_name = Some("é".repeat(101));
        assert_eq!(
            errors(too_long),
            vec![err("content.first_name", "too_long")]
        );

        let mut description = base();
        description.content.description = Some("x".repeat(1000));
        assert!(validate_card(description).is_ok());
        let mut description = base();
        description.content.description = Some("x".repeat(1001));
        assert_eq!(
            errors(description),
            vec![err("content.description", "too_long")]
        );

        for (field, set) in [
            (
                "content.last_name",
                (|c: &mut ContentInput| &mut c.last_name)
                    as fn(&mut ContentInput) -> &mut Option<String>,
            ),
            ("content.job_title", |c| &mut c.job_title),
            ("content.company", |c| &mut c.company),
        ] {
            let mut input = base();
            *set(&mut input.content) = Some("y".repeat(101));
            assert_eq!(errors(input), vec![err(field, "too_long")]);
        }
    }

    // spec: PUB-020
    #[test]
    fn email_and_phone_are_validated() {
        let mut bad_email = base();
        bad_email.content.email = Some("alice@".into());
        assert_eq!(
            errors(bad_email),
            vec![err("content.email", "invalid_email")]
        );

        let mut french = base();
        french.content.phone = Some("06 12 34 56 78".into());
        french.content.email = Some(" alice@example.org ".into());
        let card = validate_card(french).unwrap();
        assert_eq!(card.content.phone.as_deref(), Some("+33612345678"));
        assert_eq!(card.content.email.as_deref(), Some("alice@example.org"));

        let mut uk = base();
        uk.content.phone = Some("+44 20 7946 0958".into());
        let card = validate_card(uk).unwrap();
        assert_eq!(card.content.phone.as_deref(), Some("+442079460958"));

        let mut short = base();
        short.content.phone = Some("12".into());
        assert_eq!(errors(short), vec![err("content.phone", "invalid_phone")]);

        let mut blank = base();
        blank.content.phone = Some("  ".into());
        blank.content.email = Some("".into());
        let card = validate_card(blank).unwrap();
        assert_eq!((card.content.phone, card.content.email), (None, None));
    }

    // spec: PUB-022, Review Focus 4
    #[test]
    fn links_reject_non_http_urls() {
        for url in [
            "javascript:alert(1)",
            "data:text/html,x",
            "/relative",
            "ftp://x",
            "https://",
            "https://exa mple.org",
            "example.org",
        ] {
            let mut input = base();
            input.links = vec![
                link(LinkKind::Website, "https://example.org", None),
                link(LinkKind::Website, url, None),
            ];
            assert_eq!(
                errors(input),
                vec![err("links[1].url", "invalid_url")],
                "{url}"
            );
        }

        let mut long = base();
        long.links = vec![link(
            LinkKind::Website,
            &format!("https://example.org/{}", "a".repeat(2049 - 20)),
            None,
        )];
        assert_eq!(errors(long), vec![err("links[0].url", "invalid_url")]);

        let mut exact = base();
        exact.links = vec![
            link(
                LinkKind::Website,
                &format!("https://example.org/{}", "a".repeat(2048 - 20)),
                None,
            ),
            link(LinkKind::Linkedin, " HTTP://linkedin.com/in/alice ", None),
        ];
        let card = validate_card(exact).unwrap();
        assert_eq!(card.links[1].url, "HTTP://linkedin.com/in/alice");
    }

    // spec: PUB-022
    #[test]
    fn custom_link_needs_a_label() {
        let mut missing = base();
        missing.links = vec![link(LinkKind::Custom, "https://example.org", Some("  "))];
        assert_eq!(errors(missing), vec![err("links[0].label", "required")]);

        let mut too_long = base();
        too_long.links = vec![link(
            LinkKind::Custom,
            "https://example.org",
            Some(&"l".repeat(51)),
        )];
        assert_eq!(errors(too_long), vec![err("links[0].label", "too_long")]);

        let mut ok = base();
        ok.links = vec![
            link(
                LinkKind::Custom,
                "https://example.org",
                Some(&"l".repeat(50)),
            ),
            link(LinkKind::Website, "https://example.org", None),
        ];
        let card = validate_card(ok).unwrap();
        assert_eq!(card.links[0].label, Some("l".repeat(50)));
        assert_eq!(card.links[1].label, None);
    }

    // spec: PUB-022
    #[test]
    fn at_most_20_links() {
        let make = |n: usize| -> Vec<LinkInput> {
            (0..n)
                .map(|_| link(LinkKind::Website, "https://example.org", None))
                .collect()
        };
        let mut twenty = base();
        twenty.links = make(20);
        assert_eq!(validate_card(twenty).unwrap().links.len(), 20);

        let mut twenty_one = base();
        twenty_one.links = make(21);
        assert_eq!(errors(twenty_one), vec![err("links", "too_many_links")]);
    }

    #[test]
    fn link_kind_serializes_in_snake_case() {
        assert_eq!(
            serde_json::to_string(&LinkKind::Linkedin).unwrap(),
            "\"linkedin\""
        );
        assert_eq!(serde_json::to_string(&LinkKind::X).unwrap(), "\"x\"");
        assert_eq!(
            serde_json::from_str::<LinkKind>("\"custom\"").unwrap(),
            LinkKind::Custom
        );
    }

    // spec: TPL-001, TPL-016
    #[test]
    fn settings_must_be_a_small_object() {
        let mut array = base();
        array.settings = serde_json::json!([]);
        assert_eq!(errors(array), vec![err("settings", "invalid_settings")]);

        let mut big = base();
        big.settings = serde_json::json!({ "k": "x".repeat(9000) });
        assert_eq!(errors(big), vec![err("settings", "invalid_settings")]);

        let mut ok = base();
        ok.settings = serde_json::json!({ "showQr": true, "k": "x".repeat(8000) });
        assert_eq!(validate_card(ok).unwrap().settings["showQr"], true);
    }

    // spec: TPL-015
    #[test]
    fn template_id_is_checked_by_shape_only() {
        let mut unknown = base();
        unknown.template = "futur-v2".into();
        assert_eq!(validate_card(unknown).unwrap().template, "futur-v2");

        for bad in ["", "Classique", "2fast", "a_b", "a b", &"a".repeat(33)] {
            let mut input = base();
            input.template = bad.to_string();
            assert_eq!(
                errors(input),
                vec![err("template", "invalid_template")],
                "{bad}"
            );
        }
    }

    #[test]
    fn invalid_theme_is_one_field_error() {
        let mut input = base();
        input.theme = serde_json::json!({ "preset": "craie", "accent": "red" });
        assert_eq!(errors(input), vec![err("theme", "invalid_theme")]);
    }

    // spec: TPL-023
    #[test]
    fn validate_rejects_an_unreadable_theme() {
        let mut input = base();
        input.theme = serde_json::json!({ "preset": "terracotta", "text": "#b89580" });
        assert_eq!(errors(input), vec![err("theme", "low_contrast")]);

        let mut input = base();
        input.theme = serde_json::json!({ "preset": "terracotta" });
        assert!(validate_card(input).is_ok());
    }

    // spec: LNK-018
    #[test]
    fn invalid_slug_is_reported() {
        let mut input = base();
        input.slug = "Pas Valide".into();
        assert_eq!(errors(input), vec![err("slug", "invalid_slug")]);
    }

    // spec: PUB-018
    #[test]
    fn valid_card_keeps_defaults() {
        let card = validate_card(base()).unwrap();
        assert_eq!(card.slug.as_str(), "alice-martin");
        assert_eq!(card.template, DEFAULT_TEMPLATE);
        assert_eq!(card.theme.preset, DEFAULT_THEME_PRESET);
        assert_eq!(card.settings, serde_json::json!({}));
        assert!(card.links.is_empty());
    }

    // spec: PUB-018
    #[test]
    fn all_errors_are_reported_together() {
        let mut input = base();
        input.slug = "x".into();
        input.content.email = Some("nope".into());
        input.links = vec![link(LinkKind::Website, "javascript:alert(1)", None)];
        assert_eq!(
            errors(input),
            vec![
                err("slug", "invalid_slug"),
                err("content.email", "invalid_email"),
                err("links[0].url", "invalid_url"),
            ]
        );
    }
}
