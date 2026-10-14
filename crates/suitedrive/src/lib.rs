//! SuiteDrive: files replicated to every node.
//!
//! File bytes live in a content-addressed [`BlobStore`]; names, folders,
//! versions, and sharing live in SuiteDB tables, so metadata replicates with
//! the rest of the database. When a `drive_version` row arrives from a peer,
//! its blobs are queued and fetched over `/suiteleaf/drive/blob/1`.
//!
//! Every saved version is kept. If two nodes save the same file
//! concurrently, last-writer-wins picks the head version, and the other
//! version stays available in the file's history.

pub mod blobs;

use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};

use anyhow::Context;
use serde::{Deserialize, Serialize};
use serde_bytes::ByteBuf;
use suitedb::{ColumnType, Db, TableDef, Value, hlc::iso_now};
use tokio::sync::Notify;

pub use blobs::{BlobStore, CHUNK_SIZE, Hash, Manifest};

/// Bump when the drive tables change.
pub const SCHEMA_VERSION: u32 = 4;
const MAX_BLOB_RESPONSE: usize = 24 * 1024 * 1024;
const MAX_DEPTH: usize = 64;

pub fn tables() -> Vec<TableDef> {
    use ColumnType::*;
    vec![
        TableDef::new("drive_item", "id")
            .column("parentId", Text)
            .column("name", Text)
            .column("kind", Text)
            .column("ownerId", Text)
            .column("mime", Text)
            .column("size", Integer)
            .column("headVersionId", Text)
            .column("createdAt", Text)
            .column("updatedAt", Text)
            .column("trashed", Integer)
            .index("parentId")
            .index("ownerId"),
        TableDef::new("drive_version", "id")
            .column("itemId", Text)
            .column("contentHash", Text)
            .column("size", Integer)
            .column("authorId", Text)
            .column("createdAt", Text)
            .column("name", Text)
            .column("restoredFrom", Text)
            .index("itemId")
            .index("contentHash"),
        TableDef::new("drive_acl", "id")
            .column("itemId", Text)
            .column("principalType", Text)
            .column("principalId", Text)
            .column("role", Text)
            .column("expiresAt", Text)
            .index("itemId")
            .index("principalId"),
        TableDef::new("drive_comment", "id")
            .column("itemId", Text)
            .column("authorId", Text)
            .column("body", Text)
            .column("createdAt", Text)
            .index("itemId"),
        // An in-app notice that a file was shared. Dismissal lives here because
        // drive_acl has no sharer, time, or seen flag, and there is no mail step.
        TableDef::new("drive_notice", "id")
            .column("itemId", Text)
            .column("recipientId", Text)
            .column("sharerId", Text)
            .column("role", Text)
            .column("createdAt", Text)
            .column("dismissedAt", Text)
            .index("recipientId")
            .index("itemId"),
        // Who currently has a file open with comment or edit access.
        // Dropped after 15 minutes without activity. Not shown in the editor.
        TableDef::new("drive_presence", "id")
            .column("itemId", Text)
            .column("userId", Text)
            .column("name", Text)
            .column("role", Text)
            .column("lastActiveMs", Integer)
            .index("itemId"),
        // One live collaboration room. generation stops two nodes compacting twice.
        TableDef::new("drive_room", "id")
            .column("mode", Text)
            .column("generation", Integer)
            .column("baseline", Text),
        // Yjs updates for the open room, so another node can catch up.
        TableDef::new("drive_room_update", "id")
            .column("itemId", Text)
            .column("generation", Integer)
            .column("bytes", Text)
            .column("userId", Text)
            .column("at", Text)
            .column("unit", Text)
            .column("key", Text)
            .index("itemId"),
    ]
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Viewer,
    /// Can read and add comments, but cannot change the file.
    Commenter,
    Editor,
    Owner,
}

impl Role {
    fn parse(s: &str) -> Option<Role> {
        match s {
            "viewer" => Some(Role::Viewer),
            "commenter" => Some(Role::Commenter),
            "editor" => Some(Role::Editor),
            "owner" => Some(Role::Owner),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Role::Viewer => "viewer",
            Role::Commenter => "commenter",
            Role::Editor => "editor",
            Role::Owner => "owner",
        }
    }
}

/// The caller of a drive operation.
#[derive(Clone, Debug)]
pub struct Principal {
    pub id: String,
    pub admin: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub parent_id: Option<String>,
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

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AclEntry {
    pub principal_type: String,
    pub principal_id: String,
    pub role: Role,
    /// When this grant stops working, as UTC `YYYY-MM-DDTHH:MM:SS.mmmZ`.
    /// Absent means it lasts until someone removes it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
}

/// A folder whose sharing also applies to a file inside it.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InheritedFrom {
    pub id: String,
    pub name: String,
}

/// One person or organization who can open an item, including access inherited
/// from a folder. The file's owner uses `principal_type` `"owner"`.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccessGrant {
    pub principal_type: String,
    pub principal_id: String,
    pub role: Role,
    pub inherited_from: Option<InheritedFrom>,
    /// When a direct or inherited grant stops working.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    /// The moment has passed. The person can no longer open the file, but the
    /// owner still sees the row so they can remove it.
    #[serde(default)]
    pub expired: bool,
}

/// Who can open an item, and the folder it lives in.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ItemAccess {
    pub grants: Vec<AccessGrant>,
    pub parent: Option<InheritedFrom>,
    pub your_role: Role,
}

/// A comment stored beside a file, separate from the file's content.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DriveComment {
    pub id: String,
    pub item_id: String,
    pub author_id: String,
    pub body: String,
    pub created_at: String,
}

/// An undismissed in-app notice that `sharer_id` shared `item_id`.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShareNotice {
    pub id: String,
    pub item_id: String,
    pub item_name: String,
    pub sharer_id: String,
    pub role: Role,
    pub created_at: String,
}

#[derive(Debug, thiserror::Error)]
pub enum DriveError {
    #[error("not found")]
    NotFound,
    #[error("you do not have access to this item")]
    Forbidden,
    #[error("the file changed on another device")]
    Conflict(Box<Item>),
    #[error("{0}")]
    BadRequest(String),
    #[error("the file has not replicated to this node yet")]
    Unavailable,
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

impl From<suitedb::Error> for DriveError {
    fn from(e: suitedb::Error) -> Self {
        DriveError::Other(e.into())
    }
}

pub type DriveResult<T> = Result<T, DriveError>;

type Row = BTreeMap<String, Value>;

fn text(row: &Row, key: &str) -> Option<String> {
    match row.get(key) {
        Some(Value::Text(s)) => Some(s.clone()),
        _ => None,
    }
}

fn int(row: &Row, key: &str) -> i64 {
    match row.get(key) {
        Some(Value::Integer(i)) => *i,
        _ => 0,
    }
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

/// A grant with no end, or an end still in the future, still opens the file.
fn grant_live(expires_at: Option<&str>, now: &str) -> bool {
    match expires_at.map(str::trim).filter(|s| !s.is_empty()) {
        Some(at) => at > now,
        None => true,
    }
}

/// Store an end time in the same UTC shape as [`iso_now`], so a string
/// comparison is a time comparison.
fn normalize_expiry(raw: &str) -> DriveResult<String> {
    let s = raw.trim();
    let Some((date, time)) = s.split_once('T') else {
        return Err(DriveError::BadRequest("Choose the day access ends.".into()));
    };
    let mut ymd = date.split('-');
    let (Some(y), Some(m), Some(d), None) = (ymd.next(), ymd.next(), ymd.next(), ymd.next()) else {
        return Err(DriveError::BadRequest("Choose the day access ends.".into()));
    };
    let year: u16 = y.parse().unwrap_or(0);
    let month: u8 = m.parse().unwrap_or(0);
    let day: u8 = d.parse().unwrap_or(0);
    if y.len() != 4
        || m.len() != 2
        || d.len() != 2
        || !(1970..=9999).contains(&year)
        || !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
    {
        return Err(DriveError::BadRequest("Choose the day access ends.".into()));
    }
    let time = time
        .strip_suffix('Z')
        .ok_or_else(|| DriveError::BadRequest("Choose the day access ends.".into()))?;
    let mut clock = time.split(':');
    let (Some(hh), Some(mm), Some(rest), None) =
        (clock.next(), clock.next(), clock.next(), clock.next())
    else {
        return Err(DriveError::BadRequest("Choose the day access ends.".into()));
    };
    let hour: u8 = hh.parse().unwrap_or(99);
    let minute: u8 = mm.parse().unwrap_or(99);
    let (sec, millis) = if let Some((sec, frac)) = rest.split_once('.') {
        let digits: String = frac.chars().take(3).collect();
        let millis: u16 = if digits.is_empty() {
            0
        } else {
            digits.parse().unwrap_or(1000)
        };
        (sec, millis)
    } else {
        (rest, 0)
    };
    let second: u8 = sec.parse().unwrap_or(99);
    if hh.len() != 2
        || mm.len() != 2
        || sec.len() != 2
        || hour > 23
        || minute > 59
        || second > 60
        || millis > 999
    {
        return Err(DriveError::BadRequest("Choose the day access ends.".into()));
    }
    Ok(format!("{y}-{m}-{d}T{hh}:{mm}:{second:02}.{millis:03}Z"))
}

/// Requests and responses of the blob protocol.
#[derive(Debug, Serialize, Deserialize)]
pub struct BlobRequest {
    pub hashes: Vec<Hash>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct BlobResponse {
    pub blobs: Vec<(Hash, Option<ByteBuf>)>,
}

/// How a node reaches its peers for blob replication.
#[async_trait::async_trait]
pub trait BlobTransport: Send + Sync {
    async fn peers(&self) -> Vec<String>;
    async fn request(&self, peer: &str, data: Vec<u8>) -> anyhow::Result<Vec<u8>>;
}

pub struct Drive {
    db: Arc<Db>,
    blobs: BlobStore,
    wanted: Mutex<BTreeSet<Hash>>,
    notify: Notify,
}

impl Drive {
    /// Open the blob store and start tracking versions whose blobs are missing.
    pub fn open(db: Arc<Db>, root: &Path) -> anyhow::Result<Arc<Drive>> {
        for t in tables() {
            if db.schema().table(&t.name).is_none() {
                anyhow::bail!("the SuiteDB schema lacks the {} table", t.name);
            }
        }
        let drive = Arc::new(Drive {
            db: db.clone(),
            blobs: BlobStore::open(root)?,
            wanted: Mutex::default(),
            notify: Notify::new(),
        });
        let weak = Arc::downgrade(&drive);
        db.on_applied(Box::new(move |rows| {
            if let Some(drive) = weak.upgrade() {
                for row in rows.iter().filter(|r| r.table == "drive_version") {
                    if let Ok(Some(v)) = drive.db.get("drive_version", &row.pk)
                        && let Some(hash) = text(&v, "contentHash").and_then(|h| h.parse().ok())
                    {
                        drive.want(hash);
                    }
                }
            }
        }));
        let hashes = db.query("SELECT DISTINCT contentHash FROM drive_version", &[])?;
        for row in hashes {
            if let Some(hash) = text(&row, "contentHash").and_then(|h| h.parse().ok()) {
                drive.want(hash);
            }
        }
        Ok(drive)
    }

    pub fn blobs(&self) -> &BlobStore {
        &self.blobs
    }

    fn want(&self, hash: Hash) {
        if self
            .blobs
            .missing(&hash)
            .map(|m| !m.is_empty())
            .unwrap_or(true)
        {
            self.wanted.lock().unwrap().insert(hash);
            self.notify.notify_one();
        }
    }

    /// Content hashes still waiting for blobs from peers.
    pub fn wanted(&self) -> Vec<Hash> {
        self.wanted.lock().unwrap().iter().copied().collect()
    }

    fn item_row(&self, id: &str) -> DriveResult<Row> {
        self.db.get("drive_item", id)?.ok_or(DriveError::NotFound)
    }

    fn orgs(&self, who: &Principal) -> DriveResult<Vec<Value>> {
        if self.db.schema().table("member").is_none() {
            return Ok(vec![]);
        }
        Ok(self
            .db
            .query(
                "SELECT organizationId FROM member WHERE userId = ?1",
                &[Value::Text(who.id.clone())],
            )?
            .into_iter()
            .filter_map(|r| r.get("organizationId").cloned())
            .collect())
    }

    /// The caller's effective role: ownership or sharing on the item or any
    /// ancestor folder, whichever is highest.
    pub fn role(&self, who: &Principal, id: &str) -> DriveResult<Option<Role>> {
        let mut current = Some(self.item_row(id)?);
        if who.admin {
            return Ok(Some(Role::Owner));
        }
        let orgs = self.orgs(who)?;
        let now = iso_now();
        let mut best = None;
        for _ in 0..MAX_DEPTH {
            let Some(row) = current.take() else { break };
            let item = text(&row, "id").unwrap_or_default();
            if text(&row, "ownerId").as_deref() == Some(who.id.as_str()) {
                return Ok(Some(Role::Owner));
            }
            let mut params = vec![Value::Text(item), Value::Text(who.id.clone())];
            let org_clause = if orgs.is_empty() {
                String::new()
            } else {
                let marks: Vec<String> = (0..orgs.len()).map(|i| format!("?{}", i + 3)).collect();
                params.extend(orgs.iter().cloned());
                format!(
                    " OR (principalType = 'org' AND principalId IN ({}))",
                    marks.join(", ")
                )
            };
            let grants = self.db.query(
                &format!(
                    "SELECT role, expiresAt FROM drive_acl WHERE itemId = ?1
                     AND ((principalType = 'user' AND principalId = ?2){org_clause})"
                ),
                &params,
            )?;
            for grant in grants {
                if !grant_live(text(&grant, "expiresAt").as_deref(), &now) {
                    continue;
                }
                best = best.max(text(&grant, "role").and_then(|r| Role::parse(&r)));
            }
            current = match text(&row, "parentId") {
                Some(parent) => self.db.get("drive_item", &parent)?,
                None => None,
            };
        }
        Ok(best)
    }

    fn require(&self, who: &Principal, id: &str, needed: Role) -> DriveResult<Role> {
        match self.role(who, id)? {
            Some(role) if role >= needed => Ok(role),
            _ => Err(DriveError::Forbidden),
        }
    }

    fn to_item(&self, row: &Row, role: Option<Role>) -> DriveResult<Item> {
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
        self.to_item(&self.item_row(id)?, Some(role))
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

    /// Items shared directly with the caller or their organizations.
    pub fn shared(&self, who: &Principal) -> DriveResult<Vec<Item>> {
        let now = iso_now();
        let mut params = vec![Value::Text(who.id.clone()), Value::Text(now)];
        let orgs = self.orgs(who)?;
        let org_clause = if orgs.is_empty() {
            String::new()
        } else {
            let marks: Vec<String> = (0..orgs.len()).map(|i| format!("?{}", i + 3)).collect();
            params.extend(orgs);
            format!(
                " OR (a.principalType = 'org' AND a.principalId IN ({}))",
                marks.join(", ")
            )
        };
        self.items(
            &format!(
                "SELECT DISTINCT i.* FROM drive_item i JOIN drive_acl a ON a.itemId = i.id
                 WHERE i.trashed = 0 AND i.ownerId != ?1
                   AND ((a.principalType = 'user' AND a.principalId = ?1){org_clause})
                   AND (a.expiresAt IS NULL OR a.expiresAt > ?2)
                 ORDER BY i.name COLLATE NOCASE"
            ),
            &params,
            who,
        )
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

    /// Save new content. `if_match` is the head version the caller last saw;
    /// a different head means someone else saved first.
    pub fn write(
        &self,
        who: &Principal,
        id: &str,
        if_match: Option<&str>,
        mime: Option<&str>,
        bytes: &[u8],
    ) -> DriveResult<Item> {
        self.require(who, id, Role::Editor)?;
        let row = self.item_row(id)?;
        if text(&row, "kind").as_deref() != Some("file") {
            return Err(DriveError::BadRequest("Folders have no content.".into()));
        }
        let head = text(&row, "headVersionId");
        if let Some(expected) = if_match.map(|m| m.trim_matches('"'))
            && expected != "*"
            && Some(expected) != head.as_deref()
        {
            let role = self.role(who, id)?;
            return Err(DriveError::Conflict(Box::new(self.to_item(&row, role)?)));
        }
        let hash = self.blobs.put_content(bytes).context("store content")?;
        let version = uuid::Uuid::now_v7().to_string();
        let now = iso_now();
        let size = bytes.len() as i64;
        self.db.transact(|tx| {
            tx.upsert(
                "drive_version",
                &version,
                [
                    ("itemId", Value::from(id)),
                    ("contentHash", hash.to_string().into()),
                    ("size", Value::Integer(size)),
                    ("authorId", who.id.clone().into()),
                    ("createdAt", now.clone().into()),
                ],
            )?;
            let mut cols = vec![
                ("headVersionId", Value::Text(version.clone())),
                ("size", Value::Integer(size)),
                ("updatedAt", now.clone().into()),
            ];
            if let Some(mime) = mime {
                cols.push(("mime", mime.into()));
            }
            tx.upsert("drive_item", id, cols)
        })?;
        self.get(who, id)
    }

    /// Write file bytes without an If-Match check. Used when a collaboration
    /// room compacts, after the last writer has gone idle.
    pub fn write_head(&self, author_id: &str, id: &str, bytes: &[u8]) -> DriveResult<Item> {
        let row = self.item_row(id)?;
        if text(&row, "kind").as_deref() != Some("file") {
            return Err(DriveError::BadRequest("Folders have no content.".into()));
        }
        let hash = self.blobs.put_content(bytes).context("store content")?;
        let version = uuid::Uuid::now_v7().to_string();
        let now = iso_now();
        let size = bytes.len() as i64;
        self.db.transact(|tx| {
            tx.upsert(
                "drive_version",
                &version,
                [
                    ("itemId", Value::from(id)),
                    ("contentHash", hash.to_string().into()),
                    ("size", Value::Integer(size)),
                    ("authorId", author_id.into()),
                    ("createdAt", now.clone().into()),
                ],
            )?;
            tx.upsert(
                "drive_item",
                id,
                [
                    ("headVersionId", Value::Text(version)),
                    ("size", Value::Integer(size)),
                    ("updatedAt", now.into()),
                ],
            )
        })?;
        let role = self.role(
            &Principal {
                id: author_id.to_owned(),
                admin: true,
            },
            id,
        )?;
        self.to_item(&self.item_row(id)?, role)
    }

    /// The item and the bytes of `version` (default: head).
    pub fn read(
        &self,
        who: &Principal,
        id: &str,
        version: Option<&str>,
    ) -> DriveResult<(Item, Vec<u8>)> {
        let item = self.get(who, id)?;
        let hash = self.content_hash(&item, version)?;
        let bytes = match hash {
            Some(hash) => self
                .blobs
                .get_content(&hash)?
                .ok_or(DriveError::Unavailable)?,
            None => Vec::new(),
        };
        Ok((item, bytes))
    }

    /// The content hash of an item version, for on-demand fetching.
    pub fn content_hash(&self, item: &Item, version: Option<&str>) -> DriveResult<Option<Hash>> {
        let version = match version {
            Some(v) => {
                let row = self
                    .db
                    .get("drive_version", v)?
                    .ok_or(DriveError::NotFound)?;
                if text(&row, "itemId").as_deref() != Some(item.id.as_str()) {
                    return Err(DriveError::NotFound);
                }
                text(&row, "contentHash")
            }
            None => item.content_hash.clone(),
        };
        version
            .map(|h| {
                h.parse()
                    .map_err(|_| DriveError::Other(anyhow::anyhow!("corrupt content hash")))
            })
            .transpose()
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

    pub fn acl(&self, who: &Principal, id: &str) -> DriveResult<Vec<AclEntry>> {
        self.require(who, id, Role::Viewer)?;
        Ok(self
            .db
            .query(
                "SELECT * FROM drive_acl WHERE itemId = ?1 ORDER BY principalType, principalId",
                &[Value::Text(id.into())],
            )?
            .into_iter()
            .filter_map(|r| {
                Some(AclEntry {
                    principal_type: text(&r, "principalType")?,
                    principal_id: text(&r, "principalId")?,
                    role: Role::parse(&text(&r, "role")?)?,
                    expires_at: text(&r, "expiresAt").filter(|s| !s.is_empty()),
                })
            })
            .collect())
    }

    /// Everyone who can open `id`: the owner, direct grants, and grants
    /// inherited from ancestor folders. When someone has more than one grant,
    /// only the highest role is returned, labelled with the folder it comes
    /// from when that role is not on the item itself.
    pub fn access(&self, who: &Principal, id: &str) -> DriveResult<ItemAccess> {
        let your_role = self.require(who, id, Role::Viewer)?;
        let now = iso_now();
        let mut best: BTreeMap<String, AccessGrant> = BTreeMap::new();
        let mut parent = None;
        let mut current = Some(id.to_owned());
        for depth in 0..MAX_DEPTH {
            let Some(item_id) = current.take() else { break };
            let row = self.item_row(&item_id)?;
            let name = text(&row, "name").unwrap_or_default();
            let on_item = item_id == id;
            if depth == 1 {
                parent = Some(InheritedFrom {
                    id: item_id.clone(),
                    name: name.clone(),
                });
            }
            if let Some(owner) = text(&row, "ownerId") {
                let key = format!("user:{owner}");
                let higher = best
                    .get(&key)
                    .is_none_or(|existing| Role::Owner > existing.role);
                if higher {
                    best.insert(
                        key,
                        AccessGrant {
                            principal_type: if on_item { "owner" } else { "user" }.into(),
                            principal_id: owner,
                            role: Role::Owner,
                            inherited_from: (!on_item).then(|| InheritedFrom {
                                id: item_id.clone(),
                                name: name.clone(),
                            }),
                            expires_at: None,
                            expired: false,
                        },
                    );
                }
            }
            let via = (!on_item).then(|| InheritedFrom {
                id: item_id.clone(),
                name: name.clone(),
            });
            for grant in self.db.query(
                "SELECT principalType, principalId, role, expiresAt FROM drive_acl WHERE itemId = ?1",
                &[Value::Text(item_id.clone())],
            )? {
                let Some(ptype) = text(&grant, "principalType") else {
                    continue;
                };
                let Some(pid) = text(&grant, "principalId") else {
                    continue;
                };
                let Some(role) = text(&grant, "role").and_then(|r| Role::parse(&r)) else {
                    continue;
                };
                let expires_at = text(&grant, "expiresAt").filter(|s| !s.is_empty());
                let expired = !grant_live(expires_at.as_deref(), &now);
                let key = format!("{ptype}:{pid}");
                let replace = match best.get(&key) {
                    None => true,
                    // A live grant beats an ended one, and a higher live role
                    // beats a weaker one. An ended grant stays visible only
                    // when the person has no live access left.
                    Some(existing) if existing.expired && !expired => true,
                    Some(existing) if !existing.expired && expired => false,
                    Some(existing) => role > existing.role,
                };
                if replace {
                    best.insert(
                        key,
                        AccessGrant {
                            principal_type: ptype,
                            principal_id: pid,
                            role,
                            inherited_from: via.clone(),
                            expires_at,
                            expired,
                        },
                    );
                }
            }
            current = text(&row, "parentId");
        }
        let mut grants: Vec<_> = best.into_values().collect();
        grants.sort_by(|a, b| {
            let rank = |g: &AccessGrant| {
                if g.principal_type == "owner" {
                    0
                } else if g.expired {
                    2
                } else {
                    1
                }
            };
            rank(a)
                .cmp(&rank(b))
                .then(b.role.cmp(&a.role))
                .then(a.principal_id.cmp(&b.principal_id))
        });
        Ok(ItemAccess {
            grants,
            parent,
            your_role,
        })
    }

    /// Comments on an item. Viewers can read them; writing is [`add_comment`].
    pub fn comments(&self, who: &Principal, id: &str) -> DriveResult<Vec<DriveComment>> {
        self.require(who, id, Role::Viewer)?;
        Ok(self
            .db
            .query(
                "SELECT * FROM drive_comment WHERE itemId = ?1 ORDER BY createdAt, id",
                &[Value::Text(id.into())],
            )?
            .into_iter()
            .map(|r| DriveComment {
                id: text(&r, "id").unwrap_or_default(),
                item_id: text(&r, "itemId").unwrap_or_default(),
                author_id: text(&r, "authorId").unwrap_or_default(),
                body: text(&r, "body").unwrap_or_default(),
                created_at: text(&r, "createdAt").unwrap_or_default(),
            })
            .collect())
    }

    /// Add a comment. Commenters, editors, and owners may do this. Changing
    /// the file itself still requires an editor (`write` returns forbidden).
    pub fn add_comment(&self, who: &Principal, id: &str, body: &str) -> DriveResult<DriveComment> {
        self.require(who, id, Role::Commenter)?;
        let body = body.trim();
        if body.is_empty() || body.len() > 8_000 {
            return Err(DriveError::BadRequest(
                "Write a comment of 1–8000 characters.".into(),
            ));
        }
        let comment_id = uuid::Uuid::now_v7().to_string();
        let now = iso_now();
        self.db.transact(|tx| {
            tx.upsert(
                "drive_comment",
                &comment_id,
                [
                    ("itemId", Value::from(id)),
                    ("authorId", who.id.clone().into()),
                    ("body", body.into()),
                    ("createdAt", now.clone().into()),
                ],
            )
        })?;
        Ok(DriveComment {
            id: comment_id,
            item_id: id.to_owned(),
            author_id: who.id.clone(),
            body: body.to_owned(),
            created_at: now,
        })
    }

    /// Grant a user or organization a role, or remove it with `None`.
    /// A user grant also writes an in-app notice for that person. There is no
    /// mail step. An organization grant has no single recipient, so it does not.
    /// Changing a role leaves an end date already stored on the grant.
    /// Ownership is [`Self::transfer`], not a role in this list.
    pub fn share(
        &self,
        who: &Principal,
        id: &str,
        principal_type: &str,
        principal_id: &str,
        role: Option<Role>,
    ) -> DriveResult<Vec<AclEntry>> {
        self.require(who, id, Role::Owner)?;
        if role == Some(Role::Owner) {
            return Err(DriveError::BadRequest(
                "Hand over the file to make someone the owner.".into(),
            ));
        }
        if principal_type != "user" && principal_type != "org" {
            return Err(DriveError::BadRequest(
                "principalType must be user or org".into(),
            ));
        }
        let key = format!("{id}:{principal_type}:{principal_id}");
        let now = iso_now();
        let dismiss_ids = if principal_type == "user" {
            self.open_notice_ids(id, principal_id)?
        } else {
            Vec::new()
        };
        let notice_id = (role.is_some() && principal_type == "user" && principal_id != who.id)
            .then(|| uuid::Uuid::now_v7().to_string());
        self.db.transact(|tx| {
            match role {
                Some(role) => tx.upsert(
                    "drive_acl",
                    &key,
                    [
                        ("itemId", Value::from(id)),
                        ("principalType", principal_type.into()),
                        ("principalId", principal_id.into()),
                        ("role", role.as_str().into()),
                    ],
                )?,
                None => tx.delete("drive_acl", &key)?,
            }
            for nid in &dismiss_ids {
                tx.upsert(
                    "drive_notice",
                    nid,
                    [("dismissedAt", Value::Text(now.clone()))],
                )?;
            }
            if let (Some(role), Some(notice_id)) = (role, notice_id.as_deref()) {
                tx.upsert(
                    "drive_notice",
                    notice_id,
                    [
                        ("itemId", Value::from(id)),
                        ("recipientId", principal_id.into()),
                        ("sharerId", who.id.clone().into()),
                        ("role", role.as_str().into()),
                        ("createdAt", now.clone().into()),
                    ],
                )?;
            }
            Ok(())
        })?;
        self.acl(who, id)
    }

    fn open_notice_ids(&self, item_id: &str, recipient_id: &str) -> DriveResult<Vec<String>> {
        Ok(self
            .db
            .query(
                "SELECT id FROM drive_notice WHERE itemId = ?1 AND recipientId = ?2 AND dismissedAt IS NULL",
                &[
                    Value::Text(item_id.into()),
                    Value::Text(recipient_id.into()),
                ],
            )?
            .into_iter()
            .filter_map(|row| text(&row, "id"))
            .collect())
    }

    /// Undismissed notices for files the caller can still open.
    pub fn notices(&self, who: &Principal) -> DriveResult<Vec<ShareNotice>> {
        let mut out = Vec::new();
        for row in self.db.query(
            "SELECT * FROM drive_notice WHERE recipientId = ?1 AND dismissedAt IS NULL ORDER BY createdAt DESC, id DESC",
            &[Value::Text(who.id.clone())],
        )? {
            let Some(item_id) = text(&row, "itemId") else {
                continue;
            };
            let Some(item) = self.db.get("drive_item", &item_id)? else {
                continue;
            };
            if int(&item, "trashed") != 0 {
                continue;
            }
            if self.role(who, &item_id)?.is_none() {
                continue;
            }
            let Some(role) = text(&row, "role").and_then(|r| Role::parse(&r)) else {
                continue;
            };
            out.push(ShareNotice {
                id: text(&row, "id").unwrap_or_default(),
                item_id,
                item_name: text(&item, "name").unwrap_or_default(),
                sharer_id: text(&row, "sharerId").unwrap_or_default(),
                role,
                created_at: text(&row, "createdAt").unwrap_or_default(),
            });
        }
        Ok(out)
    }

    /// Hide a notice. The file stays shared. Only the recipient can do this.
    pub fn dismiss_notice(&self, who: &Principal, id: &str) -> DriveResult<()> {
        let row = self
            .db
            .get("drive_notice", id)?
            .ok_or(DriveError::NotFound)?;
        if text(&row, "recipientId").as_deref() != Some(who.id.as_str()) && !who.admin {
            return Err(DriveError::Forbidden);
        }
        if text(&row, "dismissedAt").is_some() {
            return Ok(());
        }
        let now = iso_now();
        self.db
            .transact(|tx| tx.upsert("drive_notice", id, [("dismissedAt", Value::Text(now))]))?;
        Ok(())
    }

    /// A new file the caller owns at the top of My Drive, with the same name
    /// and the same bytes. Access to the original is unchanged.
    pub fn keep_copy(&self, who: &Principal, id: &str) -> DriveResult<Item> {
        let item = self.get(who, id)?;
        if item.kind != "file" {
            return Err(DriveError::BadRequest(
                "Only files can be kept as a copy in My Drive.".into(),
            ));
        }
        if let Some(hash) = item.content_hash.as_deref() {
            let parsed: Hash = hash
                .parse()
                .map_err(|_| DriveError::Other(anyhow::anyhow!("corrupt content hash")))?;
            if !self.blobs.missing(&parsed)?.is_empty() {
                return Err(DriveError::Unavailable);
            }
        }
        let created = self.create(who, None, &item.name, "file", item.mime.as_deref())?;
        let Some(hash) = item.content_hash.clone() else {
            return Ok(created);
        };
        let version = uuid::Uuid::now_v7().to_string();
        let now = iso_now();
        self.db.transact(|tx| {
            tx.upsert(
                "drive_version",
                &version,
                [
                    ("itemId", Value::Text(created.id.clone())),
                    ("contentHash", hash.into()),
                    ("size", Value::Integer(item.size)),
                    ("authorId", who.id.clone().into()),
                    ("createdAt", now.clone().into()),
                ],
            )?;
            tx.upsert(
                "drive_item",
                &created.id,
                [
                    ("headVersionId", Value::Text(version)),
                    ("size", Value::Integer(item.size)),
                    ("updatedAt", now.into()),
                ],
            )
        })?;
        self.get(who, &created.id)
    }

    /// Set or clear the moment a grant stops working. `None` clears it.
    /// The owner's own access has no end date. A past time ends access now.
    pub fn set_expiry(
        &self,
        who: &Principal,
        id: &str,
        principal_type: &str,
        principal_id: &str,
        expires_at: Option<&str>,
    ) -> DriveResult<ItemAccess> {
        self.require(who, id, Role::Owner)?;
        if principal_type != "user" && principal_type != "org" {
            return Err(DriveError::BadRequest(
                "principalType must be user or org".into(),
            ));
        }
        if principal_type == "user"
            && text(&self.item_row(id)?, "ownerId").as_deref() == Some(principal_id)
        {
            return Err(DriveError::BadRequest(
                "The owner's access does not expire.".into(),
            ));
        }
        let key = format!("{id}:{principal_type}:{principal_id}");
        if self.db.get("drive_acl", &key)?.is_none() {
            return Err(DriveError::BadRequest(
                "Share the file with them before setting an end date.".into(),
            ));
        }
        let stored = match expires_at.map(str::trim).filter(|s| !s.is_empty()) {
            Some(raw) => Value::Text(normalize_expiry(raw)?),
            None => Value::Null,
        };
        self.db
            .transact(|tx| tx.upsert("drive_acl", &key, [("expiresAt", stored)]))?;
        self.access(who, id)
    }

    /// Make `new_owner` the owner immediately. The caller becomes an editor.
    /// There is no invitation and nothing to accept.
    pub fn transfer(&self, who: &Principal, id: &str, new_owner: &str) -> DriveResult<Item> {
        self.require(who, id, Role::Owner)?;
        let new_owner = new_owner.trim();
        if new_owner.is_empty() || new_owner.len() > 128 || new_owner.contains(['/', '\\', '\0']) {
            return Err(DriveError::BadRequest(
                "Choose a person to own this file.".into(),
            ));
        }
        let current = text(&self.item_row(id)?, "ownerId").unwrap_or_default();
        if new_owner == current {
            return Err(DriveError::BadRequest("They already own this file.".into()));
        }
        // Folder owners can manage what is inside, but only this item's owner
        // can hand the item itself to someone else.
        if !who.admin && current != who.id {
            return Err(DriveError::Forbidden);
        }
        let previous = current;
        let editor_key = format!("{id}:user:{previous}");
        let dropped_key = format!("{id}:user:{new_owner}");
        self.db.transact(|tx| {
            tx.upsert(
                "drive_item",
                id,
                [
                    ("ownerId", Value::Text(new_owner.to_owned())),
                    ("updatedAt", iso_now().into()),
                ],
            )?;
            tx.upsert(
                "drive_acl",
                &editor_key,
                [
                    ("itemId", Value::from(id)),
                    ("principalType", Value::from("user")),
                    ("principalId", Value::from(previous.as_str())),
                    ("role", Value::from(Role::Editor.as_str())),
                    ("expiresAt", Value::Null),
                ],
            )?;
            tx.delete("drive_acl", &dropped_key)
        })?;
        self.get(who, id)
    }

    /// Answer a peer's blob request with as many requested blobs as fit.
    pub fn handle_blob_request(&self, data: &[u8]) -> Vec<u8> {
        let mut response = BlobResponse::default();
        if let Ok(request) = ciborium::from_reader::<BlobRequest, _>(data) {
            let mut size = 0;
            for hash in request.hashes.into_iter().take(256) {
                let blob = self.blobs.get(&hash).ok().flatten();
                let len = blob.as_ref().map_or(0, Vec::len);
                if size > 0 && size + len > MAX_BLOB_RESPONSE {
                    break;
                }
                size += len;
                response.blobs.push((hash, blob.map(ByteBuf::from)));
            }
        }
        let mut out = Vec::new();
        ciborium::into_writer(&response, &mut out).expect("CBOR encoding into a Vec cannot fail");
        out
    }

    /// Fetch every missing blob of `content` from peers. Returns whether the
    /// content is complete locally.
    pub async fn fetch(
        &self,
        content: Hash,
        transport: &dyn BlobTransport,
    ) -> anyhow::Result<bool> {
        loop {
            let missing = self.blobs.missing(&content)?;
            if missing.is_empty() {
                self.wanted.lock().unwrap().remove(&content);
                return Ok(true);
            }
            let mut progress = false;
            for peer in transport.peers().await {
                for batch in missing.chunks(16) {
                    let mut request = Vec::new();
                    ciborium::into_writer(
                        &BlobRequest {
                            hashes: batch.to_vec(),
                        },
                        &mut request,
                    )?;
                    let reply = match transport.request(&peer, request).await {
                        Ok(r) => r,
                        Err(e) => {
                            tracing::debug!("blob request to {peer}: {e:#}");
                            break;
                        }
                    };
                    let response: BlobResponse = ciborium::from_reader(reply.as_slice())?;
                    for (hash, bytes) in response.blobs {
                        if let Some(bytes) = bytes
                            && batch.contains(&hash)
                            && self.blobs.put_verified(&hash, &bytes).is_ok()
                        {
                            progress = true;
                        }
                    }
                }
                if progress {
                    break;
                }
            }
            if !progress {
                return Ok(false);
            }
        }
    }

    /// Fetch wanted content whenever new versions arrive, and retry
    /// periodically for content no connected peer had yet.
    pub async fn replicate(self: Arc<Self>, transport: Arc<dyn BlobTransport>, retry: Duration) {
        loop {
            tokio::select! {
                _ = self.notify.notified() => {}
                _ = tokio::time::sleep(retry) => {}
            }
            for hash in self.wanted() {
                match self.fetch(hash, transport.as_ref()).await {
                    Ok(true) => tracing::info!("replicated content {hash}"),
                    Ok(false) => {}
                    Err(e) => tracing::warn!("replicating {hash}: {e:#}"),
                }
            }
        }
    }
}
