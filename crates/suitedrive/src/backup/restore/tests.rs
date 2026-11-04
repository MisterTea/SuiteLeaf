use super::*;
use crate::backup::{export_backup, export_backup_from_database};

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
    let copied = restore_folder_copy(&dest, "beds", &archive_db, &live_db, &live_blobs).unwrap();
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
    let missing = restore_folder_copy(&dest, "secret-value", &archive_db, &live_db, &live_blobs)
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
fn a_folder_restore_keeps_the_live_email() {
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
    let schema = Schema {
        version: SCHEMA_VERSION,
        tables: drive_tables,
    };
    let archive = Db::open_in_memory(ed25519::Keypair::generate(), schema.clone()).unwrap();
    let live = Db::open_in_memory(ed25519::Keypair::generate(), schema).unwrap();
    let root = tempfile::tempdir().unwrap();
    let source = BlobStore::open(&root.path().join("source")).unwrap();
    let notes = source.put_content(b"beds").unwrap();
    archive
        .transact(|tx| {
            tx.upsert(
                "drive_item",
                "beds",
                [
                    ("parentId", Value::Text(String::new())),
                    ("name", Value::Text("Beds".into())),
                    ("kind", Value::Text("folder".into())),
                    ("ownerId", Value::Text("rosa".into())),
                    ("mime", Value::Text(String::new())),
                    ("size", Value::Integer(0)),
                    ("headVersionId", Value::Text(String::new())),
                    ("createdAt", Value::Text("2026-11-03T00:00:00.000Z".into())),
                    ("updatedAt", Value::Text("2026-11-03T00:00:00.000Z".into())),
                    ("trashed", Value::Integer(0)),
                    ("restricted", Value::Integer(0)),
                ],
            )?;
            tx.upsert(
                "drive_item",
                "notes",
                [
                    ("parentId", Value::Text("beds".into())),
                    ("name", Value::Text("Notes".into())),
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
                    ("itemId", Value::Text("notes".into())),
                    ("contentHash", Value::Text(notes.to_string())),
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
        )?;
        tx.upsert(
            "drive_item",
            "stay",
            [
                ("parentId", Value::Text(String::new())),
                ("name", Value::Text("Stay".into())),
                ("kind", Value::Text("file".into())),
                ("ownerId", Value::Text("rosa".into())),
                ("mime", Value::Text(String::new())),
                ("size", Value::Integer(0)),
                ("headVersionId", Value::Text(String::new())),
                ("createdAt", Value::Text("2026-11-03T00:00:00.000Z".into())),
                ("updatedAt", Value::Text("2026-11-03T00:00:00.000Z".into())),
                ("trashed", Value::Integer(0)),
                ("restricted", Value::Integer(0)),
            ],
        )
    })
    .unwrap();
    let dest = root.path().join("backup");
    export_backup_from_database(
        &source,
        &[notes],
        "2026-11-03T00:00:00.000Z",
        &dest,
        &archive,
    )
    .unwrap();
    let live_blobs = BlobStore::open(&root.path().join("live")).unwrap();
    let restored = restore_folder(&dest, "beds", &archive, &live, &live_blobs).unwrap();
    assert_eq!(restored.grants, 1);
    assert!(live.get("drive_item", "notes").unwrap().is_some());
    assert_eq!(
        live.get("drive_acl", "beds:user:sam").unwrap().unwrap()["role"],
        Value::Text("editor".into())
    );
    assert_eq!(
        live.get("drive_item", "stay").unwrap().unwrap()["name"],
        Value::Text("Stay".into())
    );
    assert!(live_blobs.has(&notes));
    let sam = live.get("user", "sam").unwrap().unwrap();
    assert_eq!(sam["email"], Value::Text("other@example".into()));
    assert_eq!(sam["password"], Value::Text("kept".into()));
    assert!(!format!("{sam:?}").contains("secret-value"));
}
