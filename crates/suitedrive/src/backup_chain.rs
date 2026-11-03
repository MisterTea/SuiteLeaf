//! An incremental backup stores only blobs the previous archive does not have.
//!
//! The child manifest names the BLAKE3 of that previous `manifest.json`.
//! Checking a later archive without the one it names is a chain gap. The
//! check does not copy blobs into a live store.

use std::{collections::BTreeSet, fs, path::Path};

use anyhow::{Context, Result, bail};

use crate::{
    backup::{BackupManifest, verify_backup},
    blobs::{BlobStore, Hash, Manifest},
};

/// Copy blobs that are not already in `parent`. `parent` is checked first.
/// A failed copy removes `dest`.
pub fn export_incremental(
    source: &BlobStore,
    contents: &[Hash],
    recorded_at: &str,
    dest: &Path,
    parent: &Path,
) -> Result<BackupManifest> {
    if dest.exists() {
        bail!("That backup destination already exists.");
    }
    let parent_bytes = fs::read(parent.join("manifest.json")).context("read parent manifest")?;
    let parent_manifest: BackupManifest =
        serde_json::from_slice(&parent_bytes).context("backup manifest")?;
    if parent_manifest.kind != crate::backup::BACKUP_KIND
        || parent_manifest.version != crate::backup::BACKUP_VERSION
    {
        bail!("That backup is not a SuiteLeaf backup.");
    }
    if parent_manifest.parent.is_none() {
        verify_backup(parent)?;
    } else {
        check_stored_blobs(parent, &parent_manifest)?;
    }
    let parent_hash = Hash::of(&parent_bytes).to_string();
    let parent_store = BlobStore::open(&parent.join("blobs"))?;
    let mut needed = BTreeSet::new();
    for content in contents {
        let missing = source.missing(content)?;
        if !missing.is_empty() {
            bail!("That backup is incomplete.");
        }
        needed.insert(*content);
        let encoded = source
            .get(content)?
            .context("That backup content cannot be read.")?;
        needed.extend(Manifest::decode(&encoded)?.chunks);
    }
    let archive = BlobStore::open(&dest.join("blobs"))?;
    let result = (|| -> Result<BackupManifest> {
        let mut copied = BTreeSet::new();
        for hash in &needed {
            if parent_store.has(hash) {
                continue;
            }
            let bytes = source
                .get(hash)?
                .context("That backup blob cannot be read.")?;
            archive.put_verified(hash, &bytes)?;
            copied.insert(*hash);
        }
        let manifest = BackupManifest {
            kind: crate::backup::BACKUP_KIND.to_owned(),
            version: crate::backup::BACKUP_VERSION,
            recorded_at: recorded_at.to_owned(),
            contents: contents.iter().map(|hash| hash.to_string()).collect(),
            blobs: copied.iter().map(|hash| hash.to_string()).collect(),
            database_sha256: None,
            parent: Some(parent_hash),
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

/// How many contents and blobs a chain restore would copy.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChainRestore {
    pub contents: usize,
    pub blobs: usize,
    pub dry_run: bool,
}

/// Copy every content in a verified chain into `live`.
/// A gap is refused before any blob is written. A dry run writes nothing.
pub fn restore_chain(
    archives: &[impl AsRef<Path>],
    live: &BlobStore,
    dry_run: bool,
) -> Result<ChainRestore> {
    let manifests = verify_chain(archives)?;
    let roots = archives
        .iter()
        .map(|archive| archive.as_ref().join("blobs"))
        .collect::<Vec<_>>();
    let mut contents = BTreeSet::new();
    for manifest in &manifests {
        contents.extend(manifest.contents.iter().cloned());
    }
    let mut needed = BTreeSet::new();
    let mut bodies = Vec::new();
    for hex in &contents {
        let hash: Hash = hex.parse().with_context(|| format!("content id {hex}"))?;
        let Some(encoded) = first_blob(&roots, &hash)? else {
            bail!("That backup is incomplete.");
        };
        if Hash::of(&encoded) != hash {
            bail!("That backup blob is corrupt.");
        }
        needed.insert(hash);
        needed.extend(Manifest::decode(&encoded)?.chunks);
    }
    for hash in &needed {
        let Some(bytes) = first_blob(&roots, hash)? else {
            bail!("That backup is incomplete.");
        };
        if Hash::of(&bytes) != *hash {
            bail!("That backup blob is corrupt.");
        }
        bodies.push((*hash, bytes));
    }
    let plan = ChainRestore {
        contents: contents.len(),
        blobs: bodies.len(),
        dry_run,
    };
    if dry_run {
        return Ok(plan);
    }
    for (hash, bytes) in &bodies {
        live.put_verified(hash, bytes)?;
    }
    Ok(plan)
}

/// Store a SuiteDB snapshot on an incremental archive and record its hash.
/// The previous archive's manifest hash is left as it was.
pub fn attach_database(dest: &Path, database: &[u8]) -> Result<BackupManifest> {
    if database.is_empty() {
        bail!("backup database is empty");
    }
    let bytes = fs::read(dest.join("manifest.json")).context("read backup manifest")?;
    let mut manifest: BackupManifest = serde_json::from_slice(&bytes).context("backup manifest")?;
    if manifest.parent.is_none() {
        bail!("This database snapshot belongs on an incremental backup.");
    }
    fs::write(dest.join("database.sqlite"), database)?;
    manifest.database_sha256 = Some(Hash::of(database).to_string());
    let body = serde_json::to_vec_pretty(&manifest)?;
    let tmp = dest.join("manifest.json.tmp");
    if let Err(error) =
        fs::write(&tmp, &body).and_then(|_| fs::rename(&tmp, dest.join("manifest.json")))
    {
        let _ = fs::remove_file(dest.join("database.sqlite"));
        let _ = fs::remove_file(&tmp);
        return Err(error).context("write backup manifest");
    }
    Ok(manifest)
}

/// Copy a chain's blobs, then write the newest snapshot into an empty database.
/// A chain gap, a changed snapshot, or a database that already has a file copies nothing.
/// Account secrets and a client secret are not copied. This does not start a node.
pub fn restore_chain_database(
    archives: &[impl AsRef<Path>],
    live_blobs: &BlobStore,
    snapshot: &suitedb::Db,
    live: &suitedb::Db,
) -> Result<crate::backup::CleanRestore> {
    let manifests = verify_chain(archives)?;
    let last = archives.last().context("backup chain gap")?;
    let last = last.as_ref();
    let Some(expected) = manifests
        .last()
        .and_then(|item| item.database_sha256.clone())
    else {
        bail!("This backup chain has no database snapshot.");
    };
    let existing = live.query("SELECT id FROM drive_item", &[])?;
    if !existing.is_empty() {
        bail!("This database already has files. Restore into an empty database.");
    }
    let stored = fs::read(last.join("database.sqlite")).context("read backup database")?;
    if Hash::of(&stored).to_string() != expected {
        bail!("corrupt backup database");
    }
    let known = manifests
        .iter()
        .flat_map(|item| item.contents.iter().cloned())
        .collect::<BTreeSet<_>>();
    let versions = snapshot.query("SELECT * FROM drive_version", &[])?;
    for version in &versions {
        let Some(hex) = version.get("contentHash").and_then(|value| match value {
            suitedb::Value::Text(text) if !text.is_empty() => Some(text.clone()),
            _ => None,
        }) else {
            continue;
        };
        if !known.contains(&hex) {
            bail!("That file content is not in this backup.");
        }
    }
    restore_chain(archives, live_blobs, false)?;
    for version in &versions {
        let Some(hex) = version.get("contentHash").and_then(|value| match value {
            suitedb::Value::Text(text) if !text.is_empty() => Some(text.clone()),
            _ => None,
        }) else {
            continue;
        };
        let hash: Hash = hex
            .parse()
            .context("That backup content id cannot be read.")?;
        if live_blobs.get_content(&hash)?.is_none() {
            bail!("That restored content is missing.");
        }
    }
    crate::backup::import_snapshot(snapshot, live)
}

/// Check archives in order. Each one after the first must name the previous
/// manifest. A skipped or changed backup returns an error and writes nothing.
pub fn verify_chain(archives: &[impl AsRef<Path>]) -> Result<Vec<BackupManifest>> {
    if archives.is_empty() {
        bail!("backup chain gap");
    }
    let mut found = Vec::new();
    let mut previous: Option<Vec<u8>> = None;
    let mut stores: Vec<std::path::PathBuf> = Vec::new();
    for archive in archives {
        let archive = archive.as_ref();
        let bytes = fs::read(archive.join("manifest.json")).context("read backup manifest")?;
        let manifest: BackupManifest = serde_json::from_slice(&bytes).context("backup manifest")?;
        match (&manifest.parent, &previous) {
            (None, None) => {}
            (Some(expected), Some(prior)) if Hash::of(prior).to_string() == *expected => {}
            _ => bail!("backup chain gap"),
        }
        if manifest.parent.is_none() {
            verify_backup(archive)?;
        } else {
            check_incremental(archive, &manifest, &stores)?;
        }
        stores.push(archive.join("blobs"));
        previous = Some(bytes);
        found.push(manifest);
    }
    Ok(found)
}

fn check_stored_blobs(archive: &Path, manifest: &BackupManifest) -> Result<()> {
    let store = BlobStore::open(&archive.join("blobs"))?;
    for hex in &manifest.blobs {
        let hash: Hash = hex.parse().context("That backup blob id cannot be read.")?;
        let Some(body) = store.get(&hash)? else {
            bail!("That backup is incomplete.");
        };
        if Hash::of(&body) != hash {
            bail!("That backup blob is corrupt.");
        }
    }
    Ok(())
}

fn check_incremental(
    archive: &Path,
    manifest: &BackupManifest,
    earlier: &[std::path::PathBuf],
) -> Result<()> {
    check_stored_blobs(archive, manifest)?;
    if let Some(expected) = &manifest.database_sha256 {
        let stored = fs::read(archive.join("database.sqlite")).context("read backup database")?;
        if Hash::of(&stored).to_string() != *expected {
            bail!("corrupt backup database");
        }
    }
    let mut roots = earlier.to_vec();
    roots.push(archive.join("blobs"));
    for hex in &manifest.contents {
        let hash: Hash = hex.parse().with_context(|| format!("content id {hex}"))?;
        if !content_in(&roots, &hash)? {
            bail!("That backup is incomplete.");
        }
    }
    Ok(())
}

fn content_in(roots: &[std::path::PathBuf], content: &Hash) -> Result<bool> {
    let Some(encoded) = first_blob(roots, content)? else {
        return Ok(false);
    };
    if Hash::of(&encoded) != *content {
        bail!("That backup blob is corrupt.");
    }
    for chunk in Manifest::decode(&encoded)?.chunks {
        let Some(body) = first_blob(roots, &chunk)? else {
            return Ok(false);
        };
        if Hash::of(&body) != chunk {
            bail!("That backup blob is corrupt.");
        }
    }
    Ok(true)
}

fn first_blob(roots: &[std::path::PathBuf], hash: &Hash) -> Result<Option<Vec<u8>>> {
    for root in roots {
        let store = BlobStore::open(root)?;
        if let Some(body) = store.get(hash)? {
            return Ok(Some(body));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_incremental_chain_refuses_a_missing_middle_backup() {
        let root = tempfile::tempdir().unwrap();
        let source = BlobStore::open(&root.path().join("source")).unwrap();
        let beds = source.put_content(b"beds").unwrap();
        let paths = source.put_content(b"paths").unwrap();
        let north = source.put_content(b"north").unwrap();
        let first = root.path().join("monday");
        let second = root.path().join("tuesday");
        let third = root.path().join("wednesday");
        crate::backup::export_backup(&source, &[beds], "2026-10-26T00:00:00.000Z", &first).unwrap();
        let child = export_incremental(
            &source,
            &[paths],
            "2026-10-27T00:00:00.000Z",
            &second,
            &first,
        )
        .unwrap();
        assert_eq!(child.contents, vec![paths.to_string()]);
        assert!(!child.blobs.iter().any(|hex| hex == &beds.to_string()));
        assert!(!BlobStore::open(&second.join("blobs")).unwrap().has(&beds));
        export_incremental(
            &source,
            &[north],
            "2026-10-28T00:00:00.000Z",
            &third,
            &second,
        )
        .unwrap();

        let chain = verify_chain(&[&first, &second, &third]).unwrap();
        assert_eq!(chain.len(), 3);
        assert!(chain[0].parent.is_none());
        assert!(chain[1].parent.is_some());

        let alone = verify_backup(&second).unwrap_err();
        assert!(alone.to_string().contains("backup chain gap"));

        let skipped = verify_chain(&[&first, &third]).unwrap_err();
        assert!(skipped.to_string().contains("backup chain gap"));
        assert!(!skipped.to_string().contains("secret-value"));

        let live = BlobStore::open(&root.path().join("live")).unwrap();
        let gap = restore_chain(&[&first, &third], &live, false).unwrap_err();
        assert!(gap.to_string().contains("backup chain gap"));
        assert!(!live.has(&beds));
        assert!(!live.has(&paths));
        assert!(!live.has(&north));
        let planned = restore_chain(&[&first, &second, &third], &live, true).unwrap();
        assert_eq!(planned.contents, 3);
        assert!(planned.dry_run);
        assert!(!live.has(&beds));
        let restored = restore_chain(&[&first, &second, &third], &live, false).unwrap();
        assert_eq!(restored.contents, 3);
        assert!(!restored.dry_run);
        assert_eq!(live.get_content(&beds).unwrap().unwrap(), b"beds");
        assert_eq!(live.get_content(&paths).unwrap().unwrap(), b"paths");
        assert_eq!(live.get_content(&north).unwrap().unwrap(), b"north");

        let monday = fs::read_to_string(first.join("manifest.json")).unwrap();
        let edited = monday.replacen("2026-10-26T00:00:00.000Z", "2026-10-26T00:00:00.001Z", 1);
        assert_ne!(monday, edited);
        fs::write(first.join("manifest.json"), edited).unwrap();
        let changed = verify_chain(&[&first, &second]).unwrap_err();
        assert!(changed.to_string().contains("backup chain gap"));
        let later = BlobStore::open(&root.path().join("later")).unwrap();
        let refused = restore_chain(&[&first, &second], &later, false).unwrap_err();
        assert!(refused.to_string().contains("backup chain gap"));
        assert!(!later.has(&beds));
        assert_eq!(live.get_content(&beds).unwrap().unwrap(), b"beds");
    }

    #[test]
    fn an_incremental_chain_restores_the_newest_database_into_an_empty_one() {
        use crate::{SCHEMA_VERSION, tables};
        use libp2p_identity::ed25519;
        use suitedb::{ColumnType, Db, Schema, TableDef, Value};

        let mut drive_tables = tables();
        drive_tables.push(
            TableDef::new("user", "id")
                .column("email", ColumnType::Text)
                .column("name", ColumnType::Text)
                .column("password", ColumnType::Text),
        );
        drive_tables.push(
            TableDef::new("auth_config", "id")
                .column("issuer", ColumnType::Text)
                .column("audience", ColumnType::Text)
                .column("idleSecs", ColumnType::Integer)
                .column("clientSecret", ColumnType::Text),
        );
        let schema = Schema {
            version: SCHEMA_VERSION,
            tables: drive_tables,
        };
        let root = tempfile::tempdir().unwrap();
        let source = BlobStore::open(&root.path().join("source")).unwrap();
        let beds = source.put_content(b"beds").unwrap();
        let paths = source.put_content(b"paths").unwrap();
        let monday = root.path().join("monday");
        let tuesday = root.path().join("tuesday");
        crate::backup::export_backup(&source, &[beds], "2026-10-26T00:00:00.000Z", &monday)
            .unwrap();
        export_incremental(
            &source,
            &[paths],
            "2026-10-27T00:00:00.000Z",
            &tuesday,
            &monday,
        )
        .unwrap();
        let archive = Db::open_in_memory(ed25519::Keypair::generate(), schema.clone()).unwrap();
        let item = |parent: &str, name: &str, kind: &str, version: &str| {
            vec![
                ("parentId", Value::Text(parent.into())),
                ("name", Value::Text(name.into())),
                ("kind", Value::Text(kind.into())),
                ("ownerId", Value::Text("ada".into())),
                ("mime", Value::Text("text/plain".into())),
                ("size", Value::Integer(1)),
                ("headVersionId", Value::Text(version.into())),
                ("createdAt", Value::Text("2026-10-27T00:00:00.000Z".into())),
                ("updatedAt", Value::Text("2026-10-27T00:00:00.000Z".into())),
                ("trashed", Value::Integer(0)),
            ]
        };
        archive
            .transact(|tx| {
                tx.upsert("drive_item", "beds", item("", "Beds", "folder", ""))?;
                tx.upsert(
                    "drive_item",
                    "paths",
                    item("beds", "Paths", "file", "v-paths"),
                )?;
                tx.upsert(
                    "drive_version",
                    "v-beds",
                    [
                        ("itemId", Value::Text("beds".into())),
                        ("contentHash", Value::Text(beds.to_string())),
                        ("size", Value::Integer(4)),
                        ("authorId", Value::Text("ada".into())),
                        ("createdAt", Value::Text("2026-10-26T00:00:00.000Z".into())),
                        ("name", Value::Text("Beds".into())),
                        ("restoredFrom", Value::Text(String::new())),
                    ],
                )?;
                tx.upsert(
                    "drive_version",
                    "v-paths",
                    [
                        ("itemId", Value::Text("paths".into())),
                        ("contentHash", Value::Text(paths.to_string())),
                        ("size", Value::Integer(5)),
                        ("authorId", Value::Text("ada".into())),
                        ("createdAt", Value::Text("2026-10-27T00:00:00.000Z".into())),
                        ("name", Value::Text("Paths".into())),
                        ("restoredFrom", Value::Text(String::new())),
                    ],
                )?;
                tx.upsert(
                    "user",
                    "sam",
                    [
                        ("email", Value::Text("sam@example.com".into())),
                        ("name", Value::Text("Sam".into())),
                        ("password", Value::Text("secret-value".into())),
                    ],
                )?;
                tx.upsert(
                    "drive_acl",
                    "acl-beds",
                    [
                        ("itemId", Value::Text("beds".into())),
                        ("principalType", Value::Text("user".into())),
                        ("principalId", Value::Text("sam".into())),
                        ("role", Value::Text("editor".into())),
                        ("expiresAt", Value::Text(String::new())),
                    ],
                )?;
                tx.upsert(
                    "auth_config",
                    "organization",
                    [
                        ("issuer", Value::Text("https://idp.example".into())),
                        ("audience", Value::Text("suiteleaf".into())),
                        ("idleSecs", Value::Integer(1800)),
                        ("clientSecret", Value::Text("secret-value".into())),
                    ],
                )?;
                Ok(())
            })
            .unwrap();
        let scratch = root.path().join("checkpoint");
        archive.checkpoint_copy(&scratch).unwrap();
        let bytes = fs::read(&scratch).unwrap();
        let _ = fs::remove_file(&scratch);
        attach_database(&tuesday, &bytes).unwrap();

        let busy = Db::open_in_memory(ed25519::Keypair::generate(), schema.clone()).unwrap();
        busy.transact(|tx| tx.upsert("drive_item", "notes", item("", "Notes", "file", "")))
            .unwrap();
        let untouched = BlobStore::open(&root.path().join("untouched")).unwrap();
        let refused =
            restore_chain_database(&[&monday, &tuesday], &untouched, &archive, &busy).unwrap_err();
        assert!(refused.to_string().contains("already has files"));
        assert!(!refused.to_string().contains("secret-value"));
        assert_eq!(
            busy.get("drive_item", "notes").unwrap().unwrap()["name"],
            Value::Text("Notes".into())
        );
        assert!(!untouched.has(&beds));
        assert!(!untouched.has(&paths));

        let flipped = fs::read(tuesday.join("database.sqlite")).unwrap();
        let mut broken = flipped.clone();
        let index = broken.len() - 1;
        broken[index] ^= 0xff;
        fs::write(tuesday.join("database.sqlite"), &broken).unwrap();
        let corrupt = BlobStore::open(&root.path().join("corrupt")).unwrap();
        let empty = Db::open_in_memory(ed25519::Keypair::generate(), schema.clone()).unwrap();
        let bad =
            restore_chain_database(&[&monday, &tuesday], &corrupt, &archive, &empty).unwrap_err();
        assert!(bad.to_string().contains("corrupt backup database"));
        assert!(!bad.to_string().contains("secret-value"));
        assert!(!corrupt.has(&beds));
        assert!(empty.get("drive_item", "paths").unwrap().is_none());
        fs::write(tuesday.join("database.sqlite"), &flipped).unwrap();

        let live_blobs = BlobStore::open(&root.path().join("live")).unwrap();
        let live = Db::open_in_memory(ed25519::Keypair::generate(), schema.clone()).unwrap();
        let restored =
            restore_chain_database(&[&monday, &tuesday], &live_blobs, &archive, &live).unwrap();
        assert_eq!(restored.items, 2);
        assert_eq!(restored.accounts, 1);
        assert!(restored.auth);
        assert_eq!(live_blobs.get_content(&beds).unwrap().unwrap(), b"beds");
        assert_eq!(live_blobs.get_content(&paths).unwrap().unwrap(), b"paths");
        assert_eq!(
            live.get("drive_item", "paths").unwrap().unwrap()["name"],
            Value::Text("Paths".into())
        );
        assert_eq!(
            live.get("drive_version", "v-beds").unwrap().unwrap()["contentHash"],
            Value::Text(beds.to_string())
        );
        let sam = live.get("user", "sam").unwrap().unwrap();
        assert_eq!(sam["email"], Value::Text("sam@example.com".into()));
        assert!(!matches!(sam.get("password"), Some(Value::Text(text)) if !text.is_empty()));
        let auth = live.get("auth_config", "organization").unwrap().unwrap();
        assert_eq!(auth["issuer"], Value::Text("https://idp.example".into()));
        assert!(!matches!(auth.get("clientSecret"), Some(Value::Text(text)) if !text.is_empty()));
        assert!(!format!("{sam:?}{auth:?}").contains("secret-value"));
    }
}
