//! Deleting one's own account (ACC-018, ACC-021, ACC-022).

use axum::extract::State;
use axum::http::StatusCode;
use cartouche_domain::check_account_deletion;

use crate::auth::CurrentUser;
use crate::db::{account, blocked_slugs, users};
use crate::error::{ApiError, ErrorBody};
use crate::state::AppState;

/// Deletes the caller's account and all its data, whatever its status (ACC-021). The rows, the
/// media files and the slugs (kept as hashes, LNK-015) go together: the transaction stays open
/// while the files are deleted and is only committed once they are gone, so a storage failure
/// leaves everything in place and the user can try again (ACC-022).
#[utoipa::path(
    delete,
    path = "/api/me",
    summary = "Delete the account",
    description = "Deletes the caller's account, its cards, media (files included), events and leads. The card links stay blocked forever. Allowed whatever the account's status; refused to current administrators. All or nothing: if the media files cannot be deleted, nothing is deleted.",
    tag = "account",
    security(("bearer" = [])),
    responses(
        (status = 204, description = "The account and all its data are deleted."),
        (status = 401, description = "Missing, invalid or expired token (`token_invalid`, `token_expired`).", body = ErrorBody),
        (status = 403, description = "The caller is an administrator (`cannot_delete_admin`), or signups are closed for a new user (`signup_closed`).", body = ErrorBody),
        (status = 404, description = "The account no longer exists (`not_found`).", body = ErrorBody),
        (status = 503, description = "The identity provider is unreachable (`auth_unavailable`).", body = ErrorBody),
        (status = 500, description = "Unexpected failure, or the media files could not be deleted: nothing was deleted (`internal_error`).", body = ErrorBody),
    ),
)]
pub async fn delete_me(
    current: CurrentUser,
    State(state): State<AppState>,
) -> Result<StatusCode, ApiError> {
    check_account_deletion(current.is_admin).map_err(|_| ApiError::CannotDeleteAdmin)?;
    let user_id = current.user.id;

    let mut tx = state.db.begin().await?;
    // The row lock serializes two simultaneous deletions: the second finds no account.
    users::find_for_update(&mut tx, user_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let card_ids = account::card_ids(&mut tx, user_id).await?;
    blocked_slugs::block_all_of_owner(&mut tx, user_id).await?;
    account::strip_slugs_from_audit(&mut tx, user_id).await?;
    account::delete_user(&mut tx, user_id).await?;
    // The files go before the commit, with the transaction still open: if one cannot be
    // deleted, dropping the transaction rolls the database back (a storage error is never a 404).
    for card_id in &card_ids {
        state
            .media
            .delete_card(*card_id)
            .await
            .map_err(|e| ApiError::Internal(format!("account deletion, media storage: {e}")))?;
    }
    tx.commit().await?;
    tracing::info!(%user_id, cards = card_ids.len(), "account deleted");
    Ok(StatusCode::NO_CONTENT)
}
