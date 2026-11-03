//! The public OpenAPI contract, served at `GET /api/openapi.json` and committed as
//! `frontend/api-client/openapi.json` (the source of the generated TypeScript client).
//!
//! The document lists routes explicitly, so it is identical whether or not the
//! `test-support` feature is compiled: `/api/test/*` routes are never part of it.

use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};
use utoipa::{Modify, OpenApi};

use crate::routes::{
    admin_cards, admin_users, card_media, cards, events, health, leads, me, public_cards,
    public_events, slugs,
};

struct BearerAuth;

impl Modify for BearerAuth {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        let components = openapi.components.get_or_insert_with(Default::default);
        components.add_security_scheme(
            "bearer",
            SecurityScheme::Http(
                HttpBuilder::new()
                    .scheme(HttpAuthScheme::Bearer)
                    .bearer_format("JWT")
                    .description(Some("Access token issued by the identity provider."))
                    .build(),
            ),
        );
    }
}

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Cartouche API",
        description = "Cartouche public HTTP API. Errors are always \
            `{\"error\":{\"code\",\"message\",\"request_id\"}}`.",
    ),
    paths(
        health::health,
        me::me,
        admin_users::list_users,
        admin_users::set_user_status,
        admin_cards::get_user,
        admin_cards::get_card,
        admin_cards::support_disable_card,
        admin_cards::support_enable_card,
        cards::list_cards,
        cards::create_card,
        cards::get_card,
        cards::update_card,
        cards::delete_card,
        cards::disable_card,
        cards::enable_card,
        cards::duplicate_card,
        card_media::upload_media,
        events::list_events,
        events::create_event,
        events::get_event,
        events::update_event,
        events::end_event,
        events::delete_event,
        events::consent_preview,
        leads::list_card_leads,
        leads::list_event_leads,
        leads::set_lead_spam,
        leads::delete_lead,
        slugs::suggest_slug,
        slugs::slug_availability,
        public_cards::get_public_card,
        public_cards::get_public_vcard,
        public_events::get_public_event,
        public_events::unlock_public_event,
        public_events::submit_lead,
    ),
    components(schemas(crate::error::ErrorBody, crate::error::ErrorDetail)),
    modifiers(&BearerAuth),
    tags(
        (name = "health", description = "Service health"),
        (name = "account", description = "The signed-in user's account"),
        (name = "cards", description = "The signed-in user's cards and their links"),
        (name = "events", description = "The events of the signed-in user's cards"),
        (name = "leads", description = "The contacts collected by the events of the signed-in user's cards"),
        (name = "public", description = "A published card, its vCard, its running events and their forms, no sign-in"),
        (name = "admin", description = "Support tools, administrators only"),
    ),
)]
pub struct ApiDoc;

/// The document as pretty JSON with a trailing newline: the exact content of the
/// committed `openapi.json`. Key order is deterministic (sorted maps).
pub fn document_json() -> String {
    let mut json = ApiDoc::openapi()
        .to_pretty_json()
        .expect("OpenAPI document serializes");
    json.push('\n');
    json
}
