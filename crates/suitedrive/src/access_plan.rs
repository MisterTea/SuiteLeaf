//! Who would gain or lose access if a folder were restricted or a group changed.

use suitedb::Value;

use crate::{
    AccessChange, Drive, DriveError, DriveResult, MAX_DEPTH, MemberPlan, Principal, RestrictPlan,
    Role, row::text,
};

impl Drive {
    /// Stop grants on folders above this one. Only a folder owner can set it.
    pub fn set_restricted(&self, who: &Principal, id: &str, restricted: bool) -> DriveResult<()> {
        self.require(who, id, Role::Owner)?;
        let row = self.item_row(id)?;
        if text(&row, "kind").as_deref() != Some("folder") {
            return Err(DriveError::BadRequest(
                "Only a folder can be restricted.".into(),
            ));
        }
        self.db.transact(|tx| {
            tx.upsert(
                "drive_item",
                id,
                [("restricted", Value::Integer(if restricted { 1 } else { 0 }))],
            )
        })?;
        Ok(())
    }

    /// Who would lose or keep a different role if this folder became restricted.
    /// Nothing is written.
    pub fn plan_restrict(&self, who: &Principal, id: &str) -> DriveResult<RestrictPlan> {
        self.require(who, id, Role::Owner)?;
        let row = self.item_row(id)?;
        if text(&row, "kind").as_deref() != Some("folder") {
            return Err(DriveError::BadRequest(
                "Only a folder can be restricted.".into(),
            ));
        }
        let folder_name = text(&row, "name").unwrap_or_default();
        let items = self.subtree(id)?;
        let mut changes = Vec::new();
        for principal in self.users_above(id)? {
            let person = Principal {
                id: principal.clone(),
                admin: false,
            };
            for (item_id, item_name) in &items {
                let before = self.explain(&person, item_id)?.role;
                let after = self
                    .explain_in(&person, item_id, Some(id), &[], &[], &[])?
                    .role;
                if before != after {
                    changes.push(AccessChange {
                        principal_id: principal.clone(),
                        item_id: item_id.clone(),
                        item_name: item_name.clone(),
                        before,
                        after,
                    });
                }
            }
        }
        Ok(RestrictPlan {
            folder_id: id.to_owned(),
            folder_name: folder_name.clone(),
            changes,
            recovery: format!(
                "Clear the restriction on {folder_name}. Grants stay, so access from the folder above returns."
            ),
        })
    }

    /// Who would gain or lose access if a person joined or left this group.
    /// Nothing is written.
    pub fn plan_member(
        &self,
        group_id: &str,
        member_id: &str,
        adding: bool,
    ) -> DriveResult<MemberPlan> {
        if member_id.trim().is_empty() {
            return Err(DriveError::BadRequest("Name the person.".into()));
        }
        let group = self
            .db
            .get("directory_group", group_id)?
            .ok_or(DriveError::NotFound)?;
        let group_name = text(&group, "name").unwrap_or_default();
        let grants = self.db.query(
            "SELECT itemId FROM drive_acl WHERE principalType = 'group' AND principalId = ?1",
            &[Value::Text(group_id.into())],
        )?;
        let mut items = Vec::new();
        for grant in grants {
            let Some(item_id) = text(&grant, "itemId") else {
                continue;
            };
            for (id, name) in self.subtree(&item_id)? {
                if items.iter().any(|(seen, _)| seen == &id) {
                    continue;
                }
                items.push((id, name));
            }
        }
        let as_group = self.db.get("directory_group", member_id)?.is_some();
        let people = if as_group {
            self.users_in_group(member_id)?
        } else {
            vec![member_id.to_owned()]
        };
        let mut changes = Vec::new();
        for person_id in people {
            let person = Principal {
                id: person_id.clone(),
                admin: false,
            };
            let (extra, skip) = if !as_group {
                if adding {
                    (vec![group_id.to_owned()], Vec::new())
                } else {
                    (Vec::new(), vec![group_id.to_owned()])
                }
            } else if adding {
                (vec![group_id.to_owned()], Vec::new())
            } else if self.belongs_without_edge(&person_id, group_id, member_id)? {
                (Vec::new(), Vec::new())
            } else {
                (Vec::new(), vec![group_id.to_owned()])
            };
            for (item_id, item_name) in &items {
                let before = self.explain(&person, item_id)?.role;
                let after = self
                    .explain_in(&person, item_id, None, &extra, &skip, &[])?
                    .role;
                if before != after {
                    changes.push(AccessChange {
                        principal_id: person_id.clone(),
                        item_id: item_id.clone(),
                        item_name: item_name.clone(),
                        before,
                        after,
                    });
                }
            }
        }
        Ok(MemberPlan {
            group_id: group_id.to_owned(),
            group_name,
            changes,
        })
    }

    /// Add or remove a person only when the access plan still matches.
    /// A different plan writes nothing.
    pub fn commit_member(
        &self,
        actor: &str,
        group_id: &str,
        member_id: &str,
        adding: bool,
        expected: &[AccessChange],
    ) -> DriveResult<MemberPlan> {
        let plan = self.plan_member(group_id, member_id, adding)?;
        let same = plan.changes.len() == expected.len()
            && plan.changes.iter().all(|change| {
                expected.iter().any(|item| {
                    item.item_id == change.item_id
                        && item.before == change.before
                        && item.after == change.after
                })
            });
        if !same {
            return Err(DriveError::BadRequest(
                "The access plan changed. Review it again.".into(),
            ));
        }
        let member_type = if self.db.get("directory_group", member_id)?.is_some() {
            "group"
        } else {
            "user"
        };
        if adding {
            self.add_member(actor, group_id, member_type, member_id)?;
        } else {
            self.remove_member(actor, group_id, member_type, member_id)?;
        }
        Ok(plan)
    }

    /// Record the impact, then restrict the folder. Grants are not deleted.
    pub fn restrict_folder(&self, who: &Principal, id: &str) -> DriveResult<RestrictPlan> {
        let plan = self.plan_restrict(who, id)?;
        self.set_restricted(who, id, true)?;
        Ok(plan)
    }

    /// Undo a restriction. Grants that were already on the folders stay.
    pub fn restore_inheritance(&self, who: &Principal, id: &str) -> DriveResult<()> {
        self.set_restricted(who, id, false)
    }

    fn subtree(&self, id: &str) -> DriveResult<Vec<(String, String)>> {
        let mut out = Vec::new();
        let mut queue = vec![id.to_owned()];
        while let Some(current) = queue.pop() {
            let row = self.item_row(&current)?;
            out.push((current.clone(), text(&row, "name").unwrap_or_default()));
            let children = self.db.query(
                "SELECT id FROM drive_item WHERE parentId = ?1 AND trashed = 0",
                &[Value::Text(current)],
            )?;
            for child in children {
                if let Some(child_id) = text(&child, "id") {
                    queue.push(child_id);
                }
            }
        }
        Ok(out)
    }

    fn users_above(&self, folder_id: &str) -> DriveResult<Vec<String>> {
        let mut users = Vec::new();
        let mut current = text(&self.item_row(folder_id)?, "parentId");
        for _ in 0..MAX_DEPTH {
            let Some(parent) = current else { break };
            let grants = self.db.query(
                "SELECT principalType, principalId FROM drive_acl WHERE itemId = ?1",
                &[Value::Text(parent.clone())],
            )?;
            for grant in grants {
                let kind = text(&grant, "principalType").unwrap_or_default();
                let principal = text(&grant, "principalId").unwrap_or_default();
                if kind == "user" && !users.contains(&principal) {
                    users.push(principal);
                } else if kind == "group" {
                    for person in self.people_in(&principal)? {
                        if !users.contains(&person) {
                            users.push(person);
                        }
                    }
                } else if kind == "org" {
                    for person in self.people_in_org(&principal)? {
                        if !users.contains(&person) {
                            users.push(person);
                        }
                    }
                }
            }
            current = self
                .db
                .get("drive_item", &parent)?
                .and_then(|row| text(&row, "parentId"));
        }
        Ok(users)
    }

    pub(crate) fn people_in_org(&self, org_id: &str) -> DriveResult<Vec<String>> {
        if self.db.schema().table("member").is_none() {
            return Ok(vec![]);
        }
        Ok(self
            .db
            .query(
                "SELECT userId FROM member WHERE organizationId = ?1",
                &[Value::Text(org_id.to_owned())],
            )?
            .into_iter()
            .filter_map(|row| text(&row, "userId"))
            .collect())
    }
}
