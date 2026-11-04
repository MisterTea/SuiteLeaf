//! Writing a backup archive, and checking it before anything is restored from it.

use std::{collections::BTreeSet, fs, path::Path};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

use crate::blobs::{BlobStore, Hash, Manifest};

use super::schedule::backup_due;

pub const BACKUP_KIND: &str = "suiteleaf-backup";

pub const BACKUP_VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub kind: String,
    pub version: u32,
    pub recorded_at: String,
    /// Content-manifest hashes named by file versions.
    pub contents: Vec<String>,
    /// Every blob file in this archive, including manifests and chunks.
    pub blobs: Vec<String>,
    /// BLAKE3 of `database.sqlite` when this archive includes a SuiteDB copy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database_sha256: Option<String>,
    /// BLAKE3 of the previous archive's `manifest.json`. Absent on a full copy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RestorePlan {
    pub blobs: usize,
    pub dry_run: bool,
}

/// Copy `contents` into `dest` when every chunk is already in `source`.
/// An incomplete set leaves no directory behind.
pub fn export_backup(
    source: &BlobStore,
    contents: &[Hash],
    recorded_at: &str,
    dest: &Path,
) -> Result<BackupManifest> {
    if dest.exists() {
        bail!("That backup destination already exists.");
    }
    let mut blobs = BTreeSet::new();
    for content in contents {
        let missing = source.missing(content)?;
        if !missing.is_empty() {
            bail!("That backup is incomplete.");
        }
        blobs.insert(*content);
        let encoded = source
            .get(content)?
            .context("That backup content cannot be read.")?;
        let manifest = Manifest::decode(&encoded)?;
        blobs.extend(manifest.chunks);
    }
    let archive = BlobStore::open(&dest.join("blobs"))?;
    let result = (|| -> Result<BackupManifest> {
        for hash in &blobs {
            let bytes = source.get(hash)?.context("That backup blob is missing.")?;
            archive.put_verified(hash, &bytes)?;
        }
        let manifest = BackupManifest {
            kind: BACKUP_KIND.to_owned(),
            version: BACKUP_VERSION,
            recorded_at: recorded_at.to_owned(),
            contents: contents.iter().map(|hash| hash.to_string()).collect(),
            blobs: blobs.iter().map(|hash| hash.to_string()).collect(),
            database_sha256: None,
            parent: None,
        };
        let body = serde_json::to_vec_pretty(&manifest)?;
        let tmp = dest.join("manifest.json.tmp");
        fs::write(&tmp, body)?;
        fs::rename(tmp, dest.join("manifest.json"))?;
        Ok(manifest)
    })();
    if let Err(error) = result {
        let _ = fs::remove_dir_all(dest);
        return Err(error);
    }
    result
}

/// Write a backup only when the schedule says one is due.
/// A backup that is still inside the schedule leaves no directory.
pub fn export_if_due(
    source: &BlobStore,
    contents: &[Hash],
    last: Option<&str>,
    every_hours: u32,
    now: &str,
    dest: &Path,
) -> Result<Option<BackupManifest>> {
    let decision = backup_due(last, every_hours, now)?;
    if !decision.due {
        return Ok(None);
    }
    Ok(Some(export_backup(source, contents, now, dest)?))
}

/// Same as [`export_backup`], plus a SuiteDB copy at `database.sqlite`.
/// The hash is written into the manifest only after the file is on disk.
pub fn export_backup_with_database(
    source: &BlobStore,
    contents: &[Hash],
    recorded_at: &str,
    dest: &Path,
    database: &[u8],
) -> Result<BackupManifest> {
    let mut manifest = export_backup(source, contents, recorded_at, dest)?;
    let hash = Hash::of(database).to_string();
    let result = (|| -> Result<BackupManifest> {
        fs::write(dest.join("database.sqlite"), database)?;
        manifest.database_sha256 = Some(hash);
        let body = serde_json::to_vec_pretty(&manifest)?;
        let tmp = dest.join("manifest.json.tmp");
        fs::write(&tmp, body)?;
        fs::rename(tmp, dest.join("manifest.json"))?;
        Ok(manifest)
    })();
    if let Err(error) = result {
        let _ = fs::remove_dir_all(dest);
        return Err(error);
    }
    result
}

/// Checkpoint `database` and store that snapshot as `database.sqlite`.
/// A later write to the live database is not in this archive.
pub fn export_backup_from_database(
    source: &BlobStore,
    contents: &[Hash],
    recorded_at: &str,
    dest: &Path,
    database: &suitedb::Db,
) -> Result<BackupManifest> {
    let scratch = dest.with_extension("checkpoint");
    let copied = (|| -> Result<Vec<u8>> {
        database.checkpoint_copy(&scratch)?;
        let bytes = fs::read(&scratch).context("read checkpoint")?;
        Ok(bytes)
    })();
    let _ = fs::remove_file(&scratch);
    let bytes = copied?;
    export_backup_with_database(source, contents, recorded_at, dest, &bytes)
}

/// Check the archive. A missing or altered blob is an error, and this function
/// does not write.
pub fn verify_backup(dest: &Path) -> Result<BackupManifest> {
    let bytes = fs::read(dest.join("manifest.json")).context("read backup manifest")?;
    let manifest: BackupManifest = serde_json::from_slice(&bytes).context("backup manifest")?;
    if manifest.kind != BACKUP_KIND || manifest.version != BACKUP_VERSION {
        bail!("That backup is not a SuiteLeaf backup.");
    }
    if manifest.parent.is_some() {
        bail!("backup chain gap");
    }
    let store = BlobStore::open(&dest.join("blobs"))?;
    for hex in &manifest.blobs {
        let hash: Hash = hex.parse().context("That backup blob id cannot be read.")?;
        let Some(body) = store.get(&hash)? else {
            bail!("That backup is incomplete.");
        };
        if Hash::of(&body) != hash {
            bail!("That backup blob is corrupt.");
        }
    }
    for hex in &manifest.contents {
        let hash: Hash = hex
            .parse()
            .context("That backup content id cannot be read.")?;
        let missing = store.missing(&hash)?;
        if !missing.is_empty() {
            bail!("That backup is incomplete.");
        }
    }
    if let Some(expected) = &manifest.database_sha256 {
        let stored = fs::read(dest.join("database.sqlite")).context("read backup database")?;
        if Hash::of(&stored).to_string() != *expected {
            bail!("corrupt backup database");
        }
    }
    Ok(manifest)
}

/// Copy verified blobs into `live`. Verification runs first, so a bad archive
/// does not change `live`. `dry_run` reports the plan and writes nothing.
pub fn restore_blobs(backup: &Path, live: &BlobStore, dry_run: bool) -> Result<RestorePlan> {
    let manifest = verify_backup(backup)?;
    let plan = RestorePlan {
        blobs: manifest.blobs.len(),
        dry_run,
    };
    if dry_run {
        return Ok(plan);
    }
    let source = BlobStore::open(&backup.join("blobs"))?;
    for hex in &manifest.blobs {
        let hash: Hash = hex.parse()?;
        let bytes = source.get(&hash)?.context("backup blob")?;
        live.put_verified(&hash, &bytes)?;
    }
    Ok(RestorePlan {
        dry_run: false,
        ..plan
    })
}

/// Copy one set of content hashes and their chunks. The archive is checked
/// first. A hash that is not in the manifest copies nothing. Other contents
/// in the archive stay out of `live`.
pub fn restore_contents(
    backup: &Path,
    live: &BlobStore,
    contents: &[Hash],
    dry_run: bool,
) -> Result<RestorePlan> {
    let manifest = verify_backup(backup)?;
    let listed = manifest
        .contents
        .iter()
        .map(|item| item.to_ascii_lowercase())
        .collect::<BTreeSet<_>>();
    let source = BlobStore::open(&backup.join("blobs"))?;
    let mut needed = BTreeSet::new();
    for content in contents {
        let hex = content.to_string();
        if !listed.contains(hex.as_str()) {
            bail!("That backup does not contain that content.");
        }
        needed.insert(*content);
        let encoded = source.get(content)?.context("backup content")?;
        needed.extend(Manifest::decode(&encoded)?.chunks);
    }
    let plan = RestorePlan {
        blobs: needed.len(),
        dry_run,
    };
    if dry_run {
        return Ok(plan);
    }
    for hash in &needed {
        let bytes = source.get(hash)?.context("backup blob")?;
        live.put_verified(hash, &bytes)?;
    }
    Ok(plan)
}

#[cfg(test)]
pub(super) fn corrupt_first_blob(dest: &Path, manifest: &BackupManifest) {
    let hex = &manifest.blobs[0];
    let path = dest.join("blobs").join(&hex[..2]).join(&hex[2..]);
    let mut bytes = fs::read(&path).unwrap();
    bytes[0] ^= 0xff;
    fs::write(path, bytes).unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_complete_backup_restores_and_a_dry_run_does_not_write() {
        let root = tempfile::tempdir().unwrap();
        let source = BlobStore::open(&root.path().join("live")).unwrap();
        let content = source.put_content(b"north bed").unwrap();
        let dest = root.path().join("backup");
        let manifest =
            export_backup(&source, &[content], "2026-10-30T22:00:00.000Z", &dest).unwrap();
        assert_eq!(manifest.recorded_at, "2026-10-30T22:00:00.000Z");
        assert!(manifest.contents.contains(&content.to_string()));

        let other = BlobStore::open(&root.path().join("empty")).unwrap();
        let plan = restore_blobs(&dest, &other, true).unwrap();
        assert!(plan.dry_run);
        assert!(!other.has(&content));

        restore_blobs(&dest, &other, false).unwrap();
        assert_eq!(other.get_content(&content).unwrap().unwrap(), b"north bed");
    }

    #[test]
    fn missing_bytes_are_not_written_as_a_backup() {
        let root = tempfile::tempdir().unwrap();
        let source = BlobStore::open(&root.path().join("live")).unwrap();
        let absent = Hash::of(b"not stored");
        let dest = root.path().join("backup");
        let error =
            export_backup(&source, &[absent], "2026-10-30T22:00:00.000Z", &dest).unwrap_err();
        assert!(error.to_string().contains("incomplete"));
        assert!(!dest.exists());
    }

    #[test]
    fn a_corrupt_archive_is_rejected_before_it_changes_live_blobs() {
        let root = tempfile::tempdir().unwrap();
        let source = BlobStore::open(&root.path().join("live")).unwrap();
        let content = source.put_content(b"south bed").unwrap();
        let dest = root.path().join("backup");
        let manifest =
            export_backup(&source, &[content], "2026-10-30T22:00:00.000Z", &dest).unwrap();
        corrupt_first_blob(&dest, &manifest);
        let error = verify_backup(&dest).unwrap_err();
        let text = error.to_string();
        assert!(text.contains("corrupt"));
        assert!(!text.contains(&manifest.blobs[0]));

        let live = BlobStore::open(&root.path().join("restored")).unwrap();
        assert!(restore_blobs(&dest, &live, false).is_err());
        assert!(!live.has(&content));
    }

    #[test]
    fn a_corrupt_database_copy_is_rejected_before_blobs_are_restored() {
        let root = tempfile::tempdir().unwrap();
        let source = BlobStore::open(&root.path().join("live")).unwrap();
        let content = source.put_content(b"east bed").unwrap();
        let dest = root.path().join("backup");
        let manifest = export_backup_with_database(
            &source,
            &[content],
            "2026-10-30T22:00:00.000Z",
            &dest,
            b"sqlite-bytes",
        )
        .unwrap();
        assert!(manifest.database_sha256.is_some());
        let path = dest.join("database.sqlite");
        let mut bytes = fs::read(&path).unwrap();
        bytes[0] ^= 0xff;
        fs::write(path, bytes).unwrap();
        assert!(
            verify_backup(&dest)
                .unwrap_err()
                .to_string()
                .contains("corrupt")
        );
        let live = BlobStore::open(&root.path().join("restored")).unwrap();
        assert!(restore_blobs(&dest, &live, false).is_err());
        assert!(!live.has(&content));
    }

    #[test]
    fn a_folder_restore_copies_only_the_requested_contents() {
        let root = tempfile::tempdir().unwrap();
        let source = BlobStore::open(&root.path().join("live")).unwrap();
        let keep = source.put_content(b"keep this").unwrap();
        let leave = source.put_content(b"leave this").unwrap();
        let dest = root.path().join("backup");
        export_backup(&source, &[keep, leave], "2026-10-30T22:00:00.000Z", &dest).unwrap();
        let other = BlobStore::open(&root.path().join("restored")).unwrap();
        let plan = restore_contents(&dest, &other, &[keep], true).unwrap();
        assert!(plan.dry_run);
        assert!(!other.has(&keep));
        restore_contents(&dest, &other, &[keep], false).unwrap();
        assert_eq!(other.get_content(&keep).unwrap().unwrap(), b"keep this");
        assert!(!other.has(&leave));
        let missing = Hash::of(b"not in the archive");
        let error = restore_contents(&dest, &other, &[missing], false).unwrap_err();
        assert_eq!(
            error.to_string(),
            "That backup does not contain that content."
        );
        assert!(!error.to_string().contains(&missing.to_string()));
        assert!(!other.has(&leave));
    }

    #[test]
    fn an_uppercase_content_id_still_restores() {
        let root = tempfile::tempdir().unwrap();
        let source = BlobStore::open(&root.path().join("live")).unwrap();
        let keep = source.put_content(b"keep this").unwrap();
        let dest = root.path().join("backup");
        export_backup(&source, &[keep], "2026-10-30T22:00:00.000Z", &dest).unwrap();
        let path = dest.join("manifest.json");
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        let contents = manifest["contents"].as_array_mut().unwrap();
        contents[0] = serde_json::Value::String(contents[0].as_str().unwrap().to_ascii_uppercase());
        fs::write(&path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        let other = BlobStore::open(&root.path().join("restored")).unwrap();
        restore_contents(&dest, &other, &[keep], false).unwrap();
        assert_eq!(other.get_content(&keep).unwrap().unwrap(), b"keep this");
        assert!(!keep.to_string().chars().any(|ch| ch.is_ascii_uppercase()));
    }

    #[test]
    fn a_checkpoint_is_the_database_at_that_moment() {
        use libp2p_identity::ed25519;
        use suitedb::{ColumnType, Db, Schema, TableDef, Value};

        let schema = Schema {
            version: 1,
            tables: vec![TableDef::new("note", "id").column("body", ColumnType::Text)],
        };
        let db = Db::open_in_memory(ed25519::Keypair::generate(), schema.clone()).unwrap();
        db.transact(|tx| tx.upsert("note", "n1", [("body", Value::Text("before".into()))]))
            .unwrap();
        let root = tempfile::tempdir().unwrap();
        let source = BlobStore::open(&root.path().join("live")).unwrap();
        let content = source.put_content(b"file").unwrap();
        let dest = root.path().join("backup");
        let manifest = export_backup_from_database(
            &source,
            &[content],
            "2026-10-30T22:00:00.000Z",
            &dest,
            &db,
        )
        .unwrap();
        assert!(manifest.database_sha256.is_some());
        assert!(!root.path().join("backup.checkpoint").exists());
        db.transact(|tx| tx.upsert("note", "n1", [("body", Value::Text("after".into()))]))
            .unwrap();
        let copy = root.path().join("copy.sqlite");
        std::fs::write(&copy, std::fs::read(dest.join("database.sqlite")).unwrap()).unwrap();
        let opened = Db::open(&copy, ed25519::Keypair::generate(), schema).unwrap();
        let row = opened.get("note", "n1").unwrap().unwrap();
        assert_eq!(row["body"], Value::Text("before".into()));
    }

    #[test]
    fn a_due_schedule_writes_a_backup_and_an_early_one_does_not() {
        let root = tempfile::tempdir().unwrap();
        let source = BlobStore::open(&root.path().join("live")).unwrap();
        let content = source.put_content(b"keep this").unwrap();
        let early = root.path().join("early");
        let skipped = export_if_due(
            &source,
            &[content],
            Some("2026-11-01T00:00:00.000Z"),
            24,
            "2026-11-01T12:00:00.000Z",
            &early,
        )
        .unwrap();
        assert!(skipped.is_none());
        assert!(!early.exists());
        let dest = root.path().join("backup");
        let written = export_if_due(
            &source,
            &[content],
            Some("2026-11-01T00:00:00.000Z"),
            24,
            "2026-11-02T00:00:00.000Z",
            &dest,
        )
        .unwrap()
        .unwrap();
        assert_eq!(written.recorded_at, "2026-11-02T00:00:00.000Z");
        let restored = BlobStore::open(&root.path().join("restored")).unwrap();
        restore_blobs(&dest, &restored, false).unwrap();
        assert_eq!(
            restored.get_content(&content).unwrap().unwrap(),
            b"keep this"
        );
        let bad = export_if_due(
            &source,
            &[content],
            None,
            24,
            "secret-value",
            &root.path().join("nope"),
        )
        .unwrap_err()
        .to_string();
        assert_eq!(bad, "The current time is not a time.");
        assert!(!bad.contains("secret-value"));
        assert!(!root.path().join("nope").exists());
    }
}
