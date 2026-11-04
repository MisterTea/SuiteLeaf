//! Grants, share notices, end dates, and handing a file to a new owner.

use std::collections::BTreeMap;

use serde::Serialize;
use suitedb::{Value, hlc::iso_now};

use crate::{
    Drive, DriveError, DriveResult, Hash, Item, MAX_DEPTH, Principal, Role,
    expiry::{grant_live, normalize_expiry},
    row::{int, text},
};

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

impl Drive {
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

    /// Grant a user, group, or organization a role, or remove it with `None`.
    /// Viewer can read, commenter can read and comment, and editor can write.
    /// A user grant notifies that person. A group grant notifies everyone who
    /// belongs to the group, including through nesting. There is no mail step.
    /// An organization grant has no single recipient, so it does not notify.
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
        if principal_type != "user" && principal_type != "org" && principal_type != "group" {
            return Err(DriveError::BadRequest(
                "principalType must be user, group, or org".into(),
            ));
        }
        let key = format!("{id}:{principal_type}:{principal_id}");
        let previous_role = self
            .db
            .get("drive_acl", &key)?
            .as_ref()
            .and_then(|row| text(row, "role"))
            .and_then(|role| Role::parse(&role))
            .map(Role::as_str)
            .unwrap_or("none");
        let next_role = role.map(Role::as_str).unwrap_or("none");
        let now = iso_now();
        let recipients = match principal_type {
            "user" => vec![principal_id.to_owned()],
            "group" => self.people_in(principal_id)?,
            _ => Vec::new(),
        };
        let mut dismiss_ids = Vec::new();
        for recipient in &recipients {
            dismiss_ids.extend(self.open_notice_ids(id, recipient)?);
        }
        let notify: Vec<String> = if role.is_some() {
            recipients.into_iter().filter(|id| id != &who.id).collect()
        } else {
            Vec::new()
        };
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
            if let Some(role) = role {
                for recipient in &notify {
                    tx.upsert(
                        "drive_notice",
                        &uuid::Uuid::now_v7().to_string(),
                        [
                            ("itemId", Value::from(id)),
                            ("recipientId", recipient.as_str().into()),
                            ("sharerId", who.id.clone().into()),
                            ("role", role.as_str().into()),
                            ("createdAt", now.clone().into()),
                        ],
                    )?;
                }
            }
            Ok(())
        })?;
        self.record_audit(
            &who.id,
            "share.before",
            "item",
            id,
            &format!("{principal_type} {principal_id} {previous_role}"),
        )?;
        self.record_audit(
            &who.id,
            "share.after",
            "item",
            id,
            &format!("{principal_type} {principal_id} {next_role}"),
        )?;
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
        if principal_type != "user" && principal_type != "org" && principal_type != "group" {
            return Err(DriveError::BadRequest(
                "principalType must be user, group, or org".into(),
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
}
