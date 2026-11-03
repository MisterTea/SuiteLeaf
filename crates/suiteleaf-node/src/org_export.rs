//! An admin export of accounts and sharing.
//!
//! The queries name the columns they return. Passwords, session tokens,
//! respond-link tokens, and file bytes are not selected.

use std::collections::BTreeMap;

use serde_json::{Value as JsonValue, json};
use suitedb::{Db, Value};
use suitedrive::DriveError;

fn text(row: &BTreeMap<String, Value>, key: &str) -> Option<String> {
    match row.get(key) {
        Some(Value::Text(value)) if !value.is_empty() => Some(value.clone()),
        _ => None,
    }
}

fn json_text(row: &BTreeMap<String, Value>, key: &str) -> JsonValue {
    text(row, key)
        .map(JsonValue::String)
        .unwrap_or(JsonValue::Null)
}

fn flag(row: &BTreeMap<String, Value>, key: &str) -> bool {
    matches!(row.get(key), Some(Value::Integer(n)) if *n != 0)
}

fn rows(db: &Db, sql: &str) -> Result<Vec<BTreeMap<String, Value>>, DriveError> {
    db.query(sql, &[])
        .map_err(|error| DriveError::Other(error.into()))
}

/// Accounts, groups, memberships, and sharing grants. No paid feature is required.
pub fn organization_export(db: &Db) -> Result<JsonValue, DriveError> {
    let accounts = rows(
        db,
        "SELECT id, name, email, username, role, banned, createdAt FROM user ORDER BY createdAt ASC, id ASC",
    )?;
    let groups = rows(
        db,
        "SELECT id, name FROM directory_group ORDER BY name COLLATE NOCASE, id ASC",
    )?;
    let memberships = rows(
        db,
        "SELECT groupId, memberType, memberId FROM directory_edge ORDER BY groupId ASC, memberType ASC, memberId ASC",
    )?;
    let sharing = rows(
        db,
        "SELECT itemId, principalType, principalId, role, expiresAt FROM drive_acl ORDER BY itemId ASC, principalType ASC, principalId ASC",
    )?;
    let files = rows(
        db,
        "SELECT i.id, i.name, i.kind, i.ownerId, i.parentId, i.mime, i.trashed, i.createdAt, i.updatedAt, v.contentHash \
         FROM drive_item i LEFT JOIN drive_version v ON v.id = i.headVersionId \
         ORDER BY i.name COLLATE NOCASE, i.id ASC",
    )?;
    Ok(json!({
        "kind": "suiteleaf-organization-export",
        "accounts": accounts.iter().map(|row| json!({
            "id": json_text(row, "id"),
            "name": json_text(row, "name"),
            "email": json_text(row, "email"),
            "username": json_text(row, "username"),
            "role": json_text(row, "role"),
            "banned": flag(row, "banned"),
            "createdAt": json_text(row, "createdAt"),
        })).collect::<Vec<_>>(),
        "groups": groups.iter().map(|row| json!({
            "id": json_text(row, "id"),
            "name": json_text(row, "name"),
        })).collect::<Vec<_>>(),
        "memberships": memberships.iter().map(|row| json!({
            "groupId": json_text(row, "groupId"),
            "memberType": json_text(row, "memberType"),
            "memberId": json_text(row, "memberId"),
        })).collect::<Vec<_>>(),
        "sharing": sharing.iter().map(|row| json!({
            "itemId": json_text(row, "itemId"),
            "principalType": json_text(row, "principalType"),
            "principalId": json_text(row, "principalId"),
            "role": json_text(row, "role"),
            "expiresAt": json_text(row, "expiresAt"),
        })).collect::<Vec<_>>(),
        "files": files.iter().map(|row| json!({
            "id": json_text(row, "id"),
            "name": json_text(row, "name"),
            "kind": json_text(row, "kind"),
            "ownerId": json_text(row, "ownerId"),
            "parentId": json_text(row, "parentId"),
            "mime": json_text(row, "mime"),
            "trashed": flag(row, "trashed"),
            "createdAt": json_text(row, "createdAt"),
            "updatedAt": json_text(row, "updatedAt"),
            "contentHash": json_text(row, "contentHash"),
        })).collect::<Vec<_>>(),
        "limits": "Passwords, session tokens, respond-link tokens, and file bytes are not included. The file list names each item, its kind, its owner, its folder, its type, whether it is in the trash, when it was created, when it was updated, and the current content hash. This export does not require a paid feature.",
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use libp2p_identity::ed25519;
    use suitedb::Db;

    #[test]
    fn an_export_lists_sharing_and_leaves_secrets_out() {
        let db = Db::open_in_memory(
            ed25519::Keypair::generate(),
            crate::schema::node_schema(None).unwrap(),
        )
        .unwrap();
        db.transact(|tx| {
            tx.upsert(
                "user",
                "rosa",
                [
                    ("name", Value::Text("Rosa".into())),
                    ("email", Value::Text("rosa@club.test".into())),
                    ("role", Value::Text("admin".into())),
                    ("createdAt", Value::Text("2026-01-01T00:00:00.000Z".into())),
                    ("banned", Value::Integer(0)),
                ],
            )?;
            tx.upsert(
                "account",
                "acct",
                [
                    ("accountId", Value::Text("rosa".into())),
                    ("providerId", Value::Text("credential".into())),
                    ("userId", Value::Text("rosa".into())),
                    ("password", Value::Text("s3cret-hash".into())),
                    ("createdAt", Value::Text("2026-01-01T00:00:00.000Z".into())),
                    ("updatedAt", Value::Text("2026-01-01T00:00:00.000Z".into())),
                ],
            )?;
            tx.upsert(
                "session",
                "sess",
                [
                    ("expiresAt", Value::Text("2026-12-01T00:00:00.000Z".into())),
                    ("token", Value::Text("session-secret".into())),
                    ("createdAt", Value::Text("2026-01-01T00:00:00.000Z".into())),
                    ("updatedAt", Value::Text("2026-01-01T00:00:00.000Z".into())),
                    ("userId", Value::Text("rosa".into())),
                ],
            )?;
            tx.upsert(
                "drive_respond_link",
                "respond-secret",
                [
                    ("itemId", Value::Text("file-1".into())),
                    ("createdAt", Value::Text("2026-01-01T00:00:00.000Z".into())),
                ],
            )?;
            tx.upsert(
                "directory_group",
                "garden",
                [
                    ("name", Value::Text("Garden".into())),
                    ("createdAt", Value::Text("2026-01-01T00:00:00.000Z".into())),
                    ("updatedAt", Value::Text("2026-01-01T00:00:00.000Z".into())),
                ],
            )?;
            tx.upsert(
                "directory_edge",
                "edge",
                [
                    ("groupId", Value::Text("garden".into())),
                    ("memberType", Value::Text("user".into())),
                    ("memberId", Value::Text("rosa".into())),
                ],
            )?;
            tx.upsert(
                "drive_version",
                "v1",
                [
                    ("itemId", Value::Text("file-1".into())),
                    ("contentHash", Value::Text("bed-hash".into())),
                    ("size", Value::Integer(8)),
                    ("authorId", Value::Text("rosa".into())),
                    ("createdAt", Value::Text("2026-01-01T00:00:00.000Z".into())),
                    ("name", Value::Text("Watering rota.sldoc".into())),
                ],
            )?;
            tx.upsert(
                "drive_item",
                "plots",
                [
                    ("parentId", Value::Text("".into())),
                    ("name", Value::Text("Plots".into())),
                    ("kind", Value::Text("folder".into())),
                    ("ownerId", Value::Text("rosa".into())),
                    ("mime", Value::Text("".into())),
                    ("size", Value::Integer(0)),
                    ("headVersionId", Value::Text("".into())),
                    ("createdAt", Value::Text("2026-01-01T00:00:00.000Z".into())),
                    ("updatedAt", Value::Text("2026-01-01T00:00:00.000Z".into())),
                    ("trashed", Value::Integer(0)),
                ],
            )?;
            tx.upsert(
                "drive_item",
                "file-1",
                [
                    ("parentId", Value::Text("plots".into())),
                    ("name", Value::Text("Watering rota.sldoc".into())),
                    ("kind", Value::Text("file".into())),
                    ("ownerId", Value::Text("rosa".into())),
                    (
                        "mime",
                        Value::Text("application/vnd.suiteleaf.document".into()),
                    ),
                    ("size", Value::Integer(8)),
                    ("headVersionId", Value::Text("v1".into())),
                    ("createdAt", Value::Text("2026-01-01T00:00:00.000Z".into())),
                    ("updatedAt", Value::Text("2026-01-01T00:00:00.000Z".into())),
                    ("trashed", Value::Integer(0)),
                ],
            )?;
            tx.upsert(
                "drive_item",
                "file-2",
                [
                    ("parentId", Value::Text("".into())),
                    ("name", Value::Text("Old notes.sldoc".into())),
                    ("kind", Value::Text("file".into())),
                    ("ownerId", Value::Text("rosa".into())),
                    (
                        "mime",
                        Value::Text("application/vnd.suiteleaf.document".into()),
                    ),
                    ("size", Value::Integer(4)),
                    ("headVersionId", Value::Text("v2".into())),
                    ("createdAt", Value::Text("2026-01-02T00:00:00.000Z".into())),
                    ("updatedAt", Value::Text("2026-01-02T00:00:00.000Z".into())),
                    ("trashed", Value::Integer(1)),
                ],
            )?;
            tx.upsert(
                "drive_acl",
                "acl",
                [
                    ("itemId", Value::Text("file-1".into())),
                    ("principalType", Value::Text("user".into())),
                    ("principalId", Value::Text("rosa".into())),
                    ("role", Value::Text("editor".into())),
                ],
            )?;
            Ok(())
        })
        .unwrap();
        let export = organization_export(&db).unwrap();
        let text = export.to_string();
        assert!(text.contains("rosa@club.test"));
        assert!(text.contains("\"role\":\"editor\""));
        assert!(text.contains("Garden"));
        assert!(!text.contains("s3cret-hash"));
        assert!(!text.contains("session-secret"));
        assert!(!text.contains("respond-secret"));
        assert!(text.contains("does not require a paid feature"));
        assert!(text.contains("Watering rota.sldoc"));
        assert!(text.contains("application/vnd.suiteleaf.document"));
        assert!(text.contains("\"ownerId\":\"rosa\""));
        assert!(text.contains("\"trashed\":false"));
        assert!(text.contains("Old notes.sldoc"));
        assert!(text.contains("\"trashed\":true"));
        assert!(text.contains("\"contentHash\":\"bed-hash\""));
        assert!(text.contains("\"createdAt\":\"2026-01-01T00:00:00.000Z\""));
        assert!(text.contains("\"updatedAt\":\"2026-01-02T00:00:00.000Z\""));
        assert!(text.contains("\"parentId\":\"plots\""));
        assert!(text.contains("Plots"));
        assert!(!text.contains("\"size\""));
    }
}
