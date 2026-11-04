//! An encrypted copy of a backup directory for storage away from the cluster.
//!
//! The caller supplies a 32-byte key. This is not a passphrase and it is not
//! end-to-end encryption of documents on the node. A wrong key writes nothing.

use std::{fs, path::Path};

use anyhow::{Context, Result, bail};
use chacha20poly1305::{
    ChaCha20Poly1305, KeyInit, Nonce,
    aead::{Aead, Payload},
};
use rand::{RngCore, rngs::OsRng};

use crate::backup::{BackupManifest, verify_backup};

mod retain;

const MAGIC: &[u8] = b"SLSEAL1\0";
const AAD: &[u8] = b"SLSEAL1";

/// Encrypt `backup` into a new file at `dest`.
pub fn seal_backup(backup: &Path, key: &[u8], dest: &Path) -> Result<()> {
    let key = key_bytes(key)?;
    if dest.exists() {
        bail!("That sealed backup already exists.");
    }
    let files = files_in(backup)?;
    let plain = pack(&files);
    let cipher = ChaCha20Poly1305::new((&key).into());
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &plain,
                aad: AAD,
            },
        )
        .map_err(|_| anyhow::anyhow!("backup seal failed"))?;
    let mut out = Vec::with_capacity(MAGIC.len() + nonce.len() + ciphertext.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = dest.with_extension("seal.tmp");
    fs::write(&tmp, out)?;
    fs::rename(tmp, dest)?;
    Ok(())
}

/// Copy a sealed backup into a different directory and open that copy with the key.
/// The copy is removed if it does not match the sealed file or the key does not open it.
/// This does not write into a live blob store, and it does not upload to a remote service.
pub fn store_sealed(sealed: &Path, key: &[u8], dest: &Path) -> Result<u64> {
    if !sealed.is_file() {
        bail!("sealed backup is missing");
    }
    if dest.exists() {
        bail!("That independent copy already exists.");
    }
    let sealed_dir = fs::canonicalize(sealed.parent().context("sealed file has no directory")?)?;
    let dest_parent = dest
        .parent()
        .context("independent copy needs a directory")?;
    fs::create_dir_all(dest_parent)?;
    let dest_parent = fs::canonicalize(dest_parent)?;
    if dest_parent == sealed_dir || dest_parent.starts_with(&sealed_dir) {
        bail!("The independent copy must be outside the sealed file's directory.");
    }
    let bytes = fs::read(sealed).context("read sealed backup")?;
    let tmp = dest.with_extension("copy.tmp");
    fs::write(&tmp, &bytes)?;
    fs::rename(&tmp, dest)?;
    let copied = fs::read(dest).context("read independent copy")?;
    if copied != bytes {
        let _ = fs::remove_file(dest);
        bail!("The independent copy does not match the sealed file.");
    }
    let check = dest.with_extension("check");
    let opened = open_sealed(dest, key, &check);
    let _ = fs::remove_dir_all(&check);
    if let Err(error) = opened {
        let _ = fs::remove_file(dest);
        return Err(error);
    }
    Ok(u64::try_from(bytes.len()).unwrap_or(u64::MAX))
}

/// Write, seal, and copy a backup only when the schedule says one is due.
/// The plaintext directory is removed after the sealed file is written.
/// A schedule that is not due leaves no directory and no sealed file.
#[allow(clippy::too_many_arguments)]
pub fn export_sealed_if_due(
    source: &crate::blobs::BlobStore,
    contents: &[crate::blobs::Hash],
    last: Option<&str>,
    every_hours: u32,
    now: &str,
    backup: &Path,
    key: &[u8],
    sealed: &Path,
    independent: &Path,
    database: Option<&suitedb::Db>,
) -> Result<Option<u64>> {
    let decision = crate::backup::backup_due(last, every_hours, now)?;
    if !decision.due {
        return Ok(None);
    }
    let exported = if let Some(database) = database {
        crate::backup::export_backup_from_database(source, contents, now, backup, database)
    } else {
        crate::backup::export_backup(source, contents, now, backup)
    };
    if let Err(error) = exported {
        let _ = fs::remove_dir_all(backup);
        return Err(error);
    }
    if let Err(error) = seal_backup(backup, key, sealed) {
        let _ = fs::remove_dir_all(backup);
        let _ = fs::remove_file(sealed);
        return Err(error);
    }
    let _ = fs::remove_dir_all(backup);
    match store_sealed(sealed, key, independent) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) => {
            let _ = fs::remove_file(sealed);
            let _ = fs::remove_file(independent);
            Err(error)
        }
    }
}

fn drill_database(backup: &Path, schema: &suitedb::Schema) -> Result<crate::backup::CleanRestore> {
    use crate::blobs::BlobStore;
    use libp2p_identity::ed25519;
    use suitedb::Db;

    let copy = backup.join(".database-copy.sqlite");
    fs::copy(backup.join("database.sqlite"), &copy)?;
    let archive = Db::open(&copy, ed25519::Keypair::generate(), schema.clone())?;
    let scratch = backup.join(".drill-db");
    if scratch.exists() {
        fs::remove_dir_all(&scratch)?;
    }
    fs::create_dir_all(&scratch)?;
    let live = Db::open(
        &scratch.join("db.sqlite"),
        ed25519::Keypair::generate(),
        schema.clone(),
    )?;
    let blobs = BlobStore::open(&scratch.join("blobs"))?;
    let restored = crate::backup::restore_clean(backup, &archive, &live, &blobs);
    let _ = fs::remove_dir_all(&scratch);
    let _ = fs::remove_file(&copy);
    restored
}

pub(crate) fn seal_stamp(now: &str) -> Option<String> {
    let bytes = now.as_bytes();
    if bytes.len() < 20
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || !now.ends_with('Z')
    {
        return None;
    }
    let digits: String = now
        .chars()
        .filter(|c| c.is_ascii_digit())
        .take(14)
        .collect();
    (digits.len() == 14).then_some(digits)
}

/// Keep an earlier sealed file. The next due copy uses the time's digits, not the raw clock text.
fn next_seal_path(path: &Path, now: &str) -> Result<std::path::PathBuf> {
    if !path.exists() {
        return Ok(path.to_path_buf());
    }
    let Some(stamp) = seal_stamp(now) else {
        bail!("The current time is not a time.");
    };
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("backup.seal");
    let next = path.with_file_name(format!("{name}-{stamp}"));
    if next.exists() {
        bail!("That sealed backup already exists.");
    }
    Ok(next)
}

#[derive(Debug)]
pub struct ScheduledSeal {
    pub wrote: bool,
    pub reason: String,
}

/// Seal a due backup and record that time for the next check.
/// A schedule that is not due writes nothing. The reason does not include the key or a path.
#[allow(clippy::too_many_arguments)]
pub fn scheduled_seal(
    source: &crate::blobs::BlobStore,
    contents: &[crate::blobs::Hash],
    freshness: &Path,
    every_hours: &str,
    now: &str,
    key: &[u8],
    sealed: &Path,
    independent: &Path,
    database: Option<&suitedb::Db>,
) -> Result<ScheduledSeal> {
    let schema = database.map(|db| db.schema().clone());
    let keep_copies = retain::retention_count(freshness)?;
    let sealed_name = sealed;
    let independent_name = independent;
    let recorded = if freshness.join("manifest.json").is_file() {
        match crate::backup::backup_freshness(freshness) {
            Ok(report) => report.recorded_at,
            Err(_) => bail!("The last backup time is not a time."),
        }
    } else {
        String::new()
    };
    let decision = crate::backup::schedule_note(&recorded, every_hours, now)?;
    if !decision.due {
        return Ok(ScheduledSeal {
            wrote: false,
            reason: decision.reason,
        });
    }
    let plain = sealed.with_file_name("scheduled-plain");
    let hours: u32 = every_hours
        .trim()
        .parse()
        .map_err(|_| anyhow::anyhow!("The backup schedule must be from 1 to 168 hours."))?;
    let last = if recorded.is_empty() {
        None
    } else {
        Some(recorded.as_str())
    };
    let sealed = next_seal_path(sealed_name, now)?;
    let independent = next_seal_path(independent_name, now)?;
    let written = match export_sealed_if_due(
        source,
        contents,
        last,
        hours,
        now,
        &plain,
        key,
        &sealed,
        &independent,
        database,
    ) {
        Ok(written) => written,
        Err(error) => {
            let _ = fs::remove_dir_all(&plain);
            return Err(error);
        }
    };
    if written.is_none() {
        return Ok(ScheduledSeal {
            wrote: false,
            reason: decision.reason,
        });
    }
    fs::create_dir_all(freshness)?;
    let manifest = BackupManifest {
        kind: crate::backup::BACKUP_KIND.to_owned(),
        version: crate::backup::BACKUP_VERSION,
        recorded_at: now.to_owned(),
        contents: contents.iter().map(|hash| hash.to_string()).collect(),
        blobs: Vec::new(),
        database_sha256: None,
        parent: None,
    };
    fs::write(
        freshness.join("manifest.json"),
        serde_json::to_vec(&manifest)?,
    )?;
    let plain = freshness.join(".scheduled-drill");
    if plain.exists() {
        fs::remove_dir_all(&plain)?;
    }
    open_sealed(&sealed, key, &plain)
        .map_err(|_| anyhow::anyhow!("The restore drill did not pass."))?;
    let drill = crate::backup::record_restore_drill(&plain, now)
        .map_err(|_| anyhow::anyhow!("The restore drill did not pass."))?;
    if plain.join("database.sqlite").is_file() {
        let Some(schema) = schema.as_ref() else {
            anyhow::bail!("The restore drill did not pass.");
        };
        drill_database(&plain, schema)
            .map_err(|_| anyhow::anyhow!("The restore drill did not pass."))?;
    }
    fs::write(freshness.join("drill.json"), serde_json::to_vec(&drill)?)?;
    fs::remove_dir_all(&plain)?;
    if let Some(count) = keep_copies {
        retain::retain_sealed_copies(sealed_name, now, count)?;
        retain::retain_sealed_copies(independent_name, now, count)?;
    }
    Ok(ScheduledSeal {
        wrote: true,
        reason: decision.reason,
    })
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CopyProgress {
    pub copied: u64,
    pub total: u64,
    pub complete: bool,
}

/// Copy up to `limit` more bytes of a sealed backup into a different directory.
/// A later call continues when the destination is a prefix of the sealed file.
/// A destination that is not that prefix is left unchanged.
/// The key is checked only when every byte has been copied. A wrong key removes
/// that finished copy. A partial copy is not opened.
/// This does not upload to a remote service.
pub fn resume_sealed_copy(
    sealed: &Path,
    key: &[u8],
    dest: &Path,
    limit: u64,
) -> Result<CopyProgress> {
    independent_directory(sealed, dest)?;
    let source = fs::read(sealed).context("read sealed backup")?;
    let total = u64::try_from(source.len()).unwrap_or(u64::MAX);
    let existing = if dest.is_file() {
        fs::read(dest).context("read independent copy")?
    } else if dest.exists() {
        bail!("That independent copy is not a file.");
    } else {
        Vec::new()
    };
    if existing.len() > source.len() || existing.as_slice() != &source[..existing.len()] {
        bail!("The independent copy does not match the sealed file.");
    }
    let have = existing.len();
    let room = source.len() - have;
    let step = usize::try_from(limit).unwrap_or(usize::MAX).min(room);
    if step > 0 {
        let mut next = existing;
        next.extend_from_slice(&source[have..have + step]);
        let tmp = dest.with_extension("copy.tmp");
        fs::write(&tmp, &next)?;
        fs::rename(&tmp, dest)?;
    }
    let copied = u64::try_from(have + step).unwrap_or(u64::MAX);
    if copied < total {
        return Ok(CopyProgress {
            copied,
            total,
            complete: false,
        });
    }
    let check = dest.with_extension("check");
    let opened = open_sealed(dest, key, &check);
    let _ = fs::remove_dir_all(&check);
    if let Err(error) = opened {
        let _ = fs::remove_file(dest);
        return Err(error);
    }
    Ok(CopyProgress {
        copied: total,
        total,
        complete: true,
    })
}

fn independent_directory(sealed: &Path, dest: &Path) -> Result<()> {
    if !sealed.is_file() {
        bail!("sealed backup is missing");
    }
    let sealed_dir = fs::canonicalize(sealed.parent().context("sealed file has no directory")?)?;
    let dest_parent = dest
        .parent()
        .context("independent copy needs a directory")?;
    fs::create_dir_all(dest_parent)?;
    let dest_parent = fs::canonicalize(dest_parent)?;
    if dest_parent == sealed_dir || dest_parent.starts_with(&sealed_dir) {
        bail!("The independent copy must be outside the sealed file's directory.");
    }
    Ok(())
}

/// Decrypt `sealed` into a new directory and check it as a backup.
/// A wrong key or a changed byte leaves no directory.
pub fn open_sealed(sealed: &Path, key: &[u8], dest: &Path) -> Result<BackupManifest> {
    let key = key_bytes(key)?;
    if dest.exists() {
        bail!("That backup destination already exists.");
    }
    let bytes = fs::read(sealed).context("read sealed backup")?;
    if bytes.len() < MAGIC.len() + 12 + 16 || &bytes[..MAGIC.len()] != MAGIC {
        bail!("sealed backup header is not recognized");
    }
    let nonce = &bytes[MAGIC.len()..MAGIC.len() + 12];
    let ciphertext = &bytes[MAGIC.len() + 12..];
    let cipher = ChaCha20Poly1305::new((&key).into());
    let plain = cipher
        .decrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad: AAD,
            },
        )
        .map_err(|_| anyhow::anyhow!("The backup key does not open this archive."))?;
    let files = unpack(&plain)?;
    let wrote = (|| -> Result<()> {
        fs::create_dir_all(dest)?;
        for (path, body) in &files {
            let full = dest.join(path);
            if let Some(parent) = full.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(full, body)?;
        }
        verify_backup(dest)?;
        Ok(())
    })();
    if let Err(error) = wrote {
        let _ = fs::remove_dir_all(dest);
        return Err(error);
    }
    verify_backup(dest)
}

/// Decrypt a sealed directory that is not a SuiteLeaf file backup.
/// A wrong key leaves no directory. A path that leaves the destination is refused.
pub fn open_sealed_files(sealed: &Path, key: &[u8], dest: &Path) -> Result<()> {
    let key = key_bytes(key)?;
    if dest.exists() {
        bail!("That backup destination already exists.");
    }
    let bytes = fs::read(sealed).context("read sealed backup")?;
    if bytes.len() < MAGIC.len() + 12 + 16 || &bytes[..MAGIC.len()] != MAGIC {
        bail!("sealed backup header is not recognized");
    }
    let nonce = &bytes[MAGIC.len()..MAGIC.len() + 12];
    let ciphertext = &bytes[MAGIC.len() + 12..];
    let cipher = ChaCha20Poly1305::new((&key).into());
    let plain = cipher
        .decrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad: AAD,
            },
        )
        .map_err(|_| anyhow::anyhow!("The backup key does not open this archive."))?;
    let files = unpack(&plain)?;
    for (path, _) in &files {
        if path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        {
            bail!("That identity backup has extra files.");
        }
    }
    let wrote = (|| -> Result<()> {
        fs::create_dir_all(dest)?;
        for (path, body) in &files {
            fs::write(dest.join(path), body)?;
        }
        Ok(())
    })();
    if let Err(error) = wrote {
        let _ = fs::remove_dir_all(dest);
        return Err(error);
    }
    Ok(())
}

fn key_bytes(key: &[u8]) -> Result<[u8; 32]> {
    let bytes: [u8; 32] = key
        .try_into()
        .map_err(|_| anyhow::anyhow!("The backup key must be 32 bytes."))?;
    Ok(bytes)
}

fn files_in(root: &Path) -> Result<Vec<(String, Vec<u8>)>> {
    let mut out = Vec::new();
    walk(root, root, &mut out)?;
    out.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(out)
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) -> Result<()> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir).with_context(|| format!("read {}", dir.display()))? {
        let path = entry?.path();
        if path.file_name().and_then(|name| name.to_str()) == Some(".drill") {
            continue;
        }
        if path.is_dir() {
            walk(root, &path, out)?;
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .context("backup path")?
            .to_string_lossy()
            .replace('\\', "/");
        if relative.ends_with(".tmp") {
            continue;
        }
        out.push((relative, fs::read(&path)?));
    }
    Ok(())
}

fn pack(files: &[(String, Vec<u8>)]) -> Vec<u8> {
    let mut out = Vec::new();
    for (path, bytes) in files {
        let path_bytes = path.as_bytes();
        out.extend_from_slice(&(path_bytes.len() as u32).to_le_bytes());
        out.extend_from_slice(path_bytes);
        out.extend_from_slice(&(bytes.len() as u64).to_le_bytes());
        out.extend_from_slice(bytes);
    }
    out
}

fn unpack(mut plain: &[u8]) -> Result<Vec<(String, Vec<u8>)>> {
    let mut files = Vec::new();
    while !plain.is_empty() {
        if plain.len() < 4 {
            bail!("sealed backup is truncated");
        }
        let path_len = u32::from_le_bytes(plain[..4].try_into().unwrap()) as usize;
        plain = &plain[4..];
        if plain.len() < path_len + 8 {
            bail!("sealed backup is truncated");
        }
        let path = std::str::from_utf8(&plain[..path_len]).context("sealed path")?;
        if path.is_empty() || path.starts_with('/') || path.split('/').any(|part| part == "..") {
            bail!("sealed backup path is not allowed");
        }
        plain = &plain[path_len..];
        let size = u64::from_le_bytes(plain[..8].try_into().unwrap()) as usize;
        plain = &plain[8..];
        if plain.len() < size {
            bail!("sealed backup is truncated");
        }
        files.push((path.to_owned(), plain[..size].to_vec()));
        plain = &plain[size..];
    }
    Ok(files)
}

#[cfg(test)]
mod tests;
