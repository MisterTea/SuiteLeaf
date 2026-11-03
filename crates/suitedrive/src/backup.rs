//! An independent copy of SuiteDrive file bytes.
//!
//! Replication keeps another node in step with this one, so it also copies
//! deletions and gaps. A backup is a directory written only after every
//! content hash and chunk is present. Restore checks that directory before
//! it copies anything into a live blob store.
//!
//! An optional `database.sqlite` is a caller-supplied copy of SuiteDB. Its
//! hash is checked before a restore copies blobs. A folder restore copies
//! that folder's rows from an opened snapshot and copies a missing account
//! only when a restored grant names it. Desktop recovery drafts stay separate.

use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use suitedb::Value;

use crate::blobs::{BlobStore, Hash, Manifest};

fn content_hash(hex: &str) -> Result<Hash> {
    hex.parse::<Hash>()
        .map_err(|_| anyhow::anyhow!("A content id in this backup is not a content id."))
}

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

/// One older version copied onto a file that is already on this node.
/// The file's current version is not changed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VersionRestore {
    pub version_id: String,
    pub file_id: String,
}

/// One file copied out of a backup database. Other items are not written.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileRestore {
    pub file_id: String,
    pub file_name: String,
    pub versions: usize,
    pub grants: usize,
}

/// One folder copied out of a backup database. Other items are not written.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FolderRestore {
    pub folder_id: String,
    pub folder_name: String,
    pub items: usize,
    pub grants: usize,
    pub accounts: usize,
}

/// A whole snapshot written into an empty database.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CleanRestore {
    pub items: usize,
    pub versions: usize,
    pub grants: usize,
    pub accounts: usize,
    pub auth: bool,
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

/// Put one folder, and the files inside it, back into a live database.
/// A file that is already on this node keeps its name, version, and grants.
/// A missing file inside the folder comes back. Grants on other files are not written.
/// A missing account named by a restored grant, or by an owner of a restored item, is copied. An account that already exists is left as it is. A password is not copied.
/// The archive is checked before any live blob or row changes.
pub fn restore_folder(
    backup: &Path,
    folder_id: &str,
    archive: &suitedb::Db,
    live: &suitedb::Db,
    blobs: &BlobStore,
) -> Result<FolderRestore> {
    verify_backup(backup)?;
    let items = archive.query("SELECT * FROM drive_item", &[])?;
    let folder = items
        .iter()
        .find(|row| text_of(row, "id").as_deref() == Some(folder_id))
        .context("That folder is not in this backup.")?
        .clone();
    if text_of(&folder, "kind").as_deref() != Some("folder") {
        bail!("That backup item is not a folder.");
    }
    let chosen = folder_rows(&items, folder_id);
    let live_ids = live
        .query("SELECT id FROM drive_item", &[])?
        .into_iter()
        .filter_map(|row| text_of(&row, "id"))
        .collect::<BTreeSet<_>>();
    let missing = chosen
        .into_iter()
        .filter(|row| text_of(row, "id").is_some_and(|id| !live_ids.contains(&id)))
        .collect::<Vec<_>>();
    let ids = missing
        .iter()
        .filter_map(|row| text_of(row, "id"))
        .collect::<BTreeSet<_>>();
    let versions = archive
        .query("SELECT * FROM drive_version", &[])?
        .into_iter()
        .filter(|row| text_of(row, "itemId").is_some_and(|id| ids.contains(&id)))
        .collect::<Vec<_>>();
    let mut hashes = Vec::new();
    for version in &versions {
        if let Some(hex) = text_of(version, "contentHash") {
            hashes.push(content_hash(&hex)?);
        }
    }
    if !hashes.is_empty() {
        restore_contents(backup, blobs, &hashes, false)?;
    }
    let grants = archive
        .query("SELECT * FROM drive_acl", &[])?
        .into_iter()
        .filter(|row| text_of(row, "itemId").is_some_and(|id| ids.contains(&id)))
        .collect::<Vec<_>>();
    let comments = missing_comments(archive, live, &ids)?;
    let accounts = missing_accounts(archive, live, &grants, &owner_ids(&missing))?;
    let name = text_of(&folder, "name").unwrap_or_default();
    let count = missing.len();
    let grant_count = grants.len();
    let account_count = accounts.len();
    live.transact(|tx| {
        for row in &missing {
            let Some(id) = text_of(row, "id") else {
                continue;
            };
            tx.upsert("drive_item", &id, columns(row))?;
        }
        for row in &versions {
            let Some(id) = text_of(row, "id") else {
                continue;
            };
            tx.upsert("drive_version", &id, columns(row))?;
        }
        for row in &grants {
            let Some(id) = text_of(row, "id") else {
                continue;
            };
            tx.upsert("drive_acl", &id, columns(row))?;
        }
        for row in &comments {
            let Some(id) = text_of(row, "id") else {
                continue;
            };
            tx.upsert("drive_comment", &id, columns(row))?;
        }
        for row in &accounts {
            let Some(id) = text_of(row, "id") else {
                continue;
            };
            tx.upsert("user", &id, account_columns(row))?;
        }
        Ok(())
    })?;
    Ok(FolderRestore {
        folder_id: folder_id.to_owned(),
        folder_name: name,
        items: count,
        grants: grant_count,
        accounts: account_count,
    })
}

fn copy_id(id: &str) -> String {
    format!("copy-{id}")
}

/// Write one backup folder beside the live folder. The live rows keep their ids.
/// The copy uses new ids. A second copy of the same folder is refused.
pub fn restore_folder_copy(
    backup: &Path,
    folder_id: &str,
    archive: &suitedb::Db,
    live: &suitedb::Db,
    blobs: &BlobStore,
) -> Result<FolderRestore> {
    verify_backup(backup)?;
    let items = archive.query("SELECT * FROM drive_item", &[])?;
    let folder = items
        .iter()
        .find(|row| text_of(row, "id").as_deref() == Some(folder_id))
        .context("That folder is not in this backup.")?
        .clone();
    if text_of(&folder, "kind").as_deref() != Some("folder") {
        bail!("That backup item is not a folder.");
    }
    let copied_folder = copy_id(folder_id);
    if live.get("drive_item", &copied_folder)?.is_some() {
        bail!("That copy is already in this database.");
    }
    let chosen = folder_rows(&items, folder_id);
    let ids = chosen
        .iter()
        .filter_map(|row| text_of(row, "id"))
        .collect::<BTreeSet<_>>();
    let versions = archive
        .query("SELECT * FROM drive_version", &[])?
        .into_iter()
        .filter(|row| text_of(row, "itemId").is_some_and(|id| ids.contains(&id)))
        .collect::<Vec<_>>();
    let version_ids = versions
        .iter()
        .filter_map(|row| text_of(row, "id"))
        .collect::<BTreeSet<_>>();
    let mut hashes = Vec::new();
    for version in &versions {
        if let Some(hex) = text_of(version, "contentHash") {
            hashes.push(content_hash(&hex)?);
        }
    }
    if !hashes.is_empty() {
        restore_contents(backup, blobs, &hashes, false)?;
    }
    let grants = archive
        .query("SELECT * FROM drive_acl", &[])?
        .into_iter()
        .filter(|row| text_of(row, "itemId").is_some_and(|id| ids.contains(&id)))
        .collect::<Vec<_>>();
    let copied_comment_ids = live
        .query("SELECT id FROM drive_comment", &[])?
        .into_iter()
        .filter_map(|row| text_of(&row, "id"))
        .collect::<BTreeSet<_>>();
    let comments = archive
        .query("SELECT * FROM drive_comment", &[])?
        .into_iter()
        .filter(|row| text_of(row, "itemId").is_some_and(|id| ids.contains(&id)))
        .filter(|row| {
            text_of(row, "id").is_some_and(|id| !copied_comment_ids.contains(&copy_id(&id)))
        })
        .collect::<Vec<_>>();
    let accounts = missing_accounts(archive, live, &grants, &owner_ids(&chosen))?;
    let name = text_of(&folder, "name").unwrap_or_default();
    let count = chosen.len();
    let grant_count = grants.len();
    let account_count = accounts.len();
    let remap = |key: &str, value: Value| -> Value {
        let Value::Text(text) = &value else {
            return value;
        };
        let hit = (key == "parentId" || key == "itemId") && ids.contains(text)
            || key == "headVersionId" && version_ids.contains(text);
        if hit {
            Value::Text(copy_id(text))
        } else {
            value
        }
    };
    live.transact(|tx| {
        for row in &chosen {
            let Some(id) = text_of(row, "id") else {
                continue;
            };
            let fields = columns(row)
                .into_iter()
                .map(|(key, value)| {
                    let next = remap(&key, value);
                    (key, next)
                })
                .collect::<Vec<_>>();
            tx.upsert("drive_item", &copy_id(&id), fields)?;
        }
        for row in &versions {
            let Some(id) = text_of(row, "id") else {
                continue;
            };
            let fields = columns(row)
                .into_iter()
                .map(|(key, value)| (key.clone(), remap(&key, value)))
                .collect::<Vec<_>>();
            tx.upsert("drive_version", &copy_id(&id), fields)?;
        }
        for row in &grants {
            let Some(id) = text_of(row, "id") else {
                continue;
            };
            let fields = columns(row)
                .into_iter()
                .map(|(key, value)| (key.clone(), remap(&key, value)))
                .collect::<Vec<_>>();
            tx.upsert("drive_acl", &copy_id(&id), fields)?;
        }
        for row in &comments {
            let Some(id) = text_of(row, "id") else {
                continue;
            };
            let fields = columns(row)
                .into_iter()
                .map(|(key, value)| (key.clone(), remap(&key, value)))
                .collect::<Vec<_>>();
            tx.upsert("drive_comment", &copy_id(&id), fields)?;
        }
        for row in &accounts {
            let Some(id) = text_of(row, "id") else {
                continue;
            };
            tx.upsert("user", &id, account_columns(row))?;
        }
        Ok(())
    })?;
    Ok(FolderRestore {
        folder_id: copied_folder,
        folder_name: name,
        items: count,
        grants: grant_count,
        accounts: account_count,
    })
}

/// Say which file a restore would write. Nothing is copied and no row is written.
pub fn plan_file_restore(
    backup: &Path,
    file_id: &str,
    archive: &suitedb::Db,
    live: &suitedb::Db,
) -> Result<FileRestore> {
    verify_backup(backup)?;
    let file = backup_file(archive, file_id)?;
    if live.get("drive_item", file_id)?.is_some() {
        bail!("That file is already on this node.");
    }
    let versions = archive
        .query("SELECT * FROM drive_version", &[])?
        .into_iter()
        .filter(|row| text_of(row, "itemId").as_deref() == Some(file_id))
        .count();
    let grants = archive
        .query("SELECT * FROM drive_acl", &[])?
        .into_iter()
        .filter(|row| text_of(row, "itemId").as_deref() == Some(file_id))
        .count();
    Ok(FileRestore {
        file_id: file_id.to_owned(),
        file_name: text_of(&file, "name").unwrap_or_default(),
        versions,
        grants,
    })
}

fn backup_file(archive: &suitedb::Db, file_id: &str) -> Result<BTreeMap<String, Value>> {
    let items = archive.query("SELECT * FROM drive_item", &[])?;
    let Some(file) = items
        .iter()
        .find(|row| text_of(row, "id").as_deref() == Some(file_id))
        .cloned()
    else {
        bail!("That file is not in this backup.");
    };
    if text_of(&file, "kind").as_deref() == Some("folder") {
        bail!("That backup item is not a file.");
    }
    Ok(file)
}

/// Write one backup file that is missing from the live database.
/// A file that is already there is left as it is. A folder id is refused.
pub fn restore_file(
    backup: &Path,
    file_id: &str,
    archive: &suitedb::Db,
    live: &suitedb::Db,
    blobs: &BlobStore,
) -> Result<FileRestore> {
    verify_backup(backup)?;
    let file = backup_file(archive, file_id)?;
    if live.get("drive_item", file_id)?.is_some() {
        bail!("That file is already on this node.");
    }
    let versions = archive
        .query("SELECT * FROM drive_version", &[])?
        .into_iter()
        .filter(|row| text_of(row, "itemId").as_deref() == Some(file_id))
        .collect::<Vec<_>>();
    let mut hashes = Vec::new();
    for version in &versions {
        if let Some(hex) = text_of(version, "contentHash") {
            hashes.push(content_hash(&hex)?);
        }
    }
    if !hashes.is_empty() {
        restore_contents(backup, blobs, &hashes, false)?;
    }
    let grants = archive
        .query("SELECT * FROM drive_acl", &[])?
        .into_iter()
        .filter(|row| text_of(row, "itemId").as_deref() == Some(file_id))
        .collect::<Vec<_>>();
    let mut file_ids = BTreeSet::new();
    file_ids.insert(file_id.to_owned());
    let comments = missing_comments(archive, live, &file_ids)?;
    let accounts = missing_accounts(
        archive,
        live,
        &grants,
        &owner_ids(std::slice::from_ref(&file)),
    )?;
    let name = text_of(&file, "name").unwrap_or_default();
    let version_count = versions.len();
    let grant_count = grants.len();
    live.transact(|tx| {
        tx.upsert("drive_item", file_id, columns(&file))?;
        for row in &versions {
            let Some(id) = text_of(row, "id") else {
                continue;
            };
            tx.upsert("drive_version", &id, columns(row))?;
        }
        for row in &grants {
            let Some(id) = text_of(row, "id") else {
                continue;
            };
            tx.upsert("drive_acl", &id, columns(row))?;
        }
        for row in &comments {
            let Some(id) = text_of(row, "id") else {
                continue;
            };
            tx.upsert("drive_comment", &id, columns(row))?;
        }
        for row in &accounts {
            let Some(id) = text_of(row, "id") else {
                continue;
            };
            tx.upsert("user", &id, account_columns(row))?;
        }
        Ok(())
    })?;
    Ok(FileRestore {
        file_id: file_id.to_owned(),
        file_name: name,
        versions: version_count,
        grants: grant_count,
    })
}

/// Copy one backup version onto a file that is already on this node.
/// The file's current version stays. A missing version id is not repeated.
pub fn restore_version(
    backup: &Path,
    version_id: &str,
    archive: &suitedb::Db,
    live: &suitedb::Db,
    blobs: &BlobStore,
) -> Result<VersionRestore> {
    verify_backup(backup)?;
    let versions = archive.query("SELECT * FROM drive_version", &[])?;
    let Some(version) = versions
        .iter()
        .find(|row| text_of(row, "id").as_deref() == Some(version_id))
        .cloned()
    else {
        bail!("That version is not in this backup.");
    };
    let Some(file_id) = text_of(&version, "itemId") else {
        bail!("That version is not in this backup.");
    };
    if live.get("drive_item", &file_id)?.is_none() {
        bail!("That file is not on this node.");
    }
    if live.get("drive_version", version_id)?.is_some() {
        bail!("That version is already on this node.");
    }
    if let Some(hex) = text_of(&version, "contentHash") {
        let hash = content_hash(&hex)?;
        restore_contents(backup, blobs, &[hash], false)?;
    }
    live.transact(|tx| tx.upsert("drive_version", version_id, columns(&version)))?;
    Ok(VersionRestore {
        version_id: version_id.to_owned(),
        file_id,
    })
}

fn owner_ids(rows: &[BTreeMap<String, Value>]) -> BTreeSet<String> {
    rows.iter()
        .filter_map(|row| text_of(row, "ownerId"))
        .filter(|id| !id.is_empty())
        .collect()
}

fn missing_accounts(
    archive: &suitedb::Db,
    live: &suitedb::Db,
    grants: &[BTreeMap<String, Value>],
    owners: &BTreeSet<String>,
) -> Result<Vec<BTreeMap<String, Value>>> {
    let has_user = |db: &suitedb::Db| db.schema().tables.iter().any(|table| table.name == "user");
    if !has_user(archive) || !has_user(live) {
        return Ok(Vec::new());
    }
    let mut wanted = grants
        .iter()
        .filter(|row| text_of(row, "principalType").as_deref() == Some("user"))
        .filter_map(|row| text_of(row, "principalId"))
        .collect::<BTreeSet<_>>();
    wanted.extend(owners.iter().cloned());
    let mut accounts = Vec::new();
    for row in archive.query("SELECT * FROM user", &[])? {
        let Some(id) = text_of(&row, "id") else {
            continue;
        };
        if !wanted.contains(&id) {
            continue;
        }
        if live.get("user", &id)?.is_some() {
            continue;
        }
        accounts.push(row);
    }
    Ok(accounts)
}

fn folder_rows(items: &[BTreeMap<String, Value>], folder_id: &str) -> Vec<BTreeMap<String, Value>> {
    let mut chosen = Vec::new();
    let mut pending = vec![folder_id.to_owned()];
    while let Some(id) = pending.pop() {
        for row in items {
            if text_of(row, "id").as_deref() != Some(id.as_str()) {
                continue;
            }
            chosen.push(row.clone());
            for child in items {
                if text_of(child, "parentId").as_deref() == Some(id.as_str()) {
                    if let Some(child_id) = text_of(child, "id") {
                        pending.push(child_id);
                    }
                }
            }
        }
    }
    chosen
}

fn secret_column(key: &str) -> bool {
    let folded = key.to_ascii_lowercase().replace(['-', '_'], "");
    folded.contains("password")
        || folded.contains("passwd")
        || folded.contains("secret")
        || folded.contains("token")
        || folded.contains("authorization")
        || folded.contains("apikey")
        || folded.contains("credential")
        || folded.contains("privatekey")
}

fn account_columns(row: &BTreeMap<String, Value>) -> Vec<(String, Value)> {
    columns(row)
        .into_iter()
        .filter(|(key, _)| !secret_column(key))
        .collect()
}

/// Copy the organization sign-in row from a snapshot when the live database has none.
/// An existing row is left as it is. A client secret is not copied.
pub fn restore_auth_config(archive: &suitedb::Db, live: &suitedb::Db) -> Result<bool> {
    let has = |db: &suitedb::Db| {
        db.schema()
            .tables
            .iter()
            .any(|table| table.name == "auth_config")
    };
    if !has(archive) || !has(live) {
        return Ok(false);
    }
    let Some(row) = archive.get("auth_config", "organization")? else {
        return Ok(false);
    };
    if live.get("auth_config", "organization")?.is_some() {
        return Ok(false);
    }
    let stored = columns(&row)
        .into_iter()
        .filter(|(key, _)| !secret_column(key))
        .collect::<Vec<_>>();
    live.transact(|tx| tx.upsert("auth_config", "organization", stored))?;
    Ok(true)
}

/// Write every file, version, and grant from a snapshot into an empty database.
/// Content bytes are copied only after the archive checks out. A database that
/// already has a file is left unchanged. Account secrets and a client secret are not copied.
pub fn restore_clean(
    backup: &Path,
    archive: &suitedb::Db,
    live: &suitedb::Db,
    blobs: &BlobStore,
) -> Result<CleanRestore> {
    let manifest = verify_backup(backup)?;
    let existing = live.query("SELECT id FROM drive_item", &[])?;
    if !existing.is_empty() {
        bail!("This database already has files. Restore into an empty database.");
    }
    let versions = archive.query("SELECT * FROM drive_version", &[])?;
    for version in &versions {
        let Some(hex) = text_of(version, "contentHash") else {
            continue;
        };
        if hex.is_empty() {
            continue;
        }
        if !manifest
            .contents
            .iter()
            .any(|item| item.eq_ignore_ascii_case(&hex))
        {
            bail!("That file content is not in this backup.");
        }
    }
    restore_blobs(backup, blobs, false)?;
    for version in &versions {
        let Some(hex) = text_of(version, "contentHash") else {
            continue;
        };
        if hex.is_empty() {
            continue;
        }
        let hash: Hash = hex
            .parse()
            .context("That backup content id cannot be read.")?;
        blobs
            .get_content(&hash)?
            .context("That restored content is missing.")?;
    }
    import_snapshot(archive, live)
}

pub(crate) fn import_snapshot(archive: &suitedb::Db, live: &suitedb::Db) -> Result<CleanRestore> {
    let items = archive.query("SELECT * FROM drive_item", &[])?;
    let versions = archive.query("SELECT * FROM drive_version", &[])?;
    let grants = archive.query("SELECT * FROM drive_acl", &[])?;
    let accounts = missing_accounts(archive, live, &grants, &owner_ids(&items))?;
    let auth = restore_auth_config(archive, live)?;
    let item_count = items.len();
    let version_count = versions.len();
    let grant_count = grants.len();
    let account_count = accounts.len();
    live.transact(|tx| {
        for row in &items {
            let Some(id) = text_of(row, "id") else {
                continue;
            };
            tx.upsert("drive_item", &id, columns(row))?;
        }
        for row in &versions {
            let Some(id) = text_of(row, "id") else {
                continue;
            };
            tx.upsert("drive_version", &id, columns(row))?;
        }
        for row in &grants {
            let Some(id) = text_of(row, "id") else {
                continue;
            };
            tx.upsert("drive_acl", &id, columns(row))?;
        }
        for row in &accounts {
            let Some(id) = text_of(row, "id") else {
                continue;
            };
            tx.upsert("user", &id, account_columns(row))?;
        }
        Ok(())
    })?;
    Ok(CleanRestore {
        items: item_count,
        versions: version_count,
        grants: grant_count,
        accounts: account_count,
        auth,
    })
}

/// Comments on the named items whose ids are not already in the live database.
fn missing_comments(
    archive: &suitedb::Db,
    live: &suitedb::Db,
    item_ids: &BTreeSet<String>,
) -> Result<Vec<BTreeMap<String, Value>>> {
    let live_ids = live
        .query("SELECT id FROM drive_comment", &[])?
        .into_iter()
        .filter_map(|row| text_of(&row, "id"))
        .collect::<BTreeSet<_>>();
    Ok(archive
        .query("SELECT * FROM drive_comment", &[])?
        .into_iter()
        .filter(|row| text_of(row, "itemId").is_some_and(|id| item_ids.contains(&id)))
        .filter(|row| text_of(row, "id").is_some_and(|id| !live_ids.contains(&id)))
        .collect())
}

fn columns(row: &BTreeMap<String, Value>) -> Vec<(String, Value)> {
    row.iter()
        .filter(|(key, _)| key.as_str() != "id")
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
}

fn text_of(row: &BTreeMap<String, Value>, key: &str) -> Option<String> {
    match row.get(key) {
        Some(Value::Text(text)) => Some(text.clone()),
        _ => None,
    }
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BackupDue {
    pub due: bool,
    pub reason: String,
}

/// Whether `every_hours` has passed since `last`. Nothing is written.
/// A time that is not a real UTC time is not repeated.
pub fn backup_due(last: Option<&str>, every_hours: u32, now: &str) -> Result<BackupDue> {
    if !(1..=168).contains(&every_hours) {
        bail!("The backup schedule must be from 1 to 168 hours.");
    }
    let now_ms =
        parse_utc_ms(now).ok_or_else(|| anyhow::anyhow!("The current time is not a time."))?;
    let Some(last) = last.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(BackupDue {
            due: true,
            reason: "No backup has been recorded.".into(),
        });
    };
    let Some(last_ms) = parse_utc_ms(last) else {
        return Ok(BackupDue {
            due: false,
            reason: "The last backup time is not a time.".into(),
        });
    };
    if now_ms < last_ms {
        return Ok(BackupDue {
            due: false,
            reason: "That backup is newer than the current time.".into(),
        });
    }
    let elapsed_hours = (now_ms - last_ms) / 3_600_000;
    if elapsed_hours >= i64::from(every_hours) {
        Ok(BackupDue {
            due: true,
            reason: "A backup is due.".into(),
        })
    } else {
        Ok(BackupDue {
            due: false,
            reason: "The last backup is still inside the schedule.".into(),
        })
    }
}

/// `every_hours` is the operator's schedule text. A value that is not a whole number of hours is not repeated.
pub fn schedule_note(recorded_at: &str, every_hours: &str, now: &str) -> Result<BackupDue> {
    let hours: u32 = every_hours
        .trim()
        .parse()
        .map_err(|_| anyhow::anyhow!("The backup schedule must be from 1 to 168 hours."))?;
    let last = if recorded_at.trim().is_empty() {
        None
    } else {
        Some(recorded_at)
    };
    backup_due(last, hours, now)
}

fn parse_utc_ms(value: &str) -> Option<i64> {
    let value = value.trim();
    let (body, millis) = if let Some(prefix) = value.strip_suffix('Z') {
        if let Some((date, frac)) = prefix.split_once('.') {
            if frac.len() != 3 || !frac.chars().all(|char| char.is_ascii_digit()) {
                return None;
            }
            (date, frac.parse::<i64>().ok()?)
        } else {
            (prefix, 0)
        }
    } else {
        return None;
    };
    let (date, time) = body.split_once('T')?;
    let mut dates = date.split('-');
    let year: i32 = dates.next()?.parse().ok()?;
    let month: u32 = dates.next()?.parse().ok()?;
    let day: u32 = dates.next()?.parse().ok()?;
    if dates.next().is_some() {
        return None;
    }
    let mut times = time.split(':');
    let hour: i64 = times.next()?.parse().ok()?;
    let minute: i64 = times.next()?.parse().ok()?;
    let second: i64 = times.next()?.parse().ok()?;
    if times.next().is_some()
        || !(0..24).contains(&hour)
        || !(0..60).contains(&minute)
        || !(0..60).contains(&second)
    {
        return None;
    }
    if !(1970..=9999).contains(&year) || !real_day(year, month, day) {
        return None;
    }
    let mut days = 0i64;
    for past in 1970..year {
        days += if leap_year(past) { 366 } else { 365 };
    }
    let lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for past in 1..month {
        let extra = if past == 2 && leap_year(year) { 1 } else { 0 };
        days += lengths[(past - 1) as usize] + extra;
    }
    days += i64::from(day) - 1;
    Some((((days * 24 + hour) * 60 + minute) * 60 + second) * 1000 + millis)
}

fn leap_year(year: i32) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

fn real_day(year: i32, month: u32, day: u32) -> bool {
    if !(1..=12).contains(&month) || day < 1 {
        return false;
    }
    let lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let max = lengths[(month - 1) as usize] + if month == 2 && leap_year(year) { 1 } else { 0 };
    day <= max
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RetentionPlan {
    pub keep: Vec<String>,
    pub remove: Vec<String>,
    /// `recordedAt` of the newest copy. Empty when there are no copies.
    pub newest_recorded_at: Option<String>,
}

/// Which backup ids may be deleted. The newest copy is always kept.
/// A copy recorded at or after `keep_after` is kept. A missing time is kept.
/// Older copies stay until at least `keep_at_least` copies remain.
/// This function does not delete anything.
pub fn retention_plan(
    copies: &[(String, String)],
    keep_after: &str,
    keep_at_least: usize,
) -> RetentionPlan {
    let mut ordered: Vec<&(String, String)> = copies.iter().collect();
    ordered.sort_by(|left, right| right.1.cmp(&left.1).then(left.0.cmp(&right.0)));
    let newest_recorded_at = ordered.first().map(|copy| copy.1.clone());
    let mut keep = Vec::new();
    let mut older = Vec::new();
    for (index, (id, recorded_at)) in ordered.into_iter().enumerate() {
        let fresh = !recorded_at.is_empty() && recorded_at.as_str() >= keep_after;
        if index == 0 || fresh || recorded_at.is_empty() {
            keep.push(id.clone());
        } else {
            older.push(id.clone());
        }
    }
    let floor = keep_at_least.max(if copies.is_empty() { 0 } else { 1 });
    while keep.len() < floor {
        let Some(id) = older.first().cloned() else {
            break;
        };
        older.remove(0);
        keep.push(id);
    }
    RetentionPlan {
        keep,
        remove: older,
        newest_recorded_at,
    }
}

fn backup_dir_name(id: &str) -> Result<()> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        bail!("That backup name is not a single directory.");
    }
    Ok(())
}

/// Delete only directories the plan lists in `remove`. The newest kept copy
/// must still have `manifest.json`. A plan that would leave none is refused,
/// and nothing is deleted.
pub fn apply_retention(root: &Path, plan: &RetentionPlan) -> Result<Vec<String>> {
    for id in plan.keep.iter().chain(plan.remove.iter()) {
        backup_dir_name(id)?;
    }
    let kept = plan
        .keep
        .iter()
        .filter(|id| root.join(id).join("manifest.json").is_file())
        .count();
    if kept == 0 {
        bail!("retention would leave no backup");
    }
    let mut removed = Vec::new();
    for id in &plan.remove {
        if plan.keep.iter().any(|kept_id| kept_id == id) {
            continue;
        }
        let path = root.join(id);
        if path.is_dir() {
            fs::remove_dir_all(&path)?;
            removed.push(id.clone());
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blobs::BlobStore;

    fn write_copy(root: &Path, id: &str) {
        let dir = root.join(id);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("manifest.json"), b"{}").unwrap();
    }

    #[test]
    fn a_passwd_column_is_not_copied() {
        assert!(secret_column("passwd"));
        assert!(secret_column("password"));
        assert!(!secret_column("name"));
        assert!(!secret_column("email"));
    }

    #[test]
    fn retention_keeps_the_newest_backup_and_refuses_to_remove_the_last_one() {
        let root = tempfile::tempdir().unwrap();
        write_copy(root.path(), "monday");
        write_copy(root.path(), "tuesday");
        write_copy(root.path(), "wednesday");
        let copies = vec![
            ("monday".into(), "2026-10-26T00:00:00.000Z".into()),
            ("tuesday".into(), "2026-10-27T00:00:00.000Z".into()),
            ("wednesday".into(), "2026-10-28T00:00:00.000Z".into()),
        ];
        let plan = retention_plan(&copies, "2026-10-28T00:00:00.000Z", 1);
        assert_eq!(
            plan.newest_recorded_at.as_deref(),
            Some("2026-10-28T00:00:00.000Z")
        );
        assert_eq!(plan.keep, vec!["wednesday".to_string()]);
        assert_eq!(
            plan.remove,
            vec!["tuesday".to_string(), "monday".to_string()]
        );
        let removed = apply_retention(root.path(), &plan).unwrap();
        assert_eq!(removed, vec!["tuesday".to_string(), "monday".to_string()]);
        assert!(
            root.path()
                .join("wednesday")
                .join("manifest.json")
                .is_file()
        );
        assert!(!root.path().join("monday").exists());
        let only = retention_plan(
            &[("wednesday".into(), "2026-10-01T00:00:00.000Z".into())],
            "2026-10-28T00:00:00.000Z",
            0,
        );
        assert!(only.remove.is_empty());
        let wipe = RetentionPlan {
            keep: vec!["missing".into()],
            remove: vec!["wednesday".into()],
            newest_recorded_at: None,
        };
        let error = apply_retention(root.path(), &wipe).unwrap_err();
        assert!(error.to_string().contains("no backup"));
        let named = backup_dir_name("secret-value/beds").unwrap_err();
        assert_eq!(
            named.to_string(),
            "That backup name is not a single directory."
        );
        assert!(!named.to_string().contains("secret-value"));
        assert!(
            root.path()
                .join("wednesday")
                .join("manifest.json")
                .is_file()
        );
    }

    fn corrupt_first_blob(dest: &Path, manifest: &BackupManifest) {
        let hex = &manifest.blobs[0];
        let path = dest.join("blobs").join(&hex[..2]).join(&hex[2..]);
        let mut bytes = fs::read(&path).unwrap();
        bytes[0] ^= 0xff;
        fs::write(path, bytes).unwrap();
    }

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
    fn a_bad_content_id_is_not_repeated_when_a_folder_restore_stops() {
        use crate::{SCHEMA_VERSION, tables};
        use libp2p_identity::ed25519;
        use suitedb::{ColumnType, Db, Schema, TableDef, Value};

        let mut drive_tables = tables();
        drive_tables.push(
            TableDef::new("user", "id")
                .column("email", ColumnType::Text)
                .column("name", ColumnType::Text),
        );
        let schema = Schema {
            version: SCHEMA_VERSION,
            tables: drive_tables,
        };
        let archive_db = Db::open_in_memory(ed25519::Keypair::generate(), schema.clone()).unwrap();
        let live_db = Db::open_in_memory(ed25519::Keypair::generate(), schema).unwrap();
        let root = tempfile::tempdir().unwrap();
        let source = BlobStore::open(&root.path().join("source")).unwrap();
        let content = source.put_content(b"beds").unwrap();
        let dest = root.path().join("backup");
        export_backup(&source, &[content], "2026-10-30T22:00:00.000Z", &dest).unwrap();
        archive_db
            .transact(|tx| {
                tx.upsert(
                    "drive_item",
                    "beds",
                    [
                        ("parentId", Value::Text(String::new())),
                        ("name", Value::Text("Beds".into())),
                        ("kind", Value::Text("folder".into())),
                        ("ownerId", Value::Text("ada".into())),
                        ("mime", Value::Text(String::new())),
                        ("size", Value::Integer(0)),
                        ("headVersionId", Value::Text(String::new())),
                        ("createdAt", Value::Text("2026-10-30T22:00:00.000Z".into())),
                        ("updatedAt", Value::Text("2026-10-30T22:00:00.000Z".into())),
                        ("trashed", Value::Integer(0)),
                    ],
                )?;
                tx.upsert(
                    "drive_item",
                    "notes",
                    [
                        ("parentId", Value::Text("beds".into())),
                        ("name", Value::Text("Notes".into())),
                        ("kind", Value::Text("file".into())),
                        ("ownerId", Value::Text("ada".into())),
                        ("mime", Value::Text(String::new())),
                        ("size", Value::Integer(1)),
                        ("headVersionId", Value::Text("v".into())),
                        ("createdAt", Value::Text("2026-10-30T22:00:00.000Z".into())),
                        ("updatedAt", Value::Text("2026-10-30T22:00:00.000Z".into())),
                        ("trashed", Value::Integer(0)),
                    ],
                )?;
                tx.upsert(
                    "drive_version",
                    "v",
                    [
                        ("itemId", Value::Text("notes".into())),
                        ("contentHash", Value::Text("secret-value".into())),
                        ("size", Value::Integer(1)),
                        ("authorId", Value::Text("ada".into())),
                        ("createdAt", Value::Text("2026-10-30T22:00:00.000Z".into())),
                        ("name", Value::Text("Notes".into())),
                        ("restoredFrom", Value::Text(String::new())),
                    ],
                )?;
                Ok(())
            })
            .unwrap();
        let live_blobs = BlobStore::open(&root.path().join("live")).unwrap();
        let error = restore_folder(&dest, "beds", &archive_db, &live_db, &live_blobs)
            .unwrap_err()
            .to_string();
        assert_eq!(error, "A content id in this backup is not a content id.");
        assert!(!error.contains("secret-value"));
        assert!(live_db.get("drive_item", "notes").unwrap().is_none());
    }

    #[test]
    fn a_deleted_folder_comes_back_without_changing_another_file() {
        use crate::{SCHEMA_VERSION, tables};
        use libp2p_identity::ed25519;
        use suitedb::{ColumnType, Db, Schema, TableDef, Value};

        let mut drive_tables = tables();
        drive_tables.push(
            TableDef::new("user", "id")
                .column("email", ColumnType::Text)
                .column("name", ColumnType::Text)
                .column("password", ColumnType::Text)
                .column("apiKey", ColumnType::Text),
        );
        let schema = Schema {
            version: SCHEMA_VERSION,
            tables: drive_tables,
        };
        let archive_db = Db::open_in_memory(ed25519::Keypair::generate(), schema.clone()).unwrap();
        let live_db = Db::open_in_memory(ed25519::Keypair::generate(), schema).unwrap();
        let root = tempfile::tempdir().unwrap();
        let source = BlobStore::open(&root.path().join("source")).unwrap();
        let tomatoes = source.put_content(b"tomatoes").unwrap();
        let old_other = source.put_content(b"old other").unwrap();
        let stay = source.put_content(b"stay").unwrap();
        let item = |_id: &str, parent: &str, name: &str, kind: &str, version: &str| {
            vec![
                ("parentId", Value::Text(parent.into())),
                ("name", Value::Text(name.into())),
                ("kind", Value::Text(kind.into())),
                ("ownerId", Value::Text("ada".into())),
                ("mime", Value::Text("text/plain".into())),
                ("size", Value::Integer(1)),
                ("headVersionId", Value::Text(version.into())),
                ("createdAt", Value::Text("2026-10-30T22:00:00.000Z".into())),
                ("updatedAt", Value::Text("2026-10-30T22:00:00.000Z".into())),
                ("trashed", Value::Integer(0)),
            ]
        };
        archive_db
            .transact(|tx| {
                tx.upsert("drive_item", "beds", item("beds", "", "Beds", "folder", ""))?;
                tx.upsert(
                    "drive_item",
                    "tomatoes",
                    item("tomatoes", "beds", "Tomatoes", "file", "v-tomatoes"),
                )?;
                tx.upsert(
                    "drive_version",
                    "v-tomatoes",
                    [
                        ("itemId", Value::Text("tomatoes".into())),
                        ("contentHash", Value::Text(tomatoes.to_string())),
                        ("size", Value::Integer(8)),
                        ("authorId", Value::Text("ada".into())),
                        ("createdAt", Value::Text("2026-10-30T22:00:00.000Z".into())),
                        ("name", Value::Text("Tomatoes".into())),
                        ("restoredFrom", Value::Text(String::new())),
                    ],
                )?;
                tx.upsert(
                    "drive_item",
                    "other",
                    item("other", "", "Other", "file", "v-old"),
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
                    "user",
                    "noor",
                    [
                        ("email", Value::Text("noor@example.com".into())),
                        ("name", Value::Text("Noor".into())),
                    ],
                )?;
                tx.upsert(
                    "user",
                    "ada",
                    [
                        ("email", Value::Text("ada-old@example.com".into())),
                        ("name", Value::Text("Ada old".into())),
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
                    "drive_acl",
                    "acl-other-old",
                    [
                        ("itemId", Value::Text("other".into())),
                        ("principalType", Value::Text("user".into())),
                        ("principalId", Value::Text("sam".into())),
                        ("role", Value::Text("viewer".into())),
                        ("expiresAt", Value::Text(String::new())),
                    ],
                )?;
                tx.upsert(
                    "drive_version",
                    "v-old",
                    [
                        ("itemId", Value::Text("other".into())),
                        ("contentHash", Value::Text(old_other.to_string())),
                        ("size", Value::Integer(9)),
                        ("authorId", Value::Text("ada".into())),
                        ("createdAt", Value::Text("2026-10-30T22:00:00.000Z".into())),
                        ("name", Value::Text("Other".into())),
                        ("restoredFrom", Value::Text(String::new())),
                    ],
                )?;
                tx.upsert(
                    "drive_comment",
                    "c-water",
                    [
                        ("itemId", Value::Text("tomatoes".into())),
                        ("authorId", Value::Text("ada".into())),
                        ("body", Value::Text("Water the beds".into())),
                        ("createdAt", Value::Text("2026-10-30T22:00:00.000Z".into())),
                    ],
                )?;
                tx.upsert(
                    "drive_comment",
                    "c-kept",
                    [
                        ("itemId", Value::Text("tomatoes".into())),
                        ("authorId", Value::Text("ada".into())),
                        ("body", Value::Text("Old note".into())),
                        ("createdAt", Value::Text("2026-10-30T22:00:00.000Z".into())),
                    ],
                )?;
                tx.upsert(
                    "drive_comment",
                    "c-other",
                    [
                        ("itemId", Value::Text("other".into())),
                        ("authorId", Value::Text("ada".into())),
                        ("body", Value::Text("secret-value".into())),
                        ("createdAt", Value::Text("2026-10-30T22:00:00.000Z".into())),
                    ],
                )?;
                Ok(())
            })
            .unwrap();
        let mut tomatoes_row = archive_db.get("drive_item", "tomatoes").unwrap().unwrap();
        tomatoes_row.insert("ownerId".into(), Value::Text("priya".into()));
        archive_db
            .transact(|tx| {
                tx.upsert("drive_item", "tomatoes", columns(&tomatoes_row))?;
                tx.upsert(
                    "user",
                    "priya",
                    [
                        ("email", Value::Text("priya@example.com".into())),
                        ("name", Value::Text("Priya".into())),
                        ("password", Value::Text("secret-value".into())),
                        ("apiKey", Value::Text("secret-value".into())),
                    ],
                )?;
                Ok(())
            })
            .unwrap();
        live_db
            .transact(|tx| {
                tx.upsert(
                    "user",
                    "ada",
                    [
                        ("email", Value::Text("ada@example.com".into())),
                        ("name", Value::Text("Ada".into())),
                    ],
                )?;
                tx.upsert(
                    "drive_item",
                    "other",
                    item("other", "", "Other", "file", "v-stay"),
                )?;
                tx.upsert(
                    "drive_acl",
                    "acl-other",
                    [
                        ("itemId", Value::Text("other".into())),
                        ("principalType", Value::Text("user".into())),
                        ("principalId", Value::Text("sam".into())),
                        ("role", Value::Text("owner".into())),
                        ("expiresAt", Value::Text(String::new())),
                    ],
                )?;
                tx.upsert(
                    "drive_version",
                    "v-stay",
                    [
                        ("itemId", Value::Text("other".into())),
                        ("contentHash", Value::Text(stay.to_string())),
                        ("size", Value::Integer(4)),
                        ("authorId", Value::Text("ada".into())),
                        ("createdAt", Value::Text("2026-10-31T12:00:00.000Z".into())),
                        ("name", Value::Text("Other".into())),
                        ("restoredFrom", Value::Text(String::new())),
                    ],
                )?;
                tx.upsert(
                    "drive_comment",
                    "c-kept",
                    [
                        ("itemId", Value::Text("tomatoes".into())),
                        ("authorId", Value::Text("ada".into())),
                        ("body", Value::Text("Kept".into())),
                        ("createdAt", Value::Text("2026-11-01T12:00:00.000Z".into())),
                    ],
                )?;
                Ok(())
            })
            .unwrap();
        let dest = root.path().join("backup");
        export_backup_from_database(
            &source,
            &[tomatoes, old_other],
            "2026-10-30T22:00:00.000Z",
            &dest,
            &archive_db,
        )
        .unwrap();
        let live_blobs = BlobStore::open(&root.path().join("live-blobs")).unwrap();
        live_blobs.put_content(b"stay").unwrap();
        let restored = restore_folder(&dest, "beds", &archive_db, &live_db, &live_blobs).unwrap();
        assert_eq!(restored.folder_name, "Beds");
        assert_eq!(restored.items, 2);
        assert_eq!(restored.grants, 1);
        assert_eq!(restored.accounts, 2);
        let folder = live_db.get("drive_item", "beds").unwrap().unwrap();
        assert_eq!(folder["name"], Value::Text("Beds".into()));
        let file = live_db.get("drive_item", "tomatoes").unwrap().unwrap();
        assert_eq!(file["name"], Value::Text("Tomatoes".into()));
        assert_eq!(
            live_blobs.get_content(&tomatoes).unwrap().unwrap(),
            b"tomatoes"
        );
        let other = live_db.get("drive_item", "other").unwrap().unwrap();
        assert_eq!(other["headVersionId"], Value::Text("v-stay".into()));
        assert!(!live_blobs.has(&old_other));
        let version = live_db.get("drive_version", "v-stay").unwrap().unwrap();
        assert_eq!(version["contentHash"], Value::Text(stay.to_string()));
        let folder_grant = live_db.get("drive_acl", "acl-beds").unwrap().unwrap();
        assert_eq!(folder_grant["role"], Value::Text("editor".into()));
        assert_eq!(folder_grant["principalId"], Value::Text("sam".into()));
        let other_grant = live_db.get("drive_acl", "acl-other").unwrap().unwrap();
        assert_eq!(other_grant["role"], Value::Text("owner".into()));
        assert!(live_db.get("drive_acl", "acl-other-old").unwrap().is_none());
        let priya = live_db.get("user", "priya").unwrap().unwrap();
        assert_eq!(priya["name"], Value::Text("Priya".into()));
        assert_eq!(priya["email"], Value::Text("priya@example.com".into()));
        let blank = |value: Option<&Value>| match value {
            None | Some(Value::Null) => true,
            Some(Value::Text(text)) => text.is_empty(),
            Some(_) => false,
        };
        assert!(blank(priya.get("password")));
        assert!(blank(priya.get("apiKey")));
        assert!(!format!("{priya:?}").contains("secret-value"));
        let sam = live_db.get("user", "sam").unwrap().unwrap();
        assert!(!matches!(sam.get("password"), Some(Value::Text(text)) if !text.is_empty()));
        assert_eq!(sam["email"], Value::Text("sam@example.com".into()));
        assert!(live_db.get("user", "noor").unwrap().is_none());
        let ada = live_db.get("user", "ada").unwrap().unwrap();
        assert_eq!(ada["name"], Value::Text("Ada".into()));
        assert_eq!(
            live_db.get("drive_comment", "c-water").unwrap().unwrap()["body"],
            Value::Text("Water the beds".into())
        );
        assert_eq!(
            live_db.get("drive_comment", "c-kept").unwrap().unwrap()["body"],
            Value::Text("Kept".into())
        );
        assert!(live_db.get("drive_comment", "c-other").unwrap().is_none());
        let ripe = live_blobs.put_content(b"ripe").unwrap();
        let mut current = live_db.get("drive_item", "tomatoes").unwrap().unwrap();
        current.insert("name".into(), Value::Text("Ripe".into()));
        current.insert("headVersionId".into(), Value::Text("v-ripe".into()));
        live_db
            .transact(|tx| {
                tx.upsert(
                    "drive_version",
                    "v-ripe",
                    [
                        ("itemId", Value::Text("tomatoes".into())),
                        ("contentHash", Value::Text(ripe.to_string())),
                        ("size", Value::Integer(4)),
                        ("authorId", Value::Text("ada".into())),
                        ("createdAt", Value::Text("2026-11-01T18:00:00.000Z".into())),
                        ("name", Value::Text("Ripe".into())),
                        ("restoredFrom", Value::Text(String::new())),
                    ],
                )?;
                tx.upsert("drive_item", "tomatoes", columns(&current))?;
                tx.upsert(
                    "drive_comment",
                    "c-water",
                    [
                        ("itemId", Value::Text("tomatoes".into())),
                        ("authorId", Value::Text("ada".into())),
                        ("body", Value::Text("Ripe note".into())),
                        ("createdAt", Value::Text("2026-11-01T18:00:00.000Z".into())),
                    ],
                )?;
                tx.delete("drive_item", "beds")?;
                Ok(())
            })
            .unwrap();
        let kept = restore_folder(&dest, "beds", &archive_db, &live_db, &live_blobs).unwrap();
        assert_eq!(kept.items, 1);
        assert_eq!(
            live_db.get("drive_item", "tomatoes").unwrap().unwrap()["name"],
            Value::Text("Ripe".into())
        );
        assert_eq!(
            live_db.get("drive_item", "tomatoes").unwrap().unwrap()["headVersionId"],
            Value::Text("v-ripe".into())
        );
        assert_eq!(live_blobs.get_content(&ripe).unwrap().unwrap(), b"ripe");
        assert_eq!(
            live_db.get("drive_item", "beds").unwrap().unwrap()["name"],
            Value::Text("Beds".into())
        );
        assert_eq!(
            live_db.get("drive_item", "other").unwrap().unwrap()["headVersionId"],
            Value::Text("v-stay".into())
        );
        assert_eq!(
            live_db.get("drive_comment", "c-water").unwrap().unwrap()["body"],
            Value::Text("Ripe note".into())
        );
        assert!(live_db.get("drive_comment", "c-other").unwrap().is_none());
        assert!(!format!("{kept:?}").contains("secret-value"));
        live_db
            .transact(|tx| {
                tx.upsert(
                    "user",
                    "sam",
                    [
                        ("email", Value::Text("sam-live@example.com".into())),
                        ("name", Value::Text("Sam live".into())),
                    ],
                )
            })
            .unwrap();
        let again = restore_folder(&dest, "beds", &archive_db, &live_db, &live_blobs).unwrap();
        assert_eq!(again.accounts, 0);
        let sam_again = live_db.get("user", "sam").unwrap().unwrap();
        assert_eq!(
            sam_again["email"],
            Value::Text("sam-live@example.com".into())
        );
        let copied =
            restore_folder_copy(&dest, "beds", &archive_db, &live_db, &live_blobs).unwrap();
        assert_eq!(copied.folder_id, "copy-beds");
        assert_eq!(copied.folder_name, "Beds");
        assert_eq!(copied.accounts, 0);
        let copy = live_db.get("drive_item", "copy-beds").unwrap().unwrap();
        assert_eq!(copy["name"], Value::Text("Beds".into()));
        let original = live_db.get("drive_item", "beds").unwrap().unwrap();
        assert_eq!(original["name"], Value::Text("Beds".into()));
        let copy_file = live_db.get("drive_item", "copy-tomatoes").unwrap().unwrap();
        assert_eq!(copy_file["parentId"], Value::Text("copy-beds".into()));
        assert_eq!(
            copy_file["headVersionId"],
            Value::Text("copy-v-tomatoes".into())
        );
        let other_after = live_db.get("drive_item", "other").unwrap().unwrap();
        assert_eq!(other_after["headVersionId"], Value::Text("v-stay".into()));
        let copy_note = live_db
            .get("drive_comment", "copy-c-water")
            .unwrap()
            .unwrap();
        assert_eq!(copy_note["body"], Value::Text("Water the beds".into()));
        assert_eq!(copy_note["itemId"], Value::Text("copy-tomatoes".into()));
        assert!(
            live_db
                .get("drive_comment", "copy-c-other")
                .unwrap()
                .is_none()
        );
        let copy_grant = live_db.get("drive_acl", "copy-acl-beds").unwrap().unwrap();
        assert_eq!(copy_grant["role"], Value::Text("editor".into()));
        let sam_copy = live_db.get("user", "sam").unwrap().unwrap();
        assert!(!matches!(sam_copy.get("password"), Some(Value::Text(text)) if !text.is_empty()));
        let missing =
            restore_folder_copy(&dest, "secret-value", &archive_db, &live_db, &live_blobs)
                .unwrap_err()
                .to_string();
        assert!(!missing.contains("secret-value"));
        let twice = restore_folder_copy(&dest, "beds", &archive_db, &live_db, &live_blobs)
            .unwrap_err()
            .to_string();
        assert_eq!(twice, "That copy is already in this database.");
        live_db
            .transact(|tx| {
                tx.delete("drive_item", "tomatoes")?;
                tx.delete("drive_version", "v-tomatoes")?;
                tx.delete("drive_comment", "c-water")?;
                Ok(())
            })
            .unwrap();
        let plan = plan_file_restore(&dest, "tomatoes", &archive_db, &live_db).unwrap();
        assert_eq!(plan.file_name, "Tomatoes");
        assert_eq!(plan.versions, 1);
        assert!(live_db.get("drive_item", "tomatoes").unwrap().is_none());
        let brought = restore_file(&dest, "tomatoes", &archive_db, &live_db, &live_blobs).unwrap();
        assert_eq!(brought.file_name, "Tomatoes");
        assert_eq!(brought.versions, 1);
        assert_eq!(
            live_db.get("drive_item", "tomatoes").unwrap().unwrap()["name"],
            Value::Text("Tomatoes".into())
        );
        assert_eq!(
            live_blobs.get_content(&tomatoes).unwrap().unwrap(),
            b"tomatoes"
        );
        assert_eq!(
            live_db.get("drive_comment", "c-water").unwrap().unwrap()["body"],
            Value::Text("Water the beds".into())
        );
        assert_eq!(
            live_db.get("drive_comment", "c-kept").unwrap().unwrap()["body"],
            Value::Text("Kept".into())
        );
        assert_eq!(
            live_db.get("drive_item", "other").unwrap().unwrap()["headVersionId"],
            Value::Text("v-stay".into())
        );
        let present = restore_file(&dest, "tomatoes", &archive_db, &live_db, &live_blobs)
            .unwrap_err()
            .to_string();
        assert_eq!(present, "That file is already on this node.");
        let folder = restore_file(&dest, "beds", &archive_db, &live_db, &live_blobs)
            .unwrap_err()
            .to_string();
        assert_eq!(folder, "That backup item is not a file.");
        let missing_file = restore_file(&dest, "secret-value", &archive_db, &live_db, &live_blobs)
            .unwrap_err()
            .to_string();
        assert!(!missing_file.contains("secret-value"));
        let older = restore_version(&dest, "v-old", &archive_db, &live_db, &live_blobs).unwrap();
        assert_eq!(older.file_id, "other");
        assert_eq!(
            live_db.get("drive_item", "other").unwrap().unwrap()["headVersionId"],
            Value::Text("v-stay".into())
        );
        assert_eq!(
            live_blobs.get_content(&old_other).unwrap().unwrap(),
            b"old other"
        );
        let again = restore_version(&dest, "v-old", &archive_db, &live_db, &live_blobs)
            .unwrap_err()
            .to_string();
        assert_eq!(again, "That version is already on this node.");
        let missing_version =
            restore_version(&dest, "secret-value", &archive_db, &live_db, &live_blobs)
                .unwrap_err()
                .to_string();
        assert!(!missing_version.contains("secret-value"));
        assert_eq!(
            live_db.get("drive_item", "beds").unwrap().unwrap()["name"],
            Value::Text("Beds".into())
        );
    }

    #[test]
    fn a_clean_database_gets_the_sign_in_settings_without_the_client_secret() {
        use libp2p_identity::ed25519;
        use suitedb::{ColumnType, Db, Schema, TableDef, Value};

        let schema = Schema {
            version: 1,
            tables: vec![
                TableDef::new("auth_config", "id")
                    .column("issuer", ColumnType::Text)
                    .column("audience", ColumnType::Text)
                    .column("idleSecs", ColumnType::Integer)
                    .column("clientSecret", ColumnType::Text),
            ],
        };
        let archive = Db::open_in_memory(ed25519::Keypair::generate(), schema.clone()).unwrap();
        let live = Db::open_in_memory(ed25519::Keypair::generate(), schema).unwrap();
        archive
            .transact(|tx| {
                tx.upsert(
                    "auth_config",
                    "organization",
                    [
                        ("issuer", Value::Text("https://idp.example".into())),
                        ("audience", Value::Text("suiteleaf".into())),
                        ("idleSecs", Value::Integer(1800)),
                        ("clientSecret", Value::Text("secret-value".into())),
                    ],
                )
            })
            .unwrap();
        assert!(restore_auth_config(&archive, &live).unwrap());
        let row = live.get("auth_config", "organization").unwrap().unwrap();
        assert_eq!(row["issuer"], Value::Text("https://idp.example".into()));
        assert_eq!(row["audience"], Value::Text("suiteleaf".into()));
        assert_eq!(row["idleSecs"], Value::Integer(1800));
        assert!(!matches!(row.get("clientSecret"), Some(Value::Text(text)) if !text.is_empty()));
        live.transact(|tx| {
            tx.upsert(
                "auth_config",
                "organization",
                [("issuer", Value::Text("https://kept.example".into()))],
            )
        })
        .unwrap();
        assert!(!restore_auth_config(&archive, &live).unwrap());
        let kept = live.get("auth_config", "organization").unwrap().unwrap();
        assert_eq!(kept["issuer"], Value::Text("https://kept.example".into()));
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

    #[test]
    fn a_clean_database_gets_the_snapshot_and_a_used_database_is_left_alone() {
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
        let archive = Db::open_in_memory(ed25519::Keypair::generate(), schema.clone()).unwrap();
        let live = Db::open_in_memory(ed25519::Keypair::generate(), schema.clone()).unwrap();
        let root = tempfile::tempdir().unwrap();
        let source = BlobStore::open(&root.path().join("source")).unwrap();
        let tomatoes = source.put_content(b"tomatoes").unwrap();
        let other = source.put_content(b"old other").unwrap();
        let item = |parent: &str, name: &str, kind: &str, version: &str| {
            vec![
                ("parentId", Value::Text(parent.into())),
                ("name", Value::Text(name.into())),
                ("kind", Value::Text(kind.into())),
                ("ownerId", Value::Text("ada".into())),
                ("mime", Value::Text("text/plain".into())),
                ("size", Value::Integer(1)),
                ("headVersionId", Value::Text(version.into())),
                ("createdAt", Value::Text("2026-10-30T22:00:00.000Z".into())),
                ("updatedAt", Value::Text("2026-10-30T22:00:00.000Z".into())),
                ("trashed", Value::Integer(0)),
            ]
        };
        archive
            .transact(|tx| {
                tx.upsert("drive_item", "beds", item("", "Beds", "folder", ""))?;
                tx.upsert(
                    "drive_item",
                    "tomatoes",
                    item("beds", "Tomatoes", "file", "v-tomatoes"),
                )?;
                tx.upsert("drive_item", "other", item("", "Other", "file", "v-other"))?;
                tx.upsert(
                    "drive_version",
                    "v-tomatoes",
                    [
                        ("itemId", Value::Text("tomatoes".into())),
                        ("contentHash", Value::Text(tomatoes.to_string())),
                        ("size", Value::Integer(8)),
                        ("authorId", Value::Text("ada".into())),
                        ("createdAt", Value::Text("2026-10-30T22:00:00.000Z".into())),
                        ("name", Value::Text("Tomatoes".into())),
                        ("restoredFrom", Value::Text(String::new())),
                    ],
                )?;
                tx.upsert(
                    "drive_version",
                    "v-other",
                    [
                        ("itemId", Value::Text("other".into())),
                        ("contentHash", Value::Text(other.to_string())),
                        ("size", Value::Integer(9)),
                        ("authorId", Value::Text("ada".into())),
                        ("createdAt", Value::Text("2026-10-30T22:00:00.000Z".into())),
                        ("name", Value::Text("Other".into())),
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
                    "user",
                    "noor",
                    [
                        ("email", Value::Text("noor@example.com".into())),
                        ("name", Value::Text("Noor".into())),
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
                    "drive_acl",
                    "acl-other",
                    [
                        ("itemId", Value::Text("other".into())),
                        ("principalType", Value::Text("user".into())),
                        ("principalId", Value::Text("sam".into())),
                        ("role", Value::Text("viewer".into())),
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
        let dest = root.path().join("backup");
        export_backup_from_database(
            &source,
            &[tomatoes, other],
            "2026-10-30T22:00:00.000Z",
            &dest,
            &archive,
        )
        .unwrap();
        let busy = Db::open_in_memory(ed25519::Keypair::generate(), schema.clone()).unwrap();
        busy.transact(|tx| tx.upsert("drive_item", "notes", item("", "Notes", "file", "")))
            .unwrap();
        let untouched = BlobStore::open(&root.path().join("untouched")).unwrap();
        let error = restore_clean(&dest, &archive, &busy, &untouched).unwrap_err();
        assert!(error.to_string().contains("already has files"));
        assert_eq!(
            busy.get("drive_item", "notes").unwrap().unwrap()["name"],
            Value::Text("Notes".into())
        );
        assert!(busy.get("drive_item", "beds").unwrap().is_none());
        assert!(!untouched.has(&tomatoes));

        let restored_blobs = BlobStore::open(&root.path().join("restored")).unwrap();
        let restored = restore_clean(&dest, &archive, &live, &restored_blobs).unwrap();
        assert_eq!(restored.items, 3);
        assert_eq!(restored.versions, 2);
        assert_eq!(restored.grants, 2);
        assert_eq!(restored.accounts, 1);
        assert!(restored.auth);
        assert_eq!(
            live.get("drive_item", "beds").unwrap().unwrap()["name"],
            Value::Text("Beds".into())
        );
        assert_eq!(
            live.get("drive_item", "tomatoes").unwrap().unwrap()["headVersionId"],
            Value::Text("v-tomatoes".into())
        );
        assert_eq!(
            live.get("drive_item", "other").unwrap().unwrap()["headVersionId"],
            Value::Text("v-other".into())
        );
        assert_eq!(
            restored_blobs.get_content(&tomatoes).unwrap().unwrap(),
            b"tomatoes"
        );
        assert_eq!(
            restored_blobs.get_content(&other).unwrap().unwrap(),
            b"old other"
        );
        let sam = live.get("user", "sam").unwrap().unwrap();
        assert_eq!(sam["email"], Value::Text("sam@example.com".into()));
        assert!(!matches!(sam.get("password"), Some(Value::Text(text)) if !text.is_empty()));
        assert!(live.get("user", "noor").unwrap().is_none());
        let sign_in = live.get("auth_config", "organization").unwrap().unwrap();
        assert_eq!(sign_in["issuer"], Value::Text("https://idp.example".into()));
        assert_eq!(sign_in["audience"], Value::Text("suiteleaf".into()));
        assert!(
            !matches!(sign_in.get("clientSecret"), Some(Value::Text(text)) if !text.is_empty())
        );

        let mut listed: BackupManifest =
            serde_json::from_slice(&fs::read(dest.join("manifest.json")).unwrap()).unwrap();
        let hidden = listed.contents.remove(0);
        fs::write(
            dest.join("manifest.json"),
            serde_json::to_vec_pretty(&listed).unwrap(),
        )
        .unwrap();
        let again = Db::open_in_memory(ed25519::Keypair::generate(), schema.clone()).unwrap();
        let held = BlobStore::open(&root.path().join("held")).unwrap();
        let missing = restore_clean(&dest, &archive, &again, &held).unwrap_err();
        let text = missing.to_string();
        assert!(text.contains("That file content is not in this backup."));
        assert!(!text.contains(&hidden));
        assert!(again.get("drive_item", "tomatoes").unwrap().is_none());
        assert!(!held.has(&tomatoes));
    }

    #[test]
    fn a_backup_is_due_after_the_scheduled_hours() {
        let due = backup_due(None, 24, "2026-11-02T00:00:00.000Z").unwrap();
        assert!(due.due);
        assert_eq!(due.reason, "No backup has been recorded.");
        let waiting = backup_due(
            Some("2026-11-01T00:00:00.000Z"),
            24,
            "2026-11-01T12:00:00.000Z",
        )
        .unwrap();
        assert!(!waiting.due);
        assert_eq!(
            waiting.reason,
            "The last backup is still inside the schedule."
        );
        let ready = backup_due(
            Some("2026-11-01T00:00:00.000Z"),
            24,
            "2026-11-02T00:00:00.000Z",
        )
        .unwrap();
        assert!(ready.due);
        assert_eq!(ready.reason, "A backup is due.");
        let bad = backup_due(Some("secret-value"), 24, "2026-11-02T00:00:00.000Z").unwrap();
        assert!(!bad.due);
        assert_eq!(bad.reason, "The last backup time is not a time.");
        assert!(!bad.reason.contains("secret-value"));
        let impossible = backup_due(
            Some("2026-02-31T00:00:00.000Z"),
            24,
            "2026-11-02T00:00:00.000Z",
        )
        .unwrap();
        assert!(!impossible.due);
        let hours = schedule_note(
            "2026-11-01T00:00:00.000Z",
            "secret-value",
            "2026-11-02T00:00:00.000Z",
        )
        .unwrap_err()
        .to_string();
        assert_eq!(hours, "The backup schedule must be from 1 to 168 hours.");
        assert!(!hours.contains("secret-value"));
        let leap = backup_due(
            Some("2024-02-29T00:00:00.000Z"),
            1,
            "2024-02-29T01:00:00.000Z",
        )
        .unwrap();
        assert!(leap.due);
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
