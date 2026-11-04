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

/// Seal only `identity.key` and `swarm.key`. A file backup is not accepted.
/// The swarm key is not included in an error.
pub fn seal_node_identity(data_dir: &Path, key: &[u8], dest: &Path) -> Result<()> {
    let identity = fs::read(data_dir.join(IDENTITY_FILE))
        .map_err(|_| anyhow::anyhow!("The node identity is missing."))?;
    let swarm = fs::read(data_dir.join(SWARM_KEY_FILE))
        .map_err(|_| anyhow::anyhow!("The swarm key is missing."))?;
    if data_dir.join("database.sqlite").exists() || data_dir.join("blobs").exists() {
        bail!("A node identity backup is not a file backup.");
    }
    let scratch = dest.with_extension("identity-plain");
    if scratch.exists() {
        fs::remove_dir_all(&scratch)?;
    }
    fs::create_dir_all(&scratch)?;
    let sealed = (|| -> Result<()> {
        fs::write(scratch.join(IDENTITY_FILE), &identity)?;
        fs::write(scratch.join(SWARM_KEY_FILE), &swarm)?;
        suitedrive::seal::seal_backup(&scratch, key, dest)?;
        Ok(())
    })();
    let _ = fs::remove_dir_all(&scratch);
    sealed
}

/// Copy the two key files out of a live data directory and seal them.
/// The live directory also holds the database and blobs, so it is not sealed itself.
pub fn seal_running_identity(data_dir: &Path, key: &[u8], dest: &Path) -> Result<()> {
    let scratch = dest.with_extension("identity-src");
    if scratch.exists() {
        fs::remove_dir_all(&scratch)?;
    }
    fs::create_dir_all(&scratch)?;
    let outcome = (|| -> Result<()> {
        fs::copy(data_dir.join(IDENTITY_FILE), scratch.join(IDENTITY_FILE))?;
        fs::copy(data_dir.join(SWARM_KEY_FILE), scratch.join(SWARM_KEY_FILE))?;
        seal_node_identity(&scratch, key, dest)?;
        let check = dest.with_extension("identity-check");
        if check.exists() {
            fs::remove_dir_all(&check)?;
        }
        open_node_identity(dest, key, &check)?;
        let _ = fs::remove_dir_all(&check);
        Ok(())
    })();
    let _ = fs::remove_dir_all(&scratch);
    outcome
}

/// Open a node identity backup. A wrong key leaves no directory.
pub fn open_node_identity(sealed: &Path, key: &[u8], dest: &Path) -> Result<()> {
    suitedrive::seal::open_sealed_files(sealed, key, dest)?;
    let names = fs::read_dir(dest)?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    let allowed = names.len() == 2
        && names.iter().any(|name| name == IDENTITY_FILE)
        && names.iter().any(|name| name == SWARM_KEY_FILE);
    if !allowed {
        let _ = fs::remove_dir_all(dest);
        bail!("That identity backup has extra files.");
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_node_identity_seals_without_the_file_backup() {
        let root = tempfile::tempdir().unwrap();
        let data = root.path().join("data");
        fs::create_dir_all(&data).unwrap();
        fs::write(data.join(IDENTITY_FILE), b"identity-bytes").unwrap();
        fs::write(data.join(SWARM_KEY_FILE), b"swarm-secret-line\n").unwrap();
        let sealed = root.path().join("identity.seal");
        let key = [4u8; 32];
        seal_node_identity(&data, &key, &sealed).unwrap();
        let opened = root.path().join("opened");
        open_node_identity(&sealed, &key, &opened).unwrap();
        assert_eq!(
            fs::read(opened.join(IDENTITY_FILE)).unwrap(),
            b"identity-bytes"
        );
        assert_eq!(
            fs::read(opened.join(SWARM_KEY_FILE)).unwrap(),
            b"swarm-secret-line\n"
        );
        assert!(!opened.join("database.sqlite").exists());
        let wrong = root.path().join("wrong");
        let error = open_node_identity(&sealed, &[9u8; 32], &wrong).unwrap_err();
        assert!(!error.to_string().contains("swarm-secret-line"));
        assert!(!wrong.exists());
        let short = seal_node_identity(&data, b"secret-value", &root.path().join("short.seal"))
            .unwrap_err()
            .to_string();
        assert_eq!(short, "The backup key must be 32 bytes.");
        assert!(!short.contains("secret-value"));
        fs::write(data.join("database.sqlite"), b"secret-value").unwrap();
        let mixed = seal_node_identity(&data, &key, &root.path().join("mixed.seal"))
            .unwrap_err()
            .to_string();
        assert_eq!(mixed, "A node identity backup is not a file backup.");
        assert!(!mixed.contains("secret-value"));
        assert!(!root.path().join("mixed.seal").exists());
        let live = root.path().join("live.seal");
        seal_running_identity(&data, &key, &live).unwrap();
        let again = root.path().join("again");
        open_node_identity(&live, &key, &again).unwrap();
        assert_eq!(
            fs::read(again.join(IDENTITY_FILE)).unwrap(),
            b"identity-bytes"
        );
        assert!(!again.join("database.sqlite").exists());
        assert!(
            !format!("{:?}", fs::read_dir(&again).unwrap().collect::<Vec<_>>())
                .contains("secret-value")
        );
    }
}
