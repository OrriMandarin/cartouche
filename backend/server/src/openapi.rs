//! The public OpenAPI contract, served at `GET /api/openapi.json` and committed as
//! `frontend/api-client/openapi.json` (the source of the generated TypeScript client).
//!
//! The document lists routes explicitly, so it is identical whether or not the
//! `test-support` feature is compiled: `/api/test/*` routes are never part of it.

use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};
use utoipa::{Modify, OpenApi};

use crate::routes::{admin_users, health, me};

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
    ),
    components(schemas(crate::error::ErrorBody, crate::error::ErrorDetail)),
    modifiers(&BearerAuth),
    tags(
        (name = "health", description = "Service health"),
        (name = "account", description = "The signed-in user's account"),
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
