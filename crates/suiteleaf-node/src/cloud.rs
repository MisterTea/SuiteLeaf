//! Hosted registration and cross-instance mutation serialization.
use crate::{auth::RequireUser, http::AppState};
use axum::{
    Json,
    extract::{Request, State},
    http::{HeaderMap, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use std::sync::Arc;
use suitedb::{Db, Value};

pub const REGISTRATION_HEADER: &str = "x-suiteleaf-registration";
pub fn token_hash(token: &str) -> String {
    blake3::hash(token.as_bytes()).to_hex().to_string()
}

pub fn registration(db: &Db, headers: &HeaderMap, body: &[u8]) -> anyhow::Result<Option<String>> {
    let token = headers
        .get("x-suiteleaf-invite")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if token.len() < 32 || token.len() > 256 {
        return Ok(None);
    }
    let digest = token_hash(token);
    let users = db.query("SELECT id FROM user LIMIT 1", &[])?;
    if users.is_empty()
        && std::env::var("SUITELEAF_BOOTSTRAP_TOKEN_HASH")
            .ok()
            .as_deref()
            == Some(&digest)
    {
        return Ok(Some(digest));
    }
    let Some(invite) = db.get("cloud_invite", &digest)? else {
        return Ok(None);
    };
    let body: serde_json::Value = serde_json::from_slice(body)?;
    let email = body.get("email").and_then(|s| s.as_str()).unwrap_or("");
    let matches = matches!(invite.get("email"),Some(Value::Text(expected)) if expected.eq_ignore_ascii_case(email));
    let current = matches!(invite.get("expiresAt"),Some(Value::Text(expiry)) if expiry>&suitedb::hlc::iso_now());
    Ok((matches && current && !users.is_empty()).then_some(digest))
}

fn bypasses_mutation_lock(method: &Method, path: &str) -> bool {
    if path.starts_with("/api/ai/") {
        return true;
    }
    // Immutable content-addressed blob uploads (idempotent; chunked uploads take
    // their own per-blob item lock only around fast DB chunk writes, never across
    // remote blob storage HTTP I/O) and read-only missing-blob probes must not
    // hold or wait on the global cloud-mutations lock.
    if *method == Method::PUT && path.starts_with("/api/drive/items/") && path.contains("/blobs/") {
        return true;
    }
    if *method == Method::POST
        && path.starts_with("/api/drive/items/")
        && path.ends_with("/sections/missing")
    {
        return true;
    }
    false
}

pub async fn serialize_mutation(State(db): State<Arc<Db>>, req: Request, next: Next) -> Response {
    let mutation = req.method() != Method::GET
        && req.method() != Method::HEAD
        && req.method() != Method::OPTIONS;
    let guarded =
        db.is_postgres() && mutation && !bypasses_mutation_lock(req.method(), req.uri().path());
    let lock = if guarded {
        match db.exclusive("cloud-mutations") {
            Ok(lock) => lock,
            Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
        }
    } else {
        None
    };
    let response = next.run(req).await;
    drop(lock);
    response
}

#[derive(Deserialize)]
pub struct Invite {
    email: String,
}
pub async fn invite(
    State(state): State<AppState>,
    RequireUser(user): RequireUser,
    Json(input): Json<Invite>,
) -> Response {
    if !user.is_admin() {
        return StatusCode::FORBIDDEN.into_response();
    }
    if !state.config.cloud {
        return StatusCode::NOT_FOUND.into_response();
    }
    let email = input.email.trim().to_lowercase();
    if !email.contains('@') || email.len() > 320 {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let hash = token_hash(&token);
    let expiry = suitedb::hlc::iso_from_ms(suitedb::hlc::now_ms() + 7 * 24 * 60 * 60 * 1000);
    if state
        .db
        .transact(|tx| {
            tx.upsert(
                "cloud_invite",
                &hash,
                [
                    ("email", Value::Text(email)),
                    ("expiresAt", Value::Text(expiry)),
                ],
            )
        })
        .is_err()
    {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    Json(serde_json::json!({"url":format!("{}/#/?invite={token}",state.config.public_url())}))
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blob_uploads_and_missing_probes_bypass_global_mutation_lock() {
        assert!(bypasses_mutation_lock(
            &Method::PUT,
            "/api/drive/items/abc/blobs/deadbeef"
        ));
        assert!(bypasses_mutation_lock(
            &Method::POST,
            "/api/drive/items/abc/sections/missing"
        ));
        assert!(bypasses_mutation_lock(&Method::POST, "/api/ai/chat"));

        // Stateful mutations remain serialized.
        assert!(!bypasses_mutation_lock(
            &Method::POST,
            "/api/drive/items/abc/sections/commit"
        ));
        assert!(!bypasses_mutation_lock(&Method::POST, "/api/drive/items"));
        assert!(!bypasses_mutation_lock(
            &Method::PUT,
            "/api/drive/items/abc/content"
        ));
        assert!(!bypasses_mutation_lock(
            &Method::DELETE,
            "/api/drive/items/abc"
        ));
    }
}
