//! JSON shapes of the API that are shared by several routes.

use cartouche_domain::{
    CardContent, CardStatus, Link, LinkKind, MediaKind, Theme, VariantFormat, format_international,
    storage_key,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::config::Config;
use crate::db::cards::Card;
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
