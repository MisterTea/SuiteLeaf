//! Admin routes for people, nested groups, and a person's document trail.
//!
//! Creating a password and changing one go through better-auth, which hashes
//! them. Everything else is a SuiteDB write on this node, so the last-admin
//! rule and the audit row happen in the same place.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Deserialize;
use serde_json::{Value as JsonValue, json};
use suitedb::{Db, Value};
use suitedrive::{Drive, DriveError, Principal};

use crate::{auth::AuthUser, drive_api::ApiError, http::AppState};

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

fn require_admin(user: &AuthUser) -> Option<Response> {
    if user.is_admin() {
        None
    } else {
        Some(forbid())
    }
}

#[derive(Deserialize)]
struct ListQuery {
    q: Option<String>,
    group: Option<String>,
}

async fn list_users(
    State(s): State<AppState>,
    crate::auth::RequireUser(user): crate::auth::RequireUser,
    Query(q): Query<ListQuery>,
) -> Result<Response, ApiError> {
    if let Some(response) = require_admin(&user) {
        return Ok(response);
    }
    let db = s.db.clone();
    let drive = s.drive.clone();
    let payload = tokio::task::spawn_blocking(move || {
        let mut rows = users(&db)?;
        if let Some(query) = q.q.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            let needle = query.to_lowercase();
            rows.retain(|row| {
                [text(row, "name"), text(row, "email"), text(row, "username")]
                    .into_iter()
                    .flatten()
                    .any(|value| value.to_lowercase().contains(&needle))
            });
        }
        if let Some(group) = q.group.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            let people = drive.group_detail(group)?.people;
            rows.retain(|row| text(row, "id").is_some_and(|id| people.contains(&id)));
        }
        let mut listed = Vec::new();
        for row in &rows {
            let id = text(row, "id").unwrap_or_default();
            let groups = drive.group_ids(&id)?;
            let mut names = Vec::new();
            for value in &groups {
                if let Value::Text(group_id) = value
                    && let Some(name) = drive.group_name(group_id)?
                {
                    names.push(name);
                }
            }
            names.sort();
            let mut person = user_json(row);
            person["groups"] = json!(names);
            listed.push(person);
        }
        Ok::<_, DriveError>(listed)
    })
    .await
    .map_err(|e| ApiError(DriveError::Other(e.into())))?
    .map_err(ApiError)?;
    Ok(Json(json!({ "users": payload })).into_response())
}

async fn get_user(
    State(s): State<AppState>,
    crate::auth::RequireUser(actor): crate::auth::RequireUser,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    if let Some(response) = require_admin(&actor) {
        return Ok(response);
    }
    let db = s.db.clone();
    let drive = s.drive.clone();
    let payload = tokio::task::spawn_blocking(move || person(&db, &drive, &id))
        .await
        .map_err(|e| ApiError(DriveError::Other(e.into())))?
        .map_err(ApiError)?;
    Ok(Json(payload).into_response())
}

fn person(db: &Db, drive: &Drive, id: &str) -> Result<JsonValue, DriveError> {
    let row = db.get("user", id)?.ok_or(DriveError::NotFound)?;
    let group_values = drive.group_ids(id)?;
    let mut groups = Vec::new();
    for value in &group_values {
        if let Value::Text(group_id) = value {
            groups.push(json!({
                "id": group_id,
                "name": drive.group_name(group_id)?,
            }));
        }
    }
    let direct: Vec<String> = db
        .query(
            "SELECT groupId FROM directory_edge WHERE memberType = 'user' AND memberId = ?1",
            &[Value::Text(id.into())],
        )?
        .into_iter()
        .filter_map(|row| text(&row, "groupId"))
        .collect();
    let (files, bytes) = drive.person_files(id)?;
    let sessions: Vec<_> = db
        .query(
            "SELECT id, createdAt, ipAddress, userAgent FROM session WHERE userId = ?1 ORDER BY createdAt DESC",
            &[Value::Text(id.into())],
        )?
        .into_iter()
        .map(|row| {
            json!({
                "id": text(&row, "id"),
                "at": text(&row, "createdAt"),
                "ipAddress": text(&row, "ipAddress"),
                "userAgent": text(&row, "userAgent"),
            })
        })
        .collect();
    Ok(json!({
        "user": user_json(&row),
        "groups": groups,
        "directGroupIds": direct,
        "files": files,
        "bytes": bytes,
        "documents": drive.document_trail(id)?,
        "signIns": drive.sign_in_events(id)?,
        "sessions": sessions,
        "changes": drive.audit_for("user", id)?,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateUser {
    name: String,
    email: String,
    password: String,
    username: Option<String>,
    #[serde(default)]
    admin: bool,
}

async fn create_user(
    State(s): State<AppState>,
    crate::auth::RequireUser(actor): crate::auth::RequireUser,
    headers: HeaderMap,
    Json(body): Json<CreateUser>,
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
    let mut data = serde_json::Map::new();
    if let Some(username) = body
        .username
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        data.insert("username".into(), json!(username));
    }
    let payload = json!({
        "name": body.name.trim(),
        "email": body.email.trim(),
        "password": body.password,
        "role": if body.admin { "admin" } else { "user" },
        "data": data,
    });
    let (status, response) = s
        .auth
        .sidecar_post("/api/auth/admin/create-user", authorization, &payload)
        .await
        .map_err(|e| ApiError(DriveError::Other(e)))?;
    if !(200..300).contains(&status) {
        let message = response
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Could not create that account.");
        return Ok((
            StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY),
            Json(json!({ "error": message })),
        )
            .into_response());
    }
    let created = response.get("user").cloned().unwrap_or(json!({}));
    let id = created
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_owned();
    let name = body.name.trim().to_owned();
    let drive = s.drive.clone();
    let actor_id = actor.id.clone();
    blocking(&drive, move |d| {
        d.record_audit(&actor_id, "user.create", "user", &id, &name)
    })
    .await?;
    Ok((StatusCode::CREATED, Json(json!({ "user": created }))).into_response())
}

#[derive(Deserialize)]
struct ProfileBody {
    name: Option<String>,
    email: Option<String>,
    username: Option<String>,
}

async fn update_user(
    State(s): State<AppState>,
    crate::auth::RequireUser(actor): crate::auth::RequireUser,
    Path(id): Path<String>,
    Json(body): Json<ProfileBody>,
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
        let mut fields: Vec<(&str, Value)> = Vec::new();
        if let Some(name) = body.name {
            let name = name.trim().to_owned();
            if name.is_empty() {
                return Err(DriveError::BadRequest("A person needs a name.".into()));
            }
            fields.push(("name", Value::Text(name)));
        }
        if let Some(email) = body.email {
            let email = email.trim().to_lowercase();
            if !email.contains('@') {
                return Err(DriveError::BadRequest("Enter an email address.".into()));
            }
            let clash = db.query(
                "SELECT id FROM user WHERE LOWER(email) = ?1 AND id != ?2 AND id NOT IN (SELECT loser FROM _conflicts WHERE tbl = 'user') LIMIT 1",
                &[Value::Text(email.clone()), Value::Text(user_id.clone())],
            )?;
            if !clash.is_empty() {
                return Err(DriveError::BadRequest(
                    "Another account already uses that email.".into(),
                ));
            }
            fields.push(("email", Value::Text(email)));
        }
        if let Some(username) = body.username {
            fields.push(("username", Value::Text(username.trim().to_owned())));
        }
        if fields.is_empty() {
            return Err(DriveError::BadRequest("Nothing to change.".into()));
        }
        db.transact(|tx| tx.upsert("user", &user_id, fields))?;
        drive.record_audit(&actor_id, "user.update", "user", &user_id, "")?;
        Ok(())
    })
    .await
    .map_err(|e| ApiError(DriveError::Other(e.into())))?
    .map_err(ApiError)?;
    get_user(State(s), crate::auth::RequireUser(actor), Path(id)).await
}

#[derive(Deserialize)]
struct RoleBody {
    role: String,
}

async fn set_role(
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
struct BanBody {
    banned: bool,
}

async fn set_banned(
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
struct PasswordBody {
    password: String,
}

async fn set_password(
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

async fn revoke(
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
struct RemoveBody {
    owner_id: Option<String>,
}

async fn remove_user(
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

fn ids_of(db: &Db, sql: &str, id: &str) -> Result<Vec<String>, DriveError> {
    Ok(db
        .query(sql, &[Value::Text(id.into())])?
        .into_iter()
        .filter_map(|row| text(&row, "id"))
        .collect())
}

#[derive(Deserialize)]
struct GroupBody {
    name: String,
}

async fn list_groups(
    State(s): State<AppState>,
    crate::auth::RequireUser(actor): crate::auth::RequireUser,
) -> Result<Response, ApiError> {
    if let Some(response) = require_admin(&actor) {
        return Ok(response);
    }
    let groups = blocking(&s.drive, |d| d.list_groups()).await?;
    Ok(Json(json!({ "groups": groups })).into_response())
}

async fn create_group(
    State(s): State<AppState>,
    crate::auth::RequireUser(actor): crate::auth::RequireUser,
    Json(body): Json<GroupBody>,
) -> Result<Response, ApiError> {
    if let Some(response) = require_admin(&actor) {
        return Ok(response);
    }
    let actor_id = actor.id.clone();
    let group = blocking(&s.drive, move |d| d.create_group(&actor_id, &body.name)).await?;
    Ok((StatusCode::CREATED, Json(group)).into_response())
}

async fn get_group(
    State(s): State<AppState>,
    crate::auth::RequireUser(actor): crate::auth::RequireUser,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    if let Some(response) = require_admin(&actor) {
        return Ok(response);
    }
    let detail = blocking(&s.drive, move |d| d.group_detail(&id)).await?;
    Ok(Json(detail).into_response())
}

async fn rename_group(
    State(s): State<AppState>,
    crate::auth::RequireUser(actor): crate::auth::RequireUser,
    Path(id): Path<String>,
    Json(body): Json<GroupBody>,
) -> Result<Response, ApiError> {
    if let Some(response) = require_admin(&actor) {
        return Ok(response);
    }
    let actor_id = actor.id.clone();
    let group = blocking(&s.drive, move |d| {
        d.rename_group(&actor_id, &id, &body.name)
    })
    .await?;
    Ok(Json(group).into_response())
}

async fn delete_group(
    State(s): State<AppState>,
    crate::auth::RequireUser(actor): crate::auth::RequireUser,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    if let Some(response) = require_admin(&actor) {
        return Ok(response);
    }
    let actor_id = actor.id.clone();
    blocking(&s.drive, move |d| d.delete_group(&actor_id, &id)).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemberBody {
    member_type: String,
    member_id: String,
}

async fn add_member(
    State(s): State<AppState>,
    crate::auth::RequireUser(actor): crate::auth::RequireUser,
    Path(id): Path<String>,
    Json(body): Json<MemberBody>,
) -> Result<Response, ApiError> {
    if let Some(response) = require_admin(&actor) {
        return Ok(response);
    }
    let actor_id = actor.id.clone();
    let group_id = id.clone();
    blocking(&s.drive, move |d| {
        d.add_member(&actor_id, &group_id, &body.member_type, &body.member_id)
    })
    .await?;
    get_group(State(s), crate::auth::RequireUser(actor), Path(id)).await
}

async fn remove_member(
    State(s): State<AppState>,
    crate::auth::RequireUser(actor): crate::auth::RequireUser,
    Path(id): Path<String>,
    Json(body): Json<MemberBody>,
) -> Result<Response, ApiError> {
    if let Some(response) = require_admin(&actor) {
        return Ok(response);
    }
    let actor_id = actor.id.clone();
    let group_id = id.clone();
    blocking(&s.drive, move |d| {
        d.remove_member(&actor_id, &group_id, &body.member_type, &body.member_id)
    })
    .await?;
    get_group(State(s), crate::auth::RequireUser(actor), Path(id)).await
}

pub fn router(state: AppState) -> Router {
    Router::new()
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
