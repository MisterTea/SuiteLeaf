//! Reading and writing a file's bytes, with an ETag per version.

use std::time::Duration;

use axum::{
    Json,
    body::{Body, Bytes},
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::json;
use suitedrive::{Drive, DriveError, Item, Manifest, Role};

use crate::{auth::RequireUser, http::AppState};

use super::names::item_body;
use super::{ApiError, ApiResult, NetTransport, blocking, principal};

#[derive(Deserialize)]
pub(super) struct ContentQuery {
    version: Option<String>,
}

pub(super) fn etag(version: Option<&str>) -> Option<HeaderValue> {
    version.and_then(|v| HeaderValue::from_str(&format!("\"{v}\"")).ok())
}

pub(super) async fn read_content(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
    Query(q): Query<ContentQuery>,
) -> ApiResult<Response> {
    let who = principal(&user);
    if s.config.cloud {
        let version = q.version.clone();
        let (item, manifest) = blocking(&s.drive, move |d| {
            let item = d.get(&who, &id)?;
            // Form responders must keep the existing response-redaction path.
            if item.role == Some(Role::Responder) {
                let (_, bytes) = d.read(&who, &id, version.as_deref())?;
                return Ok((item, Err(bytes)));
            }
            let manifest = match d.content_hash(&item, version.as_deref())? {
                Some(hash) => {
                    Manifest::decode(&d.blobs().get(&hash)?.ok_or(DriveError::Unavailable)?)?
                }
                None => Manifest {
                    size: 0,
                    chunks: Vec::new(),
                },
            };
            Ok((item, Ok(manifest)))
        })
        .await?;
        let actor = user.id.clone();
        let opened = item.clone();
        let _ = blocking(&s.drive, move |d| {
            d.note_open(&actor, &opened.id, &opened.name)
        })
        .await;
        let body = match manifest {
            Err(bytes) => {
                let bytes = Bytes::from(bytes);
                let frames = (0..bytes.len())
                    .step_by(suitedrive::CHUNK_SIZE)
                    .map(move |start| {
                        Ok::<_, std::io::Error>(
                            bytes.slice(start..(start + suitedrive::CHUNK_SIZE).min(bytes.len())),
                        )
                    });
                Body::from_stream(futures::stream::iter(frames))
            }
            Ok(manifest) => {
                let state = (
                    s.drive.clone(),
                    std::collections::VecDeque::from(manifest.chunks),
                    manifest.size,
                );
                Body::from_stream(futures::stream::try_unfold(
                    state,
                    |(drive, mut chunks, remaining)| async move {
                        let Some(hash) = chunks.pop_front() else {
                            if remaining != 0 {
                                return Err(std::io::Error::other("Incomplete document manifest"));
                            }
                            return Ok(None);
                        };
                        let store = drive.clone();
                        let bytes = tokio::task::spawn_blocking(move || store.blobs().get(&hash))
                            .await
                            .map_err(|_| std::io::Error::other("Document storage worker failed"))?
                            .map_err(|_| std::io::Error::other("Document storage is unavailable"))?
                            .ok_or_else(|| {
                                std::io::Error::other("Document chunk is unavailable")
                            })?;
                        let expected = remaining.min(suitedrive::CHUNK_SIZE as u64);
                        if bytes.len() as u64 != expected {
                            return Err(std::io::Error::other("Document chunk size is invalid"));
                        }
                        Ok(Some((
                            Bytes::from(bytes),
                            (drive, chunks, remaining - expected),
                        )))
                    },
                ))
            }
        };
        return Ok(content_response(&item, q.version.is_none(), body));
    }
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
    let opened = (who.id.clone(), item.id.clone(), item.name.clone());
    let _ = blocking(&s.drive, {
        let (actor, item_id, name) = opened;
        move |d| d.note_open(&actor, &item_id, &name)
    })
    .await;
    Ok(content_response(
        &item,
        q.version.is_none(),
        Body::from(bytes),
    ))
}

fn content_response(item: &Item, head: bool, body: Body) -> Response {
    let mut response = Response::new(body);
    let headers = response.headers_mut();
    let mime = item.mime.as_deref().unwrap_or("application/octet-stream");
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime).unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    if head && let Some(tag) = etag(item.head_version_id.as_deref()) {
        headers.insert(header::ETAG, tag);
    }
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-cache"),
    );
    response
}

pub(super) async fn write_content(
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
    if let Some(range) = headers.get(header::CONTENT_RANGE) {
        let header_text = range.to_str().unwrap_or("");
        let Some((start, end, total)) = Drive::content_range(header_text) else {
            return Err(DriveError::BadRequest("The upload range cannot be read.".into()).into());
        };
        if total == 0 {
            if start != 0 || end != 0 || !body.is_empty() {
                return Err(DriveError::BadRequest(
                    "That upload does not continue the saved part.".into(),
                )
                .into());
            }
        } else if body.len() != end - start + 1 {
            return Err(DriveError::BadRequest(
                "That upload does not continue the saved part.".into(),
            )
            .into());
        }
        let item = blocking(&s.drive, move |d| {
            d.write_span(
                &who,
                &id,
                if_match.as_deref(),
                mime.as_deref(),
                start,
                total,
                &body,
            )
        })
        .await?;
        let Some(item) = item else {
            return Ok((StatusCode::ACCEPTED, Json(json!({ "accepted": end + 1 }))).into_response());
        };
        let mut response = Json(item_body(&s, &item).await?).into_response();
        if let Some(tag) = etag(item.head_version_id.as_deref()) {
            response.headers_mut().insert(header::ETAG, tag);
        }
        return Ok(response);
    }
    let item = blocking(&s.drive, move |d| {
        d.write(&who, &id, if_match.as_deref(), mime.as_deref(), &body)
    })
    .await?;
    let mut response = Json(item_body(&s, &item).await?).into_response();
    if let Some(tag) = etag(item.head_version_id.as_deref()) {
        response.headers_mut().insert(header::ETAG, tag);
    }
    Ok(response)
}
