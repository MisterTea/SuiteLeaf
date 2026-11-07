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

mod access;
mod access_plan;
pub mod backup;
pub mod backup_chain;
pub mod blobs;
mod comments;
mod content;
mod directory;
mod error;
mod expiry;
mod form_answers;
mod forms;
mod guest;
mod items;
pub mod move_preview;
mod person_access;
mod policy;
mod presence;
mod public_sharing;
pub mod recover;
mod replication;
mod row;
mod schema;
pub mod seal;
mod search;
pub mod share_migration;
mod sharing;
mod versions;

pub use access::{AccessExplanation, AccessReason, Principal, Role};
pub use blobs::{BlobStore, CHUNK_SIZE, Hash, Manifest};
pub use comments::DriveComment;
pub use directory::{AuditEvent, DirectoryGroup, GroupDetail, GroupMember, PersonFile, TrailEntry};
pub use error::{DriveError, DriveResult};
pub use forms::PublicForm;
pub use guest::{GuestShare, guest_role};
pub use items::Item;
pub use policy::{PolicyChange, PolicyPlan};
pub use presence::{PRESENCE_IDLE, PRESENCE_TTL, Presence};
pub use public_sharing::PublicLink;
pub use replication::{BlobRequest, BlobResponse, BlobTransport};
pub use schema::{SCHEMA_VERSION, tables};
pub use search::{SearchHit, SpreadsheetHit};
pub use share_migration::{AccessChange, MemberPlan, RestrictPlan};
pub use sharing::{AccessGrant, AclEntry, InheritedFrom, ItemAccess, ShareNotice};
pub use versions::Version;

use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use anyhow::Context;
use suitedb::Db;
use tokio::sync::Notify;

use content::{OpenUpload, load_partials};
use expiry::normalize_expiry;
use presence::PresenceBeat;
use row::{int, text};

const MAX_DEPTH: usize = 64;

pub struct Drive {
    db: Arc<Db>,
    blobs: BlobStore,
    wanted: Mutex<BTreeSet<Hash>>,
    notify: Notify,
    /// Latest open-file beat per item, then per user. Read paths drop beats
    /// older than [`PRESENCE_TTL`]; there is no sweeper thread.
    presence: Mutex<BTreeMap<String, BTreeMap<String, PresenceBeat>>>,
    /// Bytes accepted for an upload that is not a version yet.
    partials: Mutex<BTreeMap<String, OpenUpload>>,
    partial_dir: PathBuf,
    storage_budget: Mutex<Option<u64>>,
    public_sharing_lock: Mutex<()>,
}

impl Drive {
    pub fn open_cloud(db: Arc<Db>, bridge_url: &str, token: &str) -> anyhow::Result<Arc<Drive>> {
        anyhow::ensure!(db.is_postgres(), "Cloud storage requires Postgres");
        Ok(Arc::new(Drive {
            db,
            blobs: BlobStore::open_remote(bridge_url, token)?,
            wanted: Mutex::default(),
            notify: Notify::new(),
            presence: Mutex::default(),
            partials: Mutex::default(),
            partial_dir: PathBuf::new(),
            storage_budget: Mutex::new(None),
            public_sharing_lock: Mutex::new(()),
        }))
    }
    /// Open the blob store and start tracking versions whose blobs are missing.
    pub fn open(db: Arc<Db>, root: &Path) -> anyhow::Result<Arc<Drive>> {
        for t in tables() {
            if db.schema().table(&t.name).is_none() {
                anyhow::bail!("the SuiteDB schema lacks the {} table", t.name);
            }
        }
        let partial_dir = root.join("partials");
        fs::create_dir_all(&partial_dir)
            .with_context(|| format!("create {}", partial_dir.display()))?;
        let drive = Arc::new(Drive {
            db: db.clone(),
            blobs: BlobStore::open(root)?,
            wanted: Mutex::default(),
            notify: Notify::new(),
            presence: Mutex::default(),
            partials: Mutex::new(load_partials(&partial_dir)),
            partial_dir,
            storage_budget: Mutex::new(None),
            public_sharing_lock: Mutex::new(()),
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
}
