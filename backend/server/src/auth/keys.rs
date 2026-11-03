use std::collections::HashMap;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use jsonwebtoken::DecodingKey;
use jsonwebtoken::jwk::{AlgorithmParameters, EllipticCurve, Jwk};
use thiserror::Error;
use tokio::sync::{Mutex, RwLock};
use url::Url;

/// Hard timeout for one JWKS request (connection, response and body together).
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
/// Unknown `kid`s trigger a refetch at most this often.
const DEFAULT_MIN_REFETCH_INTERVAL: Duration = Duration::from_secs(30);
/// After a failed fetch, further attempts fail fast for this long, so that a burst of
/// requests during an outage does not queue behind one timeout after another.
const FAILURE_BACKOFF: Duration = Duration::from_secs(2);
/// A JWKS larger than this is refused.
const MAX_JWKS_BYTES: usize = 1024 * 1024;

/// The keys could not be obtained (as opposed to the key not existing).
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("key source unavailable: {0}")]
pub struct KeySourceError(pub String);

/// Where verification keys come from. `Ok(None)` means "no such key".
#[async_trait]
pub trait KeySource: Send + Sync {
    async fn key(&self, kid: &str) -> Result<Option<DecodingKey>, KeySourceError>;
}

/// A fixed set of keys (tests), or a source that always fails.
pub struct StaticKeySource {
    keys: Option<HashMap<String, DecodingKey>>,
}

impl StaticKeySource {
    pub fn new(keys: Vec<(String, DecodingKey)>) -> Self {
        Self {
            keys: Some(keys.into_iter().collect()),
        }
    }

    /// Always answers `KeySourceError`.
    pub fn failing() -> Self {
        Self { keys: None }
    }
}

#[async_trait]
impl KeySource for StaticKeySource {
    async fn key(&self, kid: &str) -> Result<Option<DecodingKey>, KeySourceError> {
        match &self.keys {
            Some(keys) => Ok(keys.get(kid).cloned()),
            None => Err(KeySourceError("static key source set to fail".to_string())),
        }
    }
}

#[derive(Default)]
struct Cache {
    keys: HashMap<String, DecodingKey>,
    /// When the keys were last loaded successfully.
    loaded_at: Option<Instant>,
    /// When the last fetch attempt failed.
    failed_at: Option<Instant>,
}

impl Cache {
    fn is_fresh(&self, ttl: Duration) -> bool {
        self.loaded_at.is_some_and(|t| t.elapsed() < ttl)
    }
}

/// Keys published at a JWKS URL, cached in memory.
///
/// - Keys are reloaded once the TTL has passed.
/// - An unknown `kid` triggers a reload, at most once per minimum interval (30 s by default),
///   so random `kid`s cannot be used to hammer the identity provider.
/// - Every request has a 5 s timeout; failures surface as `KeySourceError`.
/// - Only RSA and P-256 keys are loaded: symmetric keys in a JWKS are never trusted.
pub struct JwksKeySource {
    url: Url,
    client: reqwest::Client,
    ttl: Duration,
    min_refetch_interval: Duration,
    cache: RwLock<Cache>,
    /// Serializes reloads: concurrent requests trigger a single fetch.
    refresh: Mutex<()>,
}

impl JwksKeySource {
    pub fn new(url: Url, client: reqwest::Client, ttl: Duration) -> Self {
        Self {
            url,
            client,
            ttl,
            min_refetch_interval: DEFAULT_MIN_REFETCH_INTERVAL,
            cache: RwLock::new(Cache::default()),
            refresh: Mutex::new(()),
        }
    }

    /// Overrides the unknown-`kid` refetch rate limit (30 s by default).
    pub fn with_min_refetch_interval(mut self, interval: Duration) -> Self {
        self.min_refetch_interval = interval;
        self
    }

    async fn lookup_fresh(&self, kid: &str) -> Option<DecodingKey> {
        let cache = self.cache.read().await;
        if cache.is_fresh(self.ttl) {
            cache.keys.get(kid).cloned()
        } else {
            None
        }
    }

    async fn fetch(&self) -> Result<HashMap<String, DecodingKey>, KeySourceError> {
        let mut response = self
            .client
            .get(self.url.clone())
            .header("accept", "application/json")
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await
            .map_err(|e| KeySourceError(format!("request failed: {}", describe(e))))?;
        if !response.status().is_success() {
            return Err(KeySourceError(format!("HTTP status {}", response.status())));
        }
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| KeySourceError(format!("reading body failed: {}", describe(e))))?
        {
            if body.len() + chunk.len() > MAX_JWKS_BYTES {
                return Err(KeySourceError("JWKS response too large".to_string()));
            }
            body.extend_from_slice(&chunk);
        }
        parse_jwks(&body)
    }
}

/// `reqwest::Error` without the URL (which is configuration, not a secret, but noisy).
fn describe(e: reqwest::Error) -> String {
    e.without_url().to_string()
}

/// Parses a JWK Set, keeping only usable asymmetric signing keys that have a `kid`.
/// One malformed entry never invalidates the others.
fn parse_jwks(body: &[u8]) -> Result<HashMap<String, DecodingKey>, KeySourceError> {
    let value: serde_json::Value = serde_json::from_slice(body)
        .map_err(|e| KeySourceError(format!("JWKS is not valid JSON: {e}")))?;
    let entries = value
        .get("keys")
        .and_then(|k| k.as_array())
        .ok_or_else(|| KeySourceError("JWKS has no `keys` array".to_string()))?;
    let mut keys = HashMap::new();
    for entry in entries {
        let Ok(jwk) = serde_json::from_value::<Jwk>(entry.clone()) else {
            continue;
        };
        let Some(kid) = jwk.common.key_id.clone() else {
            continue;
        };
        let usable = match &jwk.algorithm {
            AlgorithmParameters::RSA(_) => true,
            AlgorithmParameters::EllipticCurve(ec) => ec.curve == EllipticCurve::P256,
            // Symmetric and other key types are never accepted from a JWKS.
            _ => false,
        };
        if !usable {
            continue;
        }
        if let Ok(key) = DecodingKey::from_jwk(&jwk) {
            keys.insert(kid, key);
        }
    }
    Ok(keys)
}

#[async_trait]
impl KeySource for JwksKeySource {
    async fn key(&self, kid: &str) -> Result<Option<DecodingKey>, KeySourceError> {
        if let Some(key) = self.lookup_fresh(kid).await {
            return Ok(Some(key));
        }

        let _refresh = self.refresh.lock().await;
        // Another request may have reloaded while this one waited for the lock.
        {
            let cache = self.cache.read().await;
            if cache.is_fresh(self.ttl) {
                if let Some(key) = cache.keys.get(kid) {
                    return Ok(Some(key.clone()));
                }
                // Fresh but unknown `kid`: reload only if the last load is old enough.
                if cache
                    .loaded_at
                    .is_some_and(|t| t.elapsed() < self.min_refetch_interval)
                {
                    return Ok(None);
                }
            }
            if cache
                .failed_at
                .is_some_and(|t| t.elapsed() < FAILURE_BACKOFF)
            {
                return Err(KeySourceError(
                    "recent JWKS fetch failed, backing off".to_string(),
                ));
            }
        }

        match self.fetch().await {
            Ok(keys) => {
                let found = keys.get(kid).cloned();
                let mut cache = self.cache.write().await;
                cache.keys = keys;
                cache.loaded_at = Some(Instant::now());
                cache.failed_at = None;
                Ok(found)
            }
            Err(e) => {
                tracing::warn!(error = %e, "JWKS fetch failed");
                self.cache.write().await.failed_at = Some(Instant::now());
                Err(e)
            }
        }
    }
}
