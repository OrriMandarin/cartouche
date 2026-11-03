use std::sync::Arc;

use async_trait::async_trait;
use cartouche_domain::Clock;
use jsonwebtoken::{Algorithm, Validation, decode, decode_header};
use serde::Deserialize;
use serde_json::Value;

use super::AuthError;
use super::keys::KeySource;
use crate::config::AuthConfig;

/// Tolerance applied to `exp` and `nbf`, in seconds.
const LEEWAY_SECONDS: f64 = 60.0;

/// What the API keeps from a verified token. Strings are as sent by the issuer: callers
/// normalize (NFC, trim) before storing them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedClaims {
    pub issuer: String,
    pub subject: String,
    pub email: Option<String>,
    pub name: Option<String>,
}

#[async_trait]
pub trait TokenVerifier: Send + Sync {
    async fn verify(&self, token: &str) -> Result<VerifiedClaims, AuthError>;
}

/// Verifies RS256/ES256 JWTs against keys from a `KeySource`.
///
/// The signature is checked by `jsonwebtoken`; the claims (`iss`, `aud`, `exp`, `nbf`) are
/// checked here, against the injected clock rather than the system time.
pub struct JwtVerifier<K: KeySource> {
    issuer: String,
    audience: Option<String>,
    keys: K,
    clock: Arc<dyn Clock>,
}

#[derive(Deserialize)]
struct RawClaims {
    iss: Option<Value>,
    sub: Option<Value>,
    aud: Option<Value>,
    exp: Option<Value>,
    nbf: Option<Value>,
    email: Option<Value>,
    name: Option<Value>,
}

/// Longest attacker-controlled value copied into a log line.
const MAX_LOGGED_LEN: usize = 200;

fn clipped(value: &str) -> String {
    value.chars().take(MAX_LOGGED_LEN).collect()
}

/// Why a token was refused, for the operator's logs. Never the token itself. A wrong issuer
/// or audience is the usual symptom of a misconfigured deployment, hence `info`; the rest
/// is routine noise from clients and stays at `debug`.
fn rejected(reason: &str) -> AuthError {
    tracing::debug!(reason, "token rejected");
    AuthError::Invalid
}

impl<K: KeySource> JwtVerifier<K> {
    pub fn new(auth: &AuthConfig, keys: K, clock: Arc<dyn Clock>) -> Self {
        Self {
            issuer: auth.issuer.clone(),
            audience: auth.audience.clone(),
            keys,
            clock,
        }
    }

    fn check_claims(&self, claims: RawClaims) -> Result<VerifiedClaims, AuthError> {
        // Issuer and audience first: `Expired` is only ever said of a token meant for us.
        if claims.iss.as_ref().and_then(Value::as_str) != Some(self.issuer.as_str()) {
            let received = match &claims.iss {
                Some(Value::String(iss)) => clipped(iss),
                Some(_) => "<not a string>".to_string(),
                None => "<missing>".to_string(),
            };
            tracing::info!(
                expected = %self.issuer,
                received = %received,
                "token rejected: issuer mismatch"
            );
            return Err(AuthError::Invalid);
        }
        if let Some(expected) = &self.audience {
            let matches = match &claims.aud {
                Some(Value::String(aud)) => aud == expected,
                Some(Value::Array(auds)) => auds.iter().any(|a| a.as_str() == Some(expected)),
                _ => false,
            };
            if !matches {
                tracing::info!(expected = %expected, "token rejected: audience mismatch");
                return Err(AuthError::Invalid);
            }
        }

        let now = self.clock.now().timestamp() as f64;
        // `exp` is mandatory: a token that never expires is not accepted.
        let exp = claims
            .exp
            .as_ref()
            .and_then(Value::as_f64)
            .ok_or_else(|| rejected("missing or malformed exp"))?;
        if let Some(nbf) = claims.nbf {
            let nbf = nbf.as_f64().ok_or_else(|| rejected("malformed nbf"))?;
            if nbf - LEEWAY_SECONDS > now {
                return Err(rejected("token not yet valid (nbf)"));
            }
        }
        if exp + LEEWAY_SECONDS < now {
            tracing::debug!(reason = "token expired", "token rejected");
            return Err(AuthError::Expired);
        }

        let subject = match claims.sub {
            Some(Value::String(sub)) if !sub.is_empty() => sub,
            _ => return Err(rejected("missing or empty sub")),
        };
        let optional_string = |v: Option<Value>| match v {
            Some(Value::String(s)) => Some(s),
            _ => None,
        };
        Ok(VerifiedClaims {
            issuer: self.issuer.clone(),
            subject,
            email: optional_string(claims.email),
            name: optional_string(claims.name),
        })
    }
}

#[async_trait]
impl<K: KeySource> TokenVerifier for JwtVerifier<K> {
    async fn verify(&self, token: &str) -> Result<VerifiedClaims, AuthError> {
        let header = decode_header(token).map_err(|e| {
            tracing::debug!(error = %e, "token rejected: unreadable header");
            AuthError::Invalid
        })?;
        // Allow-list, checked before any key lookup: no `none`, no HMAC (an attacker could
        // otherwise use a public key as the HMAC secret), nothing but RS256 and ES256.
        if !matches!(header.alg, Algorithm::RS256 | Algorithm::ES256) {
            tracing::debug!(alg = ?header.alg, "token rejected: unsupported algorithm");
            return Err(AuthError::Invalid);
        }
        let kid = header
            .kid
            .as_deref()
            .filter(|kid| !kid.is_empty())
            .ok_or_else(|| rejected("missing kid"))?;
        let key = self
            .keys
            .key(kid)
            .await
            .map_err(|_| AuthError::Unavailable)?
            .ok_or_else(|| {
                tracing::debug!(kid = %clipped(kid), "token rejected: unknown kid");
                AuthError::Invalid
            })?;

        // Only the signature (and the algorithm allow-list) is delegated to jsonwebtoken;
        // time and audience checks are done in `check_claims`.
        let mut validation = Validation::new(header.alg);
        validation.algorithms = vec![header.alg];
        validation.validate_exp = false;
        validation.validate_nbf = false;
        validation.validate_aud = false;
        validation.required_spec_claims.clear();
        let data = decode::<RawClaims>(token, &key, &validation).map_err(|e| {
            tracing::debug!(error = %e, "token rejected: bad signature or malformed claims");
            AuthError::Invalid
        })?;
        self.check_claims(data.claims)
    }
}
