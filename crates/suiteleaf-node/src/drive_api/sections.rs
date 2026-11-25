//! HTTP endpoints for v2 sectioned `.slslides` partial loading, background
//! streaming, immutable blob fetches, and incremental delta commits.

use std::collections::BTreeSet;

use axum::{
    Json,
    body::{Body, Bytes},
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{Value, json};
use suitedrive::{DriveError, Hash};

use crate::{auth::RequireUser, http::AppState};

use super::content::etag;
use super::names::item_body;
use super::{ApiResult, blocking, principal};

#[derive(Deserialize)]
pub(super) struct BootstrapQuery {
    slide: Option<String>,
    section: Option<String>,
    version: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct StreamQuery {
    exclude: Option<String>,
    version: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct BlobQuery {
    version: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct MissingRequest {
    hashes: Vec<String>,
}

/// `GET /api/drive/items/{id}/sections/bootstrap?slide=<id>&version=<v>`
///
/// Returns `{ sectioned: true, item, versionId, manifest, global, slides: { [active]: ... } }`
/// in a single round-trip so the editor can render Slide 1 immediately.
/// Returns `{ sectioned: false }` for legacy v1 files so clients fall back cleanly.
pub(super) async fn bootstrap(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
    Query(q): Query<BootstrapQuery>,
) -> ApiResult<Response> {
    let who = principal(&user);
    let version = q.version.clone();
    let requested_section = q.section.clone().or_else(|| q.slide.clone());
    let result = blocking(&s.drive, move |d| {
        let Some((item, manifest, _)) = d.read_section_manifest(&who, &id, version.as_deref())?
        else {
            return Ok(None);
        };
        let global_hash: Hash = manifest
            .global
            .hash
            .parse()
            .map_err(|_| DriveError::Other(anyhow::anyhow!("invalid global hash")))?;
        let global_bytes = d
            .blobs()
            .get(&global_hash)
            .map_err(DriveError::Other)?
            .ok_or(DriveError::Unavailable)?;
        let global: Value =
            serde_json::from_slice(&global_bytes).map_err(|e| DriveError::Other(e.into()))?;

        let active_id = requested_section
            .filter(|sid| manifest.section_hash(sid).is_some())
            .or_else(|| manifest.section_order().first().cloned());

        let mut sections = serde_json::Map::new();
        if let Some(sid) = active_id
            && let Some(hash_str) = manifest.section_hash(&sid)
            && let Ok(hash) = hash_str.parse::<Hash>()
            && let Some(section_bytes) = d.blobs().get(&hash).map_err(DriveError::Other)?
            && let Ok(section_val) = serde_json::from_slice::<Value>(&section_bytes)
        {
            sections.insert(sid, section_val);
        }

        let _ = d.note_open(&who.id, &item.id, &item.name);
        Ok(Some((item, manifest, global, Value::Object(sections))))
    })
    .await?;

    let Some((item, manifest, global, sections)) = result else {
        return Ok(Json(json!({ "sectioned": false })).into_response());
    };
    let version_id = item.head_version_id.clone();
    let item_json = item_body(&s, &item).await?;
    let mut response = Json(json!({
        "sectioned": true,
        "item": item_json,
        "versionId": version_id,
        "manifest": manifest,
        "global": global,
        "sections": sections,
        "slides": sections,
    }))
    .into_response();
    if q.version.is_none()
        && let Some(tag) = etag(item.head_version_id.as_deref())
    {
        response.headers_mut().insert(header::ETAG, tag);
    }
    Ok(response)
}

/// `GET /api/drive/items/{id}/sections/stream?exclude=s1,s2&version=<v>`
///
/// Streams remaining slide sections as `application/x-ndjson` so the client can
/// hydrate thumbnails and slides in the background while the user is already editing.
pub(super) async fn stream_slides(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
    Query(q): Query<StreamQuery>,
) -> ApiResult<Response> {
    let who = principal(&user);
    let version = q.version.clone();
    let excluded: BTreeSet<String> = q
        .exclude
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect();

    let queue = blocking(&s.drive, move |d| {
        let Some((_, manifest, _)) = d.read_section_manifest(&who, &id, version.as_deref())? else {
            return Err(DriveError::NotFound);
        };
        let mut items: Vec<(String, Hash)> = Vec::new();
        for sid in manifest.section_order() {
            if excluded.contains(sid) {
                continue;
            }
            if let Some(hash_str) = manifest.section_hash(sid)
                && let Ok(hash) = hash_str.parse::<Hash>()
            {
                items.push((sid.clone(), hash));
            }
        }
        Ok(items)
    })
    .await?;

    let state = (s.drive.clone(), std::collections::VecDeque::from(queue));
    let body = Body::from_stream(futures::stream::try_unfold(
        state,
        |(drive, mut pending)| async move {
            let Some((slide_id, hash)) = pending.pop_front() else {
                return Ok::<_, std::io::Error>(None);
            };
            let store = drive.clone();
            let bytes = tokio::task::spawn_blocking(move || store.blobs().get(&hash))
                .await
                .map_err(|_| std::io::Error::other("blob worker failed"))?
                .map_err(|_| std::io::Error::other("blob store error"))?
                .ok_or_else(|| std::io::Error::other("slide blob unavailable"))?;
            let data: Value = serde_json::from_slice(&bytes)
                .map_err(|_| std::io::Error::other("corrupt slide json"))?;
            let mut line = serde_json::to_vec(&json!({
                "id": slide_id,
                "hash": hash.to_string(),
                "data": data,
            }))
            .map_err(|_| std::io::Error::other("encode slide ndjson"))?;
            line.push(b'\n');
            Ok(Some((Bytes::from(line), (drive, pending))))
        },
    ));

    let mut response = Response::new(body);
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/x-ndjson"),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-cache"),
    );
    Ok(response)
}

/// `GET /api/drive/items/{id}/blobs/{hash}?version=<v>`
///
/// Serves a content-addressed section or media blob with immutable caching headers.
pub(super) async fn read_blob(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path((id, hash_str)): Path<(String, String)>,
    Query(q): Query<BlobQuery>,
) -> ApiResult<Response> {
    let who = principal(&user);
    let hash: Hash = hash_str
        .parse()
        .map_err(|_| DriveError::BadRequest("Invalid blob hash.".into()))?;
    let version = q.version.clone();
    let bytes = blocking(&s.drive, move |d| {
        d.read_item_blob(&who, &id, version.as_deref(), hash)
    })
    .await?;

    let mut response = Response::new(Body::from(bytes));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=31536000, immutable"),
    );
    if let Ok(tag) = HeaderValue::from_str(&format!("\"{hash}\"")) {
        response.headers_mut().insert(header::ETAG, tag);
    }
    Ok(response)
}

/// `POST /api/drive/items/{id}/sections/missing`
///
/// Returns the subset of requested BLAKE3 hashes not yet stored on the server.
pub(super) async fn missing_blobs(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
    Json(req): Json<MissingRequest>,
) -> ApiResult<Response> {
    let who = principal(&user);
    let mut hashes = Vec::with_capacity(req.hashes.len());
    for raw in req.hashes {
        let hash: Hash = raw
            .parse()
            .map_err(|_| DriveError::BadRequest(format!("Invalid hash: {raw}")))?;
        hashes.push(hash);
    }
    let missing = blocking(&s.drive, move |d| d.missing_blobs(&who, &id, &hashes)).await?;
    let missing_hex: Vec<String> = missing.into_iter().map(|h| h.to_string()).collect();
    Ok(Json(json!({ "missing": missing_hex })).into_response())
}

/// `PUT /api/drive/items/{id}/blobs/{hash}`
///
/// Stores a single verified section/media/font blob before committing a manifest.
/// Supports `Content-Range: bytes start-end/total` for chunked uploads of large media blobs.
pub(super) async fn put_blob(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path((id, hash_str)): Path<(String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    let who = principal(&user);
    let hash: Hash = hash_str
        .parse()
        .map_err(|_| DriveError::BadRequest("Invalid blob hash.".into()))?;
    if let Some(range) = headers.get(header::CONTENT_RANGE) {
        let header_text = range.to_str().unwrap_or("");
        let Some((start, end, total)) = suitedrive::Drive::content_range(header_text) else {
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
        let done = blocking(&s.drive, move |d| {
            d.put_item_blob_span(&who, &id, hash, start, total, &body)
        })
        .await?;
        if done.is_none() {
            return Ok((StatusCode::ACCEPTED, Json(json!({ "accepted": end + 1 }))).into_response());
        }
        return Ok((StatusCode::NO_CONTENT, ()).into_response());
    }
    blocking(&s.drive, move |d| d.put_item_blob(&who, &id, hash, &body)).await?;
    Ok((StatusCode::NO_CONTENT, ()).into_response())
}

/// `POST /api/drive/items/{id}/sections/commit`
///
/// Commits a new v2 `.slslides` version from its updated `manifest.json` without
/// re-uploading untouched slides or media. Enforces `If-Match` optimistic locking.
pub(super) async fn commit_sections(
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
    let item = blocking(&s.drive, move |d| {
        d.commit_sections(&who, &id, if_match.as_deref(), &body)
    })
    .await?;
    let mut response = Json(item_body(&s, &item).await?).into_response();
    if let Some(tag) = etag(item.head_version_id.as_deref()) {
        response.headers_mut().insert(header::ETAG, tag);
    }
    Ok(response)
}
