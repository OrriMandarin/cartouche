//! Signed media addresses for the dashboard and the support page (MED-023).

use aws_lc_rs::hmac;
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::{DateTime, Utc};

/// Signs and checks media addresses with a key drawn at startup: addresses signed before a
/// restart stop working, and the dashboard asks for fresh ones on its next read.
#[derive(Clone)]
pub struct UrlSigner {
    key: hmac::Key,
}

impl UrlSigner {
    /// A signer with a random 32-byte key.
    pub fn random() -> UrlSigner {
        let mut secret = [0u8; 32];
        aws_lc_rs::rand::fill(&mut secret).expect("the system random generator is available");
        UrlSigner {
            key: hmac::Key::new(hmac::HMAC_SHA256, &secret),
        }
    }

    /// HMAC-SHA256 of the storage key and the expiry (Unix seconds), in unpadded base64url.
    pub fn sign(&self, key: &str, expires_at: i64) -> String {
        URL_SAFE_NO_PAD.encode(hmac::sign(&self.key, &message(key, expires_at)))
    }

    /// Whether `signature` was made by this signer for `key` and `expires_at`, and the expiry
    /// is still ahead of `now`. The comparison takes constant time.
    pub fn verify(&self, key: &str, expires_at: i64, signature: &str, now: DateTime<Utc>) -> bool {
        if expires_at <= now.timestamp() {
            return false;
        }
        let Ok(tag) = URL_SAFE_NO_PAD.decode(signature) else {
            return false;
        };
        hmac::verify(&self.key, &message(key, expires_at), &tag).is_ok()
    }
}

fn message(key: &str, expires_at: i64) -> Vec<u8> {
    format!("{key}\n{expires_at}").into_bytes()
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};

    use super::*;

    const KEY: &str =
        "cards/0198a1b2-0000-7000-8000-000000000001/0198a1b2-0000-7000-8000-000000000002/s128.webp";
    const OTHER: &str =
        "cards/0198a1b2-0000-7000-8000-000000000001/0198a1b2-0000-7000-8000-000000000003/s128.webp";

    // spec: MED-023
    #[test]
    fn signature_round_trip() {
        let signer = UrlSigner::random();
        let now = Utc.with_ymd_and_hms(2026, 1, 15, 12, 0, 0).unwrap();
        let exp = now.timestamp() + 3600;
        let sig = signer.sign(KEY, exp);
        assert!(!sig.contains(['+', '/', '=']), "{sig}");
        assert!(signer.verify(KEY, exp, &sig, now));

        assert!(!signer.verify(OTHER, exp, &sig, now));
        assert!(!signer.verify(KEY, exp + 1, &sig, now));
        let mut altered = sig.clone().into_bytes();
        altered[0] = if altered[0] == b'A' { b'B' } else { b'A' };
        assert!(!signer.verify(KEY, exp, std::str::from_utf8(&altered).unwrap(), now));
        assert!(!signer.verify(KEY, exp, "not base64!", now));
        assert!(!signer.verify(KEY, exp, "", now));
        // Expired: exp must lie strictly after now.
        let at_exp = Utc.timestamp_opt(exp, 0).unwrap();
        assert!(!signer.verify(KEY, exp, &sig, at_exp));
        assert!(!signer.verify(KEY, exp, &sig, at_exp + chrono::Duration::seconds(1)));
        // Another server start draws another key.
        assert!(!UrlSigner::random().verify(KEY, exp, &sig, now));
    }
}
