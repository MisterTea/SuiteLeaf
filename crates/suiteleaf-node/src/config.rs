use std::{collections::BTreeMap, net::SocketAddr, path::PathBuf};

use anyhow::{Context, Result};
use serde::Deserialize;
use suiteleaf_net::{Multiaddr, PeerId};

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    /// Holds `identity.key`, `swarm.key`, `suitedb.sqlite`, and `blobs/`.
    pub data_dir: PathBuf,
    /// The public HTTP listener for the web app and APIs.
    pub http_addr: SocketAddr,
    /// The URL browsers use to reach this node; OAuth callbacks are built from it.
    pub public_url: Option<String>,
    /// libp2p listen addresses.
    pub listen: Vec<Multiaddr>,
    /// Peers to keep connected, as `/ip4/…/tcp/…/p2p/<peer id>`.
    pub bootstrap: Vec<Multiaddr>,
    /// When non-empty, only these peers may connect or author ops.
    pub allowlist: Vec<PeerId>,
    pub mdns: bool,
    /// A built SuiteLeaf web app (`apps/web/dist`) to serve at `/`.
    pub web_root: Option<PathBuf>,
    /// Extra origins allowed to call the API with bearer tokens.
    pub cors_origins: Vec<String>,
    pub sync_interval_secs: u64,
    pub auth: AuthConfig,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct AuthConfig {
    pub enabled: bool,
    /// Command that starts the better-auth sidecar.
    pub command: Vec<String>,
    /// Use a sidecar started by someone else (for example the desktop app)
    /// instead of running `command`.
    pub url: Option<String>,
    /// A generated auth schema to use instead of the built-in one.
    pub schema: Option<PathBuf>,
    /// Shared by every node in the cluster; `SUITELEAF_AUTH_SECRET` overrides it.
    pub secret: Option<String>,
    /// Extra environment for the sidecar, such as OAuth client IDs.
    pub env: BTreeMap<String, String>,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            data_dir: PathBuf::from("suiteleaf-data"),
            http_addr: "127.0.0.1:8787".parse().unwrap(),
            public_url: None,
            listen: vec!["/ip4/0.0.0.0/tcp/4001".parse().unwrap()],
            bootstrap: vec![],
            allowlist: vec![],
            mdns: false,
            web_root: None,
            cors_origins: vec!["suiteleaf://app".into()],
            sync_interval_secs: 30,
            auth: AuthConfig::default(),
        }
    }
}

impl Default for AuthConfig {
    fn default() -> Self {
        AuthConfig {
            enabled: true,
            command: vec!["node".into(), "services/auth/dist/server.mjs".into()],
            url: None,
            schema: None,
            secret: None,
            env: BTreeMap::new(),
        }
    }
}

impl Config {
    pub fn load(path: Option<&std::path::Path>) -> Result<Config> {
        match path {
            Some(p) => {
                let text =
                    std::fs::read_to_string(p).with_context(|| format!("read {}", p.display()))?;
                toml::from_str(&text).with_context(|| format!("parse {}", p.display()))
            }
            None => Ok(Config::default()),
        }
    }

    pub fn public_url(&self) -> String {
        self.public_url
            .clone()
            .unwrap_or_else(|| format!("http://{}", self.http_addr))
            .trim_end_matches('/')
            .to_owned()
    }
}
