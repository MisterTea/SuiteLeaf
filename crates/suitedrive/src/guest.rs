//! A guest share ends on a date and is only a viewer or a commenter.
//! The review lists those grants for the file owner. Permanent shares stay out.

use serde::Serialize;

use crate::{Drive, DriveError, DriveResult, Principal, Role, text};
use suitedb::hlc::iso_now;

/// A guest is a viewer or a commenter. Any other word, including an editor, is refused.
/// The error does not repeat the word that was sent.
pub fn guest_role(value: &str) -> Result<Role, &'static str> {
    match Role::parse(value.trim()) {
        Some(Role::Viewer) => Ok(Role::Viewer),
        Some(Role::Commenter) => Ok(Role::Commenter),
        _ => Err("A guest share is a viewer or a commenter."),
    }
}

/// One person whose access to a file ends at a set time.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestShare {
    pub item_id: String,
    pub item_name: String,
    pub principal_id: String,
    pub role: Role,
    pub expires_at: String,
    pub expired: bool,
}

impl Drive {
    /// Share one person as a viewer or commenter until `expires_at`.
    /// An editor role is refused. The previous role is captured first. Both the
    /// previous role and the new role with its end date are recorded after the
    /// grant is stored.
    pub fn share_guest(
        &self,
        who: &Principal,
        id: &str,
        principal_id: &str,
        role: Role,
        expires_at: &str,
    ) -> DriveResult<()> {
        if role != Role::Viewer && role != Role::Commenter {
            return Err(DriveError::BadRequest(
                "A guest share is a viewer or a commenter.".into(),
            ));
        }
        let principal_id = principal_id.trim();
        if principal_id.is_empty()
            || principal_id.len() > 128
            || principal_id.contains(['/', '\\', '\0'])
        {
            return Err(DriveError::BadRequest(
                "A guest share is for one person.".into(),
            ));
        }
        let expires_at = match crate::normalize_expiry(expires_at) {
            Ok(value) => value,
            Err(DriveError::BadRequest(message))
                if message == "That day is not on the calendar." =>
            {
                return Err(DriveError::BadRequest(message));
            }
            Err(_) => {
                return Err(DriveError::BadRequest(
                    "A guest share needs an end date.".into(),
                ));
            }
        };
        let now = iso_now();
        if expires_at <= now {
            return Err(DriveError::BadRequest(
                "Choose an end date that is still ahead.".into(),
            ));
        }
        let key = format!("{id}:user:{principal_id}");
        let previous = self.db.get("drive_acl", &key)?;
        let previous_role = previous
            .as_ref()
            .and_then(|row| text(row, "role"))
            .filter(|role| !role.is_empty())
            .unwrap_or_else(|| "none".into());
        self.share(who, id, "user", principal_id, Some(role))?;
        self.set_expiry(who, id, "user", principal_id, Some(&expires_at))?;
        self.record_audit(
            &who.id,
            "guest.before",
            "item",
            id,
            &format!("{principal_id} {previous_role}"),
        )?;
        self.record_audit(
            &who.id,
            "guest.after",
            "item",
            id,
            &format!("{principal_id} {} {expires_at}", role.as_str()),
        )?;
        Ok(())
    }

    /// Guest grants on files this person owns. An administrator sees every file.
    /// A grant with no end date is not listed.
    pub fn guest_review(&self, who: &Principal) -> DriveResult<Vec<GuestShare>> {
        let now = iso_now();
        let mut out = Vec::new();
        for row in self
            .db
            .query("SELECT * FROM drive_acl WHERE principalType = 'user'", &[])?
        {
            let Some(expires_at) = text(&row, "expiresAt").filter(|value| !value.is_empty()) else {
                continue;
            };
            let Some(item_id) = text(&row, "itemId") else {
                continue;
            };
            let Some(item) = self.db.get("drive_item", &item_id)? else {
                continue;
            };
            let owner = text(&item, "ownerId").unwrap_or_default();
            if !who.admin && owner != who.id {
                continue;
            }
            let Some(role) = text(&row, "role").and_then(|value| Role::parse(&value)) else {
                continue;
            };
            out.push(GuestShare {
                item_id,
                item_name: text(&item, "name").unwrap_or_default(),
                principal_id: text(&row, "principalId").unwrap_or_default(),
                role,
                expired: expires_at <= now,
                expires_at,
            });
        }
        out.sort_by(|a, b| {
            a.item_name
                .cmp(&b.item_name)
                .then(a.principal_id.cmp(&b.principal_id))
        });
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::guest_role;
    use crate::Role;

    #[test]
    fn a_guest_role_is_viewer_or_commenter() {
        assert_eq!(guest_role("viewer").unwrap(), Role::Viewer);
        assert_eq!(guest_role(" commenter ").unwrap(), Role::Commenter);
        let refused = guest_role("secret-value").unwrap_err();
        assert_eq!(refused, "A guest share is a viewer or a commenter.");
        assert!(!refused.contains("secret-value"));
        assert!(guest_role("editor").is_err());
    }
}
