//! An independent copy of SuiteDrive file bytes.
//!
//! Replication keeps another node in step with this one, so it also copies
//! deletions and gaps. A backup is a directory written only after every
//! content hash and chunk is present. Restore checks that directory before
//! it copies anything into a live blob store.
//!
//! An optional `database.sqlite` is a caller-supplied copy of SuiteDB. Its
//! hash is checked before a restore copies blobs. A folder restore copies
//! that folder's rows from an opened snapshot and copies a missing account
//! only when a restored grant names it. Desktop recovery drafts stay separate.

mod archive;
mod drill;
mod restore;
mod retention;
mod rows;
mod schedule;
mod snapshot;

pub use archive::{
    BACKUP_KIND, BACKUP_VERSION, BackupManifest, RestorePlan, export_backup,
    export_backup_from_database, export_backup_with_database, export_if_due, restore_blobs,
    restore_contents, verify_backup,
};
pub use drill::{
    BackupFreshness, DRILL_KIND, RestoreDrill, backup_freshness, record_restore_drill,
};
pub use restore::{
    FileRestore, FolderRestore, VersionRestore, plan_file_restore, restore_file, restore_folder,
    restore_folder_copy, restore_version,
};
pub use retention::{RetentionPlan, apply_retention, retention_plan};
pub use schedule::{BackupDue, backup_due, schedule_note};
pub(crate) use snapshot::import_snapshot;
pub use snapshot::{CleanRestore, restore_auth_config, restore_clean};
