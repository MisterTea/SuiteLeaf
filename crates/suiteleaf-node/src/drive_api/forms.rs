//! Respond links and the public form they open.

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::json;
use std::collections::BTreeMap;

use crate::{auth::RequireUser, http::AppState};

use super::{ApiResult, blocking, principal};

pub(super) async fn create_respond_link(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let who = principal(&user);
    let token = blocking(&s.drive, move |d| d.create_respond_link(&who, &id)).await?;
    Ok(Json(json!({ "token": token })).into_response())
}

pub(super) async fn clear_respond_link(
    State(s): State<AppState>,
    RequireUser(user): RequireUser,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let who = principal(&user);
    blocking(&s.drive, move |d| d.clear_respond_link(&who, &id)).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// Title and questions for a sign-up link. No account, and no responses.
pub(super) async fn get_public_form(
    State(s): State<AppState>,
    Path(token): Path<String>,
) -> ApiResult<Response> {
    let form = blocking(&s.drive, move |d| d.public_form(&token)).await?;
    Ok(Json(form).into_response())
}

#[derive(Deserialize)]
pub(super) struct RespondBody {
    answers: BTreeMap<String, String>,
}

/// Append one response. No account. Questions are unchanged.
pub(super) async fn post_public_response(
    State(s): State<AppState>,
    Path(token): Path<String>,
    Json(body): Json<RespondBody>,
) -> ApiResult<Response> {
    blocking(&s.drive, move |d| {
        d.submit_public_response(&token, &body.answers)
    })
    .await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}
