//! Files and folders: reading, listing, creating, moving, and deleting them.

use std::collections::BTreeSet;

use anyhow::Context;
use serde::Serialize;
use suitedb::{Value, hlc::iso_now};

use crate::{
    Drive, DriveError, DriveResult, Hash, MAX_DEPTH, Manifest, Principal, Role,
    access::principal_clause,
    row::{Row, int, text},
};

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub parent_id: Option<String>,
    /// The parent folder's name, when a trash listing looked it up.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_name: Option<String>,
    pub name: String,
    pub kind: String,
    pub owner_id: String,
    pub mime: Option<String>,
    pub size: i64,
    pub head_version_id: Option<String>,
    pub content_hash: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// Who wrote the head version, and when. Absent for folders and for files
    /// that have never been saved. This is the last editor, not the owner.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_author_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_edited_at: Option<String>,
    pub trashed: bool,
    pub role: Option<Role>,
    /// Whether this node holds every blob of the head version.
    pub available: bool,
}

fn check_name(name: &str) -> DriveResult<String> {
    let name = name.trim();
    if name.is_empty()
        || name.len() > 255
        || name.contains(['/', '\\', '\0'])
        || name == "."
        || name == ".."
    {
        return Err(DriveError::BadRequest(
            "Use a name of 1–255 characters without slashes.".into(),
        ));
    }
    Ok(name.to_owned())
}

impl Drive {
    pub(crate) fn item_row(&self, id: &str) -> DriveResult<Row> {
        self.db.get("drive_item", id)?.ok_or(DriveError::NotFound)
    }

    pub(crate) fn to_item(&self, row: &Row, role: Option<Role>) -> DriveResult<Item> {
        let head = text(row, "headVersionId");
        let head_row = match &head {
            Some(v) => self.db.get("drive_version", v)?,
            None => None,
        };
        let content_hash = head_row.as_ref().and_then(|r| text(r, "contentHash"));
        let last_author_id = head_row
            .as_ref()
            .and_then(|r| text(r, "authorId"))
            .filter(|id| !id.is_empty());
        let last_edited_at = last_author_id
            .as_ref()
            .and_then(|_| head_row.as_ref().and_then(|r| text(r, "createdAt")))
            .filter(|at| !at.is_empty());
        let available = match content_hash.as_deref().map(str::parse::<Hash>) {
            Some(Ok(hash)) => self
                .blobs
                .missing(&hash)
                .map(|m| m.is_empty())
                .unwrap_or(false),
            Some(Err(_)) => false,
            None => true,
        };
        Ok(Item {
            id: text(row, "id").unwrap_or_default(),
            parent_id: text(row, "parentId"),
            parent_name: None,
            name: text(row, "name").unwrap_or_default(),
            kind: text(row, "kind").unwrap_or_else(|| "file".into()),
            owner_id: text(row, "ownerId").unwrap_or_default(),
            mime: text(row, "mime"),
            size: int(row, "size"),
            head_version_id: head,
            content_hash,
            created_at: text(row, "createdAt").unwrap_or_default(),
            updated_at: text(row, "updatedAt").unwrap_or_default(),
            last_author_id,
            last_edited_at,
            trashed: int(row, "trashed") != 0,
            role,
            available,
        })
    }

    pub fn get(&self, who: &Principal, id: &str) -> DriveResult<Item> {
        let role = self.require(who, id, Role::Viewer)?;
        let mut item = self.to_item(&self.item_row(id)?, Some(role))?;
        if let Some(parent_id) = item.parent_id.clone() {
            item.parent_name = self
                .db
                .get("drive_item", &parent_id)?
                .as_ref()
                .and_then(|parent| text(parent, "name"));
        }
        Ok(item)
    }

    fn items(&self, sql: &str, params: &[Value], who: &Principal) -> DriveResult<Vec<Item>> {
        let mut out = Vec::new();
        for row in self.db.query(sql, params)? {
            let id = text(&row, "id").unwrap_or_default();
            if let Some(role) = self.role(who, &id)? {
                out.push(self.to_item(&row, Some(role))?);
            }
        }
        Ok(out)
    }

    /// Children of a folder, or the caller's own top-level items.
    pub fn list(&self, who: &Principal, parent: Option<&str>) -> DriveResult<Vec<Item>> {
        const ORDER: &str = "ORDER BY kind = 'folder' DESC, name COLLATE NOCASE";
        match parent {
            Some(parent) => {
                self.require(who, parent, Role::Viewer)?;
                self.items(
                    &format!("SELECT * FROM drive_item WHERE parentId = ?1 AND trashed = 0 {ORDER}"),
                    &[Value::Text(parent.into())],
                    who,
                )
            }
            None => self.items(
                &format!("SELECT * FROM drive_item WHERE parentId IS NULL AND ownerId = ?1 AND trashed = 0 {ORDER}"),
                &[Value::Text(who.id.clone())],
                who,
            ),
        }
    }

    /// Folders the caller can edit, including nested ones, so a move dialog
    /// can show a path without opening each folder. A folder they can only
    /// view or comment on is left out. Trashed folders are left out.
    pub fn list_folders(&self, who: &Principal) -> DriveResult<Vec<Item>> {
        let rows = self.db.query(
            "SELECT * FROM drive_item WHERE kind = 'folder' AND trashed = 0 ORDER BY name COLLATE NOCASE",
            &[],
        )?;
        let mut out = Vec::new();
        for row in rows {
            let id = text(&row, "id").unwrap_or_default();
            if let Some(role) = self.role(who, &id)?
                && role >= Role::Editor
            {
                out.push(self.to_item(&row, Some(role))?);
            }
        }
        Ok(out)
    }

    /// Items shared directly with the caller or their organizations.
    pub fn shared(&self, who: &Principal) -> DriveResult<Vec<Item>> {
        let now = iso_now();
        let mut params = vec![Value::Text(who.id.clone()), Value::Text(now.clone())];
        let orgs = self.orgs(who)?;
        let groups = self.group_ids(&who.id)?;
        let grant = principal_clause("", 1, &orgs, &groups, &mut params);
        self.items(
            &format!(
                "SELECT * FROM drive_item
                 WHERE trashed = 0 AND ownerId != ?1
                   AND id IN (
                       SELECT itemId FROM drive_acl
                       WHERE ({grant})
                         AND (expiresAt IS NULL OR expiresAt > ?2)
                   )
                 ORDER BY name COLLATE NOCASE"
            ),
            &params,
            who,
        )
    }

    /// Trashed items the caller owns, with the folder name they came from.
    pub fn list_trashed(&self, who: &Principal) -> DriveResult<Vec<Item>> {
        let rows = self.db.query(
            "SELECT * FROM drive_item WHERE ownerId = ?1 AND trashed = 1 ORDER BY name COLLATE NOCASE",
            &[Value::Text(who.id.clone())],
        )?;
        let mut out = Vec::new();
        for row in rows {
            let mut item = self.to_item(&row, Some(Role::Owner))?;
            if let Some(parent_id) = item.parent_id.clone() {
                item.parent_name = self
                    .db
                    .get("drive_item", &parent_id)?
                    .as_ref()
                    .and_then(|parent| text(parent, "name"));
            }
            out.push(item);
        }
        Ok(out)
    }

    pub fn create(
        &self,
        who: &Principal,
        parent: Option<&str>,
        name: &str,
        kind: &str,
        mime: Option<&str>,
    ) -> DriveResult<Item> {
        let name = check_name(name)?;
        if kind != "file" && kind != "folder" {
            return Err(DriveError::BadRequest("kind must be file or folder".into()));
        }
        if let Some(parent) = parent {
            self.require(who, parent, Role::Editor)?;
            if text(&self.item_row(parent)?, "kind").as_deref() != Some("folder") {
                return Err(DriveError::BadRequest(
                    "Items can only be created inside folders.".into(),
                ));
            }
        }
        let id = uuid::Uuid::now_v7().to_string();
        let now = iso_now();
        self.db.transact(|tx| {
            tx.upsert(
                "drive_item",
                &id,
                [
                    ("parentId", Value::from(parent.map(str::to_owned))),
                    ("name", name.clone().into()),
                    ("kind", kind.into()),
                    ("ownerId", who.id.clone().into()),
                    ("mime", Value::from(mime.map(str::to_owned))),
                    ("size", Value::Integer(0)),
                    ("createdAt", now.clone().into()),
                    ("updatedAt", now.clone().into()),
                    ("trashed", Value::Integer(0)),
                ],
            )
        })?;
        self.get(who, &id)
    }

    pub fn update(
        &self,
        who: &Principal,
        id: &str,
        name: Option<&str>,
        parent: Option<Option<&str>>,
        trashed: Option<bool>,
    ) -> DriveResult<Item> {
        self.require(who, id, Role::Editor)?;
        let mut cols: Vec<(&str, Value)> = vec![("updatedAt", iso_now().into())];
        if let Some(name) = name {
            cols.push(("name", check_name(name)?.into()));
        }
        if let Some(parent) = parent {
            if let Some(target) = parent {
                self.require(who, target, Role::Editor)?;
                let mut cursor = Some(target.to_owned());
                for _ in 0..MAX_DEPTH {
                    let Some(current) = cursor else { break };
                    if current == id {
                        return Err(DriveError::BadRequest(
                            "A folder cannot move inside itself.".into(),
                        ));
                    }
                    let row = self.item_row(&current)?;
                    if current == target && text(&row, "kind").as_deref() != Some("folder") {
                        return Err(DriveError::BadRequest(
                            "Items can only move into folders.".into(),
                        ));
                    }
                    cursor = text(&row, "parentId");
                }
            } else if text(&self.item_row(id)?, "ownerId").as_deref() != Some(who.id.as_str())
                && !who.admin
            {
                return Err(DriveError::Forbidden);
            }
            cols.push(("parentId", Value::from(parent.map(str::to_owned))));
        }
        if let Some(trashed) = trashed {
            cols.push(("trashed", Value::from(trashed)));
        }
        self.db.transact(|tx| tx.upsert("drive_item", id, cols))?;
        self.get(who, id)
    }

    fn column_values(&self, sql: &str, column: &str, item_id: &str) -> DriveResult<Vec<String>> {
        Ok(self
            .db
            .query(sql, &[Value::Text(item_id.to_owned())])?
            .into_iter()
            .filter_map(|row| text(&row, column))
            .collect())
    }

    /// Remove a trashed item the caller owns, plus its versions, grants, and
    /// any blobs no other version still uses.
    pub fn delete_forever(&self, who: &Principal, id: &str) -> DriveResult<()> {
        let row = self.item_row(id)?;
        if text(&row, "ownerId").as_deref() != Some(who.id.as_str()) {
            return Err(DriveError::Forbidden);
        }
        if int(&row, "trashed") == 0 {
            return Err(DriveError::BadRequest(
                "Move it to Trash before deleting it forever.".into(),
            ));
        }
        let children = self.db.query(
            "SELECT id FROM drive_item WHERE parentId = ?1 LIMIT 1",
            &[Value::Text(id.to_owned())],
        )?;
        if !children.is_empty() {
            return Err(DriveError::BadRequest(
                "This folder still has something in it. Move those out, or delete them forever, before deleting the folder.".into(),
            ));
        }
        let versions = self.db.query(
            "SELECT id, contentHash FROM drive_version WHERE itemId = ?1",
            &[Value::Text(id.to_owned())],
        )?;
        let version_ids: Vec<String> = versions.iter().filter_map(|row| text(row, "id")).collect();
        let hashes: Vec<String> = versions
            .iter()
            .filter_map(|row| text(row, "contentHash"))
            .collect();
        let acls = self.column_values("SELECT id FROM drive_acl WHERE itemId = ?1", "id", id)?;
        let mut transient_rows = Vec::new();
        for table in [
            "drive_upload_chunk",
            "drive_room_update",
            "drive_signal",
            "drive_open_presence",
            "drive_presence",
        ] {
            transient_rows.push((
                table,
                self.column_values(
                    &format!("SELECT id FROM {table} WHERE itemId = ?1"),
                    "id",
                    id,
                )?,
            ));
        }
        let comments =
            self.column_values("SELECT id FROM drive_comment WHERE itemId = ?1", "id", id)?;
        let notices =
            self.column_values("SELECT id FROM drive_notice WHERE itemId = ?1", "id", id)?;
        let links = self.column_values(
            "SELECT token FROM drive_respond_link WHERE itemId = ?1",
            "token",
            id,
        )?;
        self.db.transact(|tx| {
            tx.delete("drive_upload", id)?;
            tx.delete("drive_room", id)?;
            for (table, ids) in &transient_rows {
                for id in ids {
                    tx.delete(table, id)?;
                }
            }
            for version_id in &version_ids {
                tx.delete("drive_version", version_id)?;
            }
            for acl_id in &acls {
                tx.delete("drive_acl", acl_id)?;
            }
            for comment_id in &comments {
                tx.delete("drive_comment", comment_id)?;
            }
            for notice_id in &notices {
                tx.delete("drive_notice", notice_id)?;
            }
            for token in &links {
                tx.delete("drive_respond_link", token)?;
            }
            tx.delete("drive_public_link", id)?;
            tx.delete("drive_item", id)?;
            Ok(())
        })?;
        self.release_unreferenced_blobs(&hashes)?;
        Ok(())
    }

    /// Drop manifest and chunk blobs that no remaining version still names.
    fn release_unreferenced_blobs(&self, hashes: &[String]) -> DriveResult<()> {
        let live: BTreeSet<String> = self
            .db
            .query("SELECT contentHash FROM drive_version", &[])?
            .into_iter()
            .filter_map(|row| text(&row, "contentHash"))
            .collect();
        let mut live_chunks = BTreeSet::new();
        for hash in &live {
            let Ok(parsed) = hash.parse::<Hash>() else {
                continue;
            };
            if let Some(bytes) = self.blobs.get(&parsed)?
                && let Ok(manifest) = Manifest::decode(&bytes)
            {
                live_chunks.extend(manifest.chunks);
            }
        }
        for hash in hashes {
            if live.contains(hash) {
                continue;
            }
            let Ok(parsed) = hash.parse::<Hash>() else {
                continue;
            };
            let chunks = self
                .blobs
                .get(&parsed)?
                .and_then(|bytes| Manifest::decode(&bytes).ok())
                .map(|manifest| manifest.chunks)
                .unwrap_or_default();
            for chunk in chunks {
                if live_chunks.contains(&chunk) {
                    continue;
                }
                self.blobs.remove(&chunk).context("remove chunk")?;
                self.wanted.lock().unwrap().remove(&chunk);
            }
            self.blobs.remove(&parsed).context("remove content")?;
            self.wanted.lock().unwrap().remove(&parsed);
        }
        Ok(())
    }
}
