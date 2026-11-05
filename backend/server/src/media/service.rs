use std::ops::Range;
use std::sync::Arc;

use bytes::Bytes;
use cartouche_domain::{CropRect, Slot, served_content_type};
use chrono::{DateTime, Utc};
use futures_util::TryStreamExt;
use object_store::aws::AmazonS3Builder;
use object_store::local::LocalFileSystem;
#[cfg(any(test, feature = "test-support"))]
use object_store::memory::InMemory;
use object_store::path::Path;
use object_store::prefix::PrefixStore;
use object_store::{
    Attribute, Attributes, GetOptions, GetRange, ObjectStore, ObjectStoreExt, PutOptions,
};
use thiserror::Error;
use tokio::sync::Semaphore;
use url::Url;
use uuid::Uuid;

use super::process::{PrepareError, PreparedImage, ProcessError, prepare_image};
use super::signing::UrlSigner;
use crate::config::MediaStorageConfig;

/// Files never change under their name (MED-016).
pub const CACHE_CONTROL: &str = "public, max-age=31536000, immutable";

/// Files read through a signed address of the dashboard or the support page (MED-023).
pub const PRIVATE_CACHE_CONTROL: &str = "private, max-age=86400";

/// Where private originals live in local mode, under the media directory (MED-044).
pub const LOCAL_PRIVATE_PREFIX: &str = "private";

/// How long a signed address stays valid at least (MED-023).
const SIGNATURE_LIFETIME_SECONDS: i64 = 24 * 3600;

/// A processing job panicked (a decoder bug on a hostile file).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Panicked;

/// Images processed at the same time: decoding and resizing are CPU and memory heavy.
const IMAGE_PROCESSING_PERMITS: usize = 2;

#[derive(Debug, Error)]
pub enum MediaError {
    #[error("media not found")]
    NotFound,
    #[error("media storage error: {0}")]
    Storage(String),
}

impl From<object_store::Error> for MediaError {
    fn from(e: object_store::Error) -> MediaError {
        match e {
            object_store::Error::NotFound { .. } => MediaError::NotFound,
            other => MediaError::Storage(other.to_string()),
        }
    }
}

impl From<object_store::path::Error> for MediaError {
    fn from(e: object_store::path::Error) -> MediaError {
        MediaError::Storage(format!("invalid media key: {e}"))
    }
}

/// A stored file, or the requested part of it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaObject {
    pub bytes: Bytes,
    /// Size of the whole file, whatever part `bytes` holds.
    pub size: u64,
}

/// Stores media files (local disk or S3-compatible) behind one interface.
#[derive(Clone)]
pub struct MediaService {
    /// Files served to visitors (MED-011).
    public: Arc<dyn ObjectStore>,
    /// Private originals, which no address serves (MED-036, MED-044).
    private: Arc<dyn ObjectStore>,
    /// Public address of the storage root, without a trailing slash.
    base_url: String,
    serves_locally: bool,
    /// Whether `put` stores a content type, a cache policy and a disposition with each file. A bucket serves
    /// them itself (S3 mode); the local file system cannot store them, the API sets them when
    /// it serves the file.
    stores_headers: bool,
    image_permits: Arc<Semaphore>,
    /// Signs the dashboard's addresses of local files (MED-023).
    signer: UrlSigner,
}

impl MediaService {
    /// Builds the service of the configured storage. In local mode the directory is created.
    /// `public_base_url` is the API's public address, under which local files are served.
    pub fn from_config(
        config: &MediaStorageConfig,
        public_base_url: &Url,
    ) -> Result<MediaService, MediaError> {
        match config {
            MediaStorageConfig::Local { dir } => {
                std::fs::create_dir_all(dir).map_err(|e| {
                    MediaError::Storage(format!("cannot create {}: {e}", dir.display()))
                })?;
                let store: Arc<dyn ObjectStore> = Arc::new(LocalFileSystem::new_with_prefix(dir)?);
                let private = Arc::new(PrefixStore::new(Arc::clone(&store), LOCAL_PRIVATE_PREFIX));
                let base = format!("{}/media", public_base_url.as_str().trim_end_matches('/'));
                Ok(MediaService::new(store, private, &base, true))
            }
            MediaStorageConfig::S3 {
                bucket,
                private_bucket,
                region,
                endpoint,
                access_key_id,
                secret_access_key,
                public_base_url,
            } => {
                let bucket_store = |name: &str| -> Result<Arc<dyn ObjectStore>, MediaError> {
                    let mut builder = AmazonS3Builder::new()
                        .with_bucket_name(name)
                        .with_region(region)
                        .with_access_key_id(access_key_id)
                        .with_secret_access_key(secret_access_key.expose());
                    if let Some(endpoint) = endpoint {
                        builder = builder
                            .with_endpoint(endpoint.as_str())
                            .with_allow_http(endpoint.scheme() == "http");
                    }
                    Ok(Arc::new(builder.build()?))
                };
                Ok(MediaService::new(
                    bucket_store(bucket)?,
                    bucket_store(private_bucket)?,
                    public_base_url.as_str(),
                    false,
                ))
            }
        }
    }

    /// An in-memory store that behaves like local mode: files are served by the API.
    /// `public_base` is the address keys are appended to (e.g. `http://localhost:3000/media/`).
    #[cfg(any(test, feature = "test-support"))]
    pub fn in_memory(public_base: Url) -> MediaService {
        MediaService::new(
            Arc::new(InMemory::new()),
            Arc::new(InMemory::new()),
            public_base.as_str(),
            true,
        )
    }

    /// An in-memory store that behaves like S3 mode: files are served from `public_base`.
    #[cfg(any(test, feature = "test-support"))]
    pub fn in_memory_remote(public_base: Url) -> MediaService {
        MediaService::new(
            Arc::new(InMemory::new()),
            Arc::new(InMemory::new()),
            public_base.as_str(),
            false,
        )
    }

    /// A service over any stores, for tests that need stores of their own (e.g. one that fails).
    #[cfg(any(test, feature = "test-support"))]
    pub fn with_stores(
        public: Arc<dyn ObjectStore>,
        private: Arc<dyn ObjectStore>,
        public_base: Url,
        serves_locally: bool,
    ) -> MediaService {
        MediaService::new(public, private, public_base.as_str(), serves_locally)
    }

    fn new(
        public: Arc<dyn ObjectStore>,
        private: Arc<dyn ObjectStore>,
        base_url: &str,
        serves_locally: bool,
    ) -> MediaService {
        MediaService {
            public,
            private,
            base_url: base_url.trim_end_matches('/').to_string(),
            serves_locally,
            stores_headers: !serves_locally,
            image_permits: Arc::new(Semaphore::new(IMAGE_PROCESSING_PERMITS)),
            signer: UrlSigner::random(),
        }
    }

    /// Whether the API serves `/media/*` itself (local mode) instead of the bucket (S3 mode).
    pub fn serves_locally(&self) -> bool {
        self.serves_locally
    }

    /// Public address of the file stored under `key`.
    pub fn url(&self, key: &str) -> String {
        format!("{}/{}", self.base_url, key.trim_start_matches('/'))
    }

    /// Address of the file under `key` for the dashboard and the support page, and of a source
    /// for its owner (MED-031). In local mode it is signed, so it stays readable when the card
    /// is not served; it expires at the start of the hour after `now`, plus 24 hours, so it
    /// does not change within the hour and the browser can cache it. In S3 mode it is the
    /// bucket address (MED-023, MED-024).
    pub fn dashboard_url(&self, key: &str, now: DateTime<Utc>) -> String {
        let url = self.url(key);
        if !self.serves_locally {
            return url;
        }
        let next_hour = (now.timestamp().div_euclid(3600) + 1) * 3600;
        let expires_at = next_hour + SIGNATURE_LIFETIME_SECONDS;
        let signature = self.signer.sign(key, expires_at);
        format!("{url}?exp={expires_at}&sig={signature}")
    }

    /// Whether `signature` was made by this service for `key` and is not expired at `now`.
    pub fn verify_signature(
        &self,
        key: &str,
        expires_at: i64,
        signature: &str,
        now: DateTime<Utc>,
    ) -> bool {
        self.signer.verify(key, expires_at, signature, now)
    }

    pub async fn put(&self, key: &str, bytes: Bytes) -> Result<(), MediaError> {
        let options = if self.stores_headers {
            PutOptions::from(object_attributes(key))
        } else {
            PutOptions::default()
        };
        self.public
            .put_opts(&Path::parse(key)?, bytes.into(), options)
            .await?;
        Ok(())
    }

    /// Stores a private original under `key` (MED-036, MED-044). Nothing serves it, so it
    /// carries no headers.
    pub async fn put_private(&self, key: &str, bytes: Bytes) -> Result<(), MediaError> {
        self.private.put(&Path::parse(key)?, bytes.into()).await?;
        Ok(())
    }

    /// Size in bytes of the file stored under `key`.
    pub async fn size(&self, key: &str) -> Result<u64, MediaError> {
        Ok(self.public.head(&Path::parse(key)?).await?.size)
    }

    /// The whole file, or the bytes of `range` when given (an end past the file is cut short).
    pub async fn get(
        &self,
        key: &str,
        range: Option<Range<u64>>,
    ) -> Result<MediaObject, MediaError> {
        read(&self.public, key, range).await
    }

    /// Same as [`MediaService::get`], on a private original.
    pub async fn get_private(
        &self,
        key: &str,
        range: Option<Range<u64>>,
    ) -> Result<MediaObject, MediaError> {
        read(&self.private, key, range).await
    }

    pub async fn copy(&self, from: &str, to: &str) -> Result<(), MediaError> {
        self.public
            .copy(&Path::parse(from)?, &Path::parse(to)?)
            .await?;
        Ok(())
    }

    /// Copies a private original to another key of the private store.
    pub async fn copy_private(&self, from: &str, to: &str) -> Result<(), MediaError> {
        self.private
            .copy(&Path::parse(from)?, &Path::parse(to)?)
            .await?;
        Ok(())
    }

    /// Removes every file of one media of a card. Files already gone are not an error.
    pub async fn delete_media(&self, card_id: Uuid, media_id: Uuid) -> Result<(), MediaError> {
        self.delete_prefix(&format!("cards/{card_id}/{media_id}"))
            .await
    }

    /// Removes every file of a card (MED-019).
    pub async fn delete_card(&self, card_id: Uuid) -> Result<(), MediaError> {
        self.delete_prefix(&format!("cards/{card_id}")).await
    }

    /// Every key of the public store, in no particular order. For tests.
    #[cfg(any(test, feature = "test-support"))]
    pub async fn list_keys(&self) -> Vec<String> {
        list_all(&self.public).await
    }

    /// Every key of the private store, in no particular order. For tests.
    #[cfg(any(test, feature = "test-support"))]
    pub async fn list_private_keys(&self) -> Vec<String> {
        list_all(&self.private).await
    }

    /// Produces the source and the variants of an uploaded image, cut along `crop`, on a
    /// blocking thread, at most two images at a time, so uploads cannot exhaust CPU and memory.
    pub async fn prepare_image(
        &self,
        bytes: Bytes,
        slot: Slot,
        crop: Option<CropRect>,
    ) -> Result<PreparedImage, PrepareError> {
        match self
            .run_limited(move || prepare_image(&bytes, slot, crop))
            .await
        {
            Ok(result) => result,
            Err(Panicked) => {
                tracing::error!("image processing panicked, refusing the file as corrupt");
                Err(ProcessError::Corrupt.into())
            }
        }
    }

    /// Runs `work` on a blocking thread under a processing permit. The permit travels with the
    /// work: if the caller is dropped (client disconnect), the work still holds its permit
    /// until it ends, so the limit counts running threads, not waiting callers. A panic in
    /// `work` is reported as [`Panicked`] (the permit is still given back) instead of
    /// propagating to the request.
    async fn run_limited<T: Send + 'static>(
        &self,
        work: impl FnOnce() -> T + Send + 'static,
    ) -> Result<T, Panicked> {
        let permit = Arc::clone(&self.image_permits)
            .acquire_owned()
            .await
            .expect("the semaphore is never closed");
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            work()
        })
        .await
        .map_err(|_| Panicked)
    }

    async fn delete_prefix(&self, prefix: &str) -> Result<(), MediaError> {
        let prefix = Path::parse(prefix)?;
        for store in [&self.public, &self.private] {
            let metas: Vec<_> = store.list(Some(&prefix)).try_collect().await?;
            for meta in metas {
                match store.delete(&meta.location).await {
                    Ok(()) | Err(object_store::Error::NotFound { .. }) => {}
                    Err(e) => return Err(e.into()),
                }
            }
        }
        Ok(())
    }
}

async fn read(
    store: &Arc<dyn ObjectStore>,
    key: &str,
    range: Option<Range<u64>>,
) -> Result<MediaObject, MediaError> {
    let options = GetOptions::default().with_range(range.map(GetRange::Bounded));
    let result = store.get_opts(&Path::parse(key)?, options).await?;
    let size = result.meta.size;
    let bytes = result.bytes().await?;
    Ok(MediaObject { bytes, size })
}

#[cfg(any(test, feature = "test-support"))]
async fn list_all(store: &Arc<dyn ObjectStore>) -> Vec<String> {
    let metas: Vec<_> = store
        .list(None)
        .try_collect()
        .await
        .expect("listable store");
    metas.into_iter().map(|m| m.location.to_string()).collect()
}

/// What a bucket must send when it serves the file under `key`: its content type (iOS refuses
/// a video served as `binary/octet-stream`, PUB-005, MED-017) and the immutable cache policy
/// (MED-016).
fn object_attributes(key: &str) -> Attributes {
    let mut attributes = Attributes::new();
    if let Some(content_type) = served_content_type(key) {
        attributes.insert(Attribute::ContentType, content_type.into());
    }
    attributes.insert(Attribute::CacheControl, CACHE_CONTROL.into());
    attributes.insert(Attribute::ContentDisposition, "inline".into());
    attributes
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;
    use std::time::Duration;

    use super::*;

    fn service() -> MediaService {
        MediaService::in_memory("http://localhost:3000/media/".parse().unwrap())
    }

    // spec: MED-012
    #[tokio::test]
    async fn permit_is_held_until_the_blocking_work_ends_even_if_the_caller_is_dropped() {
        let media = service();
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel::<()>();

        let caller = tokio::spawn({
            let media = media.clone();
            async move {
                media
                    .run_limited(move || {
                        started_tx.send(()).unwrap();
                        release_rx.recv().unwrap();
                    })
                    .await
            }
        });
        // Wait (off the async threads) until the work is really running.
        tokio::task::spawn_blocking(move || started_rx.recv_timeout(Duration::from_secs(5)))
            .await
            .unwrap()
            .expect("work started");
        assert_eq!(media.image_permits.available_permits(), 1);

        // The client goes away: the awaiting future is dropped, the thread keeps running.
        caller.abort();
        let _ = caller.await;
        assert_eq!(media.image_permits.available_permits(), 1);

        // Only the end of the blocking work gives the permit back.
        release_tx.send(()).unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            while media.image_permits.available_permits() < IMAGE_PROCESSING_PERMITS {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("permit released after the work ended");
    }

    // spec: MED-012
    #[tokio::test]
    async fn a_panicking_job_is_reported_not_propagated() {
        let media = service();
        let result = media.run_limited(|| -> u32 { panic!("decoder") }).await;
        assert_eq!(result, Err(Panicked));
        // The permit went back: another job runs.
        assert_eq!(media.run_limited(|| 7).await, Ok(7));
        assert_eq!(
            media.image_permits.available_permits(),
            IMAGE_PROCESSING_PERMITS
        );
    }

    const CARD: &str = "0198a1b2-0000-7000-8000-000000000001";
    const MEDIA: &str = "0198a1b2-0000-7000-8000-000000000002";

    // spec: MED-016
    #[test]
    fn s3_files_get_their_content_type_and_immutable_cache_policy() {
        for (name, content_type) in [
            ("s640.webp", "image/webp"),
            ("w1920.webp", "image/webp"),
            ("s256.jpg", "image/jpeg"),
            ("video.mp4", "video/mp4"),
        ] {
            let attributes = object_attributes(&format!("cards/{CARD}/{MEDIA}/{name}"));
            assert_eq!(
                attributes.get(&Attribute::ContentType).map(|v| v.as_ref()),
                Some(content_type),
                "{name}"
            );
            assert_eq!(
                attributes.get(&Attribute::CacheControl).map(|v| v.as_ref()),
                Some("public, max-age=31536000, immutable"),
                "{name}"
            );
        }
    }

    // spec: MED-043
    #[test]
    fn s3_files_are_stored_inline_with_their_type_and_cache() {
        let attributes = object_attributes(&format!("cards/{CARD}/{MEDIA}/video.mp4"));
        assert_eq!(
            attributes
                .get(&Attribute::ContentDisposition)
                .map(|v| v.as_ref()),
            Some("inline")
        );
        assert!(attributes.get(&Attribute::ContentType).is_some());
        assert!(attributes.get(&Attribute::CacheControl).is_some());
    }

    // spec: MED-016
    #[tokio::test]
    async fn remote_mode_stores_the_attributes_and_local_mode_does_not() {
        let key = format!("cards/{CARD}/{MEDIA}/video.mp4");
        let remote = MediaService::in_memory_remote("https://cdn.example".parse().unwrap());
        remote.put(&key, Bytes::from_static(b"mp4")).await.unwrap();
        let stored = remote
            .public
            .get_opts(&Path::parse(&key).unwrap(), GetOptions::default())
            .await
            .unwrap();
        assert_eq!(
            stored
                .attributes
                .get(&Attribute::ContentType)
                .map(|v| v.as_ref()),
            Some("video/mp4")
        );
        assert!(stored.attributes.get(&Attribute::CacheControl).is_some());

        let local = service();
        local.put(&key, Bytes::from_static(b"mp4")).await.unwrap();
        let stored = local
            .public
            .get_opts(&Path::parse(&key).unwrap(), GetOptions::default())
            .await
            .unwrap();
        assert!(stored.attributes.is_empty());
    }
}
