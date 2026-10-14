//! Nested groups and the audit rows an admin reads.
//!
//! A group may contain people and other groups. Adding an edge is refused
//! when it would make a loop. A merge can still create one, so every walk
//! keeps a visited set and the group page can say a loop is present.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use suitedb::{
    Value,
    hlc::{iso_from_ms, iso_now, now_ms},
};

use super::{Drive, DriveError, DriveResult, text};

const OPEN_WINDOW_MS: u64 = 15 * 60 * 1000;

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryGroup {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GroupMember {
    pub member_type: String,
    pub member_id: String,
    /// True when this person or group was added directly, not through nesting.
    pub direct: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GroupDetail {
    pub group: DirectoryGroup,
    pub members: Vec<GroupMember>,
    /// People who reach this group through nesting, including direct members.
    pub people: Vec<String>,
    /// A replicated race left a loop that includes this group.
    pub loop_present: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuditEvent {
    pub id: String,
    pub at: String,
    pub actor_id: String,
    pub action: String,
    pub target_type: String,
    pub target_id: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrailEntry {
    pub at: String,
    pub action: String,
    pub item_id: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersonFile {
    pub id: String,
    pub name: String,
    pub size: i64,
    /// `owned`, or `group` when a group grant is how they can open it.
    pub via: String,
    pub group_name: Option<String>,
}

fn clean_name(name: &str) -> DriveResult<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(DriveError::BadRequest(
            "Give the group a name of 1 to 80 characters.".into(),
        ));
    }
    Ok(name.to_owned())
}

fn group_from(row: &BTreeMap<String, Value>) -> Option<DirectoryGroup> {
    Some(DirectoryGroup {
        id: text(row, "id")?,
        name: text(row, "name").unwrap_or_default(),
        created_at: text(row, "createdAt").unwrap_or_default(),
        updated_at: text(row, "updatedAt").unwrap_or_default(),
    })
}

impl Drive {
    pub fn create_group(&self, actor: &str, name: &str) -> DriveResult<DirectoryGroup> {
        let name = clean_name(name)?;
        let id = uuid::Uuid::now_v7().to_string();
        let now = iso_now();
        self.db.transact(|tx| {
            tx.upsert(
                "directory_group",
                &id,
                [
                    ("name", Value::Text(name.clone())),
                    ("createdAt", Value::Text(now.clone())),
                    ("updatedAt", Value::Text(now.clone())),
                ],
            )
        })?;
        self.record_audit(actor, "group.create", "group", &id, &name)?;
        Ok(DirectoryGroup {
            id,
            name,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn rename_group(&self, actor: &str, id: &str, name: &str) -> DriveResult<DirectoryGroup> {
        let name = clean_name(name)?;
        let existing = self
            .db
            .get("directory_group", id)?
            .ok_or(DriveError::NotFound)?;
        let created = text(&existing, "createdAt").unwrap_or_default();
        let now = iso_now();
        self.db.transact(|tx| {
            tx.upsert(
                "directory_group",
                id,
                [
                    ("name", Value::Text(name.clone())),
                    ("updatedAt", Value::Text(now.clone())),
                ],
            )
        })?;
        self.record_audit(actor, "group.rename", "group", id, &name)?;
        Ok(DirectoryGroup {
            id: id.to_owned(),
            name,
            created_at: created,
            updated_at: now,
        })
    }

    pub fn delete_group(&self, actor: &str, id: &str) -> DriveResult<()> {
        let existing = self
            .db
            .get("directory_group", id)?
            .ok_or(DriveError::NotFound)?;
        let name = text(&existing, "name").unwrap_or_default();
        let edges = self.edge_ids(
            "SELECT id FROM directory_edge WHERE groupId = ?1 OR (memberType = 'group' AND memberId = ?1)",
            id,
        )?;
        let grants = self.edge_ids(
            "SELECT id FROM drive_acl WHERE principalType = 'group' AND principalId = ?1",
            id,
        )?;
        self.db.transact(|tx| {
            for edge in &edges {
                tx.delete("directory_edge", edge)?;
            }
            for grant in &grants {
                tx.delete("drive_acl", grant)?;
            }
            tx.delete("directory_group", id)
        })?;
        self.record_audit(actor, "group.remove", "group", id, &name)?;
        Ok(())
    }

    fn edge_ids(&self, sql: &str, id: &str) -> DriveResult<Vec<String>> {
        Ok(self
            .db
            .query(sql, &[Value::Text(id.into())])?
            .into_iter()
            .filter_map(|row| text(&row, "id"))
            .collect())
    }

    pub fn add_member(
        &self,
        actor: &str,
        group_id: &str,
        member_type: &str,
        member_id: &str,
    ) -> DriveResult<()> {
        if member_type != "user" && member_type != "group" {
            return Err(DriveError::BadRequest(
                "A member is a person or a group.".into(),
            ));
        }
        let group = self
            .db
            .get("directory_group", group_id)?
            .ok_or(DriveError::NotFound)?;
        let group_name = text(&group, "name").unwrap_or_default();
        if member_type == "group" {
            if self.db.get("directory_group", member_id)?.is_none() {
                return Err(DriveError::NotFound);
            }
            if self.reaches(member_id, group_id)? {
                return Err(DriveError::BadRequest(
                    "That group is already inside this one, so adding it would make a loop.".into(),
                ));
            }
        }
        let existing = self.db.query(
            "SELECT id FROM directory_edge WHERE groupId = ?1 AND memberType = ?2 AND memberId = ?3 LIMIT 1",
            &[
                Value::Text(group_id.into()),
                Value::Text(member_type.into()),
                Value::Text(member_id.into()),
            ],
        )?;
        if !existing.is_empty() {
            return Err(DriveError::BadRequest(
                "They are already in this group.".into(),
            ));
        }
        let id = uuid::Uuid::now_v7().to_string();
        self.db.transact(|tx| {
            tx.upsert(
                "directory_edge",
                &id,
                [
                    ("groupId", Value::Text(group_id.into())),
                    ("memberType", Value::Text(member_type.into())),
                    ("memberId", Value::Text(member_id.into())),
                ],
            )
        })?;
        if member_type == "user" {
            self.record_audit(actor, "group.member", "user", member_id, &group_name)?;
        }
        let label = if member_type == "user" {
            member_id.to_owned()
        } else {
            text(
                &self
                    .db
                    .get("directory_group", member_id)?
                    .unwrap_or_default(),
                "name",
            )
            .unwrap_or_else(|| member_id.to_owned())
        };
        self.record_audit(actor, "group.member", "group", group_id, &label)?;
        Ok(())
    }

    pub fn remove_member(
        &self,
        actor: &str,
        group_id: &str,
        member_type: &str,
        member_id: &str,
    ) -> DriveResult<()> {
        let rows = self.db.query(
            "SELECT id FROM directory_edge WHERE groupId = ?1 AND memberType = ?2 AND memberId = ?3",
            &[
                Value::Text(group_id.into()),
                Value::Text(member_type.into()),
                Value::Text(member_id.into()),
            ],
        )?;
        if rows.is_empty() {
            return Err(DriveError::NotFound);
        }
        let group_name = self
            .db
            .get("directory_group", group_id)?
            .as_ref()
            .and_then(|row| text(row, "name"))
            .unwrap_or_default();
        self.db.transact(|tx| {
            for row in &rows {
                if let Some(id) = text(row, "id") {
                    tx.delete("directory_edge", &id)?;
                }
            }
            Ok(())
        })?;
        if member_type == "user" {
            self.record_audit(actor, "group.unmember", "user", member_id, &group_name)?;
        }
        self.record_audit(actor, "group.unmember", "group", group_id, member_id)?;
        Ok(())
    }

    pub fn list_groups(&self) -> DriveResult<Vec<DirectoryGroup>> {
        Ok(self
            .db
            .query(
                "SELECT * FROM directory_group ORDER BY name COLLATE NOCASE, id",
                &[],
            )?
            .into_iter()
            .filter_map(|row| group_from(&row))
            .collect())
    }

    pub fn search_groups(&self, query: &str) -> DriveResult<Vec<DirectoryGroup>> {
        let query = query.trim();
        if query.chars().count() < 2 {
            return Ok(vec![]);
        }
        let mut escaped = String::new();
        for c in query.chars() {
            if c == '\\' || c == '%' || c == '_' {
                escaped.push('\\');
            }
            escaped.extend(c.to_lowercase());
        }
        let pattern = format!("%{escaped}%");
        Ok(self
            .db
            .query(
                "SELECT * FROM directory_group WHERE LOWER(name) LIKE ?1 ESCAPE '\\' ORDER BY name COLLATE NOCASE LIMIT 8",
                &[Value::Text(pattern)],
            )?
            .into_iter()
            .filter_map(|row| group_from(&row))
            .collect())
    }

    pub fn group_detail(&self, id: &str) -> DriveResult<GroupDetail> {
        let group = group_from(
            &self
                .db
                .get("directory_group", id)?
                .ok_or(DriveError::NotFound)?,
        )
        .ok_or(DriveError::NotFound)?;
        let mut members = Vec::new();
        for row in self.db.query(
            "SELECT memberType, memberId FROM directory_edge WHERE groupId = ?1 ORDER BY memberType, memberId",
            &[Value::Text(id.into())],
        )? {
            let Some(member_type) = text(&row, "memberType") else {
                continue;
            };
            let Some(member_id) = text(&row, "memberId") else {
                continue;
            };
            members.push(GroupMember {
                member_type,
                member_id,
                direct: true,
            });
        }
        let people = self.people_in(id)?;
        let loop_present = self.group_has_loop(id)?;
        Ok(GroupDetail {
            group,
            members,
            people,
            loop_present,
        })
    }

    pub fn group_name(&self, id: &str) -> DriveResult<Option<String>> {
        Ok(self
            .db
            .get("directory_group", id)?
            .as_ref()
            .and_then(|row| text(row, "name")))
    }

    /// Groups this person belongs to, including groups that contain those groups.
    pub fn group_ids(&self, user_id: &str) -> DriveResult<Vec<Value>> {
        let mut direct = Vec::new();
        for row in self.db.query(
            "SELECT groupId FROM directory_edge WHERE memberType = 'user' AND memberId = ?1",
            &[Value::Text(user_id.into())],
        )? {
            if let Some(id) = text(&row, "groupId") {
                direct.push(id);
            }
        }
        let mut all = BTreeSet::new();
        let mut frontier = direct;
        let mut guard = 0;
        while !frontier.is_empty() && guard < 10_000 {
            guard += 1;
            let mut next = Vec::new();
            for id in frontier {
                if !all.insert(id.clone()) {
                    continue;
                }
                for row in self.db.query(
                    "SELECT groupId FROM directory_edge WHERE memberType = 'group' AND memberId = ?1",
                    &[Value::Text(id)],
                )? {
                    if let Some(parent) = text(&row, "groupId")
                        && !all.contains(&parent)
                    {
                        next.push(parent);
                    }
                }
            }
            frontier = next;
        }
        Ok(all.into_iter().map(Value::Text).collect())
    }

    /// True when `target` is `start` or sits inside `start`, walking members.
    fn reaches(&self, start: &str, target: &str) -> DriveResult<bool> {
        let mut stack = vec![start.to_owned()];
        let mut seen = BTreeSet::new();
        while let Some(group) = stack.pop() {
            if !seen.insert(group.clone()) {
                continue;
            }
            if group == target {
                return Ok(true);
            }
            for child in self.child_groups(&group)? {
                stack.push(child);
            }
        }
        Ok(false)
    }

    fn child_groups(&self, group_id: &str) -> DriveResult<Vec<String>> {
        Ok(self
            .db
            .query(
                "SELECT memberId FROM directory_edge WHERE groupId = ?1 AND memberType = 'group'",
                &[Value::Text(group_id.into())],
            )?
            .into_iter()
            .filter_map(|row| text(&row, "memberId"))
            .collect())
    }

    pub fn group_has_loop(&self, start: &str) -> DriveResult<bool> {
        let mut color: BTreeMap<String, u8> = BTreeMap::new();
        self.loop_from(start, &mut color)
    }

    fn loop_from(&self, group: &str, color: &mut BTreeMap<String, u8>) -> DriveResult<bool> {
        match color.get(group).copied() {
            Some(1) => return Ok(true),
            Some(2) => return Ok(false),
            _ => {}
        }
        color.insert(group.to_owned(), 1);
        for child in self.child_groups(group)? {
            if self.loop_from(&child, color)? {
                return Ok(true);
            }
        }
        color.insert(group.to_owned(), 2);
        Ok(false)
    }

    pub(super) fn people_in(&self, start: &str) -> DriveResult<Vec<String>> {
        let mut groups = BTreeSet::new();
        let mut stack = vec![start.to_owned()];
        let mut people = BTreeSet::new();
        while let Some(group) = stack.pop() {
            if !groups.insert(group.clone()) {
                continue;
            }
            for row in self.db.query(
                "SELECT memberType, memberId FROM directory_edge WHERE groupId = ?1",
                &[Value::Text(group)],
            )? {
                let Some(kind) = text(&row, "memberType") else {
                    continue;
                };
                let Some(id) = text(&row, "memberId") else {
                    continue;
                };
                if kind == "user" {
                    people.insert(id);
                } else if kind == "group" {
                    stack.push(id);
                }
            }
        }
        Ok(people.into_iter().collect())
    }

    pub fn record_audit(
        &self,
        actor: &str,
        action: &str,
        target_type: &str,
        target_id: &str,
        name: &str,
    ) -> DriveResult<()> {
        let id = uuid::Uuid::now_v7().to_string();
        self.db.transact(|tx| {
            tx.upsert(
                "audit_event",
                &id,
                [
                    ("at", Value::Text(iso_now())),
                    ("actorId", Value::Text(actor.into())),
                    ("action", Value::Text(action.into())),
                    ("targetType", Value::Text(target_type.into())),
                    ("targetId", Value::Text(target_id.into())),
                    ("name", Value::Text(name.into())),
                ],
            )
        })?;
        Ok(())
    }

    /// One open per person per file per 15 minutes. Folder listings are not opens.
    pub fn note_open(&self, actor: &str, item_id: &str, name: &str) -> DriveResult<()> {
        let cutoff = iso_from_ms(now_ms().saturating_sub(OPEN_WINDOW_MS));
        let recent = self.db.query(
            "SELECT id FROM audit_event WHERE actorId = ?1 AND action = 'open' AND targetType = 'item' AND targetId = ?2 AND at > ?3 LIMIT 1",
            &[
                Value::Text(actor.into()),
                Value::Text(item_id.into()),
                Value::Text(cutoff),
            ],
        )?;
        if !recent.is_empty() {
            return Ok(());
        }
        self.record_audit(actor, "open", "item", item_id, name)
    }

    pub fn audit_for(&self, target_type: &str, target_id: &str) -> DriveResult<Vec<AuditEvent>> {
        Ok(self
            .db
            .query(
                "SELECT * FROM audit_event WHERE targetType = ?1 AND targetId = ?2 ORDER BY at DESC, id DESC",
                &[Value::Text(target_type.into()), Value::Text(target_id.into())],
            )?
            .into_iter()
            .filter_map(|row| {
                Some(AuditEvent {
                    id: text(&row, "id")?,
                    at: text(&row, "at").unwrap_or_default(),
                    actor_id: text(&row, "actorId").unwrap_or_default(),
                    action: text(&row, "action").unwrap_or_default(),
                    target_type: text(&row, "targetType").unwrap_or_default(),
                    target_id: text(&row, "targetId").unwrap_or_default(),
                    name: text(&row, "name").unwrap_or_default(),
                })
            })
            .collect())
    }

    /// Opens from the audit log and edits from version history, newest first.
    pub fn document_trail(&self, user_id: &str) -> DriveResult<Vec<TrailEntry>> {
        let mut entries = Vec::new();
        for row in self.db.query(
            "SELECT at, targetId, name FROM audit_event WHERE actorId = ?1 AND action = 'open' AND targetType = 'item' ORDER BY at DESC",
            &[Value::Text(user_id.into())],
        )? {
            entries.push(TrailEntry {
                at: text(&row, "at").unwrap_or_default(),
                action: "open".into(),
                item_id: text(&row, "targetId").unwrap_or_default(),
                name: text(&row, "name").unwrap_or_default(),
            });
        }
        for row in self.db.query(
            "SELECT v.createdAt, v.itemId, v.name, i.name AS itemName FROM drive_version v LEFT JOIN drive_item i ON i.id = v.itemId WHERE v.authorId = ?1",
            &[Value::Text(user_id.into())],
        )? {
            let version_name = text(&row, "name").filter(|s| !s.is_empty());
            let item_name = text(&row, "itemName").filter(|s| !s.is_empty());
            entries.push(TrailEntry {
                at: text(&row, "createdAt").unwrap_or_default(),
                action: "edit".into(),
                item_id: text(&row, "itemId").unwrap_or_default(),
                name: version_name.or(item_name).unwrap_or_else(|| "Untitled".into()),
            });
        }
        entries.sort_by(|a, b| b.at.cmp(&a.at).then(a.action.cmp(&b.action)));
        Ok(entries)
    }

    /// Sign-ins recorded when a session is created. `name` is the IP and browser.
    pub fn sign_in_events(&self, user_id: &str) -> DriveResult<Vec<AuditEvent>> {
        Ok(self
            .db
            .query(
                "SELECT * FROM audit_event WHERE actorId = ?1 AND action = 'sign-in' ORDER BY at DESC, id DESC",
                &[Value::Text(user_id.into())],
            )?
            .into_iter()
            .filter_map(|row| {
                Some(AuditEvent {
                    id: text(&row, "id")?,
                    at: text(&row, "at").unwrap_or_default(),
                    actor_id: text(&row, "actorId").unwrap_or_default(),
                    action: text(&row, "action").unwrap_or_default(),
                    target_type: text(&row, "targetType").unwrap_or_default(),
                    target_id: text(&row, "targetId").unwrap_or_default(),
                    name: text(&row, "name").unwrap_or_default(),
                })
            })
            .collect())
    }

    /// Files they own, plus files a group they belong to can open.
    pub fn person_files(&self, user_id: &str) -> DriveResult<(Vec<PersonFile>, i64)> {
        let mut files = Vec::new();
        let mut bytes = 0_i64;
        let mut seen = BTreeSet::new();
        for row in self.db.query(
            "SELECT * FROM drive_item WHERE ownerId = ?1 AND kind = 'file' AND trashed = 0 ORDER BY name COLLATE NOCASE",
            &[Value::Text(user_id.into())],
        )? {
            let Some(id) = text(&row, "id") else { continue };
            let size = super::int(&row, "size");
            bytes += size;
            seen.insert(id.clone());
            files.push(PersonFile {
                id,
                name: text(&row, "name").unwrap_or_default(),
                size,
                via: "owned".into(),
                group_name: None,
            });
        }
        let groups = self.group_ids(user_id)?;
        if !groups.is_empty() {
            let mut params = groups.clone();
            let marks: Vec<String> = (0..groups.len()).map(|i| format!("?{}", i + 1)).collect();
            let now = iso_now();
            params.push(Value::Text(now));
            let now_mark = params.len();
            for row in self.db.query(
                &format!(
                    "SELECT i.*, a.principalId AS groupId FROM drive_item i
                     JOIN drive_acl a ON a.itemId = i.id
                     WHERE i.kind = 'file' AND i.trashed = 0
                       AND a.principalType = 'group' AND a.principalId IN ({})
                       AND (a.expiresAt IS NULL OR a.expiresAt > ?{now_mark})",
                    marks.join(", ")
                ),
                &params,
            )? {
                let Some(id) = text(&row, "id") else { continue };
                if !seen.insert(id.clone()) {
                    continue;
                }
                let group_id = text(&row, "groupId").unwrap_or_default();
                files.push(PersonFile {
                    id,
                    name: text(&row, "name").unwrap_or_default(),
                    size: super::int(&row, "size"),
                    via: "group".into(),
                    group_name: self.group_name(&group_id)?,
                });
            }
        }
        Ok((files, bytes))
    }

    pub fn owned_item_ids(&self, user_id: &str) -> DriveResult<Vec<String>> {
        Ok(self
            .db
            .query(
                "SELECT id FROM drive_item WHERE ownerId = ?1",
                &[Value::Text(user_id.into())],
            )?
            .into_iter()
            .filter_map(|row| text(&row, "id"))
            .collect())
    }

    /// Hand every item they own to someone else. The caller must be an admin.
    pub fn transfer_owned(
        &self,
        actor: &super::Principal,
        from: &str,
        to: &str,
    ) -> DriveResult<usize> {
        if !actor.admin {
            return Err(DriveError::Forbidden);
        }
        let ids = self.owned_item_ids(from)?;
        for id in &ids {
            self.transfer(actor, id, to)?;
        }
        Ok(ids.len())
    }
}
