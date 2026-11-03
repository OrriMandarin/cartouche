//! JSON shapes of the API that are shared by several routes.

use cartouche_domain::{
    CardContent, CardStatus, CustomField, EventPhase, Link, LinkKind, MediaKind, PublicForm,
    StandardField, StandardFields, Theme, VariantFormat, consent_text, default_consent_text,
    form_version, format_international, storage_key,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::config::Config;
use crate::db::cards::Card;
use crate::db::events::{Event, EventWithCount, PublicCandidate};
use crate::db::media::MediaRecord;
use crate::error::ApiError;
use crate::media::MediaService;

/// A card as its owner sees it.
#[derive(Debug, Serialize, ToSchema)]
pub struct CardView {
    pub id: Uuid,
    /// The current slug.
    pub slug: String,
    /// Public address of the card: `{PUBLIC_BASE_URL}/c/{slug}`.
    pub public_url: String,
    pub status: CardStatus,
    /// Identifier of the template; any well-formed identifier is stored.
    pub template: String,
    /// Template-specific settings, a JSON object.
    #[schema(value_type = Object)]
    pub settings: serde_json::Value,
    pub theme: Theme,
    pub content: ContentView,
    pub links: Vec<LinkView>,
    /// The header background, once attached by a save (MED-018).
    pub header: Option<MediaView>,
    /// The profile photo, once attached by a save (MED-018).
    pub avatar: Option<MediaView>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// An event as its owner sees it: the access code is shown in clear (EVT-010).
#[derive(Debug, Serialize, ToSchema)]
pub struct EventView {
    pub id: Uuid,
    pub card_id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub starts_at: DateTime<Utc>,
    /// Absent: the event lasts until it is ended (EVT-003).
    pub ends_at: Option<DateTime<Utc>>,
    /// Computed with the server clock (EVT-020).
    pub phase: EventPhase,
    pub access_code: Option<String>,
    /// Submissions allowed per device, 1 to 100 (EVT-014).
    pub device_limit: u32,
    pub standard_fields: StandardFields,
    pub custom_fields: Vec<CustomField>,
    /// The owner's own consent text; absent when the default one applies.
    pub consent_text: Option<String>,
    /// The consent text used when there is no custom one, for this card and title (FRM-029).
    pub default_consent_text: String,
    /// Every contact of the event, spam ones included.
    pub lead_count: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl EventView {
    /// `card` is the content of the event's card; the phase is computed at `now`.
    pub fn new(counted: EventWithCount, card: &CardContent, now: DateTime<Utc>) -> EventView {
        let EventWithCount { event, lead_count } = counted;
        EventView {
            phase: event.period.phase(now),
            default_consent_text: default_consent_text(card, &event.title),
            id: event.id,
            card_id: event.card_id,
            description: event.description,
            starts_at: event.period.starts_at,
            ends_at: event.period.ends_at,
            access_code: event.access_code,
            device_limit: event.device_limit,
            standard_fields: event.form.standard,
            custom_fields: event.form.custom,
            consent_text: event.consent_text,
            title: event.title,
            lead_count,
            created_at: event.created_at,
            updated_at: event.updated_at,
        }
    }
}

/// A served card as any visitor sees it: no internal id and no date. The files' addresses
/// carry the media ids, so they are no secret.
#[derive(Debug, Serialize, ToSchema)]
pub struct PublicCard {
    pub slug: String,
    /// Public address of the card: `{PUBLIC_BASE_URL}/c/{slug}`.
    pub public_url: String,
    /// Identifier of the template.
    pub template: String,
    /// Template-specific settings, a JSON object.
    #[schema(value_type = Object)]
    pub settings: serde_json::Value,
    pub theme: Theme,
    pub content: ContentView,
    pub links: Vec<LinkView>,
    pub header: Option<MediaView>,
    pub avatar: Option<MediaView>,
    /// Where to download the contact card: `/api/public/cards/{slug}/vcard`.
    pub vcard_url: String,
    /// The events running now, by start then title (PUB-008, PUB-009, PUB-029).
    pub events: Vec<PublicEventButton>,
}

/// A running event, as a button of the public card.
#[derive(Debug, Serialize, ToSchema)]
pub struct PublicEventButton {
    pub id: Uuid,
    pub title: String,
    pub starts_at: DateTime<Utc>,
}

impl PublicEventButton {
    /// The buttons among `candidates` (already in display order): the events running at `now`
    /// (EVT-002, PUB-029).
    pub fn running(candidates: Vec<PublicCandidate>, now: DateTime<Utc>) -> Vec<PublicEventButton> {
        candidates
            .into_iter()
            .filter(|candidate| candidate.period.is_running(now))
            .map(|candidate| PublicEventButton {
                id: candidate.id,
                title: candidate.title,
                starts_at: candidate.period.starts_at,
            })
            .collect()
    }
}

/// What a visitor learns of an event whose form is not handed out: its title only (EVT-027).
#[derive(Debug, Serialize, ToSchema)]
pub struct PublicEventHeading {
    pub id: Uuid,
    pub title: String,
}

impl From<&Event> for PublicEventHeading {
    fn from(event: &Event) -> Self {
        PublicEventHeading {
            id: event.id,
            title: event.title.clone(),
        }
    }
}

/// A standard field of the form, in display order (FRM-017).
#[derive(Debug, Serialize, ToSchema)]
pub struct PublicStandardField {
    pub field: StandardField,
    pub required: bool,
}

/// The form a prospect fills in. It never carries the access code, the device limit or dates.
#[derive(Debug, Serialize, ToSchema)]
pub struct PublicEventForm {
    pub id: Uuid,
    pub title: String,
    pub description: Option<String>,
    /// The enabled standard fields, in display order (FRM-017, FRM-019).
    pub standard_fields: Vec<PublicStandardField>,
    pub custom_fields: Vec<CustomField>,
    /// The text the prospect accepts, as it will be recorded (FRM-007, FRM-028).
    pub consent_text: String,
    /// Fingerprint of this form, sent back with the submission (FRM-030).
    pub form_version: String,
}

impl PublicEventForm {
    /// `card` is the content of the event's card (it names the data controller).
    pub fn new(event: Event, card: &CardContent) -> PublicEventForm {
        let consent = consent_text(event.consent_text.as_deref(), card, &event.title);
        let form_version = form_version(&PublicForm {
            title: &event.title,
            description: event.description.as_deref(),
            standard: &event.form.standard,
            custom: &event.form.custom,
            consent_text: &consent,
        });
        PublicEventForm {
            standard_fields: event
                .form
                .standard
                .enabled()
                .into_iter()
                .map(|(field, required)| PublicStandardField { field, required })
                .collect(),
            id: event.id,
            title: event.title,
            description: event.description,
            custom_fields: event.form.custom,
            consent_text: consent,
            form_version,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ContentView {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub job_title: Option<String>,
    pub company: Option<String>,
    pub description: Option<String>,
    pub email: Option<String>,
    /// E.164, as stored.
    pub phone: Option<String>,
    /// The phone in international format for display, when a phone is set.
    pub phone_display: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LinkView {
    pub kind: LinkKind,
    pub url: String,
    pub label: Option<String>,
}

/// An uploaded image or video and the addresses of its files.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct MediaView {
    pub id: Uuid,
    pub kind: MediaKind,
    /// The WebP variants, narrowest first; for a video, the waiting image.
    pub images: Vec<ImageVariantView>,
    /// The MP4 file, for a video.
    pub video_url: Option<String>,
    /// The largest JPEG variant, for a profile photo (vCard and link previews).
    pub jpeg_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct ImageVariantView {
    /// Width in pixels (the side, for a profile photo).
    pub width: u32,
    pub url: String,
}

/// Who reads the addresses of a card's files.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Audience {
    /// Any visitor of the public page: plain addresses, readable while the card is served.
    Public,
    /// The owner's dashboard or the support page, at the given time: signed addresses,
    /// readable even when the card is not served (MED-023).
    Dashboard(DateTime<Utc>),
}

impl MediaView {
    pub fn new(record: &MediaRecord, media: &MediaService, audience: Audience) -> MediaView {
        let url_of = |name: &str| {
            let key = storage_key(record.card_id, record.id, name);
            match audience {
                Audience::Public => media.url(&key),
                Audience::Dashboard(now) => media.dashboard_url(&key, now),
            }
        };
        let mut images: Vec<ImageVariantView> = record
            .variants
            .iter()
            .filter(|v| v.format == VariantFormat::Webp)
            .map(|v| ImageVariantView {
                width: v.width,
                url: url_of(&v.name),
            })
            .collect();
        images.sort_by_key(|image| image.width);
        let named = |format: VariantFormat| {
            record
                .variants
                .iter()
                .filter(move |v| v.format == format)
                .max_by_key(|v| v.width)
        };
        MediaView {
            id: record.id,
            kind: record.kind,
            images,
            video_url: named(VariantFormat::Mp4).map(|v| url_of(&v.name)),
            jpeg_url: named(VariantFormat::Jpeg).map(|v| url_of(&v.name)),
        }
    }
}

/// `{PUBLIC_BASE_URL}/c/{slug}`, with a single slash whether or not the base ends with one.
pub fn public_url(config: &Config, slug: &str) -> String {
    format!(
        "{}/c/{slug}",
        config.public_base_url.as_str().trim_end_matches('/')
    )
}

/// The card's stored theme; invalid only through a bug of ours.
fn stored_theme(card: &Card) -> Result<Theme, ApiError> {
    Theme::parse(&card.theme)
        .map_err(|_| ApiError::Internal(format!("card {} has an invalid theme", card.id)))
}

/// The view of the attached media `id`, among the card's `attached` records.
fn attached_view(
    attached: &[MediaRecord],
    id: Option<Uuid>,
    media: &MediaService,
    audience: Audience,
) -> Option<MediaView> {
    let record = attached.iter().find(|m| Some(m.id) == id)?;
    Some(MediaView::new(record, media, audience))
}

impl From<CardContent> for ContentView {
    fn from(content: CardContent) -> Self {
        ContentView {
            phone_display: content.phone.as_deref().map(format_international),
            first_name: content.first_name,
            last_name: content.last_name,
            job_title: content.job_title,
            company: content.company,
            description: content.description,
            email: content.email,
            phone: content.phone,
        }
    }
}

impl From<Link> for LinkView {
    fn from(link: Link) -> Self {
        LinkView {
            kind: link.kind,
            url: link.url,
            label: link.label,
        }
    }
}

impl CardView {
    /// `attached` holds the card's header and avatar records (others are ignored); the files'
    /// addresses are signed at `now` (MED-023). Fails only if the stored theme is no longer
    /// valid, which is a bug of ours.
    pub fn new(
        card: Card,
        attached: &[MediaRecord],
        config: &Config,
        media: &MediaService,
        now: DateTime<Utc>,
    ) -> Result<CardView, ApiError> {
        let status = card.status();
        let theme = stored_theme(&card)?;
        let view_of =
            |id: Option<Uuid>| attached_view(attached, id, media, Audience::Dashboard(now));
        Ok(CardView {
            header: view_of(card.header_media_id),
            avatar: view_of(card.avatar_media_id),
            public_url: public_url(config, &card.slug),
            id: card.id,
            slug: card.slug,
            status,
            template: card.template,
            settings: card.settings,
            theme,
            content: card.content.into(),
            links: card.links.into_iter().map(LinkView::from).collect(),
            created_at: card.created_at,
            updated_at: card.updated_at,
        })
    }
}

impl PublicCard {
    /// `attached` holds the card's header and avatar records (others are ignored).
    pub fn new(
        card: Card,
        attached: &[MediaRecord],
        config: &Config,
        media: &MediaService,
        events: Vec<PublicEventButton>,
    ) -> Result<PublicCard, ApiError> {
        let theme = stored_theme(&card)?;
        let view_of = |id: Option<Uuid>| attached_view(attached, id, media, Audience::Public);
        Ok(PublicCard {
            header: view_of(card.header_media_id),
            avatar: view_of(card.avatar_media_id),
            public_url: public_url(config, &card.slug),
            vcard_url: format!("/api/public/cards/{}/vcard", card.slug),
            slug: card.slug,
            template: card.template,
            settings: card.settings,
            theme,
            content: card.content.into(),
            links: card.links.into_iter().map(LinkView::from).collect(),
            events,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_with_base(base: &str) -> Config {
        Config::from_vars(|name| {
            Some(
                match name {
                    "APP_ENV" => "test",
                    "AUTH_ISSUER" => "issuer",
                    "AUTH_JWKS_URL" => "http://localhost:0/jwks.json",
                    "PUBLIC_BASE_URL" => base,
                    "DATABASE_URL" => "unused",
                    _ => return None,
                }
                .to_string(),
            )
        })
        .unwrap()
    }

    // spec: LNK-029
    #[test]
    fn public_url_has_a_single_slash() {
        for base in [
            "https://cartouche.example",
            "https://cartouche.example/",
            "https://cartouche.example/app",
            "https://cartouche.example/app/",
        ] {
            let url = public_url(&config_with_base(base), "alice-durand");
            let path = url.strip_prefix("https://cartouche.example").unwrap();
            assert!(!path.contains("//"), "{url}");
            assert!(url.ends_with("/c/alice-durand"), "{url}");
        }
    }
}
