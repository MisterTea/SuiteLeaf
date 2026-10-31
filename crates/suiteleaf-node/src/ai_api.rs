//! `/api/ai`: the assistant, when a client runs it on this node.
//!
//! With `ai.upstream` set, the prompt is forwarded there. Otherwise the node
//! starts the local runner, which downloads a built-in GGUF the first time
//! that model is asked for. The caller's session is checked here and is not
//! sent upstream.

use axum::{
    Json, Router,
    body::Body,
    extract::State,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use futures::TryStreamExt;
use serde_json::json;

use crate::{auth::RequireUser, http::AppState};

const MISSING: &str = "This server could not start its model. Build the runner with npm run build -w @suiteleaf/ai, or set SUITELEAF_AI_UPSTREAM.";

/// `http://host:8080/v1` and `http://host:8080` both address `/v1/completions`.
pub fn completions_url(upstream: &str) -> String {
    let trimmed = upstream.trim().trim_end_matches('/');
    if trimmed.ends_with("/completions") {
        trimmed.to_owned()
    } else if trimmed.ends_with("/v1") {
        format!("{trimmed}/completions")
    } else {
        format!("{trimmed}/v1/completions")
    }
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/ai/v1/load", axum::routing::post(load_model))
        .route("/api/ai/v1/completions", axum::routing::post(completions))
        .with_state(state)
}

async fn load_model(
    State(state): State<AppState>,
    _user: RequireUser,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    if state.config.ai.upstream.is_some() {
        return Json(json!({ "state": "ready" })).into_response();
    }
    proxy_local(&state, "/v1/load", headers, body).await
}

async fn completions(
    State(state): State<AppState>,
    _user: RequireUser,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    if body.len() > 4_000_000 {
        return StatusCode::PAYLOAD_TOO_LARGE.into_response();
    }
    let Some(upstream) = state.config.ai.upstream.clone() else {
        return proxy_local(&state, "/v1/completions", headers, body).await;
    };
    let mut request = reqwest::Client::builder()
        .build()
        .expect("HTTP client")
        .post(completions_url(&upstream))
        .header(
            header::CONTENT_TYPE,
            headers
                .get(header::CONTENT_TYPE)
                .map(|v| v.as_bytes())
                .unwrap_or(b"application/json"),
        )
        .body(body);
    if let Some(key) = &state.config.ai.api_key {
        request = request.bearer_auth(key);
    }
    let upstream = match request.send().await {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!("assistant upstream: {error}");
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": "The server's model endpoint did not answer." })),
            )
                .into_response();
        }
    };
    let status = upstream.status();
    if !status.is_success() {
        let text = upstream.text().await.unwrap_or_default();
        return (status, text).into_response();
    }
    let content_type = upstream
        .headers()
        .get(header::CONTENT_TYPE)
        .cloned()
        .unwrap_or_else(|| header::HeaderValue::from_static("text/event-stream"));
    let stream = upstream.bytes_stream().map_err(|error| {
        std::io::Error::other(error)
    });
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from_stream(stream))
        .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
}

async fn proxy_local(state: &AppState, path: &str, headers: HeaderMap, body: axum::body::Bytes) -> Response {
    if body.len() > 4_000_000 {
        return StatusCode::PAYLOAD_TOO_LARGE.into_response();
    }
    let base = match state.local.ensure(&state.config).await {
        Ok(url) => url,
        Err(error) => {
            tracing::warn!("model runner: {error}");
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "error": format!("{MISSING} {error}") })),
            )
                .into_response();
        }
    };
    let request = reqwest::Client::builder()
        .build()
        .expect("HTTP client")
        .post(format!("{base}{path}"))
        .header(
            header::CONTENT_TYPE,
            headers
                .get(header::CONTENT_TYPE)
                .map(|v| v.as_bytes())
                .unwrap_or(b"application/json"),
        )
        .body(body);
    let upstream = match request.send().await {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!("model runner: {error}");
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": "The server's model did not answer." })),
            )
                .into_response();
        }
    };
    let status = upstream.status();
    if !status.is_success() {
        let text = upstream.text().await.unwrap_or_default();
        return (status, text).into_response();
    }
    let content_type = upstream
        .headers()
        .get(header::CONTENT_TYPE)
        .cloned()
        .unwrap_or_else(|| header::HeaderValue::from_static("text/event-stream"));
    let stream = upstream.bytes_stream().map_err(std::io::Error::other);
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from_stream(stream))
        .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
}

#[cfg(test)]
mod tests {
    use super::completions_url;

    #[test]
    fn completions_url_accepts_a_base_or_a_v1_root() {
        assert_eq!(
            completions_url("http://127.0.0.1:8080/v1/"),
            "http://127.0.0.1:8080/v1/completions"
        );
        assert_eq!(
            completions_url("http://models.example/v1/completions"),
            "http://models.example/v1/completions"
        );
        assert_eq!(
            completions_url("http://models.example"),
            "http://models.example/v1/completions"
        );
    }
}
