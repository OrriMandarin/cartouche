use std::sync::Arc;

use cartouche_domain::Clock;
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
}
