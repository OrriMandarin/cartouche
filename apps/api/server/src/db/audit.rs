//! The append-only `audit_log` table: one row per administrator action (ADM-005).

use sqlx::PgConnection;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq)]
pub struct AuditEntry {
    pub actor_user_id: Uuid,
    pub action: &'static str,
    pub target_type: &'static str,
    pub target_id: Uuid,
    pub metadata: serde_json::Value,
}

/// Appends an entry. Takes a connection so the caller can write it in the same
/// transaction as the change it records.
pub async fn record(tx: &mut PgConnection, entry: AuditEntry) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into audit_log (actor_user_id, action, target_type, target_id, metadata) \
         values ($1, $2, $3, $4, $5)",
    )
    .bind(entry.actor_user_id)
    .bind(entry.action)
    .bind(entry.target_type)
    .bind(entry.target_id)
    .bind(sqlx::types::Json(entry.metadata))
    .execute(tx)
    .await?;
    Ok(())
}
