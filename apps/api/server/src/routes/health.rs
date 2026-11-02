use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use serde_json::{Value, json};

use crate::db;
use crate::state::AppState;

pub async fn health(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    match db::ping(&state.db).await {
        Ok(()) => (StatusCode::OK, Json(json!({"status": "ok", "db": "ok"}))),
        Err(e) => {
            tracing::error!(error = %e, "health check: database unreachable");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({"status": "degraded", "db": "error"})),
            )
        }
    }
}
