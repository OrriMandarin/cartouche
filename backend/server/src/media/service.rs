use std::ops::Range;
use std::sync::Arc;

use bytes::Bytes;
use cartouche_domain::Slot;
use futures_util::TryStreamExt;
use object_store::aws::AmazonS3Builder;
use object_store::local::LocalFileSystem;
use object_store::memory::InMemory;
use object_store::path::Path;
use object_store::{GetOptions, GetRange, ObjectStore, ObjectStoreExt};
use thiserror::Error;
use tokio::sync::Semaphore;
use url::Url;
use uuid::Uuid;

use super::process::{EncodedVariant, ProcessError, process_image};
use crate::config::MediaStorageConfig;

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
    store: Arc<dyn ObjectStore>,
    /// Public address of the storage root, without a trailing slash.
    base_url: String,
    serves_locally: bool,
    image_permits: Arc<Semaphore>,
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
                let store = LocalFileSystem::new_with_prefix(dir)?;
                let base = format!("{}/media", public_base_url.as_str().trim_end_matches('/'));
                Ok(MediaService::new(Arc::new(store), &base, true))
            }
            MediaStorageConfig::S3 {
                bucket,
                region,
                endpoint,
                access_key_id,
                secret_access_key,
                public_base_url,
            } => {
                let mut builder = AmazonS3Builder::new()
                    .with_bucket_name(bucket)
                    .with_region(region)
                    .with_access_key_id(access_key_id)
                    .with_secret_access_key(secret_access_key.expose());
                if let Some(endpoint) = endpoint {
                    builder = builder
                        .with_endpoint(endpoint.as_str())
                        .with_allow_http(endpoint.scheme() == "http");
                }
                let store = builder.build()?;
                Ok(MediaService::new(
                    Arc::new(store),
                    public_base_url.as_str(),
                    false,
                ))
            }
        }
    }

    /// An in-memory store that behaves like local mode: files are served by the API.
    /// `public_base` is the address keys are appended to (e.g. `http://localhost:3000/media/`).
    pub fn in_memory(public_base: Url) -> MediaService {
        MediaService::new(Arc::new(InMemory::new()), public_base.as_str(), true)
    }

    /// An in-memory store that behaves like S3 mode: files are served from `public_base`.
    pub fn in_memory_remote(public_base: Url) -> MediaService {
        MediaService::new(Arc::new(InMemory::new()), public_base.as_str(), false)
    }

    fn new(store: Arc<dyn ObjectStore>, base_url: &str, serves_locally: bool) -> MediaService {
        MediaService {
            store,
            base_url: base_url.trim_end_matches('/').to_string(),
            serves_locally,
            image_permits: Arc::new(Semaphore::new(IMAGE_PROCESSING_PERMITS)),
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

    pub async fn put(&self, key: &str, bytes: Bytes) -> Result<(), MediaError> {
        self.store.put(&Path::parse(key)?, bytes.into()).await?;
        Ok(())
    }

    /// The whole file, or the bytes of `range` when given (an end past the file is cut short).
    pub async fn get(
        &self,
        key: &str,
        range: Option<Range<u64>>,
    ) -> Result<MediaObject, MediaError> {
        let options = GetOptions::default().with_range(range.map(GetRange::Bounded));
        let result = self.store.get_opts(&Path::parse(key)?, options).await?;
        let size = result.meta.size;
        let bytes = result.bytes().await?;
        Ok(MediaObject { bytes, size })
    }

    pub async fn copy(&self, from: &str, to: &str) -> Result<(), MediaError> {
        self.store
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

    /// Every stored key, in no particular order. For tests.
    pub async fn list_keys(&self) -> Vec<String> {
        let metas: Vec<_> = self
            .store
            .list(None)
            .try_collect()
            .await
            .expect("listable store");
        metas.into_iter().map(|m| m.location.to_string()).collect()
    }

    /// Produces the variants of an uploaded image on a blocking thread, at most two images at
    /// a time, so uploads cannot exhaust CPU and memory.
    pub async fn process_image(
        &self,
        bytes: Bytes,
        slot: Slot,
    ) -> Result<Vec<EncodedVariant>, ProcessError> {
        self.run_limited(move || process_image(&bytes, slot)).await
    }

    /// Runs `work` on a blocking thread under a processing permit. The permit travels with the
    /// work: if the caller is dropped (client disconnect), the work still holds its permit
    /// until it ends, so the limit counts running threads, not waiting callers.
    async fn run_limited<T: Send + 'static>(&self, work: impl FnOnce() -> T + Send + 'static) -> T {
        let permit = Arc::clone(&self.image_permits)
            .acquire_owned()
            .await
            .expect("the semaphore is never closed");
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            work()
        })
        .await
        .expect("image processing does not panic")
    }

    async fn delete_prefix(&self, prefix: &str) -> Result<(), MediaError> {
        let prefix = Path::parse(prefix)?;
        let metas: Vec<_> = self.store.list(Some(&prefix)).try_collect().await?;
        for meta in metas {
            match self.store.delete(&meta.location).await {
                Ok(()) | Err(object_store::Error::NotFound { .. }) => {}
                Err(e) => return Err(e.into()),
            }
        }
        Ok(())
    }
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
}
