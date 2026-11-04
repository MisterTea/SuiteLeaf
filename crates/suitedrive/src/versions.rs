//! Version history: naming, restoring, and copying a saved version.

use serde::Serialize;
use suitedb::{Value, hlc::iso_now};

use crate::{
    Drive, DriveError, DriveResult, Hash, Item, Principal, Role,
    row::{Row, int, text},
};

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    pub id: String,
    pub item_id: String,
    pub content_hash: String,
    pub size: i64,
    pub author_id: String,
    pub created_at: String,
    pub name: Option<String>,
    pub restored_from: Option<String>,
}

fn version_from_row(row: &Row) -> Version {
    Version {
        id: text(row, "id").unwrap_or_default(),
        item_id: text(row, "itemId").unwrap_or_default(),
        content_hash: text(row, "contentHash").unwrap_or_default(),
        size: int(row, "size"),
        author_id: text(row, "authorId").unwrap_or_default(),
        created_at: text(row, "createdAt").unwrap_or_default(),
        name: text(row, "name").filter(|s| !s.is_empty()),
        restored_from: text(row, "restoredFrom").filter(|s| !s.is_empty()),
    }
}

impl Drive {
    fn version_row(&self, item_id: &str, version_id: &str) -> DriveResult<Row> {
        let row = self
            .db
            .get("drive_version", version_id)?
            .ok_or(DriveError::NotFound)?;
        if text(&row, "itemId").as_deref() != Some(item_id) {
            return Err(DriveError::NotFound);
        }
        Ok(row)
    }

    fn head_matches(head: Option<&str>, if_match: Option<&str>) -> bool {
        match if_match.map(|m| m.trim_matches('"')) {
            Some(expected) if expected != "*" => Some(expected) == head,
            _ => true,
        }
    }

    pub fn versions(&self, who: &Principal, id: &str) -> DriveResult<Vec<Version>> {
        self.require(who, id, Role::Viewer)?;
        Ok(self
            .db
            .query(
                "SELECT * FROM drive_version WHERE itemId = ?1 ORDER BY createdAt DESC, id DESC",
                &[Value::Text(id.into())],
            )?
            .into_iter()
            .map(|r| version_from_row(&r))
            .collect())
    }

    /// Set or clear the name people see in version history. The name replicates
    /// with the version row, so another server shows it after sync.
    pub fn name_version(
        &self,
        who: &Principal,
        id: &str,
        version_id: &str,
        name: Option<&str>,
    ) -> DriveResult<Version> {
        self.require(who, id, Role::Editor)?;
        self.version_row(id, version_id)?;
        let name = match name.map(str::trim).filter(|s| !s.is_empty()) {
            Some(name) => {
                if name.chars().count() > 80 || name.contains(['\n', '\r', '\0']) {
                    return Err(DriveError::BadRequest(
                        "Use a version name of 1–80 characters on one line.".into(),
                    ));
                }
                Some(name.to_owned())
            }
            None => None,
        };
        self.db.transact(|tx| {
            tx.upsert(
                "drive_version",
                version_id,
                [("name", Value::from(name.clone()))],
            )
        })?;
        Ok(version_from_row(
            &self
                .db
                .get("drive_version", version_id)?
                .unwrap_or_default(),
        ))
    }

    /// Make `version_id` the file's content again, as a new version. The
    /// previous head stays in history and the saved bytes are the same blob.
    pub fn restore(
        &self,
        who: &Principal,
        id: &str,
        version_id: &str,
        if_match: Option<&str>,
    ) -> DriveResult<Item> {
        self.require(who, id, Role::Editor)?;
        let row = self.item_row(id)?;
        if text(&row, "kind").as_deref() != Some("file") {
            return Err(DriveError::BadRequest("Folders have no content.".into()));
        }
        let head = text(&row, "headVersionId");
        if !Self::head_matches(head.as_deref(), if_match) {
            let role = self.role(who, id)?;
            return Err(DriveError::Conflict(Box::new(self.to_item(&row, role)?)));
        }
        let source = self.version_row(id, version_id)?;
        let hash = text(&source, "contentHash")
            .ok_or_else(|| DriveError::Other(anyhow::anyhow!("version has no content")))?;
        let parsed: Hash = hash
            .parse()
            .map_err(|_| DriveError::Other(anyhow::anyhow!("corrupt content hash")))?;
        if !self.blobs.missing(&parsed)?.is_empty() {
            return Err(DriveError::Unavailable);
        }
        let version = uuid::Uuid::now_v7().to_string();
        let now = iso_now();
        let size = int(&source, "size");
        self.db.transact(|tx| {
            tx.upsert(
                "drive_version",
                &version,
                [
                    ("itemId", Value::from(id)),
                    ("contentHash", hash.into()),
                    ("size", Value::Integer(size)),
                    ("authorId", who.id.clone().into()),
                    ("createdAt", now.clone().into()),
                    ("restoredFrom", Value::from(version_id)),
                ],
            )?;
            tx.upsert(
                "drive_item",
                id,
                [
                    ("headVersionId", Value::Text(version.clone())),
                    ("size", Value::Integer(size)),
                    ("updatedAt", now.into()),
                ],
            )
        })?;
        self.get(who, id)
    }

    /// A new file in the same folder, holding this version's bytes.
    pub fn copy_version(
        &self,
        who: &Principal,
        id: &str,
        version_id: &str,
        name: &str,
    ) -> DriveResult<Item> {
        let item = self.get(who, id)?;
        self.version_row(id, version_id)?;
        let (_, bytes) = self.read(who, id, Some(version_id))?;
        let created = self.create(
            who,
            item.parent_id.as_deref(),
            name,
            "file",
            item.mime.as_deref(),
        )?;
        self.write(who, &created.id, None, item.mime.as_deref(), &bytes)
    }
}
