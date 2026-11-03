use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use serde::Serialize;
use utoipa::ToSchema;

use crate::db;
use crate::state::AppState;

/// Liveness and database reachability.
#[derive(Debug, Serialize, ToSchema)]
pub struct HealthResponse {
    /// `ok`, or `degraded` when the database is unreachable.
    #[schema(example = "ok")]
    pub status: &'static str,
    /// `ok`, or `error` when the database is unreachable.
    #[schema(example = "ok")]
    pub db: &'static str,
}

/// Reports whether the API and its database are up.
#[utoipa::path(
    get,
    path = "/api/health",
    summary = "Health check",
    description = "Reports whether the API and its database are up.",
    tag = "health",
    responses(
        (status = 200, description = "The API and its database are up.", body = HealthResponse),
        (status = 503, description = "The database is unreachable.", body = HealthResponse),
    ),
)]
pub async fn health(State(state): State<AppState>) -> (StatusCode, Json<HealthResponse>) {
    match db::ping(&state.db).await {
        Ok(()) => (
            StatusCode::OK,
            Json(HealthResponse {
                status: "ok",
                db: "ok",
            }),
        ),
        Err(e) => {
            tracing::error!(error = %e, "health check: database unreachable");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(HealthResponse {
                    status: "degraded",
                    db: "error",
                }),
            )
        }
    }
}
