//! Listing, creating, renaming, and deleting drive items.

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::json;
use suitedrive::DriveError;

use crate::{auth::RequireUser, http::AppState};

use super::names::{item_body, with_editor_names};
use super::{ApiError, ApiResult, blocking, principal};

#[derive(Deserialize)]
pub(super) struct ListQuery {
    parent: Option<String>,
    shared: Option<String>,
}

pub(super) async fn list(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Query(q): Query<ListQuery>,
) -> ApiResult<Response> {
    let who = principal(&user);
    let shared = q.shared.is_some();
    let items = blocking(&s.drive, move |d| {
        if shared {
            d.shared(&who)
        } else {
            d.list(&who, q.parent.as_deref().filter(|p| !p.is_empty()))
        }
    })
    .await?;
    let mut payload =
        serde_json::to_value(&items).map_err(|e| ApiError(DriveError::Other(e.into())))?;
    payload = with_editor_names(&s, payload).await?;
    if shared && let Some(rows) = payload.as_array_mut() {
        let ids: Vec<String> = rows
            .iter()
            .filter_map(|row| {
                row.get("ownerId")
                    .and_then(|v| v.as_str())
                    .map(str::to_owned)
            })
            .collect();
        let auth = s.auth.clone();
        let profiles = tokio::task::spawn_blocking(move || auth.accounts(&ids))
            .await
            .map_err(|e| ApiError(DriveError::Other(e.into())))?
            .map_err(|e| ApiError(DriveError::Other(e)))?;
        let by_id: std::collections::HashMap<_, _> =
            profiles.into_iter().map(|p| (p.id.clone(), p)).collect();
        for row in rows {
            let name = row
                .get("ownerId")
                .and_then(|v| v.as_str())
                .and_then(|id| by_id.get(id))
                .and_then(|p| p.name.clone());
            if let Some(object) = row.as_object_mut() {
                object.insert("ownerName".into(), serde_json::json!(name));
            }
        }
    }
    Ok(Json(json!({ "items": payload })).into_response())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CreateBody {
    name: String,
    parent_id: Option<String>,
    #[serde(default = "file_kind")]
    kind: String,
    mime: Option<String>,
}

fn file_kind() -> String {
    "file".into()
}

pub(super) async fn create(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Json(body): Json<CreateBody>,
) -> ApiResult<Response> {
    let who = principal(&user);
    let item = blocking(&s.drive, move |d| {
        d.create(
            &who,
            body.parent_id.as_deref(),
            &body.name,
            &body.kind,
            body.mime.as_deref(),
        )
    })
    .await?;
    Ok((StatusCode::CREATED, Json(item_body(&s, &item).await?)).into_response())
}

pub(super) async fn get_item(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let who = principal(&user);
    let item = blocking(&s.drive, move |d| d.get(&who, &id)).await?;
    Ok(Json(item_body(&s, &item).await?).into_response())
}

/// `parentId: null` moves an item to the top level; an absent key leaves it.
pub(super) async fn update(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Map<String, serde_json::Value>>,
) -> ApiResult<Response> {
    let who = principal(&user);
    let name = body.get("name").and_then(|v| v.as_str()).map(str::to_owned);
    let parent = body.get("parentId").map(|v| v.as_str().map(str::to_owned));
    let trashed = body.get("trashed").and_then(|v| v.as_bool());
    let item = blocking(&s.drive, move |d| {
        d.update(
            &who,
            &id,
            name.as_deref(),
            parent.as_ref().map(|p| p.as_deref()),
            trashed,
        )
    })
    .await?;
    Ok(Json(item_body(&s, &item).await?).into_response())
}

/// Every folder the caller can edit: id, name, and parentId.
pub(super) async fn list_folders(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
) -> ApiResult<Response> {
    let who = principal(&user);
    let items = blocking(&s.drive, move |d| d.list_folders(&who)).await?;
    let folders: Vec<_> = items
        .into_iter()
        .map(|item| {
            json!({
                "id": item.id,
                "name": item.name,
                "parentId": item.parent_id,
            })
        })
        .collect();
    Ok(Json(json!({ "folders": folders })).into_response())
}

#[derive(Deserialize)]
pub(super) struct SearchQuery {
    q: Option<String>,
}

/// Files whose name or text contains `q`. Hits are id, name, folder, and a
/// snippet. File bytes are not part of this response.
pub(super) async fn search_files(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Query(q): Query<SearchQuery>,
) -> ApiResult<Response> {
    let who = principal(&user);
    let query = q.q.unwrap_or_default();
    let hits = blocking(&s.drive, move |d| d.search(&who, &query)).await?;
    Ok(Json(json!({ "hits": hits })).into_response())
}

/// Spreadsheets the caller can read, including files inside folders. Each
/// row is id, name, and the parent folder name. File bytes are not included.
pub(super) async fn list_spreadsheets(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
) -> ApiResult<Response> {
    let who = principal(&user);
    let spreadsheets = blocking(&s.drive, move |d| d.list_spreadsheets(&who)).await?;
    Ok(Json(json!({ "spreadsheets": spreadsheets })).into_response())
}

pub(super) async fn list_trash(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
) -> ApiResult<Response> {
    let who = principal(&user);
    let items = blocking(&s.drive, move |d| d.list_trashed(&who)).await?;
    let payload =
        serde_json::to_value(&items).map_err(|e| ApiError(DriveError::Other(e.into())))?;
    let payload = with_editor_names(&s, payload).await?;
    Ok(Json(json!({ "items": payload })).into_response())
}

/// Permanent delete. The item must already be in Trash, and the caller must own it.
pub(super) async fn delete_forever(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let who = principal(&user);
    blocking(&s.drive, move |d| d.delete_forever(&who, &id)).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// An owned copy in the caller's My Drive. Not a shortcut, and not mail.
pub(super) async fn keep_copy(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let who = principal(&user);
    let item = blocking(&s.drive, move |d| d.keep_copy(&who, &id)).await?;
    Ok((StatusCode::CREATED, Json(item)).into_response())
}
