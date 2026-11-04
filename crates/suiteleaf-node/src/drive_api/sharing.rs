//! Sharing: the ACL, guests, expiry, ownership, access, and share notices.

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::json;
use suitedrive::{DriveError, Role, guest_role};

use crate::{
    auth::{AuthUser, RequireUser},
    http::AppState,
};

use super::{ApiError, ApiResult, blocking, principal};

pub(super) async fn person_files(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let who = principal(&user);
    let files = blocking(&s.drive, move |drive| drive.inspect_person(&who, &id)).await?;
    Ok(Json(json!({ "files": files })).into_response())
}

pub(super) async fn get_acl(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let who = principal(&user);
    Ok(
        Json(json!({ "acl": blocking(&s.drive, move |d| d.acl(&who, &id)).await? }))
            .into_response(),
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ShareBody {
    principal_type: String,
    principal_id: String,
    role: Option<Role>,
}

pub(super) async fn put_acl(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
    Json(body): Json<ShareBody>,
) -> ApiResult<Response> {
    let who = principal(&user);
    let acl = blocking(&s.drive, move |d| {
        d.share(
            &who,
            &id,
            &body.principal_type,
            &body.principal_id,
            body.role,
        )
    })
    .await?;
    Ok(Json(json!({ "acl": acl })).into_response())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExpiryBody {
    principal_id: String,
    #[serde(default = "user_principal")]
    principal_type: String,
    expires_at: Option<String>,
}

fn user_principal() -> String {
    "user".into()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GuestBody {
    principal_id: String,
    role: String,
    expires_at: String,
}

pub(super) async fn post_guest(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
    Json(body): Json<GuestBody>,
) -> ApiResult<Response> {
    let role =
        guest_role(&body.role).map_err(|message| DriveError::BadRequest(message.to_owned()))?;
    let who = principal(&user);
    blocking(&s.drive, move |d| {
        d.share_guest(&who, &id, &body.principal_id, role, &body.expires_at)
    })
    .await?;
    Ok(Json(json!({ "ok": true })).into_response())
}

pub(super) async fn list_guests(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
) -> ApiResult<Response> {
    let who = principal(&user);
    let guests = blocking(&s.drive, move |d| d.guest_review(&who)).await?;
    Ok(Json(json!({ "guests": guests })).into_response())
}

pub(super) async fn put_expiry(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
    Json(body): Json<ExpiryBody>,
) -> ApiResult<Response> {
    let who = principal(&user);
    let access = blocking(&s.drive, move |d| {
        d.set_expiry(
            &who,
            &id,
            &body.principal_type,
            &body.principal_id,
            body.expires_at.as_deref(),
        )
    })
    .await?;
    Ok(Json(json!({ "yourRole": access.your_role })).into_response())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TransferBody {
    user_id: String,
}

pub(super) async fn transfer_owner(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
    Json(body): Json<TransferBody>,
) -> ApiResult<Response> {
    let who = principal(&user);
    let item = blocking(&s.drive, move |d| d.transfer(&who, &id, &body.user_id)).await?;
    Ok(Json(item).into_response())
}

pub(super) async fn me(RequireUser(user): RequireUser) -> Json<AuthUser> {
    Json(user)
}

#[derive(Deserialize)]
pub(super) struct AccountQuery {
    q: Option<String>,
}

pub(super) async fn search_accounts(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Query(q): Query<AccountQuery>,
) -> ApiResult<Response> {
    let query = q.q.unwrap_or_default();
    if query.trim().chars().count() < 2 {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Type at least 2 characters to search for someone." })),
        )
            .into_response());
    }
    let auth = s.auth.clone();
    let caller = user.id.clone();
    let accounts = tokio::task::spawn_blocking(move || auth.search_accounts(&query, Some(&caller)))
        .await
        .map_err(|e| ApiError(DriveError::Other(e.into())))?
        .map_err(|e| ApiError(DriveError::Other(e)))?;
    Ok(Json(json!({ "accounts": accounts })).into_response())
}

pub(super) async fn search_groups(
    State(s): State<AppState>,
    RequireUser(_user): RequireUser,
    Query(q): Query<AccountQuery>,
) -> ApiResult<Response> {
    let query = q.q.unwrap_or_default();
    let groups = blocking(&s.drive, move |d| d.search_groups(&query)).await?;
    Ok(Json(json!({ "groups": groups })).into_response())
}

pub(super) async fn get_access(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let who = principal(&user);
    let access = blocking(&s.drive, move |d| d.access(&who, &id)).await?;
    let ids: Vec<String> = access
        .grants
        .iter()
        .map(|g| g.principal_id.clone())
        .collect();
    let auth = s.auth.clone();
    let profiles = tokio::task::spawn_blocking(move || auth.accounts(&ids))
        .await
        .map_err(|e| ApiError(DriveError::Other(e.into())))?
        .map_err(|e| ApiError(DriveError::Other(e)))?;
    let by_id: std::collections::HashMap<_, _> =
        profiles.into_iter().map(|p| (p.id.clone(), p)).collect();
    let group_ids: Vec<String> = access
        .grants
        .iter()
        .filter(|g| g.principal_type == "group")
        .map(|g| g.principal_id.clone())
        .collect();
    let drive = s.drive.clone();
    let group_names = tokio::task::spawn_blocking(move || {
        let mut names = std::collections::HashMap::new();
        for id in group_ids {
            if let Ok(Some(name)) = drive.group_name(&id) {
                names.insert(id, name);
            }
        }
        names
    })
    .await
    .map_err(|e| ApiError(DriveError::Other(e.into())))?;
    let grants: Vec<_> = access
        .grants
        .into_iter()
        .map(|g| {
            let profile = by_id.get(&g.principal_id);
            let name = if g.principal_type == "group" {
                group_names.get(&g.principal_id).cloned()
            } else {
                profile.and_then(|p| p.name.clone())
            };
            json!({
                "principalType": g.principal_type,
                "principalId": g.principal_id,
                "role": g.role,
                "name": name,
                "email": profile.and_then(|p| p.email.clone()),
                "inheritedFrom": g.inherited_from,
                "expiresAt": g.expires_at,
                "expired": g.expired,
            })
        })
        .collect();
    Ok(Json(json!({
        "grants": grants,
        "parent": access.parent,
        "yourRole": access.your_role,
    }))
    .into_response())
}

pub(super) async fn list_notices(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
) -> ApiResult<Response> {
    let who = principal(&user);
    let notices = blocking(&s.drive, move |d| d.notices(&who)).await?;
    let ids: Vec<String> = notices.iter().map(|n| n.sharer_id.clone()).collect();
    let auth = s.auth.clone();
    let profiles = tokio::task::spawn_blocking(move || auth.accounts(&ids))
        .await
        .map_err(|e| ApiError(DriveError::Other(e.into())))?
        .map_err(|e| ApiError(DriveError::Other(e)))?;
    let by_id: std::collections::HashMap<_, _> =
        profiles.into_iter().map(|p| (p.id.clone(), p)).collect();
    let views: Vec<_> = notices
        .into_iter()
        .map(|n| {
            let name = by_id
                .get(&n.sharer_id)
                .and_then(|p| p.name.clone())
                .filter(|name| !name.trim().is_empty());
            json!({
                "id": n.id,
                "itemId": n.item_id,
                "itemName": n.item_name,
                "sharerId": n.sharer_id,
                "sharerName": name,
                "role": n.role,
                "createdAt": n.created_at,
            })
        })
        .collect();
    Ok(Json(json!({ "notices": views })).into_response())
}

pub(super) async fn dismiss_notice(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let who = principal(&user);
    blocking(&s.drive, move |d| d.dismiss_notice(&who, &id)).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}
