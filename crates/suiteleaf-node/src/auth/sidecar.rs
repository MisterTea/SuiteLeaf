//! The better-auth sidecar: starting it, and proxying `/api/auth/*` to it.

use std::{net::SocketAddr, process::Stdio, sync::Arc, time::Duration};

use anyhow::{Context, Result, bail};
use axum::{
    body::Body,
    extract::{ConnectInfo, Request, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
};

use crate::config::Config;

use super::Auth;

impl Auth {
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
        let registration_key = self
            .registration_key
            .read()
            .unwrap()
            .clone()
            .unwrap_or_default();
        let response = self
            .client
            .post(format!("{base}{path}"))
            .header(header::AUTHORIZATION, authorization)
            .header(header::CONTENT_TYPE, "application/json")
            .header(crate::cloud::REGISTRATION_HEADER, registration_key)
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
        .unwrap_or("/")
        .to_owned();
    let url = format!("{base}{path}");
    let method = req.method().clone();
    let mut headers = reqwest::header::HeaderMap::new();
    for (name, value) in req.headers() {
        if !HOP_HEADERS.contains(&name.as_str())
            && name.as_str() != crate::cloud::REGISTRATION_HEADER
        {
            headers.append(name.clone(), value.clone());
        }
    }
    headers.insert("x-forwarded-for", peer.ip().to_string().parse().unwrap());
    let body = match axum::body::to_bytes(req.into_body(), 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return StatusCode::PAYLOAD_TOO_LARGE.into_response(),
    };
    let registration = if auth.db.is_postgres() && path.starts_with("/api/auth/sign-up/") {
        match crate::cloud::registration(&auth.db, &headers, &body) {
            Ok(Some(digest)) => {
                let Some(key) = auth.registration_key.read().unwrap().clone() else {
                    return StatusCode::SERVICE_UNAVAILABLE.into_response();
                };
                headers.insert(crate::cloud::REGISTRATION_HEADER, key.parse().unwrap());
                Some(digest)
            }
            _ => {
                return (
                    StatusCode::FORBIDDEN,
                    "An invitation is required to create an account.",
                )
                    .into_response();
            }
        }
    } else {
        None
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
    if upstream.status().is_success()
        && let Some(digest) = registration
        && auth
            .db
            .transact(|tx| tx.delete("cloud_invite", &digest))
            .is_err()
    {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
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
    if config.cloud {
        *auth.registration_key.write().unwrap() = Some(internal_token.clone());
    }
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
                .env(
                    "SUITELEAF_AUTH_PORT",
                    if config.cloud {
                        std::env::var("SUITELEAF_CLOUD_BRIDGE_PORT")
                            .unwrap_or_else(|_| "41235".into())
                    } else {
                        "0".into()
                    },
                )
                .env("SUITELEAF_CLOUD", if config.cloud { "1" } else { "0" })
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
