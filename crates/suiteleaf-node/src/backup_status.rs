//! Backup freshness for an operator-chosen directory.
//! The directory comes from `SUITELEAF_BACKUP_DIR`, not from the request.
//! Content hashes and the database file are not returned.

use std::path::PathBuf;

use axum::{
    Json,
    extract::State,
    response::{IntoResponse, Response},
};
use serde_json::json;

use crate::{admin_api::require_admin, auth::RequireUser, http::AppState};

pub async fn backup_status(
    State(_state): State<AppState>,
    RequireUser(user): RequireUser,
) -> Response {
    if let Some(response) = require_admin(&user) {
        return response;
    }
    let Some(dir) = std::env::var_os("SUITELEAF_BACKUP_DIR") else {
        return Json(json!({ "configured": false })).into_response();
    };
    let path = PathBuf::from(dir);
    let report =
        tokio::task::spawn_blocking(move || suitedrive::backup::backup_freshness(&path)).await;
    let Ok(Ok(report)) = report else {
        return Json(json!({ "configured": true, "readable": false })).into_response();
    };
    let mut body = json!({
        "configured": true,
        "readable": true,
        "recordedAt": report.recorded_at,
        "contentCount": report.content_count,
        "drilledAt": report.drilled_at,
        "elapsedMs": report.elapsed_ms,
        "restoreTested": report.restore_tested,
    });
    if let Ok(hours) = std::env::var("SUITELEAF_BACKUP_EVERY_HOURS") {
        let now = suitedb::hlc::iso_now();
        match suitedrive::backup::schedule_note(&report.recorded_at, &hours, &now) {
            Ok(due) => {
                body["due"] = json!(due.due);
                body["schedule"] = json!(due.reason);
            }
            Err(error) => {
                body["due"] = json!(false);
                body["schedule"] = json!(error.to_string());
            }
        }
    }
    Json(body).into_response()
}

const SCHEDULE_REASONS: &[&str] = &[
    "No backup has been recorded.",
    "The last backup time is not a time.",
    "That backup is newer than the current time.",
    "A backup is due.",
    "The last backup is still inside the schedule.",
    "The backup schedule must be from 1 to 168 hours.",
    "The current time is not a time.",
    "The backup key must be 32 bytes.",
];

fn public_schedule(text: &str) -> String {
    if SCHEDULE_REASONS.contains(&text) {
        text.to_owned()
    } else {
        "The backup could not be written.".to_owned()
    }
}

/// Seal a due backup. The directory, key, and copy path come from the environment, not the request.
pub async fn backup_run(State(state): State<AppState>, RequireUser(user): RequireUser) -> Response {
    if let Some(response) = require_admin(&user) {
        return response;
    }
    let hours = std::env::var("SUITELEAF_BACKUP_EVERY_HOURS").unwrap_or_default();
    let key_path = std::env::var("SUITELEAF_BACKUP_KEY_FILE").unwrap_or_default();
    let sealed = std::env::var("SUITELEAF_BACKUP_SEALED").unwrap_or_default();
    let copy = std::env::var("SUITELEAF_BACKUP_COPY").unwrap_or_default();
    let Some(freshness) = std::env::var_os("SUITELEAF_BACKUP_DIR") else {
        return Json(json!({
            "wrote": false,
            "schedule": "The backup destination is not configured."
        }))
        .into_response();
    };
    if hours.is_empty() || key_path.is_empty() || sealed.is_empty() || copy.is_empty() {
        return Json(json!({
            "wrote": false,
            "schedule": "The backup destination is not configured."
        }))
        .into_response();
    }
    let key = match std::fs::read(&key_path) {
        Ok(bytes) if bytes.len() == 32 => bytes,
        _ => {
            return Json(json!({
                "wrote": false,
                "schedule": "The backup key must be 32 bytes."
            }))
            .into_response();
        }
    };
    let drive = state.drive.clone();
    let db = state.db.clone();
    let state_dir = state.config.data_dir.clone();
    let now = suitedb::hlc::iso_now();
    let freshness = std::path::PathBuf::from(freshness);
    let sealed_path = std::path::PathBuf::from(sealed);
    let copy_path = std::path::PathBuf::from(copy);
    let result =
        tokio::task::spawn_blocking(move || -> Result<suitedrive::seal::ScheduledSeal, String> {
            let contents = drive
                .archived_contents()
                .map_err(|error| error.to_string())?;
            let sealed = suitedrive::seal::scheduled_seal(
                drive.blobs(),
                &contents,
                &freshness,
                &hours,
                &now,
                &key,
                &sealed_path,
                &copy_path,
                Some(&db),
            )
            .map_err(|error| error.to_string())?;
            if let Ok(identity_dest) = std::env::var("SUITELEAF_IDENTITY_SEALED")
                && sealed.wrote
                && !identity_dest.is_empty()
            {
                crate::keys::seal_running_identity(
                    &state_dir,
                    &key,
                    std::path::Path::new(&identity_dest),
                )
                .map_err(|_| "The backup could not be written.".to_owned())?;
            }
            Ok(sealed)
        })
        .await;
    let (wrote, schedule) = match result {
        Ok(Ok(seal)) => (seal.wrote, public_schedule(&seal.reason)),
        Ok(Err(text)) => (false, public_schedule(&text)),
        Err(_) => (false, "The backup could not be written.".to_owned()),
    };
    Json(json!({ "wrote": wrote, "schedule": schedule })).into_response()
}
