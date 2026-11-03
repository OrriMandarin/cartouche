use sentry::ClientInitGuard;
use sentry::integrations::tracing::{BreadcrumbLayer, ErrorLayer};
use tracing_subscriber::EnvFilter;
use tracing_subscriber::Layer;
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

use crate::config::{AppEnv, Config};

/// Keeps the Sentry client alive: events are flushed when it is dropped.
pub struct TelemetryGuard {
    _sentry: Option<ClientInitGuard>,
}

/// Initialises logging (pretty in development, JSON otherwise) and, only when a DSN is
/// configured, Sentry with its tracing integration.
pub fn init(config: &Config) -> TelemetryGuard {
    let sentry = config.sentry_dsn.as_deref().map(|dsn| {
        let mut options = sentry::ClientOptions::new()
            .dsn(dsn)
            .environment(format!("{:?}", config.app_env).to_lowercase());
        options.release = sentry::release_name!();
        sentry::init(options)
    });
    // Errors become Sentry events; info and above are kept as breadcrumbs.
    let sentry_errors = sentry
        .is_some()
        .then(|| ErrorLayer::new().with_filter(LevelFilter::ERROR));
    let sentry_breadcrumbs = sentry
        .is_some()
        .then(|| BreadcrumbLayer::new().with_filter(LevelFilter::INFO));

    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let registry = tracing_subscriber::registry()
        .with(filter)
        .with(sentry_errors)
        .with(sentry_breadcrumbs);
    match config.app_env {
        AppEnv::Development => registry
            .with(tracing_subscriber::fmt::layer().pretty())
            .init(),
        AppEnv::Test | AppEnv::Production => registry
            .with(
                tracing_subscriber::fmt::layer()
                    .json()
                    .with_current_span(true)
                    .with_span_list(false),
            )
            .init(),
    }
    TelemetryGuard { _sentry: sentry }
}
