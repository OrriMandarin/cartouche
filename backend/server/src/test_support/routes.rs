//! The `/api/test/*` routes. All of them are mounted by one guard in `app.rs`
//! (feature compiled and `APP_ENV` not production).

use axum::extract::State;
use axum::http::StatusCode;
use axum::http::header;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use cartouche_domain::normalize;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::issuer::{
    DEFAULT_EXPIRES_IN_SECS, MAX_EXPIRES_IN_SECS, TEST_JWKS, TokenSpec, sign_token,
};
use super::seed::{self, SeedReport};
use crate::auth::ApprovedUser;
use crate::error::ApiError;
use crate::extract::ApiJson;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/test/jwks.json", get(jwks))
        .route("/api/test/token", post(token))
        .route("/api/test/reset", post(reset))
        .route("/api/test/seed", post(seed_scenario))
        .route("/api/test/clock", post(set_clock))
        // Probe for the `ApprovedUser` extractor until real routes use it.
        .route("/api/test/approved-check", get(approved_check))
}

async fn approved_check(_: ApprovedUser) -> StatusCode {
    StatusCode::NO_CONTENT
}

async fn jwks() -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "application/json")], TEST_JWKS)
}

#[derive(Debug, Deserialize)]
struct TokenRequest {
    subject: String,
    email: Option<String>,
    name: Option<String>,
    expires_in_secs: Option<u64>,
}

#[derive(Debug, Serialize)]
struct TokenResponse {
    token: String,
}

async fn token(
    State(state): State<AppState>,
    ApiJson(request): ApiJson<TokenRequest>,
) -> Result<Json<TokenResponse>, ApiError> {
    let subject = normalize(&request.subject);
    let expires_in_secs = request.expires_in_secs.unwrap_or(DEFAULT_EXPIRES_IN_SECS);
    if subject.is_empty() || expires_in_secs > MAX_EXPIRES_IN_SECS {
        return Err(ApiError::InvalidRequest);
    }
    let spec = TokenSpec {
        subject,
        email: request
            .email
            .map(|e| normalize(&e))
            .filter(|e| !e.is_empty()),
        name: request
            .name
            .map(|n| normalize(&n))
            .filter(|n| !n.is_empty()),
        expires_in_secs,
    };
    let token = sign_token(&spec, state.clock.as_ref(), &state.config.auth)
        .map_err(|e| ApiError::Internal(format!("signing test token: {e}")))?;
    Ok(Json(TokenResponse { token }))
}

async fn reset(State(state): State<AppState>) -> Result<StatusCode, ApiError> {
    seed::reset(&state.db).await?;
    state.rate_limiter.reset();
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
struct SeedRequest {
    scenario: String,
}

async fn seed_scenario(
    State(state): State<AppState>,
    ApiJson(request): ApiJson<SeedRequest>,
) -> Result<Json<SeedReport>, ApiError> {
    let run = seed::scenario(&request.scenario).ok_or(ApiError::UnknownScenario)?;
    Ok(Json(run(&state.db, state.clock.now()).await?))
}

/// `now` is required but may be `null`.
#[derive(Debug, Deserialize)]
struct ClockRequest {
    #[serde(deserialize_with = "Option::deserialize")]
    now: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
struct ClockResponse {
    now: DateTime<Utc>,
}

async fn set_clock(
    State(state): State<AppState>,
    ApiJson(request): ApiJson<ClockRequest>,
) -> Result<Json<ClockResponse>, ApiError> {
    // The state runs on another clock (e.g. a frozen one): nothing to drive.
    let clock = state.test_clock.as_ref().ok_or(ApiError::NotFound)?;
    clock.set(request.now);
    Ok(Json(ClockResponse {
        now: cartouche_domain::Clock::now(clock.as_ref()),
    }))
}
