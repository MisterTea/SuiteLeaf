//! The SuiteDB tables that hold SuiteDrive metadata.

use suitedb::{ColumnType, TableDef};

/// Bump when the drive tables change.
pub const SCHEMA_VERSION: u32 = 7;

pub fn tables() -> Vec<TableDef> {
    use ColumnType::*;
    vec![
        TableDef::new("drive_public_link", "id")
            .column("token", Text)
            .index("token"),
        TableDef::new("drive_setting", "id").column("value", Text),
        TableDef::new("drive_open_presence", "id")
            .column("itemId", Text)
            .column("userId", Text)
            .column("name", Text)
            .column("editing", Integer)
            .column("lastActiveMs", Integer)
            .index("itemId"),
        TableDef::new("drive_signal", "id")
            .column("itemId", Text)
            .column("payload", Text)
            .column("expiresAt", Text)
            .index("itemId"),
        TableDef::new("drive_upload", "id")
            .column("ownerId", Text)
            .column("total", Integer)
            .column("offset", Integer)
            .column("baseVersion", Text)
            .column("mime", Text),
        TableDef::new("drive_upload_chunk", "id")
            .column("itemId", Text)
            .column("offset", Integer)
            .column("bytes", Blob)
            .index("itemId"),
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
            .column("restricted", Integer)
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
        // A secret that lets someone add one form response without an account.
        // The token is the primary key so a public request looks up one row.
        TableDef::new("drive_respond_link", "token")
            .column("itemId", Text)
            .column("createdAt", Text)
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
            .column("seedOwnerId", Text)
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
        TableDef::new("directory_group", "id")
            .column("name", Text)
            .column("createdAt", Text)
            .column("updatedAt", Text)
            .index("name"),
        TableDef::new("directory_edge", "id")
            .column("groupId", Text)
            .column("memberType", Text)
            .column("memberId", Text)
            .index("groupId")
            .index("memberId"),
        TableDef::new("audit_event", "id")
            .column("at", Text)
            .column("actorId", Text)
            .column("action", Text)
            .column("targetType", Text)
            .column("targetId", Text)
            .column("name", Text)
            .index("actorId")
            .index("targetId"),
    ]
}
