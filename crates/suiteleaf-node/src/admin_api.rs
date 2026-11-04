//! Admin routes for people, nested groups, and a person's document trail.
//!
//! Creating a password and changing one go through better-auth, which hashes
//! them. Everything else is a SuiteDB write on this node, so the last-admin
//! rule and the audit row happen in the same place.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use serde_json::{Value as JsonValue, json};
use suitedb::{Db, Value};
use suitedrive::{Drive, DriveError, Principal};

use crate::{auth::AuthUser, drive_api::ApiError, http::AppState};

mod groups;
mod people;
mod people_access;

use groups::{
    add_member, commit_member_route, create_group, delete_group, get_group, list_groups,
    preview_member, remove_member, rename_group,
};
use people::{create_user, get_user, list_users, update_user};
use people_access::{remove_user, revoke, set_banned, set_password, set_role};

fn principal(user: &AuthUser) -> Principal {
    Principal {
        id: user.id.clone(),
        admin: user.is_admin(),
    }
}

fn forbid() -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(json!({ "error": "You need to be an admin to open this." })),
    )
        .into_response()
}

fn bad(message: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": message }))).into_response()
}

fn text(row: &std::collections::BTreeMap<String, Value>, key: &str) -> Option<String> {
    match row.get(key) {
        Some(Value::Text(s)) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

pub fn is_admin_role(role: Option<&str>) -> bool {
    role.is_some_and(|r| r.split(',').any(|part| part.trim() == "admin"))
}

fn banned(row: &std::collections::BTreeMap<String, Value>) -> bool {
    matches!(row.get("banned"), Some(Value::Integer(n)) if *n != 0)
}

fn users(db: &Db) -> Result<Vec<std::collections::BTreeMap<String, Value>>, DriveError> {
    Ok(db.query(
        "SELECT * FROM user WHERE id NOT IN (SELECT loser FROM _conflicts WHERE tbl = 'user') ORDER BY createdAt ASC, id ASC",
        &[],
    )?)
}

/// If nobody has the admin role, the oldest account becomes the admin.
pub fn ensure_an_admin(db: &Db) -> anyhow::Result<()> {
    // Adapter tests grow the auth schema one plugin at a time. Until `role`
    // exists, there is nothing to promote.
    if db
        .schema()
        .table("user")
        .and_then(|table| table.column_type("role"))
        .is_none()
    {
        return Ok(());
    }
    let rows = users(db)?;
    if rows.is_empty()
        || rows
            .iter()
            .any(|row| is_admin_role(text(row, "role").as_deref()))
    {
        return Ok(());
    }
    let Some(id) = rows.first().and_then(|row| text(row, "id")) else {
        return Ok(());
    };
    db.transact(|tx| tx.upsert("user", &id, [("role", Value::Text("admin".into()))]))?;
    Ok(())
}

fn active_admin_ids(db: &Db) -> Result<Vec<String>, DriveError> {
    Ok(users(db)?
        .into_iter()
        .filter(|row| is_admin_role(text(row, "role").as_deref()) && !banned(row))
        .filter_map(|row| text(&row, "id"))
        .collect())
}

fn would_remove_last_admin(db: &Db, user_id: &str) -> Result<bool, DriveError> {
    let admins = active_admin_ids(db)?;
    Ok(admins.len() == 1 && admins.first().is_some_and(|id| id == user_id))
}

fn user_json(row: &std::collections::BTreeMap<String, Value>) -> JsonValue {
    json!({
        "id": text(row, "id"),
        "name": text(row, "name"),
        "email": text(row, "email"),
        "username": text(row, "username"),
        "role": text(row, "role"),
        "banned": banned(row),
        "createdAt": text(row, "createdAt"),
    })
}

async fn blocking<T: Send + 'static>(
    drive: &Arc<Drive>,
    work: impl FnOnce(&Drive) -> Result<T, DriveError> + Send + 'static,
) -> Result<T, ApiError> {
    let drive = drive.clone();
    tokio::task::spawn_blocking(move || work(&drive))
        .await
        .map_err(|e| ApiError(DriveError::Other(e.into())))?
        .map_err(ApiError)
}

async fn editor_policy_plan(
    State(s): State<AppState>,
    crate::auth::RequireUser(user): crate::auth::RequireUser,
) -> Result<Response, ApiError> {
    if let Some(response) = require_admin(&user) {
        return Ok(response);
    }
    let who = principal(&user);
    let plan = blocking(&s.drive, move |drive| drive.plan_org_editor_policy(&who)).await?;
    Ok(Json(plan).into_response())
}

async fn editor_policy_apply(
    State(s): State<AppState>,
    crate::auth::RequireUser(user): crate::auth::RequireUser,
    Json(body): Json<JsonValue>,
) -> Result<Response, ApiError> {
    if let Some(response) = require_admin(&user) {
        return Ok(response);
    }
    let stamp = body.get("stamp").and_then(JsonValue::as_str).unwrap_or("");
    if stamp.is_empty() {
        return Ok(bad("Review the access plan again."));
    }
    let who = principal(&user);
    let stamp = stamp.to_owned();
    let plan = blocking(&s.drive, move |drive| {
        drive.apply_org_editor_policy(&who, &stamp)
    })
    .await?;
    Ok(Json(plan).into_response())
}

pub(crate) fn require_admin(user: &AuthUser) -> Option<Response> {
    if user.is_admin() {
        None
    } else {
        Some(forbid())
    }
}

async fn replication(
    State(s): State<AppState>,
    crate::auth::RequireUser(user): crate::auth::RequireUser,
) -> Result<Response, ApiError> {
    if let Some(response) = require_admin(&user) {
        return Ok(response);
    }
    let db = s.db.clone();
    let peers = tokio::task::spawn_blocking(move || db.replication_lag())
        .await
        .map_err(|error| ApiError(DriveError::Other(error.into())))?
        .map_err(|error| ApiError(DriveError::Other(error.into())))?;
    let pending =
        s.db.pending_count()
            .map_err(|error| ApiError(DriveError::Other(error.into())))?;
    Ok(Json(json!({
        "pending": pending,
        "peers": peers
            .iter()
            .map(|row| json!({
                "peer": row.peer,
                "sameEpoch": row.same_epoch,
                "behind": row.behind,
            }))
            .collect::<Vec<_>>(),
    }))
    .into_response())
}

async fn organization_export_route(
    State(s): State<AppState>,
    crate::auth::RequireUser(user): crate::auth::RequireUser,
) -> Result<Response, ApiError> {
    if let Some(response) = require_admin(&user) {
        return Ok(response);
    }
    let db = s.db.clone();
    let payload = tokio::task::spawn_blocking(move || crate::org_export::organization_export(&db))
        .await
        .map_err(|error| ApiError(DriveError::Other(error.into())))?
        .map_err(ApiError)?;
    Ok(Json(payload).into_response())
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/admin/replication", get(replication))
        .route(
            "/api/admin/backup",
            get(crate::backup_status::backup_status).post(crate::backup_status::backup_run),
        )
        .route("/api/admin/export", get(organization_export_route))
        .route("/api/admin/users", get(list_users).post(create_user))
        .route(
            "/api/admin/users/{id}",
            get(get_user).patch(update_user).delete(remove_user),
        )
        .route("/api/admin/users/{id}/role", axum::routing::post(set_role))
        .route(
            "/api/admin/users/{id}/banned",
            axum::routing::post(set_banned),
        )
        .route(
            "/api/admin/users/{id}/password",
            axum::routing::post(set_password),
        )
        .route(
            "/api/admin/users/{id}/sessions",
            axum::routing::delete(revoke),
        )
        .route("/api/admin/groups", get(list_groups).post(create_group))
        .route(
            "/api/admin/groups/{id}",
            get(get_group).patch(rename_group).delete(delete_group),
        )
        .route(
            "/api/admin/groups/{id}/members",
            axum::routing::post(add_member).delete(remove_member),
        )
        .route(
            "/api/admin/groups/{id}/member-plan",
            axum::routing::post(preview_member),
        )
        .route(
            "/api/admin/groups/{id}/member-commit",
            axum::routing::post(commit_member_route),
        )
        .route(
            "/api/admin/editor-policy",
            get(editor_policy_plan).post(editor_policy_apply),
        )
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use libp2p_identity::ed25519;
    use suitedb::Db;

    fn db() -> Db {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("db.sqlite");
        // Keep the directory alive by leaking it; the process is the test.
        std::mem::forget(dir);
        Db::open(
            &path,
            ed25519::Keypair::generate(),
            crate::schema::node_schema(None).unwrap(),
        )
        .unwrap()
    }

    fn add_user(db: &Db, id: &str, role: &str, created: &str, banned_flag: i64) {
        db.transact(|tx| {
            tx.upsert(
                "user",
                id,
                [
                    ("name", Value::Text(id.into())),
                    ("email", Value::Text(format!("{id}@club.test"))),
                    ("role", Value::Text(role.into())),
                    ("createdAt", Value::Text(created.into())),
                    ("banned", Value::Integer(banned_flag)),
                ],
            )
        })
        .unwrap();
    }

    #[test]
    fn the_oldest_account_becomes_admin_when_nobody_is() {
        let db = db();
        ensure_an_admin(&db).unwrap();
        add_user(&db, "later", "user", "2026-02-01T00:00:00.000Z", 0);
        add_user(&db, "earlier", "user", "2026-01-01T00:00:00.000Z", 0);
        ensure_an_admin(&db).unwrap();
        let row = db.get("user", "earlier").unwrap().unwrap();
        assert_eq!(row.get("role"), Some(&Value::Text("admin".into())));
        let later = db.get("user", "later").unwrap().unwrap();
        assert_eq!(later.get("role"), Some(&Value::Text("user".into())));
    }

    #[test]
    fn an_existing_admin_is_left_alone() {
        let db = db();
        add_user(&db, "rosa", "admin", "2026-01-01T00:00:00.000Z", 0);
        add_user(&db, "sam", "user", "2026-01-02T00:00:00.000Z", 0);
        ensure_an_admin(&db).unwrap();
        let row = db.get("user", "rosa").unwrap().unwrap();
        assert_eq!(row.get("role"), Some(&Value::Text("admin".into())));
    }

    #[test]
    fn the_last_active_admin_cannot_be_removed() {
        let db = db();
        add_user(&db, "rosa", "admin", "2026-01-01T00:00:00.000Z", 0);
        add_user(&db, "sam", "admin", "2026-01-02T00:00:00.000Z", 1);
        assert!(would_remove_last_admin(&db, "rosa").unwrap());
        assert!(!would_remove_last_admin(&db, "sam").unwrap());
    }
}
