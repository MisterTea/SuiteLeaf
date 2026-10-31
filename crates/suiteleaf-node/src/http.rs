use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, State},
    http::{HeaderName, HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{any, get},
};
use serde_json::json;
use suitedb::Db;
use suitedrive::Drive;
use suiteleaf_net::NetHandle;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    services::{ServeDir, ServeFile},
};

use crate::{ai_local::LocalAi, auth::Auth, collab::Rooms, config::Config};

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Db>,
    pub net: NetHandle,
    pub config: Arc<Config>,
    pub auth: Auth,
    pub drive: Arc<Drive>,
    pub rooms: Rooms,
    pub local: LocalAi,
}

impl FromRef<AppState> for Auth {
    fn from_ref(state: &AppState) -> Auth {
        state.auth.clone()
    }
}

async fn health() -> &'static str {
    "ok"
}

async fn info(State(state): State<AppState>) -> Json<serde_json::Value> {
    let db = state.db.clone();
    let drive = state.drive.clone();
    let (ops, pending, heads, wanted) = tokio::task::spawn_blocking(move || {
        (
            db.op_count().unwrap_or(0),
            db.pending_count().unwrap_or(0),
            db.heads()
                .map(|h| h.iter().map(ToString::to_string).collect::<Vec<_>>())
                .unwrap_or_default(),
            drive.wanted().len(),
        )
    })
    .await
    .unwrap_or_default();
    let peers: Vec<String> = state
        .net
        .peers()
        .await
        .iter()
        .map(ToString::to_string)
        .collect();
    let listen: Vec<String> = state
        .net
        .listen_addrs()
        .await
        .iter()
        .map(ToString::to_string)
        .collect();
    Json(json!({
        "name": "SuiteLeaf node",
        "mode": "cluster",
        "version": env!("CARGO_PKG_VERSION"),
        "peerId": state.net.local_peer_id().to_string(),
        "publicUrl": state.config.public_url(),
        "listen": listen,
        "peers": peers,
        "auth": { "enabled": state.auth.sidecar().is_some() },
        "suitedb": { "schema": state.db.schema().version, "ops": ops, "pending": pending, "heads": heads },
        "suitedrive": { "replicating": wanted },
    }))
}

pub fn cors(config: &Config) -> CorsLayer {
    let mut origins: Vec<HeaderValue> = config
        .cors_origins
        .iter()
        .chain(std::iter::once(&config.public_url()))
        .filter_map(|o| o.trim_end_matches('/').parse().ok())
        .collect();
    origins.dedup();
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_credentials(true)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::IF_MATCH,
        ])
        .expose_headers([
            header::ETAG,
            HeaderName::from_static("set-auth-token"),
            HeaderName::from_static("set-auth-jwt"),
        ])
}

/// The web app at `/sign-up/:token`. A `<base href="/">` keeps the built
/// assets, which are relative, loading from the site root.
async fn sign_up_shell(State(state): State<AppState>) -> Response {
    let Some(root) = state.config.web_root.clone() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(html) = tokio::fs::read_to_string(root.join("index.html")).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let html = match html.find("<head>") {
        Some(at) => {
            let mut out = String::with_capacity(html.len() + 24);
            out.push_str(&html[..at + "<head>".len()]);
            out.push_str("<base href=\"/\">");
            out.push_str(&html[at + "<head>".len()..]);
            out
        }
        None => html,
    };
    (
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        html,
    )
        .into_response()
}

pub fn router(state: AppState) -> Router {
    let auth = state.auth.clone();
    let config = state.config.clone();
    let api = Router::new()
        .route("/healthz", get(health))
        .route("/api/node/info", get(info))
        .route("/sign-up/{token}", get(sign_up_shell))
        .with_state(state.clone())
        .merge(crate::drive_api::router(state.clone()))
        .merge(crate::admin_api::router(state.clone()))
        .merge(crate::ai_api::router(state))
        .merge(
            Router::new()
                .route("/api/auth/{*rest}", any(crate::auth::proxy))
                .with_state(auth),
        );
    let api = match &config.web_root {
        Some(root) => api.fallback_service(
            ServeDir::new(root).fallback(ServeFile::new(root.join("index.html"))),
        ),
        None => api,
    };
    api.layer(cors(&config))
}
