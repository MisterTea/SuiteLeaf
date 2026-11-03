//! Why the signed-in person can or cannot open one item.
//! Other people's grants are not part of this response.

use axum::{
    Json,
    extract::{Path, State},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use suitedrive::{AccessExplanation, DriveError, Principal};

use crate::{auth::RequireUser, drive_api::ApiError, http::AppState};

pub async fn explanation(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let admin = user.is_admin();
    let who = Principal { id: user.id, admin };
    let drive = s.drive.clone();
    let explanation = tokio::task::spawn_blocking(move || drive.explain_visible(&who, &id))
        .await
        .map_err(|error| ApiError(DriveError::Other(error.into())))?
        .map_err(ApiError)?;
    Ok(Json(explanation).into_response())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MovePreviewBody {
    destination_id: String,
    approved_item: AccessExplanation,
    approved_destination: AccessExplanation,
}

/// Compare the approval the caller recorded with access as it is now.
/// A difference refuses the move. The response still includes the current prediction.
pub async fn move_preview(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
    Json(body): Json<MovePreviewBody>,
) -> Result<Response, ApiError> {
    let admin = user.is_admin();
    let who = Principal { id: user.id, admin };
    let destination_id = body.destination_id;
    let drive = s.drive.clone();
    let preview = tokio::task::spawn_blocking(move || {
        let item_now = drive.explain(&who, &id)?;
        let destination_now = drive.explain(&who, &destination_id)?;
        Ok::<_, DriveError>(suitedrive::move_preview::decide_move(
            &id,
            &body.approved_item,
            &body.approved_destination,
            &item_now,
            &destination_now,
        ))
    })
    .await
    .map_err(|error| ApiError(DriveError::Other(error.into())))?
    .map_err(ApiError)?;
    Ok(Json(preview).into_response())
}
