//! Bringing one folder, file, or version back from a backup's database copy.
//! Rows already on this node are left as they are.

use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

use anyhow::{Context, Result, bail};
use suitedb::Value;

use crate::blobs::{BlobStore, Hash};

use super::{
    archive::{restore_contents, verify_backup},
    rows::{
        account_columns, columns, folder_rows, missing_accounts, missing_comments, owner_ids,
        text_of,
    },
};

fn content_hash(hex: &str) -> Result<Hash> {
    hex.parse::<Hash>()
        .map_err(|_| anyhow::anyhow!("A content id in this backup is not a content id."))
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

#[cfg(test)]
mod tests;
