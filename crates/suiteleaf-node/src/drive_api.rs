//! `/api/drive`: the SuiteDrive REST API. Every route requires a signed-in
//! user and checks SuiteDrive ACLs.

use std::{sync::Arc, time::Duration};

use axum::{
    Json, Router,
    body::{Body, Bytes},
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Deserialize;
use serde_json::json;
use suitedrive::{BlobTransport, Drive, DriveError, Principal, Role};
use suiteleaf_net::{NetHandle, PeerId, Protocol};

use crate::{
    auth::{AuthUser, RequireUser},
    http::AppState,
};

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

struct ApiError(DriveError);

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

#[derive(Deserialize)]
struct ListQuery {
    parent: Option<String>,
    shared: Option<String>,
}

async fn list(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Query(q): Query<ListQuery>,
) -> ApiResult<Response> {
    let who = principal(&user);
    let items = blocking(&s.drive, move |d| {
        if q.shared.is_some() {
            d.shared(&who)
        } else {
            d.list(&who, q.parent.as_deref().filter(|p| !p.is_empty()))
        }
    })
    .await?;
    Ok(Json(json!({ "items": items })).into_response())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateBody {
    name: String,
    parent_id: Option<String>,
    #[serde(default = "file_kind")]
    kind: String,
    mime: Option<String>,
}

fn file_kind() -> String {
    "file".into()
}

async fn create(
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
    Ok((StatusCode::CREATED, Json(item)).into_response())
}

async fn get_item(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let who = principal(&user);
    Ok(Json(blocking(&s.drive, move |d| d.get(&who, &id)).await?).into_response())
}

/// `parentId: null` moves an item to the top level; an absent key leaves it.
async fn update(
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
    Ok(Json(item).into_response())
}

async fn trash(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let who = principal(&user);
    blocking(&s.drive, move |d| {
        d.update(&who, &id, None, None, Some(true))
    })
    .await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

#[derive(Deserialize)]
struct ContentQuery {
    version: Option<String>,
}

fn etag(version: Option<&str>) -> Option<HeaderValue> {
    version.and_then(|v| HeaderValue::from_str(&format!("\"{v}\"")).ok())
}

async fn read_content(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
    Query(q): Query<ContentQuery>,
) -> ApiResult<Response> {
    let who = principal(&user);
    let attempt = |s: &AppState| {
        let (who, id, version) = (who.clone(), id.clone(), q.version.clone());
        let drive = s.drive.clone();
        async move { blocking(&drive, move |d| d.read(&who, &id, version.as_deref())).await }
    };
    let (item, bytes) = match attempt(&s).await {
        Err(ApiError(DriveError::Unavailable)) => {
            // Fetch on demand rather than waiting for background replication.
            let (who2, id2, version) = (who.clone(), id.clone(), q.version.clone());
            let hash = blocking(&s.drive, move |d| {
                let item = d.get(&who2, &id2)?;
                d.content_hash(&item, version.as_deref())
            })
            .await?;
            if let Some(hash) = hash {
                let transport = NetTransport(s.net.clone());
                let _ =
                    tokio::time::timeout(Duration::from_secs(60), s.drive.fetch(hash, &transport))
                        .await;
            }
            attempt(&s).await?
        }
        other => other?,
    };
    let mut response = Response::new(Body::from(bytes));
    let headers = response.headers_mut();
    let mime = item.mime.as_deref().unwrap_or("application/octet-stream");
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime).unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    if q.version.is_none()
        && let Some(tag) = etag(item.head_version_id.as_deref())
    {
        headers.insert(header::ETAG, tag);
    }
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-cache"),
    );
    Ok(response)
}

async fn write_content(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    let who = principal(&user);
    let if_match = headers
        .get(header::IF_MATCH)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let mime = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .filter(|m| !m.is_empty())
        .map(str::to_owned);
    let item = blocking(&s.drive, move |d| {
        d.write(&who, &id, if_match.as_deref(), mime.as_deref(), &body)
    })
    .await?;
    let mut response = Json(&item).into_response();
    if let Some(tag) = etag(item.head_version_id.as_deref()) {
        response.headers_mut().insert(header::ETAG, tag);
    }
    Ok(response)
}

async fn versions(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let who = principal(&user);
    Ok(
        Json(json!({ "versions": blocking(&s.drive, move |d| d.versions(&who, &id)).await? }))
            .into_response(),
    )
}

async fn get_acl(
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
struct ShareBody {
    principal_type: String,
    principal_id: String,
    role: Option<Role>,
}

async fn put_acl(
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

async fn me(RequireUser(user): RequireUser) -> Json<AuthUser> {
    Json(user)
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/me", get(me))
        .route("/api/drive/items", get(list).post(create))
        .route(
            "/api/drive/items/{id}",
            get(get_item).patch(update).delete(trash),
        )
        .route(
            "/api/drive/items/{id}/content",
            get(read_content)
                .put(write_content)
                .layer(DefaultBodyLimit::max(MAX_UPLOAD)),
        )
        .route("/api/drive/items/{id}/versions", get(versions))
        .route("/api/drive/items/{id}/acl", get(get_acl).put(put_acl))
        .with_state(state)
}
