//! Direct editor grants this person owns can become viewer grants.
//! The plan lists those grants. It does not include file bytes.
//! Nothing is written until the same plan is applied, and that plan can be undone.

use std::collections::BTreeSet;

use serde::Serialize;

use crate::{Drive, DriveError, DriveResult, Item, Principal, Role};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyChange {
    pub principal_type: String,
    pub principal_id: String,
    pub item_id: String,
    pub item_name: String,
    pub before: Role,
    pub after: Role,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyPlan {
    pub changes: Vec<PolicyChange>,
    pub stamp: String,
    pub recovery: String,
}

const RECOVERY: &str = "Set each changed grant back to editor.";
const STALE: &str = "The access plan changed. Review it again.";

fn stamp_of(changes: &[PolicyChange]) -> String {
    let mut lines: Vec<String> = changes
        .iter()
        .map(|change| {
            format!(
                "{}|{}|{}",
                change.item_id, change.principal_type, change.principal_id
            )
        })
        .collect();
    lines.sort();
    let mut hash: u64 = 14_695_981_039_346_656_037;
    for line in lines {
        for byte in line.as_bytes() {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(1_099_511_628_211);
        }
        hash ^= 0xff;
    }
    format!("{hash:016x}")
}

fn owned_items(drive: &Drive, who: &Principal) -> DriveResult<Vec<Item>> {
    let mut out = Vec::new();
    let mut seen = BTreeSet::new();
    let mut queue = drive.list(who, None)?;
    while let Some(item) = queue.pop() {
        if !seen.insert(item.id.clone()) {
            continue;
        }
        if item.owner_id != who.id {
            continue;
        }
        if item.kind == "folder" {
            queue.extend(drive.list(who, Some(&item.id))?);
        }
        out.push(item);
    }
    Ok(out)
}

impl Drive {
    /// Direct editor grants on items this person owns, rewritten as viewer.
    /// A viewer or commenter grant is left out. File bytes are not read.
    pub fn plan_editor_policy(&self, who: &Principal) -> DriveResult<PolicyPlan> {
        let mut changes = Vec::new();
        for item in owned_items(self, who)? {
            for grant in self.acl(who, &item.id)? {
                if grant.role != Role::Editor {
                    continue;
                }
                changes.push(PolicyChange {
                    principal_type: grant.principal_type,
                    principal_id: grant.principal_id,
                    item_id: item.id.clone(),
                    item_name: item.name.clone(),
                    before: Role::Editor,
                    after: Role::Viewer,
                });
            }
        }
        changes.sort_by(|left, right| {
            (&left.item_name, &left.principal_id).cmp(&(&right.item_name, &right.principal_id))
        });
        let stamp = stamp_of(&changes);
        Ok(PolicyPlan {
            changes,
            stamp,
            recovery: RECOVERY.into(),
        })
    }

    /// Write the planned viewer roles when the editor grants are still the same.
    /// A different stamp writes nothing.
    pub fn apply_editor_policy(&self, who: &Principal, stamp: &str) -> DriveResult<PolicyPlan> {
        let plan = self.plan_editor_policy(who)?;
        if plan.stamp != stamp {
            return Err(DriveError::BadRequest(STALE.into()));
        }
        for change in &plan.changes {
            self.share(
                who,
                &change.item_id,
                &change.principal_type,
                &change.principal_id,
                Some(Role::Viewer),
            )?;
        }
        Ok(plan)
    }

    /// Put those grants back to editor when each one is still a viewer.
    /// Any other role writes nothing.
    pub fn rollback_editor_policy(
        &self,
        who: &Principal,
        changes: &[PolicyChange],
    ) -> DriveResult<()> {
        for change in changes {
            let grants = self.acl(who, &change.item_id)?;
            let current = grants.iter().find(|grant| {
                grant.principal_type == change.principal_type
                    && grant.principal_id == change.principal_id
            });
            if current.map(|grant| grant.role) != Some(Role::Viewer) {
                return Err(DriveError::BadRequest(STALE.into()));
            }
        }
        for change in changes {
            self.share(
                who,
                &change.item_id,
                &change.principal_type,
                &change.principal_id,
                Some(Role::Editor),
            )?;
        }
        Ok(())
    }
}
