//! Authentication: supervises the better-auth sidecar, proxies `/api/auth/*`
//! to it, and resolves request identities from replicated SuiteDB tables.
//!
//! Any node can authenticate any request without the sidecar: bearer JWTs are
//! verified against the replicated `jwks` public keys, and session tokens
//! (bearer or cookie) are looked up in the replicated `session` table.

use std::{
    collections::BTreeSet,
    net::SocketAddr,
    process::Stdio,
    sync::{Arc, RwLock},
    time::Duration,
};

use anyhow::{Context, Result, anyhow, bail};
use axum::{
    body::Body,
    extract::{ConnectInfo, FromRequestParts, Request, State},
    http::{HeaderMap, StatusCode, header, request::Parts},
    response::{IntoResponse, Response},
};
use jsonwebtoken::{Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use suitedb::{Db, Value};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
};

use crate::assertion::{
    Assertion, SeenAssertions, accept_assertion, email_domain_allowed, key_still_signs,
    link_subject,
};
use crate::config::Config;
use crate::emergency::open_emergency;
use crate::session_list::{StoredSession, VisibleSession, may_revoke, visible_sessions};
use crate::session_policy::{SessionDecision, decide_session};

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

    fn verify_jwt(&self, token: &str) -> Result<AuthUser> {
        let kid = jsonwebtoken::decode_header(token)?
            .kid
            .ok_or_else(|| anyhow!("JWT has no key ID"))?;
        let row = self
            .db
            .get("jwks", &kid)?
            .ok_or_else(|| anyhow!("unknown JWT key {kid}"))?;
        let expires_at = match row.get("expiresAt") {
            Some(Value::Text(value)) => value.clone(),
            _ => String::new(),
        };
        if !key_still_signs(&expires_at, &suitedb::hlc::iso_now()) {
            bail!("JWT key has been rotated");
        }
        let Some(Value::Text(public)) = row.get("publicKey") else {
            bail!("JWT key has no public key")
        };
        let jwk: Jwk = serde_json::from_str(public)?;
        if jwk.kty != "OKP" || jwk.crv.as_deref() != Some("Ed25519") {
            bail!("unsupported JWT key type");
        }
        let key = DecodingKey::from_ed_components(&jwk.x)?;
        let mut validation = Validation::new(Algorithm::EdDSA);
        validation.set_issuer(&[JWT_ISSUER]);
        validation.set_audience(&[JWT_AUDIENCE]);
        let claims = jsonwebtoken::decode::<Claims>(token, &key, &validation)?.claims;
        if claims.banned == Some(true) {
            bail!("user is banned");
        }
        if let Some(incoming) = claims
            .oidc_sub
            .clone()
            .filter(|subject| !subject.is_empty())
        {
            link_subject(self.linked_oidc(&claims.sub)?.as_deref(), &incoming)
                .map_err(anyhow::Error::msg)?;
        }
        let domains = self.allowed_email_domains()?;
        if !domains.is_empty() {
            email_domain_allowed(claims.email.as_deref().unwrap_or(""), &domains)
                .map_err(anyhow::Error::msg)?;
        }
        if self.organization_requires_mfa()? && !assertion_has_mfa(&claims.amr) {
            bail!("This organization requires a second factor.");
        }
        self.remember_jti(&claims)?;
        let mut user = AuthUser {
            id: claims.sub,
            email: claims.email,
            name: claims.name,
            role: claims.role,
        };
        // Role and ban live in the user row. A JWT issued before a change
        // would otherwise keep the old role until it expired.
        if let Some(row) = self.db.get("user", &user.id)? {
            if matches!(row.get("banned"), Some(Value::Integer(n)) if *n != 0) {
                bail!("user is banned");
            }
            if let Some(Value::Text(role)) = row.get("role") {
                user.role = Some(role.clone());
            }
        }
        Ok(user)
    }

    /// True when any organization metadata sets `mfa` to true.
    fn organization_requires_mfa(&self) -> Result<bool> {
        let rows = self.db.query("SELECT metadata FROM organization", &[])?;
        for row in rows {
            let Some(Value::Text(metadata)) = row.get("metadata") else {
                continue;
            };
            let Ok(parsed) = serde_json::from_str::<serde_json::Value>(metadata) else {
                continue;
            };
            if parsed.get("mfa").and_then(|value| value.as_bool()) == Some(true) {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// Domains named in any organization's metadata. An empty list is no rule.
    fn allowed_email_domains(&self) -> Result<Vec<String>> {
        let rows = self.db.query("SELECT metadata FROM organization", &[])?;
        let mut domains = Vec::new();
        for row in rows {
            let Some(Value::Text(metadata)) = row.get("metadata") else {
                continue;
            };
            let Ok(parsed) = serde_json::from_str::<serde_json::Value>(metadata) else {
                continue;
            };
            let Some(list) = parsed.get("domains").and_then(|value| value.as_array()) else {
                continue;
            };
            for item in list {
                let Some(domain) = item.as_str().filter(|domain| !domain.is_empty()) else {
                    continue;
                };
                domains.push(domain.to_ascii_lowercase());
            }
        }
        Ok(domains)
    }

    /// The subject already stored for this user at provider `oidc`, if any.
    fn linked_oidc(&self, user_id: &str) -> Result<Option<String>> {
        let rows = self.db.query(
            "SELECT accountId FROM account WHERE userId = ?1 AND providerId = 'oidc'",
            &[Value::Text(user_id.into())],
        )?;
        Ok(rows.into_iter().find_map(|row| match row.get("accountId") {
            Some(Value::Text(id)) if !id.is_empty() => Some(id.clone()),
            _ => None,
        }))
    }

    /// A JWT with a `jti` may be used once. A JWT without one is left as it was.
    fn remember_jti(&self, claims: &Claims) -> Result<()> {
        let Some(jti) = claims.jti.clone().filter(|jti| !jti.is_empty()) else {
            return Ok(());
        };
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| i64::try_from(duration.as_secs()).unwrap_or(i64::MAX))
            .unwrap_or(0);
        let assertion = Assertion {
            issuer: JWT_ISSUER.into(),
            audience: JWT_AUDIENCE.into(),
            expires_at: claims.exp,
            jti,
            subject: claims.sub.clone(),
        };
        let mut seen = self.seen.write().unwrap();
        accept_assertion(&assertion, now, &mut seen, JWT_ISSUER, JWT_AUDIENCE)
            .map_err(anyhow::Error::msg)?;
        Ok(())
    }

    /// POST JSON to the auth sidecar, forwarding the caller's bearer token.
    pub async fn sidecar_post(
        &self,
        path: &str,
        authorization: &str,
        body: &serde_json::Value,
    ) -> Result<(u16, serde_json::Value)> {
        let Some(base) = self.sidecar() else {
            bail!("Authentication is not available on this node.");
        };
        let response = self
            .client
            .post(format!("{base}{path}"))
            .header(header::AUTHORIZATION, authorization)
            .header(header::CONTENT_TYPE, "application/json")
            .json(body)
            .send()
            .await
            .context("Authentication service unavailable.")?;
        let status = response.status().as_u16();
        let payload = response
            .json::<serde_json::Value>()
            .await
            .unwrap_or(serde_json::json!({}));
        Ok((status, payload))
    }

    /// Accounts whose name, username, or email contains `query` (at least two
    /// characters). `exclude` drops the caller, so people don't share with themselves.
    pub fn search_accounts(
        &self,
        query: &str,
        exclude: Option<&str>,
    ) -> Result<Vec<AccountProfile>> {
        let query = query.trim();
        if query.chars().count() < 2 {
            return Ok(vec![]);
        }
        let rows = self.db.query(
            "SELECT id, name, email, username FROM user
             WHERE id != ?2
               AND id NOT IN (SELECT loser FROM _conflicts WHERE tbl = 'user')
               AND (banned IS NULL OR banned = 0)
               AND (
                 LOWER(IFNULL(name, '')) LIKE ?1 ESCAPE '\\'
                 OR LOWER(IFNULL(email, '')) LIKE ?1 ESCAPE '\\'
                 OR LOWER(IFNULL(username, '')) LIKE ?1 ESCAPE '\\'
               )
             ORDER BY name COLLATE NOCASE, email COLLATE NOCASE
             LIMIT 8",
            &[
                Value::Text(like_contains(query)),
                Value::Text(exclude.unwrap_or("").into()),
            ],
        )?;
        Ok(rows.into_iter().filter_map(profile_from_row).collect())
    }

    /// Profiles for the given account ids, for labelling a share list.
    pub fn accounts(&self, ids: &[String]) -> Result<Vec<AccountProfile>> {
        if ids.is_empty() {
            return Ok(vec![]);
        }
        let marks: Vec<String> = (0..ids.len()).map(|i| format!("?{}", i + 1)).collect();
        let params: Vec<Value> = ids.iter().cloned().map(Value::Text).collect();
        let rows = self.db.query(
            &format!(
                "SELECT id, name, email, username FROM user
                 WHERE id IN ({})
                   AND id NOT IN (SELECT loser FROM _conflicts WHERE tbl = 'user')",
                marks.join(", ")
            ),
            &params,
        )?;
        Ok(rows.into_iter().filter_map(profile_from_row).collect())
    }

    /// Sessions for this person. The token is compared and then dropped.
    pub fn list_sessions(&self, user_id: &str, bearer: &str) -> Result<Vec<VisibleSession>> {
        let rows = self.db.query(
            "SELECT id, userId, createdAt, updatedAt, expiresAt, userAgent, token, reauthAt FROM session WHERE userId = ?1",
            &[Value::Text(user_id.to_owned())],
        )?;
        let stored = rows
            .into_iter()
            .filter_map(|row| {
                let text = |key: &str| match row.get(key) {
                    Some(Value::Text(value)) => value.clone(),
                    _ => String::new(),
                };
                let id = text("id");
                if id.is_empty() {
                    return None;
                }
                Some(StoredSession {
                    id,
                    user_id: text("userId"),
                    created_at: text("createdAt"),
                    updated_at: text("updatedAt"),
                    expires_at: text("expiresAt"),
                    user_agent: text("userAgent"),
                    token: text("token"),
                    reauth_at: text("reauthAt"),
                })
            })
            .collect::<Vec<_>>();
        let now = suitedb::hlc::iso_now();
        Ok(visible_sessions(&stored, user_id, bearer, &now))
    }

    /// End one of this person's sessions. Another person's session is not deleted.
    pub fn revoke_session(&self, user_id: &str, session_id: &str) -> Result<bool> {
        let Some(row) = self.db.get("session", session_id)? else {
            return Ok(false);
        };
        let owner = match row.get("userId") {
            Some(Value::Text(value)) => value.clone(),
            _ => String::new(),
        };
        if !may_revoke(&owner, user_id) {
            return Ok(false);
        }
        self.db.transact(|tx| tx.delete("session", session_id))?;
        Ok(true)
    }

    /// End this person's sessions for one device name. Another person's session stays.
    /// The device name is not returned.
    pub fn revoke_lost_device(&self, user_id: &str, device: &str) -> Result<usize> {
        let device = device.trim();
        if device.is_empty() {
            bail!("Name the device to sign out.");
        }
        let rows = self.db.query(
            "SELECT id, userId, userAgent FROM session WHERE userId = ?1",
            &[Value::Text(user_id.to_owned())],
        )?;
        let mut ended = 0;
        for row in rows {
            let agent = match row.get("userAgent") {
                Some(Value::Text(value)) => value.clone(),
                _ => String::new(),
            };
            if agent != device {
                continue;
            }
            let Some(Value::Text(id)) = row.get("id") else {
                continue;
            };
            if self.revoke_session(user_id, id)? {
                ended += 1;
            }
        }
        Ok(ended)
    }

    /// Replace this person's session token. The previous token no longer signs in.
    /// The new token is returned once. Another person's session is not changed.
    pub fn rotate_session(&self, user_id: &str, session_id: &str) -> Result<Option<String>> {
        let Some(row) = self.db.get("session", session_id)? else {
            return Ok(None);
        };
        let text = |key: &str| match row.get(key) {
            Some(Value::Text(value)) => value.clone(),
            _ => String::new(),
        };
        if !may_revoke(&text("userId"), user_id) {
            return Ok(None);
        }
        let previous = text("token");
        let mut generated = uuid::Uuid::now_v7().to_string();
        if generated.is_empty() || generated == previous {
            generated = uuid::Uuid::now_v7().to_string();
        }
        let expires_at = text("expiresAt");
        let created_at = text("createdAt");
        let ip_address = text("ipAddress");
        let user_agent = text("userAgent");
        let owner = text("userId");
        let impersonated_by = text("impersonatedBy");
        let organization = text("activeOrganizationId");
        let now = suitedb::hlc::iso_now();
        let stored = generated.clone();
        self.db.transact(move |tx| {
            tx.upsert(
                "session",
                session_id,
                [
                    ("expiresAt", Value::Text(expires_at)),
                    ("token", Value::Text(stored)),
                    ("createdAt", Value::Text(created_at)),
                    ("updatedAt", Value::Text(now)),
                    ("ipAddress", Value::Text(ip_address)),
                    ("userAgent", Value::Text(user_agent)),
                    ("userId", Value::Text(owner)),
                    ("impersonatedBy", Value::Text(impersonated_by)),
                    ("activeOrganizationId", Value::Text(organization)),
                ],
            )
        })?;
        Ok(Some(generated))
    }

    /// This person's session must sign in again. The row stays. Another person's session is unchanged.
    pub fn require_reauth(&self, user_id: &str, session_id: &str) -> Result<bool> {
        let Some(row) = self.db.get("session", session_id)? else {
            return Ok(false);
        };
        let text = |key: &str| match row.get(key) {
            Some(Value::Text(value)) => value.clone(),
            _ => String::new(),
        };
        if !may_revoke(&text("userId"), user_id) {
            return Ok(false);
        }
        let expires_at = text("expiresAt");
        let token = text("token");
        let created_at = text("createdAt");
        let updated_at = text("updatedAt");
        let ip_address = text("ipAddress");
        let user_agent = text("userAgent");
        let owner = text("userId");
        let impersonated_by = text("impersonatedBy");
        let organization = text("activeOrganizationId");
        let now = suitedb::hlc::iso_now();
        self.db.transact(move |tx| {
            tx.upsert(
                "session",
                session_id,
                [
                    ("expiresAt", Value::Text(expires_at)),
                    ("token", Value::Text(token)),
                    ("createdAt", Value::Text(created_at)),
                    ("updatedAt", Value::Text(updated_at)),
                    ("ipAddress", Value::Text(ip_address)),
                    ("userAgent", Value::Text(user_agent)),
                    ("userId", Value::Text(owner)),
                    ("impersonatedBy", Value::Text(impersonated_by)),
                    ("activeOrganizationId", Value::Text(organization)),
                    ("reauthAt", Value::Text(now)),
                ],
            )
        })?;
        Ok(true)
    }
}

/// A person on this server, safe to show in a share dialog.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountProfile {
    pub id: String,
    pub name: Option<String>,
    pub email: Option<String>,
    pub username: Option<String>,
}

fn like_contains(query: &str) -> String {
    let mut escaped = String::new();
    for c in query.chars() {
        if c == '\\' || c == '%' || c == '_' {
            escaped.push('\\');
        }
        escaped.extend(c.to_lowercase());
    }
    format!("%{escaped}%")
}

fn profile_from_row(row: std::collections::BTreeMap<String, Value>) -> Option<AccountProfile> {
    let text = |k: &str| match row.get(k) {
        Some(Value::Text(s)) if !s.is_empty() => Some(s.clone()),
        _ => None,
    };
    Some(AccountProfile {
        id: text("id")?,
        name: text("name"),
        email: text("email"),
        username: text("username"),
    })
}

#[derive(Deserialize)]
struct Jwk {
    kty: String,
    crv: Option<String>,
    x: String,
}

#[derive(Deserialize)]
struct Claims {
    sub: String,
    exp: i64,
    email: Option<String>,
    name: Option<String>,
    role: Option<String>,
    banned: Option<bool>,
    #[serde(default)]
    jti: Option<String>,
    #[serde(default)]
    oidc_sub: Option<String>,
    #[serde(default)]
    amr: Vec<String>,
}

fn assertion_has_mfa(methods: &[String]) -> bool {
    methods.iter().any(|method| method == "mfa")
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

const HOP_HEADERS: [&str; 6] = [
    "connection",
    "keep-alive",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
];

/// Forward `/api/auth/*` to the better-auth sidecar.
pub async fn proxy(
    State(auth): State<Auth>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    req: Request,
) -> Response {
    let Some(base) = auth.sidecar() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "Authentication is not available on this node.",
        )
            .into_response();
    };
    let path = req
        .uri()
        .path_and_query()
        .map(|p| p.as_str())
        .unwrap_or("/");
    let url = format!("{base}{path}");
    let method = req.method().clone();
    let mut headers = reqwest::header::HeaderMap::new();
    for (name, value) in req.headers() {
        if !HOP_HEADERS.contains(&name.as_str()) {
            headers.append(name.clone(), value.clone());
        }
    }
    headers.insert("x-forwarded-for", peer.ip().to_string().parse().unwrap());
    let body = match axum::body::to_bytes(req.into_body(), 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return StatusCode::PAYLOAD_TOO_LARGE.into_response(),
    };
    let upstream = match auth
        .client
        .request(method, &url)
        .headers(headers)
        .body(body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("auth sidecar: {e}");
            return (
                StatusCode::BAD_GATEWAY,
                "Authentication service unavailable.",
            )
                .into_response();
        }
    };
    let mut response = Response::builder().status(upstream.status().as_u16());
    for (name, value) in upstream.headers() {
        if !HOP_HEADERS.contains(&name.as_str()) {
            response = response.header(name, value);
        }
    }
    let bytes = upstream.bytes().await.unwrap_or_default();
    response
        .body(Body::from(bytes))
        .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
}

/// Start the sidecar and restart it if it exits. The proxy target updates
/// whenever the sidecar reports its port.
pub fn supervise(
    auth: Auth,
    config: Arc<Config>,
    internal_url: String,
    internal_token: String,
) -> Result<()> {
    let secret = std::env::var("SUITELEAF_AUTH_SECRET")
        .ok()
        .or_else(|| config.auth.secret.clone())
        .context(
            "authentication needs SUITELEAF_AUTH_SECRET (or auth.secret), identical on every node",
        )?;
    if secret.len() < 32 {
        bail!("the auth secret must be at least 32 characters");
    }
    let (program, args) = config
        .auth
        .command
        .split_first()
        .context("auth.command is empty")?;
    let (program, args) = (program.clone(), args.to_vec());
    tokio::spawn(async move {
        loop {
            let mut command = Command::new(&program);
            command
                .args(&args)
                .envs(&config.auth.env)
                .env("SUITELEAF_PUBLIC_URL", config.public_url())
                .env("SUITELEAF_AUTH_SECRET", &secret)
                .env("SUITELEAF_INTERNAL_URL", &internal_url)
                .env("SUITELEAF_INTERNAL_TOKEN", &internal_token)
                .env("SUITELEAF_TRUSTED_ORIGINS", config.cors_origins.join(","))
                .env("SUITELEAF_AUTH_PORT", "0")
                .env("SUITELEAF_EXIT_WITH_STDIN", "1")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .kill_on_drop(true);
            match command.spawn() {
                Ok(mut child) => {
                    let stdout = child.stdout.take().expect("piped stdout");
                    let reporter = auth.clone();
                    tokio::spawn(async move {
                        let mut lines = BufReader::new(stdout).lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            if let Some(port) = line.strip_prefix("SUITELEAF_AUTH_READY ") {
                                tracing::info!("auth sidecar listening on 127.0.0.1:{port}");
                                reporter
                                    .set_sidecar(Some(format!("http://127.0.0.1:{}", port.trim())));
                            } else {
                                tracing::info!(target: "auth", "{line}");
                            }
                        }
                    });
                    // `wait` closes the child's stdin, which the sidecar
                    // treats as the node exiting; hold it open instead.
                    let _stdin = child.stdin.take();
                    let status = child.wait().await;
                    auth.set_sidecar(None);
                    tracing::warn!("auth sidecar exited ({status:?}); restarting");
                }
                Err(e) => tracing::error!("could not start auth sidecar {program}: {e}"),
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::schema::node_schema;
    use suitedb::Db;

    #[test]
    fn decodes_percent_encoded_cookie_values() {
        assert_eq!(percent_decode("abc.def%3D"), "abc.def=");
        assert_eq!(percent_decode("100%"), "100%");
    }

    fn accounts() -> Auth {
        let db = Arc::new(
            Db::open_in_memory(
                suiteleaf_net::identity::ed25519::Keypair::generate(),
                node_schema(None).unwrap(),
            )
            .unwrap(),
        );
        db.transact(|tx| {
            tx.upsert(
                "user",
                "sam",
                [
                    ("name", Value::from("Sam Okafor")),
                    ("email", Value::from("sam@gardenclub.org")),
                    ("username", Value::from("sam")),
                    ("banned", Value::Integer(0)),
                ],
            )?;
            tx.upsert(
                "user",
                "priya",
                [
                    ("name", Value::from("Priya Shah")),
                    ("email", Value::from("priya@gardenclub.org")),
                    ("username", Value::from("priya")),
                ],
            )?;
            tx.upsert(
                "user",
                "lee",
                [
                    ("name", Value::from("Lee_Ann")),
                    ("email", Value::from("lee_ann@gardenclub.org")),
                ],
            )?;
            tx.upsert(
                "user",
                "banned",
                [
                    ("name", Value::from("Sam Banned")),
                    ("email", Value::from("banned@gardenclub.org")),
                    ("banned", Value::Integer(1)),
                ],
            )
        })
        .unwrap();
        Auth::new(db)
    }

    #[test]
    fn search_matches_name_username_or_email_and_skips_others() {
        let auth = accounts();
        let sam = auth.search_accounts("sa", None).unwrap();
        assert_eq!(sam.len(), 1);
        assert_eq!(sam[0].name.as_deref(), Some("Sam Okafor"));
        assert_eq!(sam[0].email.as_deref(), Some("sam@gardenclub.org"));
        assert_eq!(
            auth.search_accounts("PRI", None).unwrap()[0].id,
            "priya",
            "username match is case-insensitive"
        );
        assert!(
            auth.search_accounts("sam@", None)
                .unwrap()
                .iter()
                .any(|a| a.id == "sam")
        );
        assert!(
            auth.search_accounts("lee@example.com", None)
                .unwrap()
                .is_empty()
        );
        assert_eq!(auth.search_accounts("l", None).unwrap().len(), 0);
        let literal = auth.search_accounts("lee_", None).unwrap();
        assert_eq!(literal.len(), 1);
        assert!(auth.search_accounts("lee%", None).unwrap().is_empty());
        assert!(auth.search_accounts("sa", Some("sam")).unwrap().is_empty());
        assert!(
            auth.search_accounts("banned", None).unwrap().is_empty(),
            "banned accounts are not suggested"
        );
        assert_eq!(
            auth.accounts(&["priya".into(), "missing".into()])
                .unwrap()
                .len(),
            1
        );
    }

    fn cookie(token: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            format!("better-auth.session_token={token}")
                .parse()
                .unwrap(),
        );
        headers
    }

    #[test]
    fn an_expired_idle_or_deleted_session_does_not_sign_in() {
        let db = Arc::new(
            Db::open_in_memory(
                suiteleaf_net::identity::ed25519::Keypair::generate(),
                node_schema(None).unwrap(),
            )
            .unwrap(),
        );
        let now = suitedb::hlc::iso_now();
        db.transact(|tx| {
            tx.upsert(
                "user",
                "sam",
                [
                    ("name", Value::from("Sam")),
                    ("email", Value::from("sam@gardenclub.org")),
                    ("banned", Value::Integer(0)),
                ],
            )?;
            tx.upsert(
                "session",
                "live",
                [
                    ("token", Value::from("live-token")),
                    ("userId", Value::from("sam")),
                    ("expiresAt", Value::from("2099-01-01T00:00:00.000Z")),
                    ("createdAt", Value::from(now.clone())),
                    ("updatedAt", Value::from(now.clone())),
                ],
            )?;
            tx.upsert(
                "session",
                "old",
                [
                    ("token", Value::from("old-token")),
                    ("userId", Value::from("sam")),
                    ("expiresAt", Value::from("2000-01-01T00:00:00.000Z")),
                    ("createdAt", Value::from("2000-01-01T00:00:00.000Z")),
                    ("updatedAt", Value::from("2000-01-01T00:00:00.000Z")),
                ],
            )?;
            tx.upsert(
                "session",
                "idle",
                [
                    ("token", Value::from("idle-token")),
                    ("userId", Value::from("sam")),
                    ("expiresAt", Value::from("2099-01-01T00:00:00.000Z")),
                    ("createdAt", Value::from("2000-01-01T00:00:00.000Z")),
                    ("updatedAt", Value::from("2000-01-01T00:00:00.000Z")),
                ],
            )
        })
        .unwrap();
        let auth = Auth::new(db.clone());
        assert_eq!(auth.user(&cookie("live-token")).unwrap().id, "sam");
        assert!(auth.user(&cookie("old-token")).is_none());
        assert_eq!(auth.user(&cookie("idle-token")).unwrap().id, "sam");
        auth.set_idle_limit(Some(Duration::from_secs(30 * 60)));
        assert!(auth.user(&cookie("idle-token")).is_none());
        assert_eq!(auth.user(&cookie("live-token")).unwrap().id, "sam");
        db.transact(|tx| tx.delete("session", "live")).unwrap();
        assert!(auth.user(&cookie("live-token")).is_none());
    }

    fn ed25519_pkcs8(seed: &[u8; 32]) -> Vec<u8> {
        let mut der = vec![
            0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22,
            0x04, 0x20,
        ];
        der.extend_from_slice(seed);
        der
    }

    #[test]
    fn a_reused_jwt_is_rejected_and_one_without_a_jti_still_works() {
        use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
        use jsonwebtoken::{EncodingKey, Header};

        let key = suiteleaf_net::identity::ed25519::Keypair::generate();
        let public = URL_SAFE_NO_PAD.encode(key.public().to_bytes());
        let seed: [u8; 32] = key.to_bytes()[..32].try_into().unwrap();
        let encoding = EncodingKey::from_ed_der(&ed25519_pkcs8(&seed));
        let db = Arc::new(
            Db::open_in_memory(
                suiteleaf_net::identity::ed25519::Keypair::generate(),
                node_schema(None).unwrap(),
            )
            .unwrap(),
        );
        db.transact(|tx| {
            tx.upsert(
                "jwks",
                "key-1",
                [(
                    "publicKey",
                    Value::from(format!(r#"{{"kty":"OKP","crv":"Ed25519","x":"{public}"}}"#)),
                )],
            )
        })
        .unwrap();
        let auth = Auth::new(db.clone());
        let exp = jsonwebtoken::get_current_timestamp() as i64 + 3600;
        let mut header = Header::new(jsonwebtoken::Algorithm::EdDSA);
        header.kid = Some("key-1".into());
        let once = jsonwebtoken::encode(
            &header,
            &serde_json::json!({
                "sub": "sam",
                "exp": exp,
                "iss": JWT_ISSUER,
                "aud": JWT_AUDIENCE,
                "jti": "bed-1",
            }),
            &encoding,
        )
        .unwrap();
        assert_eq!(auth.verify_jwt(&once).unwrap().id, "sam");
        assert!(
            auth.verify_jwt(&once)
                .unwrap_err()
                .to_string()
                .contains("replayed")
        );
        let again = jsonwebtoken::encode(
            &header,
            &serde_json::json!({
                "sub": "sam",
                "exp": exp,
                "iss": JWT_ISSUER,
                "aud": "other-app",
                "jti": "bed-2",
            }),
            &encoding,
        )
        .unwrap();
        assert!(auth.verify_jwt(&again).is_err());
        let plain = jsonwebtoken::encode(
            &header,
            &serde_json::json!({
                "sub": "sam",
                "exp": exp,
                "iss": JWT_ISSUER,
                "aud": JWT_AUDIENCE,
            }),
            &encoding,
        )
        .unwrap();
        assert_eq!(auth.verify_jwt(&plain).unwrap().id, "sam");
        assert_eq!(auth.verify_jwt(&plain).unwrap().id, "sam");

        db.transact(|tx| {
            tx.upsert(
                "account",
                "link-1",
                [
                    ("accountId", Value::from("ada")),
                    ("providerId", Value::from("oidc")),
                    ("userId", Value::from("sam")),
                ],
            )
        })
        .unwrap();
        let foreign = mint(&header, &encoding, exp, Some("bed-3"), Some("noor"));
        assert!(
            auth.verify_jwt(&foreign)
                .unwrap_err()
                .to_string()
                .contains("unsafe link")
        );
        assert!(
            auth.verify_jwt(&foreign)
                .unwrap_err()
                .to_string()
                .contains("unsafe link")
        );
        let same = mint(&header, &encoding, exp, Some("bed-4"), Some("ada"));
        assert_eq!(auth.verify_jwt(&same).unwrap().id, "sam");
    }

    #[test]
    fn an_emergency_code_opens_one_admin_session_and_the_audit_omits_it() {
        let auth = accounts();
        let code = "garden-emergency-code";
        let off = auth
            .emergency_sign_in("sam", code, "the issuer was wrong")
            .unwrap_err();
        assert!(off.to_string().contains("off"));
        auth.set_emergency_code(Some(code.to_owned()));
        auth.db
            .transact(|tx| {
                tx.upsert(
                    "user",
                    "sam",
                    [
                        ("name", Value::from("Sam Okafor")),
                        ("email", Value::from("sam@gardenclub.org")),
                        ("role", Value::from("admin")),
                        ("banned", Value::Integer(0)),
                    ],
                )?;
                tx.upsert(
                    "user",
                    "ada",
                    [
                        ("name", Value::from("Ada Banned")),
                        ("email", Value::from("ada-banned@gardenclub.org")),
                        ("role", Value::from("admin")),
                        ("banned", Value::Integer(1)),
                    ],
                )
            })
            .unwrap();
        let refused = auth
            .emergency_sign_in("priya", code, "the issuer was wrong")
            .unwrap_err();
        assert!(refused.to_string().contains("administrator"));
        let banned = auth
            .emergency_sign_in("ada", code, "the issuer was wrong")
            .unwrap_err();
        assert!(banned.to_string().contains("administrator"));
        let leaked = auth.emergency_sign_in("sam", code, code).unwrap_err();
        assert!(leaked.to_string().contains("reason"));
        let session = auth
            .emergency_sign_in("sam", code, "the issuer was wrong")
            .unwrap();
        assert_eq!(session.user.id, "sam");
        assert!(session.user.is_admin());
        assert_ne!(session.token, code);
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            format!("Bearer {}", session.token).parse().unwrap(),
        );
        assert_eq!(auth.user(&headers).unwrap().id, "sam");
        let rows = auth
            .db
            .query(
                "SELECT action, name FROM audit_event WHERE action = 'emergency.sign-in'",
                &[],
            )
            .unwrap();
        assert_eq!(rows.len(), 1);
        let name = match rows[0].get("name") {
            Some(Value::Text(text)) => text.clone(),
            _ => String::new(),
        };
        assert_eq!(name, "the issuer was wrong");
        assert!(!name.contains(code));
        let again = auth
            .emergency_sign_in("sam", code, "the issuer was wrong")
            .unwrap_err();
        assert!(again.to_string().contains("already used"));
        let still = auth
            .db
            .query(
                "SELECT id FROM audit_event WHERE action = 'emergency.sign-in'",
                &[],
            )
            .unwrap();
        assert_eq!(still.len(), 1);
    }

    #[test]
    fn a_rotated_jwt_key_is_rejected_and_the_current_key_still_signs() {
        use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
        use jsonwebtoken::{EncodingKey, Header};

        let old_key = suiteleaf_net::identity::ed25519::Keypair::generate();
        let new_key = suiteleaf_net::identity::ed25519::Keypair::generate();
        let public = |key: &suiteleaf_net::identity::ed25519::Keypair| {
            URL_SAFE_NO_PAD.encode(key.public().to_bytes())
        };
        let encoding = |key: &suiteleaf_net::identity::ed25519::Keypair| {
            let seed: [u8; 32] = key.to_bytes()[..32].try_into().unwrap();
            EncodingKey::from_ed_der(&ed25519_pkcs8(&seed))
        };
        let db = Arc::new(
            Db::open_in_memory(
                suiteleaf_net::identity::ed25519::Keypair::generate(),
                node_schema(None).unwrap(),
            )
            .unwrap(),
        );
        db.transact(|tx| {
            tx.upsert(
                "jwks",
                "key-old",
                [
                    (
                        "publicKey",
                        Value::from(format!(
                            r#"{{"kty":"OKP","crv":"Ed25519","x":"{}"}}"#,
                            public(&old_key)
                        )),
                    ),
                    ("privateKey", Value::from("secret-value")),
                    ("expiresAt", Value::from("2000-01-01T00:00:00.000Z")),
                ],
            )?;
            tx.upsert(
                "jwks",
                "key-new",
                [(
                    "publicKey",
                    Value::from(format!(
                        r#"{{"kty":"OKP","crv":"Ed25519","x":"{}"}}"#,
                        public(&new_key)
                    )),
                )],
            )
        })
        .unwrap();
        let auth = Auth::new(db);
        let exp = jsonwebtoken::get_current_timestamp() as i64 + 3600;
        let token = |kid: &str, jti: &str, key: &suiteleaf_net::identity::ed25519::Keypair| {
            let mut header = Header::new(jsonwebtoken::Algorithm::EdDSA);
            header.kid = Some(kid.into());
            jsonwebtoken::encode(
                &header,
                &serde_json::json!({
                    "sub": "sam",
                    "exp": exp,
                    "iss": JWT_ISSUER,
                    "aud": JWT_AUDIENCE,
                    "jti": jti,
                }),
                &encoding(key),
            )
            .unwrap()
        };
        let retired = auth
            .verify_jwt(&token("key-old", "old-1", &old_key))
            .unwrap_err();
        assert!(retired.to_string().contains("rotated"));
        assert!(!retired.to_string().contains("secret-value"));
        let again = auth
            .verify_jwt(&token("key-old", "old-2", &old_key))
            .unwrap_err();
        assert!(again.to_string().contains("rotated"));
        assert_eq!(
            auth.verify_jwt(&token("key-new", "new-1", &new_key))
                .unwrap()
                .id,
            "sam"
        );
    }

    #[test]
    fn an_email_outside_the_organization_domain_does_not_sign_in() {
        use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
        use jsonwebtoken::{EncodingKey, Header};

        let key = suiteleaf_net::identity::ed25519::Keypair::generate();
        let public = URL_SAFE_NO_PAD.encode(key.public().to_bytes());
        let seed: [u8; 32] = key.to_bytes()[..32].try_into().unwrap();
        let encoding = EncodingKey::from_ed_der(&ed25519_pkcs8(&seed));
        let db = Arc::new(
            Db::open_in_memory(
                suiteleaf_net::identity::ed25519::Keypair::generate(),
                node_schema(None).unwrap(),
            )
            .unwrap(),
        );
        db.transact(|tx| {
            tx.upsert(
                "jwks",
                "key-1",
                [(
                    "publicKey",
                    Value::from(format!(r#"{{"kty":"OKP","crv":"Ed25519","x":"{public}"}}"#)),
                )],
            )?;
            tx.upsert(
                "organization",
                "club",
                [("metadata", Value::from(r#"{"domains":["gardenclub.org"]}"#))],
            )?;
            tx.upsert(
                "user",
                "sam",
                [("email", Value::from("sam@gardenclub.org"))],
            )?;
            tx.upsert(
                "account",
                "link-1",
                [
                    ("accountId", Value::from("ada")),
                    ("providerId", Value::from("oidc")),
                    ("userId", Value::from("sam")),
                ],
            )
        })
        .unwrap();
        let auth = Auth::new(db.clone());
        let exp = jsonwebtoken::get_current_timestamp() as i64 + 3600;
        let mut header = Header::new(jsonwebtoken::Algorithm::EdDSA);
        header.kid = Some("key-1".into());
        let token = |email: &str, subject: &str, jti: &str| {
            jsonwebtoken::encode(
                &header,
                &serde_json::json!({
                    "sub": "sam",
                    "email": email,
                    "oidc_sub": subject,
                    "exp": exp,
                    "iss": JWT_ISSUER,
                    "aud": JWT_AUDIENCE,
                    "jti": jti,
                }),
                &encoding,
            )
            .unwrap()
        };
        let outside = auth
            .verify_jwt(&token("secret-value@other.example", "ada", "out-1"))
            .unwrap_err();
        assert!(outside.to_string().contains("email domain"));
        assert!(!outside.to_string().contains("secret-value"));
        let relink = auth
            .verify_jwt(&token("sam@gardenclub.org", "noor", "relink-1"))
            .unwrap_err();
        assert!(relink.to_string().contains("unsafe link"));
        assert_eq!(
            auth.verify_jwt(&token("sam@gardenclub.org", "ada", "ok-1"))
                .unwrap()
                .id,
            "sam"
        );
        let accounts = db.query("SELECT id FROM account", &[]).unwrap();
        assert_eq!(accounts.len(), 1);
    }

    #[test]
    fn an_organization_that_requires_mfa_rejects_a_token_without_it() {
        use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
        use jsonwebtoken::{EncodingKey, Header};

        let key = suiteleaf_net::identity::ed25519::Keypair::generate();
        let public = URL_SAFE_NO_PAD.encode(key.public().to_bytes());
        let seed: [u8; 32] = key.to_bytes()[..32].try_into().unwrap();
        let encoding = EncodingKey::from_ed_der(&ed25519_pkcs8(&seed));
        let db = Arc::new(
            Db::open_in_memory(
                suiteleaf_net::identity::ed25519::Keypair::generate(),
                node_schema(None).unwrap(),
            )
            .unwrap(),
        );
        db.transact(|tx| {
            tx.upsert(
                "jwks",
                "key-1",
                [(
                    "publicKey",
                    Value::from(format!(r#"{{"kty":"OKP","crv":"Ed25519","x":"{public}"}}"#)),
                )],
            )?;
            tx.upsert(
                "organization",
                "club",
                [("metadata", Value::from(r#"{"mfa":true}"#))],
            )?;
            tx.upsert(
                "user",
                "sam",
                [("email", Value::from("sam@gardenclub.org"))],
            )
        })
        .unwrap();
        let auth = Auth::new(db);
        let exp = jsonwebtoken::get_current_timestamp() as i64 + 3600;
        let mut header = Header::new(jsonwebtoken::Algorithm::EdDSA);
        header.kid = Some("key-1".into());
        let token = |amr: &[&str], jti: &str| {
            jsonwebtoken::encode(
                &header,
                &serde_json::json!({
                    "sub": "sam",
                    "exp": exp,
                    "iss": JWT_ISSUER,
                    "aud": JWT_AUDIENCE,
                    "jti": jti,
                    "amr": amr,
                }),
                &encoding,
            )
            .unwrap()
        };
        let missing = auth
            .verify_jwt(&token(&["pwd", "secret-value"], "bed-1"))
            .unwrap_err();
        assert!(missing.to_string().contains("second factor"));
        assert!(!missing.to_string().contains("secret-value"));
        assert_eq!(
            auth.verify_jwt(&token(&["mfa"], "bed-1")).unwrap().id,
            "sam"
        );
        let replayed = auth.verify_jwt(&token(&["mfa"], "bed-1")).unwrap_err();
        assert!(!replayed.to_string().contains("secret-value"));
    }

    #[test]
    fn a_person_lists_their_sessions_without_the_token_and_ends_one() {
        let auth = accounts();
        let fields = |token: &str, user: &str, agent: &str| {
            [
                ("expiresAt", Value::from("2026-10-31T20:00:00.000Z")),
                ("token", Value::from(token)),
                ("createdAt", Value::from("2026-10-31T18:00:00.000Z")),
                ("updatedAt", Value::from("2026-10-31T18:05:00.000Z")),
                ("ipAddress", Value::from("")),
                ("userAgent", Value::from(agent)),
                ("userId", Value::from(user)),
                ("impersonatedBy", Value::from("")),
                ("activeOrganizationId", Value::from("")),
            ]
        };
        auth.db
            .transact(|tx| {
                tx.upsert(
                    "session",
                    "sam-live",
                    fields("secret-value", "sam", "Garden browser"),
                )?;
                tx.upsert(
                    "session",
                    "sam-old",
                    fields("other-secret", "sam", "Old browser"),
                )?;
                tx.upsert(
                    "session",
                    "priya-live",
                    fields("priya-secret", "priya", "Priya browser"),
                )?;
                Ok(())
            })
            .unwrap();
        let listed = auth.list_sessions("sam", "secret-value").unwrap();
        let text = format!("{listed:?}");
        assert_eq!(listed.len(), 2);
        assert!(
            listed
                .iter()
                .any(|session| session.id == "sam-live" && session.current)
        );
        assert!(
            listed
                .iter()
                .any(|session| session.id == "sam-old" && !session.current)
        );
        assert!(text.contains("Garden browser"));
        assert!(!text.contains("secret"));
        assert!(!text.contains("Priya"));
        assert!(!auth.revoke_session("sam", "priya-live").unwrap());
        assert!(auth.db.get("session", "priya-live").unwrap().is_some());
        assert!(auth.revoke_session("sam", "sam-old").unwrap());
        let again = auth.list_sessions("sam", "secret-value").unwrap();
        assert_eq!(again.len(), 1);
        assert_eq!(again[0].id, "sam-live");
    }

    #[test]
    fn rotating_a_session_replaces_its_token_and_leaves_another_person_alone() {
        let auth = accounts();
        auth.db
            .transact(|tx| {
                tx.upsert(
                    "session",
                    "sam-live",
                    [
                        ("expiresAt", Value::from("2099-10-31T20:00:00.000Z")),
                        ("token", Value::from("secret-value")),
                        ("createdAt", Value::from("2026-10-31T18:00:00.000Z")),
                        ("updatedAt", Value::from("2026-10-31T18:05:00.000Z")),
                        ("ipAddress", Value::from("")),
                        ("userAgent", Value::from("Garden browser")),
                        ("userId", Value::from("sam")),
                        ("impersonatedBy", Value::from("")),
                        ("activeOrganizationId", Value::from("")),
                    ],
                )?;
                tx.upsert(
                    "session",
                    "priya-live",
                    [
                        ("expiresAt", Value::from("2099-10-31T20:00:00.000Z")),
                        ("token", Value::from("priya-secret")),
                        ("createdAt", Value::from("2026-10-31T18:00:00.000Z")),
                        ("updatedAt", Value::from("2026-10-31T18:05:00.000Z")),
                        ("ipAddress", Value::from("")),
                        ("userAgent", Value::from("Priya browser")),
                        ("userId", Value::from("priya")),
                        ("impersonatedBy", Value::from("")),
                        ("activeOrganizationId", Value::from("")),
                    ],
                )?;
                Ok(())
            })
            .unwrap();
        assert!(auth.rotate_session("sam", "priya-live").unwrap().is_none());
        assert!(auth.session_user("priya-secret").unwrap().is_some());
        let rotated = auth
            .rotate_session("sam", "sam-live")
            .unwrap()
            .expect("token");
        assert_ne!(rotated, "secret-value");
        assert!(auth.session_user("secret-value").unwrap().is_none());
        let signed_in = auth.session_user(&rotated).unwrap().expect("sam");
        assert_eq!(signed_in.id, "sam");
        let listed = auth.list_sessions("sam", "secret-value").unwrap();
        assert!(!listed[0].current);
        let current = auth.list_sessions("sam", &rotated).unwrap();
        assert!(current[0].current);
        assert!(!format!("{current:?}").contains(&rotated));
    }

    #[test]
    fn requiring_a_fresh_sign_in_stops_only_that_session() {
        let auth = accounts();
        auth.db
            .transact(|tx| {
                tx.upsert(
                    "session",
                    "sam-live",
                    [
                        ("expiresAt", Value::from("2099-10-31T20:00:00.000Z")),
                        ("token", Value::from("secret-value")),
                        ("createdAt", Value::from("2026-10-31T18:00:00.000Z")),
                        ("updatedAt", Value::from("2026-10-31T18:05:00.000Z")),
                        ("ipAddress", Value::from("")),
                        ("userAgent", Value::from("Garden browser")),
                        ("userId", Value::from("sam")),
                        ("impersonatedBy", Value::from("")),
                        ("activeOrganizationId", Value::from("")),
                    ],
                )?;
                tx.upsert(
                    "session",
                    "priya-live",
                    [
                        ("expiresAt", Value::from("2099-10-31T20:00:00.000Z")),
                        ("token", Value::from("priya-secret")),
                        ("createdAt", Value::from("2026-10-31T18:00:00.000Z")),
                        ("updatedAt", Value::from("2026-10-31T18:05:00.000Z")),
                        ("ipAddress", Value::from("")),
                        ("userAgent", Value::from("Priya browser")),
                        ("userId", Value::from("priya")),
                        ("impersonatedBy", Value::from("")),
                        ("activeOrganizationId", Value::from("")),
                    ],
                )?;
                Ok(())
            })
            .unwrap();
        assert!(!auth.require_reauth("sam", "priya-live").unwrap());
        assert!(auth.session_user("priya-secret").unwrap().is_some());
        assert!(!auth.require_reauth("sam", "missing-session").unwrap());
        assert!(auth.require_reauth("sam", "sam-live").unwrap());
        assert!(auth.session_user("secret-value").unwrap().is_none());
        assert!(auth.db.get("session", "sam-live").unwrap().is_some());
        assert!(auth.session_user("priya-secret").unwrap().is_some());
    }

    #[test]
    fn a_lost_device_signs_out_only_that_persons_matching_session() {
        let auth = accounts();
        auth.db
            .transact(|tx| {
                tx.upsert(
                    "session",
                    "sam-garden",
                    [
                        ("expiresAt", Value::from("2099-10-31T20:00:00.000Z")),
                        ("token", Value::from("garden-token")),
                        ("createdAt", Value::from("2026-10-31T18:00:00.000Z")),
                        ("updatedAt", Value::from("2026-10-31T18:05:00.000Z")),
                        ("ipAddress", Value::from("")),
                        ("userAgent", Value::from("Garden browser")),
                        ("userId", Value::from("sam")),
                        ("impersonatedBy", Value::from("")),
                        ("activeOrganizationId", Value::from("")),
                    ],
                )?;
                tx.upsert(
                    "session",
                    "sam-phone",
                    [
                        ("expiresAt", Value::from("2099-10-31T20:00:00.000Z")),
                        ("token", Value::from("phone-token")),
                        ("createdAt", Value::from("2026-10-31T18:00:00.000Z")),
                        ("updatedAt", Value::from("2026-10-31T18:05:00.000Z")),
                        ("ipAddress", Value::from("")),
                        ("userAgent", Value::from("Lost phone")),
                        ("userId", Value::from("sam")),
                        ("impersonatedBy", Value::from("")),
                        ("activeOrganizationId", Value::from("")),
                    ],
                )?;
                tx.upsert(
                    "session",
                    "priya-phone",
                    [
                        ("expiresAt", Value::from("2099-10-31T20:00:00.000Z")),
                        ("token", Value::from("priya-token")),
                        ("createdAt", Value::from("2026-10-31T18:00:00.000Z")),
                        ("updatedAt", Value::from("2026-10-31T18:05:00.000Z")),
                        ("ipAddress", Value::from("")),
                        ("userAgent", Value::from("Lost phone")),
                        ("userId", Value::from("priya")),
                        ("impersonatedBy", Value::from("")),
                        ("activeOrganizationId", Value::from("")),
                    ],
                )?;
                Ok(())
            })
            .unwrap();
        let missed = auth.revoke_lost_device("sam", "secret-value").unwrap();
        assert_eq!(missed, 0);
        assert!(!format!("{missed}").contains("secret-value"));
        assert_eq!(
            auth.revoke_lost_device("sam", "  ")
                .unwrap_err()
                .to_string(),
            "Name the device to sign out."
        );
        assert_eq!(auth.revoke_lost_device("sam", "Lost phone").unwrap(), 1);
        assert!(auth.session_user("phone-token").unwrap().is_none());
        assert!(auth.session_user("garden-token").unwrap().is_some());
        assert!(auth.session_user("priya-token").unwrap().is_some());
    }

    fn mint(
        header: &jsonwebtoken::Header,
        encoding: &jsonwebtoken::EncodingKey,
        exp: i64,
        jti: Option<&str>,
        oidc_sub: Option<&str>,
    ) -> String {
        let mut claims = serde_json::json!({
            "sub": "sam",
            "exp": exp,
            "iss": JWT_ISSUER,
            "aud": JWT_AUDIENCE,
        });
        if let Some(jti) = jti {
            claims["jti"] = serde_json::json!(jti);
        }
        if let Some(oidc_sub) = oidc_sub {
            claims["oidc_sub"] = serde_json::json!(oidc_sub);
        }
        jsonwebtoken::encode(header, &claims, encoding).unwrap()
    }
}
