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
) -> Result<Option<u64>> {
    let decision = crate::backup::backup_due(last, every_hours, now)?;
    if !decision.due {
        return Ok(None);
    }
    if let Err(error) = crate::backup::export_backup(source, contents, now, backup) {
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

fn seal_stamp(now: &str) -> Option<String> {
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

pub struct ScheduledSeal {
    pub wrote: bool,
    pub reason: String,
}

/// Seal a due backup and record that time for the next check.
/// A schedule that is not due writes nothing. The reason does not include the key or a path.
pub fn scheduled_seal(
    source: &crate::blobs::BlobStore,
    contents: &[crate::blobs::Hash],
    freshness: &Path,
    every_hours: &str,
    now: &str,
    key: &[u8],
    sealed: &Path,
    independent: &Path,
) -> Result<ScheduledSeal> {
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
    let sealed = next_seal_path(sealed, now)?;
    let independent = next_seal_path(independent, now)?;
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
mod tests {
    use super::*;
    use crate::backup::export_backup;
    use crate::blobs::BlobStore;

    #[test]
    fn a_wrong_key_or_a_changed_byte_writes_nothing() {
        let root = tempfile::tempdir().unwrap();
        let source = BlobStore::open(&root.path().join("live")).unwrap();
        let content = source.put_content(b"sealed bed").unwrap();
        let backup = root.path().join("backup");
        export_backup(&source, &[content], "2026-10-30T22:00:00.000Z", &backup).unwrap();
        let key = [7u8; 32];
        let sealed = root.path().join("off-cluster.seal");
        seal_backup(&backup, &key, &sealed).unwrap();
        let opened = root.path().join("opened");
        let manifest = open_sealed(&sealed, &key, &opened).unwrap();
        assert!(manifest.contents.contains(&content.to_string()));
        let store = BlobStore::open(&opened.join("blobs")).unwrap();
        assert_eq!(store.get_content(&content).unwrap().unwrap(), b"sealed bed");

        let wrong = root.path().join("wrong");
        let error = open_sealed(&sealed, &[9u8; 32], &wrong).unwrap_err();
        assert!(error.to_string().contains("key"));
        assert!(!wrong.exists());

        let mut changed = fs::read(&sealed).unwrap();
        let last = changed.len() - 1;
        changed[last] ^= 0xff;
        let tampered = root.path().join("tampered.seal");
        fs::write(&tampered, changed).unwrap();
        let dest = root.path().join("tampered-out");
        assert!(open_sealed(&tampered, &key, &dest).is_err());
        assert!(!dest.exists());

        let named = root.path().join("secret-value.seal");
        seal_backup(&backup, &key, &named).unwrap();
        let again = seal_backup(&backup, &key, &named).unwrap_err().to_string();
        assert_eq!(again, "That sealed backup already exists.");
        assert!(!again.contains("secret-value"));
        assert!(!again.contains("070707"));
    }

    #[test]
    fn a_sealed_file_is_kept_only_in_a_different_directory_when_the_key_opens_it() {
        let root = tempfile::tempdir().unwrap();
        let source = BlobStore::open(&root.path().join("live")).unwrap();
        let content = source.put_content(b"offsite bed").unwrap();
        let backup = root.path().join("backup");
        export_backup(&source, &[content], "2026-10-30T22:00:00.000Z", &backup).unwrap();
        let key = [4u8; 32];
        let sealed = root.path().join("cluster.seal");
        seal_backup(&backup, &key, &sealed).unwrap();

        let beside = root.path().join("still-here.seal");
        assert!(store_sealed(&sealed, &key, &beside).is_err());
        assert!(!beside.exists());

        let vault = tempfile::tempdir().unwrap();
        let stored = vault.path().join("copy.seal");
        let bytes = store_sealed(&sealed, &key, &stored).unwrap();
        assert_eq!(bytes, fs::metadata(&stored).unwrap().len());
        let opened = vault.path().join("opened");
        let manifest = open_sealed(&stored, &key, &opened).unwrap();
        assert!(manifest.contents.contains(&content.to_string()));

        let rejected = vault.path().join("rejected.seal");
        assert!(store_sealed(&sealed, &[1u8; 32], &rejected).is_err());
        assert!(!rejected.exists());
    }

    #[test]
    fn a_partial_copy_resumes_and_a_different_file_is_left_alone() {
        let root = tempfile::tempdir().unwrap();
        let source = BlobStore::open(&root.path().join("live")).unwrap();
        let content = source.put_content(b"resume bed").unwrap();
        let backup = root.path().join("backup");
        export_backup(&source, &[content], "2026-10-30T22:00:00.000Z", &backup).unwrap();
        let key = [5u8; 32];
        let sealed = root.path().join("cluster.seal");
        seal_backup(&backup, &key, &sealed).unwrap();
        let total = fs::metadata(&sealed).unwrap().len();
        assert!(total > 16);

        let beside = root.path().join("partial.seal");
        assert!(resume_sealed_copy(&sealed, &key, &beside, 16).is_err());
        assert!(!beside.exists());

        let vault = tempfile::tempdir().unwrap();
        let stored = vault.path().join("copy.seal");
        let partial = resume_sealed_copy(&sealed, &key, &stored, 16).unwrap();
        assert!(!partial.complete);
        assert_eq!(partial.copied, 16);
        assert_eq!(partial.total, total);
        assert!(open_sealed(&stored, &key, &vault.path().join("early")).is_err());

        let other = vault.path().join("other.seal");
        fs::write(&other, b"other-bytes").unwrap();
        let mismatch = resume_sealed_copy(&sealed, &key, &other, total).unwrap_err();
        assert!(mismatch.to_string().contains("does not match"));
        assert_eq!(fs::read(&other).unwrap(), b"other-bytes");

        let finished = resume_sealed_copy(&sealed, &key, &stored, total).unwrap();
        assert!(finished.complete);
        assert_eq!(finished.copied, total);
        let opened = vault.path().join("opened");
        let manifest = open_sealed(&stored, &key, &opened).unwrap();
        assert!(manifest.contents.contains(&content.to_string()));
        assert_eq!(
            BlobStore::open(&opened.join("blobs"))
                .unwrap()
                .get_content(&content)
                .unwrap()
                .unwrap(),
            b"resume bed"
        );

        let wrong = vault.path().join("wrong.seal");
        let error = resume_sealed_copy(&sealed, &[1u8; 32], &wrong, total).unwrap_err();
        assert!(error.to_string().contains("key"));
        assert!(!wrong.exists());
    }

    #[test]
    fn a_due_schedule_seals_a_backup_and_an_early_one_does_not() {
        let root = tempfile::tempdir().unwrap();
        let source = BlobStore::open(&root.path().join("live")).unwrap();
        let content = source.put_content(b"keep this").unwrap();
        let key = [7u8; 32];
        let early = export_sealed_if_due(
            &source,
            &[content],
            Some("2026-11-01T00:00:00.000Z"),
            24,
            "2026-11-01T12:00:00.000Z",
            &root.path().join("early-plain"),
            &key,
            &root.path().join("sealed").join("early.seal"),
            &root.path().join("away").join("early.seal"),
        )
        .unwrap();
        assert!(early.is_none());
        assert!(!root.path().join("early-plain").exists());
        assert!(!root.path().join("sealed").join("early.seal").exists());
        let bytes = export_sealed_if_due(
            &source,
            &[content],
            Some("2026-11-01T00:00:00.000Z"),
            24,
            "2026-11-02T00:00:00.000Z",
            &root.path().join("plain"),
            &key,
            &root.path().join("sealed").join("backup.seal"),
            &root.path().join("away").join("backup.seal"),
        )
        .unwrap()
        .unwrap();
        assert!(bytes > 0);
        assert!(!root.path().join("plain").exists());
        let opened = root.path().join("opened");
        let manifest =
            open_sealed(&root.path().join("away").join("backup.seal"), &key, &opened).unwrap();
        assert_eq!(manifest.recorded_at, "2026-11-02T00:00:00.000Z");
        assert_eq!(
            BlobStore::open(&opened.join("blobs"))
                .unwrap()
                .get_content(&content)
                .unwrap()
                .unwrap(),
            b"keep this"
        );
        let bad = export_sealed_if_due(
            &source,
            &[content],
            None,
            24,
            "2026-11-02T00:00:00.000Z",
            &root.path().join("bad-plain"),
            b"secret-value",
            &root.path().join("sealed").join("bad.seal"),
            &root.path().join("away").join("bad.seal"),
        )
        .unwrap_err()
        .to_string();
        assert_eq!(bad, "The backup key must be 32 bytes.");
        assert!(!bad.contains("secret-value"));
        assert!(!root.path().join("bad-plain").exists());
        assert!(!root.path().join("away").join("bad.seal").exists());
    }

    #[test]
    fn a_scheduled_seal_records_the_time_and_skips_the_next_check() {
        let root = tempfile::tempdir().unwrap();
        let source = BlobStore::open(&root.path().join("live")).unwrap();
        let content = source.put_content(b"keep this").unwrap();
        let key = [7u8; 32];
        let first = scheduled_seal(
            &source,
            &[content],
            &root.path().join("fresh"),
            "24",
            "2026-11-02T00:00:00.000Z",
            &key,
            &root.path().join("sealed").join("backup.seal"),
            &root.path().join("away").join("backup.seal"),
        )
        .unwrap();
        assert!(first.wrote);
        assert_eq!(first.reason, "No backup has been recorded.");
        let opened = root.path().join("opened");
        let manifest =
            open_sealed(&root.path().join("away").join("backup.seal"), &key, &opened).unwrap();
        assert_eq!(manifest.recorded_at, "2026-11-02T00:00:00.000Z");
        assert_eq!(
            BlobStore::open(&opened.join("blobs"))
                .unwrap()
                .get_content(&content)
                .unwrap()
                .unwrap(),
            b"keep this"
        );
        let second = scheduled_seal(
            &source,
            &[content],
            &root.path().join("fresh"),
            "24",
            "2026-11-02T12:00:00.000Z",
            b"secret-value",
            &root.path().join("sealed").join("again.seal"),
            &root.path().join("away").join("again.seal"),
        )
        .unwrap();
        assert!(!second.wrote);
        assert_eq!(
            second.reason,
            "The last backup is still inside the schedule."
        );
        assert!(!second.reason.contains("secret-value"));
        assert!(!root.path().join("away").join("again.seal").exists());
    }

    #[test]
    fn a_later_due_seal_keeps_the_earlier_copy() {
        let root = tempfile::tempdir().unwrap();
        let source = BlobStore::open(&root.path().join("live")).unwrap();
        let first_content = source.put_content(b"keep this").unwrap();
        let key = [7u8; 32];
        let sealed = root.path().join("sealed").join("backup.seal");
        let copy = root.path().join("away").join("backup.seal");
        scheduled_seal(
            &source,
            &[first_content],
            &root.path().join("fresh"),
            "24",
            "2026-11-02T00:00:00.000Z",
            &key,
            &sealed,
            &copy,
        )
        .unwrap();
        let later = source.put_content(b"north bed").unwrap();
        let second = scheduled_seal(
            &source,
            &[later],
            &root.path().join("fresh"),
            "24",
            "2026-11-03T00:00:00.000Z",
            &key,
            &sealed,
            &copy,
        )
        .unwrap();
        assert!(second.wrote);
        assert_eq!(second.reason, "A backup is due.");
        assert!(!second.reason.contains("secret-value"));
        let next = root.path().join("away").join("backup.seal-20261103000000");
        assert!(next.is_file());
        assert!(copy.is_file());
        let opened = root.path().join("opened-first");
        open_sealed(&copy, &key, &opened).unwrap();
        assert_eq!(
            BlobStore::open(&opened.join("blobs"))
                .unwrap()
                .get_content(&first_content)
                .unwrap()
                .unwrap(),
            b"keep this"
        );
        let opened_later = root.path().join("opened-later");
        open_sealed(&next, &key, &opened_later).unwrap();
        assert_eq!(
            BlobStore::open(&opened_later.join("blobs"))
                .unwrap()
                .get_content(&later)
                .unwrap()
                .unwrap(),
            b"north bed"
        );
    }
}
