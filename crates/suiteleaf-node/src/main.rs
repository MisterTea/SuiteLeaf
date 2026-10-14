mod admin_api;
mod auth;
mod collab;
mod config;
mod drive_api;
mod http;
mod internal;
mod keys;
mod replication;
mod schema;

use std::{collections::HashSet, net::SocketAddr, path::PathBuf, sync::Arc, time::Duration};

use anyhow::{Context, Result};
use clap::{Args, Parser, Subcommand};
use suitedb::{Db, sync::OPS_TOPIC};
use suitedrive::Drive;
use suiteleaf_net::{Multiaddr, NetConfig, parse_swarm_key};
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

use crate::{
    auth::Auth,
    config::Config,
    drive_api::NetTransport,
    http::AppState,
    replication::{BlobService, Replicator},
};

#[derive(Parser)]
#[command(name = "suiteleaf-node", version, about = "Run a SuiteLeaf node")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Create an identity and a new cluster swarm key in a data directory.
    Init {
        #[arg(long, default_value = "suiteleaf-data")]
        data_dir: PathBuf,
        /// Join an existing cluster by copying its swarm.key instead.
        #[arg(long)]
        swarm_key: Option<PathBuf>,
    },
    /// Start the node.
    Run(Box<RunArgs>),
    /// Print this node's libp2p peer ID.
    PeerId {
        #[arg(long, default_value = "suiteleaf-data")]
        data_dir: PathBuf,
    },
}

#[derive(Args)]
struct RunArgs {
    #[arg(long, env = "SUITELEAF_CONFIG")]
    config: Option<PathBuf>,
    #[arg(long)]
    data_dir: Option<PathBuf>,
    #[arg(long)]
    http: Option<SocketAddr>,
    #[arg(long)]
    public_url: Option<String>,
    #[arg(long)]
    listen: Vec<Multiaddr>,
    #[arg(long)]
    bootstrap: Vec<Multiaddr>,
    #[arg(long)]
    web_root: Option<PathBuf>,
    #[arg(long)]
    cors_origin: Vec<String>,
    #[arg(long)]
    mdns: bool,
    #[arg(long)]
    no_auth: bool,
    /// Proxy to an auth sidecar that is already running.
    #[arg(long)]
    auth_url: Option<String>,
    #[arg(long)]
    auth_schema: Option<PathBuf>,
    /// The token the auth sidecar presents to the internal API.
    #[arg(long, env = "SUITELEAF_INTERNAL_TOKEN", hide_env_values = true)]
    internal_token: Option<String>,
    #[arg(long)]
    sync_interval: Option<u64>,
    /// Create the identity and swarm key if they are missing.
    #[arg(long)]
    init: bool,
}

impl RunArgs {
    fn config(&self) -> Result<Config> {
        let mut config = Config::load(self.config.as_deref())?;
        if let Some(d) = &self.data_dir {
            config.data_dir = d.clone();
        }
        if let Some(h) = self.http {
            config.http_addr = h;
        }
        if let Some(u) = &self.public_url {
            config.public_url = Some(u.clone());
        }
        if !self.listen.is_empty() {
            config.listen = self.listen.clone();
        }
        config.bootstrap.extend(self.bootstrap.iter().cloned());
        config.cors_origins.extend(self.cors_origin.iter().cloned());
        if let Some(w) = &self.web_root {
            config.web_root = Some(w.clone());
        }
        config.mdns |= self.mdns;
        if self.no_auth {
            config.auth.enabled = false;
        }
        if let Some(u) = &self.auth_url {
            config.auth.url = Some(u.clone());
        }
        if let Some(s) = &self.auth_schema {
            config.auth.schema = Some(s.clone());
        }
        if let Some(i) = self.sync_interval {
            config.sync_interval_secs = i;
        }
        Ok(config)
    }
}

struct DriveBlobs(Arc<Drive>);

impl BlobService for DriveBlobs {
    fn handle(&self, request: Vec<u8>) -> Vec<u8> {
        self.0.handle_blob_request(&request)
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,libp2p=warn".into()),
        )
        .with_writer(std::io::stderr)
        .init();
    match Cli::parse().command {
        Command::Init {
            data_dir,
            swarm_key,
        } => {
            std::fs::create_dir_all(&data_dir)?;
            let key = keys::load_or_create_identity(&data_dir)?;
            match swarm_key {
                Some(src) => {
                    parse_swarm_key(&std::fs::read_to_string(&src)?)?;
                    std::fs::copy(&src, data_dir.join(keys::SWARM_KEY_FILE))?;
                }
                None => keys::create_swarm_key(&data_dir)?,
            }
            println!("{}", key.public().to_peer_id());
            Ok(())
        }
        Command::PeerId { data_dir } => {
            println!(
                "{}",
                keys::load_or_create_identity(&data_dir)?
                    .public()
                    .to_peer_id()
            );
            Ok(())
        }
        Command::Run(args) => {
            let token = args.internal_token.clone();
            run(args.config()?, args.init, token).await
        }
    }
}

async fn run(config: Config, init: bool, internal_token: Option<String>) -> Result<()> {
    std::fs::create_dir_all(&config.data_dir)?;
    let identity = keys::load_or_create_identity(&config.data_dir)?;
    if init && !config.data_dir.join(keys::SWARM_KEY_FILE).exists() {
        keys::create_swarm_key(&config.data_dir)?;
    }
    let swarm_key = parse_swarm_key(&keys::load_swarm_key(&config.data_dir)?)?;
    let peer_id = identity.public().to_peer_id();

    let schema = schema::node_schema(config.auth.schema.as_deref())?;
    let db = Arc::new(
        Db::open(
            &config.data_dir.join("suitedb.sqlite"),
            keys::ed25519(&identity)?,
            schema,
        )
        .context("open SuiteDB")?,
    );
    let allowlist: Option<HashSet<_>> = (!config.allowlist.is_empty())
        .then(|| config.allowlist.iter().copied().chain([peer_id]).collect());
    db.set_allowlist(allowlist.clone());
    let drive = Drive::open(db.clone(), &config.data_dir.join("blobs"))?;
    admin_api::ensure_an_admin(&db).context("choose an admin")?;

    let (net, events) = suiteleaf_net::start(NetConfig {
        keypair: identity,
        swarm_key,
        listen: config.listen.clone(),
        bootstrap: config.bootstrap.clone(),
        allowlist,
        mdns: config.mdns,
        topics: vec![OPS_TOPIC.into()],
    })?;
    let interval = Duration::from_secs(config.sync_interval_secs.max(1));
    let replicator = Replicator::new(db.clone(), net.clone());
    tokio::spawn(replicator.run(events, Some(Arc::new(DriveBlobs(drive.clone()))), interval));
    tokio::spawn(
        drive
            .clone()
            .replicate(Arc::new(NetTransport(net.clone())), interval),
    );

    let internal_token =
        internal_token.unwrap_or_else(|| hex::encode(uuid::Uuid::new_v4().as_bytes()));
    let internal = TcpListener::bind("127.0.0.1:0").await?;
    let internal_url = format!("http://{}", internal.local_addr()?);
    let internal_router = internal::router(internal::InternalState {
        db: db.clone(),
        token: Arc::new(internal_token.clone()),
    });
    tokio::spawn(async move { axum::serve(internal, internal_router).await });

    let config = Arc::new(config);
    let auth = Auth::new(db.clone());
    if config.auth.enabled {
        match &config.auth.url {
            Some(url) => auth.set_sidecar(Some(url.trim_end_matches('/').to_owned())),
            None => auth::supervise(
                auth.clone(),
                config.clone(),
                internal_url.clone(),
                internal_token,
            )?,
        }
    }
    let state = AppState {
        db: db.clone(),
        net: net.clone(),
        config: config.clone(),
        auth,
        drive: drive.clone(),
        rooms: crate::collab::Rooms::new(db.clone(), drive.clone()),
    };
    let app = http::router(state.clone());
    let rooms = state.rooms.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(30));
        let pause = std::env::var("SUITELEAF_IDLE_MS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(crate::collab::IDLE_MS);
        loop {
            tick.tick().await;
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            let _ = rooms.kick(now, pause);
        }
    });
    let listener = TcpListener::bind(config.http_addr)
        .await
        .with_context(|| format!("bind {}", config.http_addr))?;
    let http_addr = listener.local_addr()?;
    tokio::time::sleep(Duration::from_millis(100)).await;
    let p2p = net.listen_addrs().await;
    println!(
        "SUITELEAF_NODE_READY {}",
        serde_json::json!({
            "http": format!("http://{http_addr}"),
            "peerId": peer_id.to_string(),
            "p2p": p2p.iter().map(|a| format!("{a}/p2p/{peer_id}")).collect::<Vec<_>>(),
            "internal": internal_url,
        })
    );
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;
    Ok(())
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = term.recv() => {}
        }
    }
    #[cfg(not(unix))]
    let _ = tokio::signal::ctrl_c().await;
}
