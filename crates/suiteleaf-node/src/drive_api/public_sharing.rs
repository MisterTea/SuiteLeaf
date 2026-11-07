//! Only the token-based read route is anonymous. Management always checks identity.
use super::{ApiResult, blocking, principal};
use crate::{auth::RequireUser, http::AppState};
use axum::{
    Json,
    body::{Body, Bytes},
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::json;
use suitedrive::DriveError;

pub(super) async fn get_link(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let who = principal(&user);
    Ok(Json(blocking(&s.drive, move |d| d.public_link(&who, &id)).await?).into_response())
}
pub(super) async fn create_link(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let who = principal(&user);
    Ok(Json(blocking(&s.drive, move |d| d.create_public_link(&who, &id)).await?).into_response())
}
pub(super) async fn clear_link(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let who = principal(&user);
    blocking(&s.drive, move |d| d.clear_public_link(&who, &id)).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}
pub(super) async fn policy(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
) -> ApiResult<Response> {
    if !user.is_admin() {
        return Err(DriveError::Forbidden.into());
    }
    let allowed = blocking(&s.drive, |d| d.public_sharing_allowed()).await?;
    Ok(Json(json!({"allowed": allowed})).into_response())
}
#[derive(Deserialize)]
pub(super) struct Policy {
    allowed: bool,
}
pub(super) async fn set_policy(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Json(input): Json<Policy>,
) -> ApiResult<Response> {
    let who = principal(&user);
    blocking(&s.drive, move |d| d.set_public_sharing(&who, input.allowed)).await?;
    Ok(Json(json!({"allowed": input.allowed})).into_response())
}
pub(super) async fn read_file(
    State(s): State<AppState>,
    Path(token): Path<String>,
) -> ApiResult<Response> {
    let bytes = Bytes::from(blocking(&s.drive, move |d| d.public_file(&token)).await?);
    // Stream large native files through the Vercel response-size limit.
    let frames = (0..bytes.len())
        .step_by(suitedrive::CHUNK_SIZE)
        .map(move |start| {
            Ok::<_, std::io::Error>(
                bytes.slice(start..(start + suitedrive::CHUNK_SIZE).min(bytes.len())),
            )
        });
    Ok((
        [
            ("content-type", "application/json"),
            ("cache-control", "no-store"),
            ("x-robots-tag", "noindex, nofollow"),
            ("referrer-policy", "no-referrer"),
        ],
        Body::from_stream(futures::stream::iter(frames)),
    )
        .into_response())
}
