//! Nested groups, their members, and a preview of what a membership change does.

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::json;
use suitedb::{Db, Value};
use suitedrive::{DriveError, share_migration::AccessChange};

use crate::{drive_api::ApiError, http::AppState};

use super::{blocking, require_admin, text};

pub(super) fn ids_of(db: &Db, sql: &str, id: &str) -> Result<Vec<String>, DriveError> {
    Ok(db
        .query(sql, &[Value::Text(id.into())])?
        .into_iter()
        .filter_map(|row| text(&row, "id"))
        .collect())
}

#[derive(Deserialize)]
pub(super) struct GroupBody {
    name: String,
}

pub(super) async fn list_groups(
    State(s): State<AppState>,
    crate::auth::RequireUser(actor): crate::auth::RequireUser,
) -> Result<Response, ApiError> {
    if let Some(response) = require_admin(&actor) {
        return Ok(response);
    }
    let groups = blocking(&s.drive, |d| d.list_groups()).await?;
    Ok(Json(json!({ "groups": groups })).into_response())
}

pub(super) async fn create_group(
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

pub(super) async fn get_group(
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

pub(super) async fn rename_group(
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

pub(super) async fn delete_group(
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
pub(super) struct MemberBody {
    member_type: String,
    member_id: String,
}

pub(super) async fn add_member(
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

pub(super) async fn remove_member(
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MemberPlanBody {
    member_id: String,
    adding: bool,
}

pub(super) async fn preview_member(
    State(s): State<AppState>,
    crate::auth::RequireUser(actor): crate::auth::RequireUser,
    Path(id): Path<String>,
    Json(body): Json<MemberPlanBody>,
) -> Result<Response, ApiError> {
    if let Some(response) = require_admin(&actor) {
        return Ok(response);
    }
    let group_id = id.clone();
    let plan = blocking(&s.drive, move |d| {
        d.plan_member(&group_id, &body.member_id, body.adding)
    })
    .await?;
    Ok(Json(plan).into_response())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CommitMemberBody {
    member_id: String,
    adding: bool,
    changes: Vec<AccessChange>,
}

pub(super) async fn commit_member_route(
    State(s): State<AppState>,
    crate::auth::RequireUser(actor): crate::auth::RequireUser,
    Path(id): Path<String>,
    Json(body): Json<CommitMemberBody>,
) -> Result<Response, ApiError> {
    if let Some(response) = require_admin(&actor) {
        return Ok(response);
    }
    let actor_id = actor.id.clone();
    let group_id = id.clone();
    let plan = blocking(&s.drive, move |d| {
        d.commit_member(
            &actor_id,
            &group_id,
            &body.member_id,
            body.adding,
            &body.changes,
        )
    })
    .await?;
    Ok(Json(plan).into_response())
}
