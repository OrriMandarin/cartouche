//! JSON shapes of the API that are shared by several routes.

use cartouche_domain::export::{ExportEvent, ExportLead};
use cartouche_domain::{
    AnswerSnapshot, CardContent, CardStatus, CropRect, CustomField, EventPhase, Link, LinkKind,
    MediaKind, PublicForm, StandardAnswers, StandardField, StandardFields, Theme, VariantFormat,
    VideoLoop, consent_text, default_consent_text, form_version, format_international, storage_key,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::config::Config;
use crate::db::cards::{self, Card, CardCounts};
use crate::db::events::{Event, EventWithCount, PublicCandidate};
use crate::db::leads::Lead;
use crate::db::media::MediaRecord;
use crate::error::ApiError;
use crate::media::MediaService;
use crate::state::AppState;

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
    /// The card's events by phase, computed with the server clock (EVT-020, EDI-023).
    pub event_counts: EventCounts,
    /// Every contact of the card's events, spam ones included (EDI-024).
    pub lead_count: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Number of events of a card in each phase.
#[derive(Debug, Serialize, ToSchema)]
pub struct EventCounts {
    pub running: u32,
    pub upcoming: u32,
    pub past: u32,
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

/// A contact as the owner of its event sees it. The device that sent it is not shown.
#[derive(Debug, Serialize, ToSchema)]
pub struct LeadView {
    pub id: Uuid,
    pub event_id: Uuid,
    /// The title the event has now.
    pub event_title: String,
    pub submitted_at: DateTime<Utc>,
    /// Marked as spam by the owner (ABU-003); spam contacts stay listed (ABU-009).
    pub spam: bool,
    /// The answers to the standard fields; the phone number is in E.164.
    pub answers: StandardAnswers,
    /// The phone number as people write it, e.g. `+33 6 12 34 56 78`.
    pub phone_display: Option<String>,
    /// The answers to the custom fields, with the label and type each field had when the
    /// contact was sent (FRM-022).
    pub custom: Vec<AnswerSnapshot>,
    /// When the prospect gave consent (FRM-038).
    pub consent_at: DateTime<Utc>,
    /// The consent text shown with the form, exactly (FRM-038).
    pub consent_text: String,
}

impl From<Lead> for LeadView {
    fn from(lead: Lead) -> LeadView {
        LeadView {
            phone_display: lead.standard.phone.as_deref().map(format_international),
            spam: lead.spam_at.is_some(),
            id: lead.id,
            event_id: lead.event_id,
            event_title: lead.event_title,
            submitted_at: lead.submitted_at,
            answers: lead.standard,
            custom: lead.custom,
            consent_at: lead.consent_at,
            consent_text: lead.consent_text,
        }
    }
}

impl From<Event> for ExportEvent {
    fn from(event: Event) -> ExportEvent {
        ExportEvent {
            id: event.id,
            title: event.title,
            starts_at: event.period.starts_at,
            standard: event.form.standard,
            custom: event.form.custom,
        }
    }
}

impl From<Lead> for ExportLead {
    fn from(lead: Lead) -> ExportLead {
        ExportLead {
            id: lead.id,
            event_id: lead.event_id,
            submitted_at: lead.submitted_at,
            standard: lead.standard,
            custom: lead.custom,
            consent_at: lead.consent_at,
            consent_text: lead.consent_text,
            spam: lead.spam_at.is_some(),
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

/// The consent text of an event's form and the version of the form, as the prospect is shown
/// them; a submission is checked and recorded against the same values (FRM-008, FRM-030).
pub struct ShownForm {
    pub consent_text: String,
    pub form_version: String,
}

impl ShownForm {
    /// `card` is the content of the event's card (it names the data controller).
    pub fn new(event: &Event, card: &CardContent) -> ShownForm {
        let consent = consent_text(event.consent_text.as_deref(), card, &event.title);
        let form_version = form_version(&PublicForm {
            title: &event.title,
            description: event.description.as_deref(),
            standard: &event.form.standard,
            custom: &event.form.custom,
            consent_text: &consent,
        });
        ShownForm {
            consent_text: consent,
            form_version,
        }
    }
}

impl PublicEventForm {
    /// `card` is the content of the event's card (it names the data controller).
    pub fn new(event: Event, card: &CardContent) -> PublicEventForm {
        let ShownForm {
            consent_text,
            form_version,
        } = ShownForm::new(&event, card);
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
            consent_text,
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

/// An uploaded image or video, the addresses of its files and its framing.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct MediaView {
    pub id: Uuid,
    pub kind: MediaKind,
    /// The WebP variants, narrowest first, cut along the crop; for a video, the waiting image.
    pub images: Vec<ImageVariantView>,
    /// The MP4 file, for a video, as uploaded.
    pub video_url: Option<String>,
    /// The largest JPEG variant, for a profile photo (vCard and link previews).
    pub jpeg_url: Option<String>,
    /// The crop, in proportions of the source (MED-026); absent for a media uploaded before
    /// plan 6, which is shown centred (MED-033).
    pub crop: Option<CropRect>,
    /// The part of a header video that plays in a loop, in seconds (MED-028).
    #[serde(rename = "loop")]
    pub video_loop: Option<VideoLoop>,
    /// When, in seconds, the waiting image of a video was captured (MED-028).
    pub poster_time: Option<f64>,
    /// The duration of a video, as the server read it (MED-013).
    pub duration_seconds: Option<f64>,
    /// The whole image the files are cut from, to re-frame the media. Only in the owner's
    /// views, and only for a media uploaded since plan 6 (MED-025, MED-031).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<SourceView>,
}

/// The source of a media, for its owner (MED-031).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct SourceView {
    /// Signed in local mode; the bucket address in S3 mode.
    pub url: String,
    pub width: u32,
    pub height: u32,
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
    /// The card's owner, at the given time: signed addresses, readable even when the card is
    /// not served (MED-023), and the media's source (MED-031).
    Owner(DateTime<Utc>),
    /// The support page, at the given time: signed addresses (MED-023), never the source.
    Support(DateTime<Utc>),
}

impl MediaView {
    pub fn new(record: &MediaRecord, media: &MediaService, audience: Audience) -> MediaView {
        let url_of = |name: &str| {
            let key = storage_key(record.card_id, record.id, name);
            match audience {
                Audience::Public => media.url(&key),
                Audience::Owner(now) | Audience::Support(now) => media.dashboard_url(&key, now),
            }
        };
        let source = match audience {
            Audience::Owner(_) => record.source.as_ref().map(|source| SourceView {
                url: url_of(&source.name),
                width: source.width,
                height: source.height,
            }),
            Audience::Public | Audience::Support(_) => None,
        };
        let framing = record.framing.as_ref();
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
            crop: framing.map(|f| f.crop),
            video_loop: framing.and_then(|f| f.video_loop),
            poster_time: framing.and_then(|f| f.poster_time),
            duration_seconds: record.duration_ms.map(|ms| f64::from(ms) / 1000.0),
            source,
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
    /// Like `new`, with the counts of the card read from the database (the card's owner
    /// filters them, ACC-017) and the phases computed at the server clock.
    pub async fn load(
        state: &AppState,
        card: Card,
        attached: &[MediaRecord],
        audience: Audience,
    ) -> Result<CardView, ApiError> {
        let counts =
            cards::counts_for_owner(&state.db, card.owner_id, &[card.id], state.clock.now())
                .await?
                .remove(&card.id)
                .unwrap_or_default();
        CardView::new(
            card,
            counts,
            attached,
            &state.config,
            &state.media,
            audience,
        )
    }

    /// `attached` holds the card's header and avatar records (others are ignored); the files'
    /// addresses are those of `audience`, the owner or support (MED-023, MED-031). Fails only
    /// if the stored theme is no longer valid, which is a bug of ours.
    pub fn new(
        card: Card,
        counts: CardCounts,
        attached: &[MediaRecord],
        config: &Config,
        media: &MediaService,
        audience: Audience,
    ) -> Result<CardView, ApiError> {
        let status = card.status();
        let theme = stored_theme(&card)?;
        let view_of = |id: Option<Uuid>| attached_view(attached, id, media, audience);
        Ok(CardView {
            header: view_of(card.header_media_id),
            avatar: view_of(card.avatar_media_id),
            public_url: public_url(config, &card.slug),
            event_counts: EventCounts {
                running: counts.running,
                upcoming: counts.upcoming,
                past: counts.past,
            },
            lead_count: counts.lead_count,
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
