//! A whole snapshot written into an empty database, and the sign-in settings with it.

use std::path::Path;

use anyhow::{Context, Result, bail};

use crate::blobs::{BlobStore, Hash};

use super::{
    archive::{restore_blobs, verify_backup},
    rows::{account_columns, columns, missing_accounts, owner_ids, secret_column, text_of},
};

/// A whole snapshot written into an empty database.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CleanRestore {
    pub items: usize,
    pub versions: usize,
    pub grants: usize,
    pub accounts: usize,
    pub auth: bool,
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
    // Keep the organization's public-sharing policy, but never revive link secrets.
    // Older snapshots predate this table.
    let settings = if archive.schema().table("drive_setting").is_some()
        && live.schema().table("drive_setting").is_some()
    {
        archive.query("SELECT * FROM drive_setting", &[])?
    } else {
        Vec::new()
    };
    let item_count = items.len();
    let version_count = versions.len();
    let grant_count = grants.len();
    let account_count = accounts.len();
    live.transact(|tx| {
        for row in &settings {
            if let Some(id) = text_of(row, "id") {
                tx.upsert("drive_setting", &id, columns(row))?;
            }
        }
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

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use crate::backup::{BackupManifest, export_backup_from_database};

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
                tx.upsert(
                    "drive_setting",
                    "public-sharing",
                    [("value", Value::from("0"))],
                )?;
                tx.upsert(
                    "drive_public_link",
                    "tomatoes",
                    [("token", Value::from("old-secret"))],
                )?;
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
            live.get("drive_setting", "public-sharing")
                .unwrap()
                .unwrap()["value"],
            Value::from("0")
        );
        assert!(live.get("drive_public_link", "tomatoes").unwrap().is_none());
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
    fn a_restore_keeps_the_live_email_and_password() {
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
        let beds = source.put_content(b"beds").unwrap();
        archive
            .transact(|tx| {
                tx.upsert(
                    "drive_item",
                    "beds",
                    [
                        ("parentId", Value::Text(String::new())),
                        ("name", Value::Text("Beds".into())),
                        ("kind", Value::Text("file".into())),
                        ("ownerId", Value::Text("rosa".into())),
                        ("mime", Value::Text("text/plain".into())),
                        ("size", Value::Integer(4)),
                        ("headVersionId", Value::Text("v1".into())),
                        ("createdAt", Value::Text("2026-11-03T00:00:00.000Z".into())),
                        ("updatedAt", Value::Text("2026-11-03T00:00:00.000Z".into())),
                        ("trashed", Value::Integer(0)),
                        ("restricted", Value::Integer(0)),
                    ],
                )?;
                tx.upsert(
                    "drive_version",
                    "v1",
                    [
                        ("itemId", Value::Text("beds".into())),
                        ("contentHash", Value::Text(beds.to_string())),
                        ("size", Value::Integer(4)),
                        ("authorId", Value::Text("rosa".into())),
                        ("createdAt", Value::Text("2026-11-03T00:00:00.000Z".into())),
                        ("name", Value::Text(String::new())),
                        ("restoredFrom", Value::Text(String::new())),
                    ],
                )?;
                tx.upsert(
                    "user",
                    "sam",
                    [
                        ("name", Value::Text("Sam".into())),
                        ("email", Value::Text("secret-value".into())),
                        ("password", Value::Text("secret-value".into())),
                    ],
                )?;
                tx.upsert(
                    "drive_acl",
                    "beds:user:sam",
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
                        ("clientSecret", Value::Text("secret-value".into())),
                    ],
                )
            })
            .unwrap();
        live.transact(|tx| {
            tx.upsert(
                "user",
                "sam",
                [
                    ("name", Value::Text("Other".into())),
                    ("email", Value::Text("other@example".into())),
                    ("password", Value::Text("kept".into())),
                ],
            )
        })
        .unwrap();
        let dest = root.path().join("backup");
        export_backup_from_database(
            &source,
            &[beds],
            "2026-11-03T00:00:00.000Z",
            &dest,
            &archive,
        )
        .unwrap();
        let restored_blobs = BlobStore::open(&root.path().join("restored")).unwrap();
        let restored = restore_clean(&dest, &archive, &live, &restored_blobs).unwrap();
        assert_eq!(restored.grants, 1);
        assert_eq!(restored.items, 1);
        assert_eq!(
            live.get("drive_acl", "beds:user:sam").unwrap().unwrap()["role"],
            Value::Text("editor".into())
        );
        assert!(restored_blobs.has(&beds));
        let sam = live.get("user", "sam").unwrap().unwrap();
        assert_eq!(sam["email"], Value::Text("other@example".into()));
        assert_eq!(sam["password"], Value::Text("kept".into()));
        assert!(!format!("{sam:?}").contains("secret-value"));

        let sign_in_live = Db::open_in_memory(ed25519::Keypair::generate(), schema).unwrap();
        sign_in_live
            .transact(|tx| {
                tx.upsert(
                    "auth_config",
                    "organization",
                    [("issuer", Value::Text("https://kept.example".into()))],
                )
            })
            .unwrap();
        let sign_in_blobs = BlobStore::open(&root.path().join("sign-in")).unwrap();
        restore_clean(&dest, &archive, &sign_in_live, &sign_in_blobs).unwrap();
        let sign_in = sign_in_live
            .get("auth_config", "organization")
            .unwrap()
            .unwrap();
        assert_eq!(
            sign_in["issuer"],
            Value::Text("https://kept.example".into())
        );
        assert!(!format!("{sign_in:?}").contains("secret-value"));
        assert!(sign_in_live.get("drive_item", "beds").unwrap().is_some());
    }
}
