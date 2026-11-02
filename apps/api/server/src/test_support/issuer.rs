//! Signs tokens with the test key. The key is public in this repository: tokens from here
//! are only ever accepted where the test issuer is configured (never in production).

use cartouche_domain::Clock;
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use serde_json::{Map, Value, json};

use crate::config::AuthConfig;
use crate::startup::TEST_ISSUER;

/// `kid` of the test key, as published by `test-keys/jwks.json`.
pub const TEST_KID: &str = "cartouche-test-1";
const TEST_PRIVATE_KEY_PEM: &str = include_str!("../../test-keys/es256-private.pem");
/// The JWK Set of the test key.
pub const TEST_JWKS: &str = include_str!("../../test-keys/jwks.json");

pub const DEFAULT_EXPIRES_IN_SECS: u64 = 3600;
pub const MAX_EXPIRES_IN_SECS: u64 = 86_400;

/// The claims a test token carries. `subject` must already be normalized and non-empty.
#[derive(Debug, Clone)]
pub struct TokenSpec {
    pub subject: String,
    pub email: Option<String>,
    pub name: Option<String>,
    pub expires_in_secs: u64,
}

/// A signed ES256 token: `iss` = `TEST_ISSUER`, `iat`/`exp` from `clock`, and `aud` when the
/// configuration expects an audience.
pub fn sign_token(
    spec: &TokenSpec,
    clock: &dyn Clock,
    auth: &AuthConfig,
) -> Result<String, jsonwebtoken::errors::Error> {
    let iat = clock.now().timestamp();
    let mut claims = Map::new();
    claims.insert("iss".into(), json!(TEST_ISSUER));
    claims.insert("sub".into(), json!(spec.subject));
    claims.insert("iat".into(), json!(iat));
    claims.insert(
        "exp".into(),
        json!(iat.saturating_add(i64::try_from(spec.expires_in_secs).unwrap_or(i64::MAX))),
    );
    if let Some(audience) = &auth.audience {
        claims.insert("aud".into(), json!(audience));
    }
    if let Some(email) = &spec.email {
        claims.insert("email".into(), json!(email));
    }
    if let Some(name) = &spec.name {
        claims.insert("name".into(), json!(name));
    }

    let mut header = Header::new(Algorithm::ES256);
    header.kid = Some(TEST_KID.to_string());
    let key = EncodingKey::from_ec_pem(TEST_PRIVATE_KEY_PEM.as_bytes())?;
    jsonwebtoken::encode(&header, &Value::Object(claims), &key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_jwks_has_the_test_key_only() {
        let jwks: Value = serde_json::from_str(TEST_JWKS).unwrap();
        let keys = jwks["keys"].as_array().unwrap();
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0]["kid"], TEST_KID);
        assert!(keys[0].get("d").is_none());
    }
}
