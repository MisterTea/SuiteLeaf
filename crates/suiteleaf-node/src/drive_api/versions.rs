//! A file's version history: naming, restoring, and copying a version.

use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{Value as JsonValue, json};
use suitedrive::DriveError;

use crate::{auth::RequireUser, http::AppState};

use super::content::etag;
use super::names::{author_names, item_body, version_json};
use super::{ApiError, ApiResult, blocking, principal};

pub(super) async fn versions(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let who = principal(&user);
    let list = blocking(&s.drive, move |d| d.versions(&who, &id)).await?;
    let db = s.db.clone();
    let owned = list.clone();
    let names = tokio::task::spawn_blocking(move || author_names(&db, &owned))
        .await
        .map_err(|e| ApiError(DriveError::Other(e.into())))?;
    let views: Vec<JsonValue> = list.iter().map(|v| version_json(v, &names)).collect();
    Ok(Json(json!({ "versions": views })).into_response())
}

#[derive(Deserialize)]
pub(super) struct NameBody {
    name: Option<String>,
}

pub(super) async fn name_version(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path((id, version_id)): Path<(String, String)>,
    Json(body): Json<NameBody>,
) -> ApiResult<Response> {
    let who = principal(&user);
    let version = blocking(&s.drive, move |d| {
        d.name_version(&who, &id, &version_id, body.name.as_deref())
    })
    .await?;
    let db = s.db.clone();
    let owned = version.clone();
    let named =
        tokio::task::spawn_blocking(move || author_names(&db, std::slice::from_ref(&owned)))
            .await
            .map_err(|e| ApiError(DriveError::Other(e.into())))?;
    Ok(Json(version_json(&version, &named)).into_response())
}

pub(super) async fn restore_version(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path((id, version_id)): Path<(String, String)>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let who = principal(&user);
    let if_match = headers
        .get(header::IF_MATCH)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let item = blocking(&s.drive, move |d| {
        d.restore(&who, &id, &version_id, if_match.as_deref())
    })
    .await?;
    let mut response = Json(item_body(&s, &item).await?).into_response();
    if let Some(tag) = etag(item.head_version_id.as_deref()) {
        response.headers_mut().insert(header::ETAG, tag);
    }
    Ok(response)
}

#[derive(Deserialize)]
pub(super) struct CopyBody {
    name: String,
}

pub(super) async fn copy_version(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path((id, version_id)): Path<(String, String)>,
    Json(body): Json<CopyBody>,
) -> ApiResult<Response> {
    let who = principal(&user);
    let item = blocking(&s.drive, move |d| {
        d.copy_version(&who, &id, &version_id, &body.name)
    })
    .await?;
    Ok((StatusCode::CREATED, Json(item_body(&s, &item).await?)).into_response())
}
