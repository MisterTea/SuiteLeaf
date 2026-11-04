//! Files one person can open, and why.
//! Another person's group members are not included.
//! File bytes are not read.

use serde::Serialize;
use suitedb::Value;

use crate::{AccessReason, Drive, DriveError, DriveResult, Principal, Role};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonFileAccess {
    pub item_id: String,
    pub item_name: String,
    pub role: Role,
    /// `owner`, `user`, `group`, or `org`.
    pub source: String,
    pub inherited_from: Option<String>,
    /// The granting group's name. Absent for a grant that is not from a group.
    pub group_name: Option<String>,
}

fn group_label(drive: &Drive, id: &str) -> DriveResult<String> {
    let name = drive
        .db
        .get("directory_group", id)?
        .as_ref()
        .and_then(|row| crate::text(row, "name"))
        .unwrap_or_default();
    let name = name.trim();
    if name.is_empty() || credential_like(name) {
        Ok("a group".into())
    } else {
        Ok(name.to_owned())
    }
}

fn credential_like(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("secret")
        || lower.contains("password")
        || lower.contains("token")
        || lower.contains("api_key")
        || lower.contains("api-key")
}

impl Drive {
    /// Files `person_id` can open. The caller must be that person or an administrator.
    /// A file they cannot open is left out, including its name.
    pub fn inspect_person(
        &self,
        who: &Principal,
        person_id: &str,
    ) -> DriveResult<Vec<PersonFileAccess>> {
        let person_id = person_id.trim();
        if person_id.is_empty() {
            return Err(DriveError::BadRequest("Name the person.".into()));
        }
        if !who.admin && who.id != person_id {
            return Err(DriveError::Forbidden);
        }
        let person = Principal {
            id: person_id.to_owned(),
            admin: false,
        };
        let rows = self.db.query(
            "SELECT id, name FROM drive_item WHERE trashed = 0",
            &[] as &[Value],
        )?;
        let mut files = Vec::new();
        for row in rows {
            let Some(item_id) = crate::text(&row, "id") else {
                continue;
            };
            let item_name = crate::text(&row, "name").unwrap_or_default();
            let explanation = self.explain(&person, &item_id)?;
            let Some(role) = explanation.role else {
                continue;
            };
            let (source, inherited_from, group_name) = match explanation.reason {
                AccessReason::Owner { .. } => ("owner".into(), None, None),
                AccessReason::Admin => ("admin".into(), None, None),
                AccessReason::Grant {
                    principal_type,
                    principal_id,
                    item_name: from_name,
                    inherited,
                    ..
                } => {
                    let group_name = if principal_type == "group" {
                        Some(group_label(self, &principal_id)?)
                    } else {
                        None
                    };
                    let source = if principal_type == "user"
                        || principal_type == "group"
                        || principal_type == "org"
                    {
                        principal_type
                    } else {
                        "user".into()
                    };
                    (
                        source,
                        inherited
                            .then_some(from_name)
                            .filter(|name| !name.is_empty()),
                        group_name,
                    )
                }
                AccessReason::Expired { .. }
                | AccessReason::Restricted { .. }
                | AccessReason::None => continue,
            };
            files.push(PersonFileAccess {
                item_id,
                item_name,
                role,
                source,
                inherited_from,
                group_name,
            });
        }
        files.sort_by(|left, right| {
            (&left.item_name, &left.item_id).cmp(&(&right.item_name, &right.item_id))
        });
        Ok(files)
    }
}
