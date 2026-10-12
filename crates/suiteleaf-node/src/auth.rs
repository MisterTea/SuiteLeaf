//! Authentication: supervises the better-auth sidecar, proxies `/api/auth/*`
//! to it, and resolves request identities from replicated SuiteDB tables.
//!
//! Any node can authenticate any request without the sidecar: bearer JWTs are
//! verified against the replicated `jwks` public keys, and session tokens
//! (bearer or cookie) are looked up in the replicated `session` table.

use std::{
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

use crate::config::Config;

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
    client: reqwest::Client,
}

impl Auth {
    pub fn new(db: Arc<Db>) -> Self {
        Auth {
            db,
            sidecar: Arc::default(),
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .expect("HTTP client"),
        }
    }

    pub fn set_sidecar(&self, url: Option<String>) {
        *self.sidecar.write().unwrap() = url;
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
            "SELECT u.id, u.email, u.name, u.role, u.banned FROM session s JOIN user u ON u.id = s.userId
             WHERE s.token = ?1 AND s.expiresAt > ?2
               AND s.id NOT IN (SELECT loser FROM _conflicts WHERE tbl = 'session')
             LIMIT 1",
            &[Value::Text(token.into()), Value::Text(now)],
        )?;
        Ok(rows.into_iter().next().and_then(user_from_row))
    }

    fn verify_jwt(&self, token: &str) -> Result<AuthUser> {
        let kid = jsonwebtoken::decode_header(token)?
            .kid
            .ok_or_else(|| anyhow!("JWT has no key ID"))?;
        let row = self
            .db
            .get("jwks", &kid)?
            .ok_or_else(|| anyhow!("unknown JWT key {kid}"))?;
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
        Ok(AuthUser {
            id: claims.sub,
            email: claims.email,
            name: claims.name,
            role: claims.role,
        })
    }
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
    email: Option<String>,
    name: Option<String>,
    role: Option<String>,
    banned: Option<bool>,
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
    use super::*;

    #[test]
    fn decodes_percent_encoded_cookie_values() {
        assert_eq!(percent_decode("abc.def%3D"), "abc.def=");
        assert_eq!(percent_decode("100%"), "100%");
    }
}
