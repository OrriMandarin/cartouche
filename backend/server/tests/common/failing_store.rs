//! An object store that behaves like `InMemory` until its switch is turned on; while it is on,
//! every deletion fails, so a test can check what happens when the storage is down.

use std::fmt;
use std::ops::Range;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use async_trait::async_trait;
use bytes::Bytes;
use futures_util::StreamExt;
use futures_util::stream::BoxStream;
use object_store::memory::InMemory;
use object_store::path::Path;
use object_store::{
    CopyOptions, GetOptions, GetResult, ListResult, MultipartUpload, ObjectMeta, ObjectStore,
    PutMultipartOptions, PutOptions, PutPayload, PutResult, Result,
};

/// Delegates to an `InMemory` store. While `failing` is true, `delete_stream` yields a
/// `Generic` error (never `NotFound`, which the media service ignores) for every path.
#[derive(Debug)]
pub struct FailingStore {
    inner: InMemory,
    failing: Arc<AtomicBool>,
}

impl FailingStore {
    /// The store, and the switch that makes its deletions fail (initially off).
    pub fn new() -> (FailingStore, Arc<AtomicBool>) {
        let failing = Arc::new(AtomicBool::new(false));
        let store = FailingStore {
            inner: InMemory::new(),
            failing: Arc::clone(&failing),
        };
        (store, failing)
    }
}

impl fmt::Display for FailingStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "FailingStore({})", self.inner)
    }
}

#[async_trait]
impl ObjectStore for FailingStore {
    async fn put_opts(
        &self,
        location: &Path,
        payload: PutPayload,
        opts: PutOptions,
    ) -> Result<PutResult> {
        self.inner.put_opts(location, payload, opts).await
    }

    async fn put_multipart_opts(
        &self,
        location: &Path,
        opts: PutMultipartOptions,
    ) -> Result<Box<dyn MultipartUpload>> {
        self.inner.put_multipart_opts(location, opts).await
    }

    async fn get_opts(&self, location: &Path, options: GetOptions) -> Result<GetResult> {
        self.inner.get_opts(location, options).await
    }

    async fn get_ranges(&self, location: &Path, ranges: &[Range<u64>]) -> Result<Vec<Bytes>> {
        self.inner.get_ranges(location, ranges).await
    }

    fn delete_stream(
        &self,
        locations: BoxStream<'static, Result<Path>>,
    ) -> BoxStream<'static, Result<Path>> {
        if self.failing.load(Ordering::SeqCst) {
            return locations
                .map(|location| {
                    location.and_then(|_| {
                        Err(object_store::Error::Generic {
                            store: "FailingStore",
                            source: "storage is down".into(),
                        })
                    })
                })
                .boxed();
        }
        self.inner.delete_stream(locations)
    }

    fn list(&self, prefix: Option<&Path>) -> BoxStream<'static, Result<ObjectMeta>> {
        self.inner.list(prefix)
    }

    fn list_with_offset(
        &self,
        prefix: Option<&Path>,
        offset: &Path,
    ) -> BoxStream<'static, Result<ObjectMeta>> {
        self.inner.list_with_offset(prefix, offset)
    }

    async fn list_with_delimiter(&self, prefix: Option<&Path>) -> Result<ListResult> {
        self.inner.list_with_delimiter(prefix).await
    }

    async fn copy_opts(&self, from: &Path, to: &Path, options: CopyOptions) -> Result<()> {
        self.inner.copy_opts(from, to, options).await
    }
}
