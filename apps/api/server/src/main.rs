use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use cartouche_api::app::build_router;
use cartouche_api::auth::{JwksKeySource, JwtVerifier};
use cartouche_api::config::Config;
use cartouche_api::startup::{TEST_SUPPORT_COMPILED, test_routes_enabled, validate};
use cartouche_api::state::AppState;
use cartouche_api::{db, telemetry};
use cartouche_domain::{Clock, OverridableClock, SystemClock};

/// How long fetched signing keys are trusted before the JWKS is fetched again.
const JWKS_TTL: Duration = Duration::from_secs(3600);

#[tokio::main]
async fn main() -> ExitCode {
    let config = match Config::from_env() {
        Ok(config) => config,
        Err(e) => {
            eprintln!("invalid configuration: {e}");
            return ExitCode::FAILURE;
        }
    };
    let _telemetry = telemetry::init(&config);

    if let Err(e) = validate(&config) {
        tracing::error!(error = %e, "invalid startup configuration");
        return ExitCode::FAILURE;
    }

    // Only named, non-secret fields are logged: never the whole `Config` (database URL, DSN).
    tracing::info!(
        app_env = ?config.app_env,
        auth_issuer = %config.auth.issuer,
        test_support_compiled = TEST_SUPPORT_COMPILED,
        test_routes_enabled = test_routes_enabled(&config),
        bind_addr = %config.bind_addr,
        "starting cartouche-api"
    );

    match run(config).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            tracing::error!(error = %e, "fatal error");
            ExitCode::FAILURE
        }
    }
}

async fn run(config: Config) -> Result<(), Box<dyn std::error::Error>> {
    let bind_addr = config.bind_addr;
    let pool = db::connect(&config.database_url).await?;
    db::migrate(&pool).await?;

    let (clock, _test_clock) = clocks(&config);
    let http = reqwest::Client::builder()
        .user_agent(concat!("cartouche-api/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let keys = JwksKeySource::new(config.auth.jwks_url.clone(), http, JWKS_TTL);
    let verifier = JwtVerifier::new(&config.auth, keys, clock.clone());
    let state = AppState {
        db: pool,
        config: Arc::new(config),
        clock,
        verifier: Arc::new(verifier),
        #[cfg(feature = "test-support")]
        test_clock: _test_clock,
    };
    let listener = tokio::net::TcpListener::bind(bind_addr).await?;
    tracing::info!(addr = %listener.local_addr()?, "listening");
    axum::serve(listener, build_router(state))
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

/// The clock of the application state, plus the same clock as an `OverridableClock` when the
/// test routes are mounted (`development` and `test` only); otherwise the system clock.
fn clocks(config: &Config) -> (Arc<dyn Clock>, Option<Arc<OverridableClock>>) {
    if test_routes_enabled(config) {
        let clock = Arc::new(OverridableClock::new());
        (clock.clone(), Some(clock))
    } else {
        (Arc::new(SystemClock), None)
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            signal.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
    tracing::info!("shutting down");
}
