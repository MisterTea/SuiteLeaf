//! Open a sealed backup when the original node is not running.
//! The 32-byte key is not in the sealed file. Losing it means this copy cannot be opened.
//! A node identity and a swarm key are not in the snapshot.

use std::{fs, path::Path};

use anyhow::{Result, bail};
use libp2p_identity::ed25519;
use suitedb::Db;

use crate::blobs::BlobStore;
use crate::seal::open_sealed;

/// Decrypt `sealed` and write its files, grants, accounts, and sign-in settings
/// into an empty database. Passwords and client secrets are not copied.
/// A wrong key writes nothing.
pub fn recover_sealed(
    sealed: &Path,
    key: &[u8],
    schema: &suitedb::Schema,
    database: &Path,
    blobs: &Path,
) -> Result<crate::backup::CleanRestore> {
    let plain = database.with_extension("recover-plain");
    if plain.exists() {
        fs::remove_dir_all(&plain)?;
    }
    open_sealed(sealed, key, &plain)?;
    let restored = (|| -> Result<crate::backup::CleanRestore> {
        if !plain.join("database.sqlite").is_file() {
            bail!("That backup has no database snapshot.");
        }
        let copy = plain.join(".database-copy.sqlite");
        fs::copy(plain.join("database.sqlite"), &copy)?;
        let archive = Db::open(&copy, ed25519::Keypair::generate(), schema.clone())?;
        if let Some(parent) = database.parent() {
            fs::create_dir_all(parent)?;
        }
        if let Some(parent) = blobs.parent() {
            fs::create_dir_all(parent)?;
        }
        let live = Db::open(database, ed25519::Keypair::generate(), schema.clone())?;
        let store = BlobStore::open(blobs)?;
        crate::backup::restore_clean(&plain, &archive, &live, &store)
    })();
    let _ = fs::remove_dir_all(&plain);
    restored
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blobs::BlobStore;
    use crate::seal::scheduled_seal;
    use suitedb::{ColumnType, Schema, TableDef, Value};

    #[test]
    fn a_sealed_copy_restores_without_the_original_database() {
        let mut tables = crate::tables();
        tables.push(
            TableDef::new("user", "id")
                .column("name", ColumnType::Text)
                .column("email", ColumnType::Text)
                .column("password", ColumnType::Text),
        );
        tables.push(
            TableDef::new("auth_config", "id")
                .column("issuer", ColumnType::Text)
                .column("clientSecret", ColumnType::Text),
        );
        let schema = Schema {
            version: crate::SCHEMA_VERSION,
            tables,
        };
        let original = Db::open_in_memory(ed25519::Keypair::generate(), schema.clone()).unwrap();
        let root = tempfile::tempdir().unwrap();
        let source = BlobStore::open(&root.path().join("live")).unwrap();
        let content = source.put_content(b"beds").unwrap();
        original
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
                        ("contentHash", Value::Text(content.to_string())),
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
                        ("email", Value::Text("sam@example".into())),
                        ("password", Value::Text("secret-value".into())),
                    ],
                )?;
                tx.upsert(
                    "auth_config",
                    "organization",
                    [
                        ("issuer", Value::Text("https://idp.example".into())),
                        ("clientSecret", Value::Text("secret-value".into())),
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
                )
            })
            .unwrap();
        let key = [7u8; 32];
        let sealed = root.path().join("away").join("backup.seal");
        scheduled_seal(
            &source,
            &[content],
            &root.path().join("fresh"),
            "24",
            "2026-11-03T00:00:00.000Z",
            &key,
            &root.path().join("sealed").join("backup.seal"),
            &sealed,
            Some(&original),
        )
        .unwrap();
        drop(original);
        let database = root.path().join("recovered").join("db.sqlite");
        let blobs = root.path().join("recovered").join("blobs");
        let bad_key = recover_sealed(&sealed, b"secret-value", &schema, &database, &blobs)
            .unwrap_err()
            .to_string();
        assert_eq!(bad_key, "The backup key must be 32 bytes.");
        assert!(!bad_key.contains("secret-value"));
        assert!(!database.exists());
        let wrong = recover_sealed(&sealed, &[9u8; 32], &schema, &database, &blobs).unwrap_err();
        assert!(!wrong.to_string().contains("secret-value"));
        assert!(!database.exists());
        let restored = recover_sealed(&sealed, &key, &schema, &database, &blobs).unwrap();
        assert_eq!(restored.grants, 1);
        assert_eq!(restored.accounts, 1);
        assert!(restored.auth);
        let live = Db::open(&database, ed25519::Keypair::generate(), schema).unwrap();
        let grant = live.get("drive_acl", "beds:user:sam").unwrap().unwrap();
        assert_eq!(grant["role"], Value::Text("editor".into()));
        let sam = live.get("user", "sam").unwrap().unwrap();
        assert_eq!(sam["email"], Value::Text("sam@example".into()));
        assert!(!format!("{sam:?}").contains("secret-value"));
        let sign_in = live.get("auth_config", "organization").unwrap().unwrap();
        assert_eq!(sign_in["issuer"], Value::Text("https://idp.example".into()));
        assert!(!format!("{sign_in:?}").contains("secret-value"));
        assert_eq!(
            BlobStore::open(&blobs)
                .unwrap()
                .get_content(&content)
                .unwrap()
                .unwrap(),
            b"beds"
        );
    }
}
