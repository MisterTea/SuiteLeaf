//! Comments on a file, and who else has it open.

use std::time::SystemTime;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::json;

use crate::{
    auth::{AuthUser, RequireUser},
    http::AppState,
};

use super::{ApiResult, blocking, principal};

#[derive(Deserialize)]
pub(super) struct CommentBody {
    body: String,
}

pub(super) async fn list_comments(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let who = principal(&user);
    Ok(Json(json!({
        "comments": blocking(&s.drive, move |d| d.comments(&who, &id)).await?
    }))
    .into_response())
}

pub(super) async fn add_comment(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
    Json(body): Json<CommentBody>,
) -> ApiResult<Response> {
    let who = principal(&user);
    let comment = blocking(&s.drive, move |d| d.add_comment(&who, &id, &body.body)).await?;
    Ok((StatusCode::CREATED, Json(comment)).into_response())
}

#[derive(Deserialize)]
pub(super) struct PresenceBody {
    editing: bool,
}

fn session_name(user: &AuthUser) -> String {
    user.name.clone().unwrap_or_default()
}

/// The caller has this file open. Viewers and commenters may report it.
/// `editing` does not change their role.
pub(super) async fn post_presence(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
    Json(body): Json<PresenceBody>,
) -> ApiResult<Response> {
    let who = principal(&user);
    let name = session_name(&user);
    let editing = body.editing;
    blocking(&s.drive, move |d| {
        d.report_presence(&who, &id, &name, editing, SystemTime::now())
    })
    .await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// Other people with a beat from the last 15 seconds. The caller is omitted.
pub(super) async fn get_presence(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let who = principal(&user);
    let people = blocking(&s.drive, move |d| d.presence(&who, &id, SystemTime::now())).await?;
    Ok(Json(json!({ "people": people })).into_response())
}
