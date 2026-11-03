//! Media storage and image processing (MED-006..MED-016).

pub mod process;
mod service;

pub use service::{MediaError, MediaObject, MediaService};
