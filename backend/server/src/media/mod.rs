//! Media storage, image processing and signed addresses (MED-006..MED-016, MED-023, MED-025).

pub mod process;
mod service;
pub mod signing;
pub mod video;

use cartouche_domain::source_name;
use uuid::Uuid;

pub use service::{CACHE_CONTROL, MediaError, MediaObject, MediaService, PRIVATE_CACHE_CONTROL};

/// A new file name for a media's source, with a token drawn at random: 32 hexadecimal
/// characters of a UUID v4, so that it cannot be guessed (MED-031).
pub fn new_source_name() -> String {
    source_name(&Uuid::new_v4().simple().to_string())
}
