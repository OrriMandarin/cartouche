use std::sync::Arc;

use cartouche_domain::Clock;
#[cfg(feature = "test-support")]
use cartouche_domain::OverridableClock;
use sqlx::PgPool;

use crate::auth::TokenVerifier;
use crate::config::Config;

/// Shared, cheaply clonable application state.
#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub config: Arc<Config>,
    pub clock: Arc<dyn Clock>,
    pub verifier: Arc<dyn TokenVerifier>,
    /// The same clock as `clock`, when it can be driven over HTTP (`POST /api/test/clock`).
    /// `None` when the state runs on another clock.
    #[cfg(feature = "test-support")]
    pub test_clock: Option<Arc<OverridableClock>>,
}
