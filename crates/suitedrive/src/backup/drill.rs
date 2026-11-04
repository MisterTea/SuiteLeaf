//! Restore drills, and how fresh a backup is.

use std::{fs, path::Path};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

use crate::blobs::{BlobStore, Hash};

use super::archive::{BACKUP_KIND, BackupManifest, restore_blobs, verify_backup};

pub const DRILL_KIND: &str = "suiteleaf-restore-drill";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreDrill {
    pub kind: String,
    pub passed: bool,
    pub drilled_at: String,
    pub backup_recorded_at: String,
    pub blobs: usize,
    pub contents: usize,
    pub database_checked: bool,
    /// Wall time of this successful drill, in milliseconds. Not a recovery target.
    pub elapsed_ms: u64,
}

/// Restore the archive into a scratch store, reassemble every content, and
/// write `drill.json` only when that succeeds. The scratch store is removed.
/// This does not write to any live blob store.
pub fn record_restore_drill(backup: &Path, drilled_at: &str) -> Result<RestoreDrill> {
    let started = std::time::Instant::now();
    let manifest = verify_backup(backup)?;
    let scratch = backup.join(".drill");
    if scratch.exists() {
        fs::remove_dir_all(&scratch)?;
    }
    let drilled = (|| -> Result<RestoreDrill> {
        let live = BlobStore::open(&scratch)?;
        let plan = restore_blobs(backup, &live, false)?;
        for hex in &manifest.contents {
            let hash: Hash = hex.parse()?;
            live.get_content(&hash)?
                .context("That drill content is missing.")?;
        }
        Ok(RestoreDrill {
            kind: DRILL_KIND.to_owned(),
            passed: true,
            drilled_at: drilled_at.to_owned(),
            backup_recorded_at: manifest.recorded_at,
            blobs: plan.blobs,
            contents: manifest.contents.len(),
            database_checked: manifest.database_sha256.is_some(),
            elapsed_ms: 0,
        })
    })();
    let _ = fs::remove_dir_all(&scratch);
    let mut drill = drilled?;
    drill.elapsed_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    let body = serde_json::to_vec_pretty(&drill)?;
    let tmp = backup.join("drill.json.tmp");
    fs::write(&tmp, body)?;
    fs::rename(tmp, backup.join("drill.json"))?;
    Ok(drill)
}

/// When this archive was written, and whether a successful restore drill is recorded.
/// Content hashes and the database file are not included.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFreshness {
    pub recorded_at: String,
    pub content_count: usize,
    /// Empty when no successful drill is recorded.
    pub drilled_at: String,
    pub elapsed_ms: Option<u64>,
    pub restore_tested: bool,
}

pub fn backup_freshness(backup: &Path) -> Result<BackupFreshness> {
    let manifest: BackupManifest = serde_json::from_slice(
        &fs::read(backup.join("manifest.json")).context("backup manifest")?,
    )?;
    if manifest.kind != BACKUP_KIND {
        bail!("not a SuiteLeaf backup");
    }
    let base = BackupFreshness {
        recorded_at: manifest.recorded_at,
        content_count: manifest.contents.len(),
        drilled_at: String::new(),
        elapsed_ms: None,
        restore_tested: false,
    };
    let drill_path = backup.join("drill.json");
    if !drill_path.is_file() {
        return Ok(base);
    }
    let drill: RestoreDrill = serde_json::from_slice(&fs::read(drill_path)?)
        .map_err(|_| anyhow::anyhow!("That restore drill record cannot be read."))?;
    if !drill.passed || drill.kind != DRILL_KIND {
        return Ok(base);
    }
    Ok(BackupFreshness {
        drilled_at: drill.drilled_at,
        elapsed_ms: Some(drill.elapsed_ms),
        restore_tested: true,
        ..base
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backup::{archive::corrupt_first_blob, export_backup};

    #[test]
    fn a_restore_drill_is_recorded_only_after_the_archive_restores() {
        let root = tempfile::tempdir().unwrap();
        let source = BlobStore::open(&root.path().join("live")).unwrap();
        let content = source.put_content(b"drill me").unwrap();
        let dest = root.path().join("backup");
        export_backup(&source, &[content], "2026-10-30T22:00:00.000Z", &dest).unwrap();
        let unrelated = BlobStore::open(&root.path().join("unrelated")).unwrap();
        let drill = record_restore_drill(&dest, "2026-10-30T23:00:00.000Z").unwrap();
        assert!(drill.passed);
        assert_eq!(drill.drilled_at, "2026-10-30T23:00:00.000Z");
        assert_eq!(drill.backup_recorded_at, "2026-10-30T22:00:00.000Z");
        assert_eq!(drill.contents, 1);
        let saved: RestoreDrill =
            serde_json::from_slice(&fs::read(dest.join("drill.json")).unwrap()).unwrap();
        assert_eq!(saved.elapsed_ms, drill.elapsed_ms);
        assert!(dest.join("drill.json").is_file());
        assert!(!dest.join(".drill").exists());
        assert!(!unrelated.has(&content));

        corrupt_first_blob(&dest, &verify_backup(&dest).unwrap());
        // The corrupt blob fails verification, so the earlier drill file must not be treated as a new pass.
        let _ = fs::remove_file(dest.join("drill.json"));
        assert!(record_restore_drill(&dest, "2026-10-30T23:30:00.000Z").is_err());
        assert!(!dest.join("drill.json").exists());
    }

    #[test]
    fn a_broken_drill_record_does_not_repeat_its_text() {
        let root = tempfile::tempdir().unwrap();
        let source = BlobStore::open(&root.path().join("live")).unwrap();
        let content = source.put_content(b"drill me").unwrap();
        let dest = root.path().join("backup");
        export_backup(&source, &[content], "2026-10-30T22:00:00.000Z", &dest).unwrap();
        fs::write(dest.join("drill.json"), b"secret-value").unwrap();
        let text = backup_freshness(&dest).unwrap_err().to_string();
        assert_eq!(text, "That restore drill record cannot be read.");
        assert!(!text.contains("secret-value"));
    }

    #[test]
    fn freshness_names_the_backup_time_and_a_successful_drill() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path();
        fs::write(
            dir.join("manifest.json"),
            serde_json::json!({
                "kind": BACKUP_KIND,
                "version": 1,
                "recordedAt": "2026-10-31T12:00:00.000Z",
                "contents": ["secret-hash-value"],
                "blobs": ["secret-hash-value"],
                "databaseSha256": "secret-value"
            })
            .to_string(),
        )
        .unwrap();
        let missing = backup_freshness(dir).unwrap();
        assert_eq!(missing.recorded_at, "2026-10-31T12:00:00.000Z");
        assert_eq!(missing.content_count, 1);
        assert!(!missing.restore_tested);
        assert!(missing.drilled_at.is_empty());
        fs::write(
            dir.join("drill.json"),
            serde_json::json!({
                "kind": DRILL_KIND,
                "passed": true,
                "drilledAt": "2026-10-31T13:00:00.000Z",
                "backupRecordedAt": "2026-10-31T12:00:00.000Z",
                "blobs": 1,
                "contents": 1,
                "databaseChecked": true,
                "elapsedMs": 12
            })
            .to_string(),
        )
        .unwrap();
        let drilled = backup_freshness(dir).unwrap();
        assert!(drilled.restore_tested);
        assert_eq!(drilled.drilled_at, "2026-10-31T13:00:00.000Z");
        assert_eq!(drilled.elapsed_ms, Some(12));
        let shown = serde_json::to_string(&drilled).unwrap();
        assert!(!shown.contains("secret-hash-value"));
        assert!(!shown.contains("secret-value"));
    }
}
