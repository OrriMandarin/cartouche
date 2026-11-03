//! Provider-agnostic token verification: any issuer that publishes a JWKS and signs
//! RS256/ES256 JWTs works. The API never calls the identity provider's own API.

mod extract;
mod keys;
mod verifier;

use thiserror::Error;

pub use extract::{AdminUser, ApprovedUser, CurrentUser};
pub use keys::{JwksKeySource, KeySource, KeySourceError, StaticKeySource};
pub use verifier::{JwtVerifier, TokenVerifier, VerifiedClaims};

/// Why a token was not accepted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum AuthError {
    /// No token was presented.
    #[error("no token presented")]
    Missing,
    /// Malformed, wrongly signed, wrong issuer or audience, unknown key, not yet valid...
    #[error("invalid token")]
    Invalid,
    /// Authentic but past its expiry (beyond the clock tolerance).
    #[error("token expired")]
    Expired,
    /// The identity provider's keys could not be fetched.
    #[error("token verification unavailable")]
    Unavailable,
}
