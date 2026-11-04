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
        None,
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
        None,
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
        None,
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
        None,
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
    let fresh = crate::backup::backup_freshness(&root.path().join("fresh")).unwrap();
    assert!(fresh.restore_tested);
    assert_eq!(fresh.drilled_at, "2026-11-02T00:00:00.000Z");
    assert!(!format!("{fresh:?}").contains("secret-value"));
    assert!(!root.path().join("fresh").join(".scheduled-drill").exists());
    let second = scheduled_seal(
        &source,
        &[content],
        &root.path().join("fresh"),
        "24",
        "2026-11-02T12:00:00.000Z",
        b"secret-value",
        &root.path().join("sealed").join("again.seal"),
        &root.path().join("away").join("again.seal"),
        None,
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
        None,
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
        None,
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

#[test]
fn a_scheduled_seal_restores_the_grant_into_an_empty_database() {
    use crate::SCHEMA_VERSION;
    use libp2p_identity::ed25519;
    use suitedb::{ColumnType, Db, Schema, TableDef, Value};

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
        version: SCHEMA_VERSION,
        tables,
    };
    let database = Db::open_in_memory(ed25519::Keypair::generate(), schema.clone()).unwrap();
    let root = tempfile::tempdir().unwrap();
    let source = BlobStore::open(&root.path().join("live")).unwrap();
    let content = source.put_content(b"beds").unwrap();
    database
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
                "user",
                "noor",
                [
                    ("name", Value::Text("Noor".into())),
                    ("email", Value::Text("noor@example".into())),
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
    let sealed = scheduled_seal(
        &source,
        &[content],
        &root.path().join("fresh"),
        "24",
        "2026-11-03T00:00:00.000Z",
        &key,
        &root.path().join("sealed").join("backup.seal"),
        &root.path().join("away").join("backup.seal"),
        Some(&database),
    )
    .unwrap();
    assert!(sealed.wrote);
    let opened = root.path().join("opened");
    open_sealed(&root.path().join("away").join("backup.seal"), &key, &opened).unwrap();
    let copy = opened.join("database-copy.sqlite");
    std::fs::copy(opened.join("database.sqlite"), &copy).unwrap();
    let archive = Db::open(&copy, ed25519::Keypair::generate(), schema.clone()).unwrap();
    let live = Db::open_in_memory(ed25519::Keypair::generate(), schema).unwrap();
    let blobs = BlobStore::open(&root.path().join("restored-blobs")).unwrap();
    let restored = crate::backup::restore_clean(&opened, &archive, &live, &blobs).unwrap();
    assert_eq!(restored.grants, 1);
    assert_eq!(restored.items, 1);
    let grant = live.get("drive_acl", "beds:user:sam").unwrap().unwrap();
    assert_eq!(grant["role"], Value::Text("editor".into()));
    let sam = live.get("user", "sam").unwrap().unwrap();
    assert_eq!(sam["email"], Value::Text("sam@example".into()));
    assert!(!matches!(sam.get("password"), Some(Value::Text(text)) if !text.is_empty()));
    assert!(live.get("user", "noor").unwrap().is_none());
    let sign_in = live.get("auth_config", "organization").unwrap().unwrap();
    assert_eq!(sign_in["issuer"], Value::Text("https://idp.example".into()));
    assert!(!matches!(sign_in.get("clientSecret"), Some(Value::Text(text)) if !text.is_empty()));
    assert!(!format!("{sam:?}{sign_in:?}").contains("secret-value"));
    assert_eq!(blobs.get_content(&content).unwrap().unwrap(), b"beds");
    let fresh = crate::backup::backup_freshness(&root.path().join("fresh")).unwrap();
    assert!(fresh.restore_tested);
    assert!(!format!("{fresh:?}").contains("secret-value"));
}

#[test]
fn a_retention_count_keeps_the_newest_sealed_copy() {
    let root = tempfile::tempdir().unwrap();
    let source = BlobStore::open(&root.path().join("live")).unwrap();
    let first_content = source.put_content(b"keep this").unwrap();
    let key = [7u8; 32];
    let fresh = root.path().join("fresh");
    fs::create_dir_all(&fresh).unwrap();
    fs::write(fresh.join("retention.txt"), b"1").unwrap();
    let sealed = root.path().join("sealed").join("backup.seal");
    let copy = root.path().join("away").join("backup.seal");
    fs::create_dir_all(sealed.parent().unwrap()).unwrap();
    fs::write(sealed.parent().unwrap().join("notes.sldoc"), b"Beds").unwrap();
    scheduled_seal(
        &source,
        &[first_content],
        &fresh,
        "24",
        "2026-11-02T00:00:00.000Z",
        &key,
        &sealed,
        &copy,
        None,
    )
    .unwrap();
    let later = source.put_content(b"north bed").unwrap();
    scheduled_seal(
        &source,
        &[later],
        &fresh,
        "24",
        "2026-11-03T00:00:00.000Z",
        &key,
        &sealed,
        &copy,
        None,
    )
    .unwrap();
    let next = root.path().join("away").join("backup.seal-20261103000000");
    assert!(next.is_file());
    assert!(!copy.is_file());
    assert!(!sealed.is_file());
    assert_eq!(
        fs::read(sealed.parent().unwrap().join("notes.sldoc")).unwrap(),
        b"Beds"
    );
    let opened = root.path().join("opened");
    open_sealed(&next, &key, &opened).unwrap();
    assert_eq!(
        BlobStore::open(&opened.join("blobs"))
            .unwrap()
            .get_content(&later)
            .unwrap()
            .unwrap(),
        b"north bed"
    );
    fs::write(fresh.join("retention.txt"), b"secret-value").unwrap();
    let refused = scheduled_seal(
        &source,
        &[later],
        &fresh,
        "24",
        "2026-11-04T00:00:00.000Z",
        &key,
        &sealed,
        &copy,
        None,
    )
    .unwrap_err()
    .to_string();
    assert_eq!(refused, "The backup retention count is not a whole number.");
    assert!(!refused.contains("secret-value"));
    assert!(next.is_file());
}
