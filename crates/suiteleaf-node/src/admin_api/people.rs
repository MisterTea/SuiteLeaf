//! Listing people, one person's details, creating an account, and editing a profile.

use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{Value as JsonValue, json};
use suitedb::{Db, Value};
use suitedrive::{Drive, DriveError};

use crate::{drive_api::ApiError, http::AppState};

use super::{bad, blocking, require_admin, text, user_json, users};

#[derive(Deserialize)]
pub(super) struct ListQuery {
    q: Option<String>,
    group: Option<String>,
}

pub(super) async fn list_users(
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

pub(super) async fn get_user(
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
pub(super) struct CreateUser {
    name: String,
    email: String,
    password: String,
    username: Option<String>,
    #[serde(default)]
    admin: bool,
}

pub(super) async fn create_user(
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
pub(super) struct ProfileBody {
    name: Option<String>,
    email: Option<String>,
    username: Option<String>,
}

pub(super) async fn update_user(
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
