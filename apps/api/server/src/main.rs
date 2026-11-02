use std::process::ExitCode;
use std::sync::Arc;

use cartouche_api::app::build_router;
use cartouche_api::config::Config;
use cartouche_api::startup::{TEST_SUPPORT_COMPILED, test_routes_enabled, validate};
use cartouche_api::state::AppState;
use cartouche_api::{db, telemetry};
use cartouche_domain::SystemClock;

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
    let pool = db::connect(&config.database_url).await?;
    db::migrate(&pool).await?;

    let bind_addr = config.bind_addr;
    let state = AppState {
        db: pool,
        config: Arc::new(config),
        clock: Arc::new(SystemClock),
    };
    let listener = tokio::net::TcpListener::bind(bind_addr).await?;
    tracing::info!(addr = %listener.local_addr()?, "listening");
    axum::serve(listener, build_router(state))
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
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
