//! Authentication: supervises the better-auth sidecar, proxies `/api/auth/*`
//! to it, and resolves request identities from replicated SuiteDB tables.
//!
//! Any node can authenticate any request without the sidecar: bearer JWTs are
//! verified against the replicated `jwks` public keys, and session tokens
//! (bearer or cookie) are looked up in the replicated `session` table.

use std::{
    collections::BTreeSet,
    sync::{Arc, RwLock},
    time::Duration,
};

use anyhow::{Context, Result};
use axum::{
    extract::FromRequestParts,
    http::{HeaderMap, StatusCode, header, request::Parts},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use suitedb::{Db, Value};

use crate::assertion::SeenAssertions;
use crate::emergency::open_emergency;
use crate::session_policy::{SessionDecision, decide_session};

mod accounts;
mod jwt;
mod sessions;
mod sidecar;
#[cfg(test)]
mod tests;

pub use sidecar::{proxy, supervise};

pub const JWT_ISSUER: &str = "suiteleaf";
pub const JWT_AUDIENCE: &str = "suiteleaf";
const SESSION_COOKIES: [&str; 2] = [
    "__Secure-better-auth.session_token",
    "better-auth.session_token",
];

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct AuthUser {
    pub id: String,
    pub email: Option<String>,
    pub name: Option<String>,
    pub role: Option<String>,
}

impl AuthUser {
    pub fn is_admin(&self) -> bool {
        self.role
            .as_deref()
            .is_some_and(|r| r.split(',').any(|r| r.trim() == "admin"))
    }
}

#[derive(Clone)]
pub struct Auth {
    db: Arc<Db>,
    sidecar: Arc<RwLock<Option<String>>>,
    idle: Arc<RwLock<Option<Duration>>>,
    seen: Arc<RwLock<SeenAssertions>>,
    emergency_code: Arc<RwLock<Option<String>>>,
    used_emergency: Arc<RwLock<BTreeSet<String>>>,
    client: reqwest::Client,
}

#[derive(Debug)]
pub struct EmergencySession {
    pub user: AuthUser,
    pub token: String,
}

impl Auth {
    pub fn new(db: Arc<Db>) -> Self {
        Auth {
            db,
            sidecar: Arc::default(),
            idle: Arc::default(),
            seen: Arc::default(),
            emergency_code: Arc::default(),
            used_emergency: Arc::default(),
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .expect("HTTP client"),
        }
    }

    pub fn set_sidecar(&self, url: Option<String>) {
        *self.sidecar.write().unwrap() = url;
    }

    /// How long `session.updatedAt` may sit still. `None` keeps the previous
    /// rule: only `expiresAt` ends the session.
    pub fn set_idle_limit(&self, idle: Option<Duration>) {
        *self.idle.write().unwrap() = idle;
    }

    /// The one-time recovery code. It is not written to the audit log.
    pub fn set_emergency_code(&self, code: Option<String>) {
        let trimmed = code.and_then(|value| {
            let value = value.trim().to_owned();
            if value.is_empty() { None } else { Some(value) }
        });
        *self.emergency_code.write().unwrap() = trimmed;
    }

    /// Open one 15-minute session for an existing administrator.
    /// The returned token is not the recovery code. A second use is refused.
    pub fn emergency_sign_in(
        &self,
        user_id: &str,
        offered: &str,
        reason: &str,
    ) -> Result<EmergencySession> {
        let configured = self.emergency_code.read().unwrap().clone();
        let row = self.db.get("user", user_id)?;
        let admin = row.as_ref().is_some_and(|row| {
            matches!(row.get("banned"), Some(Value::Integer(0)) | None)
                && matches!(row.get("role"), Some(Value::Text(role)) if role.split(',').any(|part| part.trim() == "admin"))
        });
        let at = suitedb::hlc::iso_now();
        let mut used = self.used_emergency.write().unwrap();
        let audit = open_emergency(
            configured.as_deref(),
            offered,
            admin,
            reason,
            &at,
            user_id,
            &mut used,
        )
        .map_err(anyhow::Error::msg)?;
        let token = uuid::Uuid::now_v7().to_string();
        let expires =
            suitedb::hlc::iso_from_ms(suitedb::hlc::now_ms().saturating_add(15 * 60 * 1000));
        let session_id = uuid::Uuid::now_v7().to_string();
        let audit_id = uuid::Uuid::now_v7().to_string();
        let stored = self.db.transact(|tx| {
            tx.upsert(
                "session",
                &session_id,
                [
                    ("expiresAt", Value::Text(expires)),
                    ("token", Value::Text(token.clone())),
                    ("createdAt", Value::Text(at.clone())),
                    ("updatedAt", Value::Text(at.clone())),
                    ("ipAddress", Value::Text(String::new())),
                    ("userAgent", Value::Text(String::new())),
                    ("userId", Value::Text(user_id.to_owned())),
                    ("impersonatedBy", Value::Text(String::new())),
                    ("activeOrganizationId", Value::Text(String::new())),
                ],
            )?;
            tx.upsert(
                "audit_event",
                &audit_id,
                [
                    ("at", Value::Text(audit.at)),
                    ("actorId", Value::Text(audit.user_id)),
                    ("action", Value::Text("emergency.sign-in".into())),
                    ("targetType", Value::Text("user".into())),
                    ("targetId", Value::Text(user_id.to_owned())),
                    ("name", Value::Text(audit.reason)),
                ],
            )?;
            Ok(())
        });
        if let Err(error) = stored {
            if let Some(code) = configured.as_deref() {
                used.remove(code.trim());
            }
            return Err(error.into());
        }
        let user = user_from_row(row.context("administrator")?).context("administrator")?;
        Ok(EmergencySession { user, token })
    }

    /// The inactivity limit in whole seconds, when one is configured.
    pub fn idle_secs(&self) -> Option<u64> {
        self.idle.read().unwrap().map(|limit| limit.as_secs())
    }

    pub fn sidecar(&self) -> Option<String> {
        self.sidecar.read().unwrap().clone()
    }

    /// Identify the caller from `Authorization: Bearer` or the session cookie.
    pub fn user(&self, headers: &HeaderMap) -> Option<AuthUser> {
        if let Some(token) = headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| {
                v.strip_prefix("Bearer ")
                    .or_else(|| v.strip_prefix("bearer "))
            })
        {
            let token = token.trim();
            return if token.matches('.').count() == 2 {
                self.verify_jwt(token).ok()
            } else {
                self.session_user(token).ok().flatten()
            };
        }
        let cookies = headers
            .get_all(header::COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok());
        for cookie in cookies.flat_map(|c| c.split(';')) {
            let Some((name, value)) = cookie.trim().split_once('=') else {
                continue;
            };
            if SESSION_COOKIES.contains(&name) {
                let value = percent_decode(value);
                if let Ok(Some(user)) = self.session_user(&value) {
                    return Some(user);
                }
            }
        }
        None
    }

    /// Session tokens may arrive signed (`token.signature`); the token alone
    /// is the unguessable lookup key.
    fn session_user(&self, token: &str) -> Result<Option<AuthUser>> {
        let token = token.split('.').next().unwrap_or_default();
        if token.is_empty() {
            return Ok(None);
        }
        let now = suitedb::hlc::iso_now();
        let rows = self.db.query(
            "SELECT u.id, u.email, u.name, u.role, u.banned, s.expiresAt, s.updatedAt, s.reauthAt
             FROM session s JOIN user u ON u.id = s.userId
             WHERE s.token = ?1
               AND s.id NOT IN (SELECT loser FROM _conflicts WHERE tbl = 'session')
             LIMIT 1",
            &[Value::Text(token.into())],
        )?;
        let Some(row) = rows.into_iter().next() else {
            return Ok(None);
        };
        let expires_at = match row.get("expiresAt") {
            Some(Value::Text(value)) => value.clone(),
            _ => String::new(),
        };
        let updated_at = match row.get("updatedAt") {
            Some(Value::Text(value)) => value.clone(),
            _ => String::new(),
        };
        let reauth_at = match row.get("reauthAt") {
            Some(Value::Text(value)) => value.clone(),
            _ => String::new(),
        };
        let idle = *self.idle.read().unwrap();
        if decide_session(&expires_at, &updated_at, &now, idle, &reauth_at)
            != SessionDecision::Accept
        {
            return Ok(None);
        }
        Ok(user_from_row(row))
    }
}

fn user_from_row(row: std::collections::BTreeMap<String, Value>) -> Option<AuthUser> {
    let text = |k: &str| match row.get(k) {
        Some(Value::Text(s)) => Some(s.clone()),
        _ => None,
    };
    if matches!(row.get("banned"), Some(Value::Integer(1))) {
        return None;
    }
    Some(AuthUser {
        id: text("id")?,
        email: text("email"),
        name: text("name"),
        role: text("role"),
    })
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let Some(b) = s
                .get(i + 1..i + 3)
                .and_then(|h| u8::from_str_radix(h, 16).ok())
        {
            out.push(b);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Extracts the signed-in user, or rejects with 401.
pub struct RequireUser(pub AuthUser);

impl<S> FromRequestParts<S> for RequireUser
where
    Auth: axum::extract::FromRef<S>,
    S: Send + Sync,
{
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let auth = <Auth as axum::extract::FromRef<S>>::from_ref(state);
        let headers = parts.headers.clone();
        match tokio::task::spawn_blocking(move || auth.user(&headers)).await {
            Ok(Some(user)) => Ok(RequireUser(user)),
            _ => Err((StatusCode::UNAUTHORIZED, "Sign in to use SuiteDrive.").into_response()),
        }
    }
}
