//! A person's role, ban, password, and sessions, and removing the account.

use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::json;
use suitedb::Value;
use suitedrive::DriveError;

use crate::{drive_api::ApiError, http::AppState};

use super::{bad, principal, require_admin, text, would_remove_last_admin};

use super::groups::ids_of;
use super::people::get_user;

#[derive(Deserialize)]
pub(super) struct RoleBody {
    role: String,
}

pub(super) async fn set_role(
    State(s): State<AppState>,
    crate::auth::RequireUser(actor): crate::auth::RequireUser,
    Path(id): Path<String>,
    Json(body): Json<RoleBody>,
) -> Result<Response, ApiError> {
    if let Some(response) = require_admin(&actor) {
        return Ok(response);
    }
    let role = body.role.trim();
    if role != "admin" && role != "user" {
        return Ok(bad("Role is admin or user."));
    }
    let db = s.db.clone();
    let drive = s.drive.clone();
    let actor_id = actor.id.clone();
    let role = role.to_owned();
    let user_id = id.clone();
    tokio::task::spawn_blocking(move || {
        if db.get("user", &user_id)?.is_none() {
            return Err(DriveError::NotFound);
        }
        if role != "admin" && would_remove_last_admin(&db, &user_id)? {
            return Err(DriveError::BadRequest(
                "The server needs at least one admin.".into(),
            ));
        }
        db.transact(|tx| tx.upsert("user", &user_id, [("role", Value::Text(role.clone()))]))?;
        drive.record_audit(&actor_id, "user.role", "user", &user_id, &role)?;
        Ok(())
    })
    .await
    .map_err(|e| ApiError(DriveError::Other(e.into())))?
    .map_err(ApiError)?;
    get_user(State(s), crate::auth::RequireUser(actor), Path(id)).await
}

#[derive(Deserialize)]
pub(super) struct BanBody {
    banned: bool,
}

pub(super) async fn set_banned(
    State(s): State<AppState>,
    crate::auth::RequireUser(actor): crate::auth::RequireUser,
    Path(id): Path<String>,
    Json(body): Json<BanBody>,
) -> Result<Response, ApiError> {
    if let Some(response) = require_admin(&actor) {
        return Ok(response);
    }
    let db = s.db.clone();
    let drive = s.drive.clone();
    let actor_id = actor.id.clone();
    let user_id = id.clone();
    tokio::task::spawn_blocking(move || {
        if db.get("user", &user_id)?.is_none() {
            return Err(DriveError::NotFound);
        }
        if body.banned && would_remove_last_admin(&db, &user_id)? {
            return Err(DriveError::BadRequest(
                "The server needs at least one admin.".into(),
            ));
        }
        let session_ids: Vec<String> = if body.banned {
            db.query(
                "SELECT id FROM session WHERE userId = ?1",
                &[Value::Text(user_id.clone())],
            )?
            .into_iter()
            .filter_map(|row| text(&row, "id"))
            .collect()
        } else {
            Vec::new()
        };
        db.transact(|tx| {
            tx.upsert(
                "user",
                &user_id,
                [("banned", Value::Integer(i64::from(body.banned)))],
            )?;
            for session_id in &session_ids {
                tx.delete("session", session_id)?;
            }
            Ok(())
        })?;
        let action = if body.banned {
            "user.disable"
        } else {
            "user.enable"
        };
        drive.record_audit(&actor_id, action, "user", &user_id, "")?;
        Ok(())
    })
    .await
    .map_err(|e| ApiError(DriveError::Other(e.into())))?
    .map_err(ApiError)?;
    get_user(State(s), crate::auth::RequireUser(actor), Path(id)).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PasswordBody {
    password: String,
}

fn password_change_error(message: &str) -> &'static str {
    match message {
        "That person was not found." => "That person was not found.",
        _ => "Could not set that password.",
    }
}

pub(super) async fn set_password(
    State(s): State<AppState>,
    crate::auth::RequireUser(actor): crate::auth::RequireUser,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<PasswordBody>,
) -> Result<Response, ApiError> {
    if let Some(response) = require_admin(&actor) {
        return Ok(response);
    }
    if body.password.chars().count() < 8 {
        return Ok(bad("Use a password of at least 8 characters."));
    }
    let Some(authorization) = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
    else {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    };
    let (status, response) = s
        .auth
        .sidecar_post(
            "/api/auth/admin/set-user-password",
            authorization,
            &json!({ "userId": id, "newPassword": body.password }),
        )
        .await
        .map_err(|e| ApiError(DriveError::Other(e)))?;
    if !(200..300).contains(&status) {
        let message = response
            .get("message")
            .and_then(|v| v.as_str())
            .map(password_change_error)
            .unwrap_or("Could not set that password.");
        return Ok((
            StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY),
            Json(json!({ "error": message })),
        )
            .into_response());
    }
    revoke_sessions(&s, &actor.id, &id).await?;
    Ok(Json(json!({ "ok": true })).into_response())
}

pub(super) async fn revoke(
    State(s): State<AppState>,
    crate::auth::RequireUser(actor): crate::auth::RequireUser,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    if let Some(response) = require_admin(&actor) {
        return Ok(response);
    }
    revoke_sessions(&s, &actor.id, &id).await?;
    Ok(Json(json!({ "ok": true })).into_response())
}

async fn revoke_sessions(s: &AppState, actor: &str, user_id: &str) -> Result<(), ApiError> {
    let db = s.db.clone();
    let drive = s.drive.clone();
    let actor = actor.to_owned();
    let user_id = user_id.to_owned();
    tokio::task::spawn_blocking(move || {
        let session_ids: Vec<String> = db
            .query(
                "SELECT id FROM session WHERE userId = ?1",
                &[Value::Text(user_id.clone())],
            )?
            .into_iter()
            .filter_map(|row| text(&row, "id"))
            .collect();
        db.transact(|tx| {
            for session_id in &session_ids {
                tx.delete("session", session_id)?;
            }
            Ok(())
        })?;
        drive.record_audit(&actor, "user.sessions", "user", &user_id, "")?;
        Ok(())
    })
    .await
    .map_err(|e| ApiError(DriveError::Other(e.into())))?
    .map_err(ApiError)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RemoveBody {
    owner_id: Option<String>,
}

pub(super) async fn remove_user(
    State(s): State<AppState>,
    crate::auth::RequireUser(actor): crate::auth::RequireUser,
    Path(id): Path<String>,
    Json(body): Json<RemoveBody>,
) -> Result<Response, ApiError> {
    if let Some(response) = require_admin(&actor) {
        return Ok(response);
    }
    let db = s.db.clone();
    let drive = s.drive.clone();
    let who = principal(&actor);
    tokio::task::spawn_blocking(move || {
        if db.get("user", &id)?.is_none() {
            return Err(DriveError::NotFound);
        }
        if would_remove_last_admin(&db, &id)? {
            return Err(DriveError::BadRequest(
                "The server needs at least one admin.".into(),
            ));
        }
        let owned = drive.owned_item_ids(&id)?;
        if !owned.is_empty() {
            let Some(owner) = body
                .owner_id
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            else {
                return Err(DriveError::BadRequest(
                    "Choose who should own their files.".into(),
                ));
            };
            if owner == id {
                return Err(DriveError::BadRequest(
                    "Choose someone else to own their files.".into(),
                ));
            }
            if db.get("user", owner)?.is_none() {
                return Err(DriveError::BadRequest(
                    "That person does not have an account.".into(),
                ));
            }
            drive.transfer_owned(&who, &id, owner)?;
        }
        let sessions = ids_of(&db, "SELECT id FROM session WHERE userId = ?1", &id)?;
        let accounts = ids_of(&db, "SELECT id FROM account WHERE userId = ?1", &id)?;
        let memberships = ids_of(&db, "SELECT id FROM member WHERE userId = ?1", &id)?;
        let edges = ids_of(
            &db,
            "SELECT id FROM directory_edge WHERE memberType = 'user' AND memberId = ?1",
            &id,
        )?;
        db.transact(|tx| {
            for session_id in &sessions {
                tx.delete("session", session_id)?;
            }
            for account_id in &accounts {
                tx.delete("account", account_id)?;
            }
            for member_id in &memberships {
                tx.delete("member", member_id)?;
            }
            for edge_id in &edges {
                tx.delete("directory_edge", edge_id)?;
            }
            tx.delete("user", &id)
        })?;
        drive.record_audit(&who.id, "user.remove", "user", &id, "")?;
        Ok(())
    })
    .await
    .map_err(|e| ApiError(DriveError::Other(e.into())))?
    .map_err(ApiError)?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_password_change_error_does_not_repeat_the_password() {
        let message = password_change_error("password secret-value was rejected");
        assert_eq!(message, "Could not set that password.");
        assert!(!message.contains("secret-value"));
        assert_eq!(
            password_change_error("That person was not found."),
            "That person was not found."
        );
    }
}
