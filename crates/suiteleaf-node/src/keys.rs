use std::{fs, io::Write, path::Path};

use anyhow::{Context, Result, bail};
use suiteleaf_net::{generate_swarm_key, identity};

pub const IDENTITY_FILE: &str = "identity.key";
pub const SWARM_KEY_FILE: &str = "swarm.key";

fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut file = options
        .open(path)
        .with_context(|| format!("create {}", path.display()))?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

/// Load this node's Ed25519 identity, creating it on first start.
pub fn load_or_create_identity(dir: &Path) -> Result<identity::Keypair> {
    let path = dir.join(IDENTITY_FILE);
    if path.exists() {
        let bytes = fs::read(&path)?;
        return identity::Keypair::from_protobuf_encoding(&bytes)
            .with_context(|| format!("decode {}", path.display()));
    }
    let key = identity::Keypair::generate_ed25519();
    write_private(&path, &key.to_protobuf_encoding()?)?;
    Ok(key)
}

pub fn ed25519(key: &identity::Keypair) -> Result<identity::ed25519::Keypair> {
    Ok(key.clone().try_into_ed25519()?)
}

/// Write a new cluster key. Every node in a cluster needs the same file.
pub fn create_swarm_key(dir: &Path) -> Result<()> {
    write_private(&dir.join(SWARM_KEY_FILE), generate_swarm_key().as_bytes())
}

pub fn load_swarm_key(dir: &Path) -> Result<String> {
    let path = dir.join(SWARM_KEY_FILE);
    if !path.exists() {
        bail!(
            "{} is missing. Run `suiteleaf-node init` for a new cluster, or copy swarm.key from an existing node.",
            path.display()
        );
    }
    Ok(fs::read_to_string(path)?)
}
