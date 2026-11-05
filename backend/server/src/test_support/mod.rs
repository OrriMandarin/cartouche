//! Everything the end-to-end and integration tests need from a running API: a token issuer,
//! the matching JWKS, database reset and seeding, and a clock driven over HTTP.
//!
//! Compiled only with the `test-support` feature, mounted only outside production (ACC-008).

pub mod issuer;
pub mod routes;
pub mod seed;
pub mod video;
