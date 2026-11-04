//! Roles, and how one person's role on one item is decided.

use serde::{Deserialize, Serialize};
use suitedb::{Value, hlc::iso_now};

use crate::{
    Drive, DriveError, DriveResult, MAX_DEPTH,
    expiry::grant_live,
    row::{int, text},
};

/// Declaration order is the privilege order. [`Drive::require`] allows this
/// role or any role listed after it, and the highest grant wins.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Viewer,
    /// Can read and add comments, but cannot change the file.
    Commenter,
    /// Can append responses on a `.slform` file, and can comment, but cannot
    /// change the questions or write any other file.
    Responder,
    Editor,
    Owner,
}

impl Role {
    pub(crate) fn parse(s: &str) -> Option<Role> {
        match s {
            "viewer" => Some(Role::Viewer),
            "commenter" => Some(Role::Commenter),
            "responder" => Some(Role::Responder),
            "editor" => Some(Role::Editor),
            "owner" => Some(Role::Owner),
            _ => None,
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Role::Viewer => "viewer",
            Role::Commenter => "commenter",
            Role::Responder => "responder",
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

/// Why one person can or cannot open one item. `role` is the same decision
/// [`Drive::role`] returns. Other people's grants are not included.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessExplanation {
    pub role: Option<Role>,
    pub reason: AccessReason,
    /// The folder walk stopped at the depth limit while a parent remained.
    pub folder_chain_truncated: bool,
    /// Groups this person belongs to whose membership contains a cycle.
    pub group_loops: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum AccessReason {
    Admin,
    Owner {
        item_id: String,
        item_name: String,
    },
    Grant {
        principal_type: String,
        principal_id: String,
        item_id: String,
        item_name: String,
        inherited: bool,
    },
    Expired {
        principal_type: String,
        principal_id: String,
        item_id: String,
    },
    /// A folder stopped the walk. Grants on folders above it do not apply.
    Restricted {
        item_id: String,
        item_name: String,
    },
    None,
}

struct GrantHit {
    role: Role,
    principal_type: String,
    principal_id: String,
    item_id: String,
    item_name: String,
    depth: usize,
}

fn prefer_grant(current: Option<GrantHit>, next: GrantHit) -> GrantHit {
    match current {
        None => next,
        Some(current) if next.role > current.role => next,
        Some(current) if next.role == current.role && next.depth < current.depth => next,
        Some(current) => current,
    }
}

/// User, organization, and group grants that apply to one person.
pub(crate) fn principal_clause(
    alias: &str,
    user_param: usize,
    orgs: &[Value],
    groups: &[Value],
    params: &mut Vec<Value>,
) -> String {
    let col = |name: &str| {
        if alias.is_empty() {
            name.to_string()
        } else {
            format!("{alias}.{name}")
        }
    };
    let mut clause = format!(
        "({} = 'user' AND {} = ?{user_param})",
        col("principalType"),
        col("principalId")
    );
    for (kind, ids) in [("org", orgs), ("group", groups)] {
        if ids.is_empty() {
            continue;
        }
        let start = params.len() + 1;
        let marks: Vec<String> = (0..ids.len()).map(|i| format!("?{}", start + i)).collect();
        params.extend(ids.iter().cloned());
        clause.push_str(&format!(
            " OR ({} = '{kind}' AND {} IN ({}))",
            col("principalType"),
            col("principalId"),
            marks.join(", ")
        ));
    }
    clause
}

impl Drive {
    pub(crate) fn orgs(&self, who: &Principal) -> DriveResult<Vec<Value>> {
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
        Ok(self.explain(who, id)?.role)
    }

    /// The same decision as [`Self::role`], with the grant that produced it.
    pub fn explain(&self, who: &Principal, id: &str) -> DriveResult<AccessExplanation> {
        self.explain_in(who, id, None, &[], &[], &[])
    }

    /// An explanation the caller is allowed to see.
    /// A hidden file and a missing file both say they were not found.
    pub fn explain_visible(&self, who: &Principal, id: &str) -> DriveResult<AccessExplanation> {
        let explanation = self.explain(who, id)?;
        if Self::explanation_hides(&explanation) {
            return Err(DriveError::NotFound);
        }
        Ok(explanation)
    }

    /// `also_stop` treats that folder as restricted for this decision only.
    /// `extra_groups` and `skip_groups` change membership for this decision only.
    pub(crate) fn explain_in(
        &self,
        who: &Principal,
        id: &str,
        also_stop: Option<&str>,
        extra_groups: &[String],
        skip_groups: &[String],
        downgraded: &[(String, String, String)],
    ) -> DriveResult<AccessExplanation> {
        let _ = self.item_row(id)?;
        let group_loops = self.looping_groups(&who.id)?;
        if who.admin {
            return Ok(AccessExplanation {
                role: Some(Role::Owner),
                reason: AccessReason::Admin,
                folder_chain_truncated: false,
                group_loops,
            });
        }
        let orgs = self.orgs(who)?;
        let mut groups = self.group_ids(&who.id)?;
        groups.retain(|value| match value {
            Value::Text(group) => !skip_groups.iter().any(|skip| skip == group),
            _ => true,
        });
        for extra in extra_groups {
            let present = groups
                .iter()
                .any(|value| matches!(value, Value::Text(group) if group == extra));
            if !present && !skip_groups.iter().any(|skip| skip == extra) {
                groups.push(Value::Text(extra.clone()));
            }
        }
        let now = iso_now();
        let mut best: Option<GrantHit> = None;
        let mut expired: Option<GrantHit> = None;
        let mut restricted_wall: Option<(String, String)> = None;
        let mut current = Some(self.item_row(id)?);
        let mut truncated = false;
        for depth in 0..MAX_DEPTH {
            let Some(row) = current.take() else { break };
            let item_id = text(&row, "id").unwrap_or_default();
            let item_name = text(&row, "name").unwrap_or_default();
            if text(&row, "ownerId").as_deref() == Some(who.id.as_str()) {
                return Ok(AccessExplanation {
                    role: Some(Role::Owner),
                    reason: AccessReason::Owner { item_id, item_name },
                    folder_chain_truncated: false,
                    group_loops,
                });
            }
            let mut params = vec![Value::Text(item_id.clone()), Value::Text(who.id.clone())];
            let clause = principal_clause("", 2, &orgs, &groups, &mut params);
            let grants = self.db.query(
                &format!(
                    "SELECT principalType, principalId, role, expiresAt FROM drive_acl WHERE itemId = ?1 AND ({clause})"
                ),
                &params,
            )?;
            for grant in grants {
                let Some(mut role) = text(&grant, "role").and_then(|r| Role::parse(&r)) else {
                    continue;
                };
                let principal_type = text(&grant, "principalType").unwrap_or_default();
                let principal_id = text(&grant, "principalId").unwrap_or_default();
                if role == Role::Editor
                    && downgraded.iter().any(|(item, kind, id)| {
                        item == &item_id && kind == &principal_type && id == &principal_id
                    })
                {
                    role = Role::Viewer;
                }
                let hit = GrantHit {
                    role,
                    principal_type,
                    principal_id,
                    item_id: item_id.clone(),
                    item_name: item_name.clone(),
                    depth,
                };
                if grant_live(text(&grant, "expiresAt").as_deref(), &now) {
                    best = Some(prefer_grant(best, hit));
                } else {
                    expired = Some(prefer_grant(expired, hit));
                }
            }
            if int(&row, "restricted") == 1 || also_stop == Some(item_id.as_str()) {
                restricted_wall = Some((item_id, item_name));
                break;
            }
            current = match text(&row, "parentId") {
                Some(parent) => self.db.get("drive_item", &parent)?,
                None => None,
            };
            if depth + 1 == MAX_DEPTH && current.is_some() {
                truncated = true;
            }
        }
        if let Some(hit) = best {
            let inherited = hit.item_id != id;
            return Ok(AccessExplanation {
                role: Some(hit.role),
                reason: AccessReason::Grant {
                    principal_type: hit.principal_type,
                    principal_id: hit.principal_id,
                    item_id: hit.item_id,
                    item_name: hit.item_name,
                    inherited,
                },
                folder_chain_truncated: truncated,
                group_loops,
            });
        }
        if let Some(hit) = expired {
            return Ok(AccessExplanation {
                role: None,
                reason: AccessReason::Expired {
                    principal_type: hit.principal_type,
                    principal_id: hit.principal_id,
                    item_id: hit.item_id,
                },
                folder_chain_truncated: truncated,
                group_loops,
            });
        }
        if let Some((item_id, mut item_name)) = restricted_wall {
            let parent = self
                .item_row(&item_id)
                .ok()
                .and_then(|row| text(&row, "parentId"));
            let visible = parent
                .as_deref()
                .is_some_and(|parent| self.role(who, parent).ok().flatten().is_some());
            if !visible {
                item_name.clear();
                return Ok(AccessExplanation {
                    role: None,
                    reason: AccessReason::Restricted {
                        item_id: String::new(),
                        item_name,
                    },
                    folder_chain_truncated: truncated,
                    group_loops,
                });
            }
            return Ok(AccessExplanation {
                role: None,
                reason: AccessReason::Restricted { item_id, item_name },
                folder_chain_truncated: truncated,
                group_loops,
            });
        }
        Ok(AccessExplanation {
            role: None,
            reason: AccessReason::None,
            folder_chain_truncated: truncated,
            group_loops,
        })
    }

    fn explanation_hides(explanation: &AccessExplanation) -> bool {
        match &explanation.reason {
            AccessReason::None => true,
            AccessReason::Restricted { item_id, .. } if item_id.is_empty() => true,
            _ => false,
        }
    }

    fn looping_groups(&self, user_id: &str) -> DriveResult<Vec<String>> {
        let mut loops = Vec::new();
        for value in self.group_ids(user_id)? {
            let Value::Text(id) = value else { continue };
            if self.group_has_loop(&id)? {
                loops.push(id);
            }
        }
        Ok(loops)
    }

    pub(crate) fn require(&self, who: &Principal, id: &str, needed: Role) -> DriveResult<Role> {
        match self.role(who, id)? {
            Some(role) if role >= needed => Ok(role),
            _ => Err(DriveError::Forbidden),
        }
    }
}
