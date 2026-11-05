use std::sync::Arc;

use cartouche_domain::Clock;
#[cfg(feature = "test-support")]
use cartouche_domain::OverridableClock;
use sqlx::PgPool;

use crate::auth::TokenVerifier;
use crate::config::Config;
use crate::media::MediaService;
use crate::media::video::VideoService;
use crate::rate_limit::RateLimiter;

/// Shared, cheaply clonable application state.
#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub config: Arc<Config>,
    pub clock: Arc<dyn Clock>,
    pub verifier: Arc<dyn TokenVerifier>,
    pub media: MediaService,
    pub video: VideoService,
    pub rate_limiter: Arc<dyn RateLimiter>,
    /// The same clock as `clock`, when it can be driven over HTTP (`POST /api/test/clock`).
    /// `None` when the state runs on another clock.
    #[cfg(feature = "test-support")]
    pub test_clock: Option<Arc<OverridableClock>>,
}
