//! `/api/drive`: the SuiteDrive REST API. Every route requires a signed-in
//! user and checks SuiteDrive ACLs.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::DefaultBodyLimit,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, patch, post, put},
};
use serde_json::json;
use suitedrive::{BlobTransport, Drive, DriveError, Principal};
use suiteleaf_net::{NetHandle, PeerId, Protocol};

use crate::{auth::AuthUser, http::AppState};

mod activity;
mod content;
mod forms;
mod items;
mod names;
mod sharing;
mod versions;

use activity::{add_comment, get_presence, list_comments, post_presence};
use content::{read_content, write_content};
use forms::{clear_respond_link, create_respond_link, get_public_form, post_public_response};
use items::{
    create, delete_forever, get_item, keep_copy, list, list_folders, list_spreadsheets, list_trash,
    search_files, update,
};
use sharing::{
    dismiss_notice, get_access, get_acl, list_guests, list_notices, me, person_files, post_guest,
    put_acl, put_expiry, search_accounts, search_groups, transfer_owner,
};
use versions::{copy_version, name_version, restore_version, versions};

/// Uploads are limited to the size of the largest native SuiteLeaf file.
pub const MAX_UPLOAD: usize = 256 * 1024 * 1024;

pub struct NetTransport(pub NetHandle);

#[async_trait::async_trait]
impl BlobTransport for NetTransport {
    async fn peers(&self) -> Vec<String> {
        self.0
            .peers()
            .await
            .iter()
            .map(ToString::to_string)
            .collect()
    }
    async fn request(&self, peer: &str, data: Vec<u8>) -> anyhow::Result<Vec<u8>> {
        let peer: PeerId = peer.parse()?;
        self.0.request(peer, Protocol::Blob, data).await
    }
}

fn principal(user: &AuthUser) -> Principal {
    Principal {
        id: user.id.clone(),
        admin: user.is_admin(),
    }
}

pub(crate) struct ApiError(pub(crate) DriveError);

impl From<DriveError> for ApiError {
    fn from(e: DriveError) -> Self {
        ApiError(e)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let message = self.0.to_string();
        match self.0 {
            DriveError::NotFound => {
                (StatusCode::NOT_FOUND, Json(json!({ "error": message }))).into_response()
            }
            DriveError::Forbidden => {
                (StatusCode::FORBIDDEN, Json(json!({ "error": message }))).into_response()
            }
            DriveError::Conflict(item) => (
                StatusCode::CONFLICT,
                Json(json!({ "error": message, "item": item })),
            )
                .into_response(),
            DriveError::BadRequest(_) => {
                (StatusCode::BAD_REQUEST, Json(json!({ "error": message }))).into_response()
            }
            DriveError::Unavailable => (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "error": message })),
            )
                .into_response(),
            DriveError::NoRoom => (
                StatusCode::PAYLOAD_TOO_LARGE,
                Json(json!({ "error": message })),
            )
                .into_response(),
            DriveError::Other(e) => {
                tracing::error!("drive: {e:#}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "SuiteDrive failed." })),
                )
                    .into_response()
            }
        }
    }
}

type ApiResult<T> = Result<T, ApiError>;

async fn blocking<T: Send + 'static>(
    drive: &Arc<Drive>,
    work: impl FnOnce(&Drive) -> Result<T, DriveError> + Send + 'static,
) -> ApiResult<T> {
    let drive = drive.clone();
    tokio::task::spawn_blocking(move || work(&drive))
        .await
        .map_err(|e| ApiError(DriveError::Other(e.into())))?
        .map_err(ApiError)
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/me", get(me))
        .route("/api/accounts", get(search_accounts))
        .route("/api/drive/groups", get(search_groups))
        .route("/api/drive/items", get(list).post(create))
        .route("/api/drive/folders", get(list_folders))
        .route("/api/drive/trash", get(list_trash))
        .route("/api/drive/search", get(search_files))
        .route("/api/drive/spreadsheets", get(list_spreadsheets))
        .route(
            "/api/drive/items/{id}",
            get(get_item).patch(update).delete(delete_forever),
        )
        .route(
            "/api/drive/items/{id}/content",
            get(read_content)
                .put(write_content)
                .layer(DefaultBodyLimit::max(MAX_UPLOAD)),
        )
        .route("/api/drive/items/{id}/versions", get(versions))
        .route(
            "/api/drive/items/{id}/versions/{version_id}",
            patch(name_version),
        )
        .route(
            "/api/drive/items/{id}/versions/{version_id}/restore",
            post(restore_version),
        )
        .route(
            "/api/drive/items/{id}/versions/{version_id}/copy",
            post(copy_version),
        )
        .route("/api/drive/items/{id}/acl", get(get_acl).put(put_acl))
        .route("/api/drive/items/{id}/expiry", put(put_expiry))
        .route("/api/drive/items/{id}/guest", post(post_guest))
        .route("/api/drive/guests", get(list_guests))
        .route("/api/drive/items/{id}/owner", post(transfer_owner))
        .route("/api/drive/items/{id}/access", get(get_access))
        .route("/api/drive/people/{id}/access", get(person_files))
        .route(
            "/api/drive/items/{id}/explanation",
            get(crate::access_explain::explanation),
        )
        .route(
            "/api/drive/items/{id}/move-preview",
            post(crate::access_explain::move_preview),
        )
        .route(
            "/api/drive/items/{id}/comments",
            get(list_comments).post(add_comment),
        )
        .route(
            "/api/drive/items/{id}/presence",
            get(get_presence).post(post_presence),
        )
        .route("/api/drive/items/{id}/copy", post(keep_copy))
        .route(
            "/api/drive/items/{id}/respond-link",
            post(create_respond_link).delete(clear_respond_link),
        )
        .route(
            "/api/respond/{token}",
            get(get_public_form).post(post_public_response),
        )
        .route("/api/drive/notices", get(list_notices))
        .route("/api/drive/notices/{id}/dismiss", post(dismiss_notice))
        .route("/api/drive/items/{id}/session", get(crate::collab::session))
        .with_state(state)
}
