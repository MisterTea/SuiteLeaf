//! A person's own sessions: listing, ending, rotating, and asking to sign in again.

use anyhow::{Result, bail};
use suitedb::Value;

use crate::session_list::{StoredSession, VisibleSession, may_revoke, visible_sessions};

use super::Auth;

impl Auth {
    /// Sessions for this person. The token is compared and then dropped.
    pub fn list_sessions(&self, user_id: &str, bearer: &str) -> Result<Vec<VisibleSession>> {
        let rows = self.db.query(
            "SELECT id, userId, createdAt, updatedAt, expiresAt, userAgent, token, reauthAt FROM session WHERE userId = ?1",
            &[Value::Text(user_id.to_owned())],
        )?;
        let stored = rows
            .into_iter()
            .filter_map(|row| {
                let text = |key: &str| match row.get(key) {
                    Some(Value::Text(value)) => value.clone(),
                    _ => String::new(),
                };
                let id = text("id");
                if id.is_empty() {
                    return None;
                }
                Some(StoredSession {
                    id,
                    user_id: text("userId"),
                    created_at: text("createdAt"),
                    updated_at: text("updatedAt"),
                    expires_at: text("expiresAt"),
                    user_agent: text("userAgent"),
                    token: text("token"),
                    reauth_at: text("reauthAt"),
                })
            })
            .collect::<Vec<_>>();
        let now = suitedb::hlc::iso_now();
        Ok(visible_sessions(&stored, user_id, bearer, &now))
    }

    /// End one of this person's sessions. Another person's session is not deleted.
    pub fn revoke_session(&self, user_id: &str, session_id: &str) -> Result<bool> {
        let Some(row) = self.db.get("session", session_id)? else {
            return Ok(false);
        };
        let owner = match row.get("userId") {
            Some(Value::Text(value)) => value.clone(),
            _ => String::new(),
        };
        if !may_revoke(&owner, user_id) {
            return Ok(false);
        }
        self.db.transact(|tx| tx.delete("session", session_id))?;
        Ok(true)
    }

    /// End this person's sessions for one device name. Another person's session stays.
    /// The device name is not returned.
    pub fn revoke_lost_device(&self, user_id: &str, device: &str) -> Result<usize> {
        let device = device.trim();
        if device.is_empty() {
            bail!("Name the device to sign out.");
        }
        let rows = self.db.query(
            "SELECT id, userId, userAgent FROM session WHERE userId = ?1",
            &[Value::Text(user_id.to_owned())],
        )?;
        let mut ended = 0;
        for row in rows {
            let agent = match row.get("userAgent") {
                Some(Value::Text(value)) => value.clone(),
                _ => String::new(),
            };
            if agent != device {
                continue;
            }
            let Some(Value::Text(id)) = row.get("id") else {
                continue;
            };
            if self.revoke_session(user_id, id)? {
                ended += 1;
            }
        }
        Ok(ended)
    }

    /// Replace this person's session token. The previous token no longer signs in.
    /// The new token is returned once. Another person's session is not changed.
    pub fn rotate_session(&self, user_id: &str, session_id: &str) -> Result<Option<String>> {
        let Some(row) = self.db.get("session", session_id)? else {
            return Ok(None);
        };
        let text = |key: &str| match row.get(key) {
            Some(Value::Text(value)) => value.clone(),
            _ => String::new(),
        };
        if !may_revoke(&text("userId"), user_id) {
            return Ok(None);
        }
        let previous = text("token");
        let mut generated = uuid::Uuid::now_v7().to_string();
        if generated.is_empty() || generated == previous {
            generated = uuid::Uuid::now_v7().to_string();
        }
        let expires_at = text("expiresAt");
        let created_at = text("createdAt");
        let ip_address = text("ipAddress");
        let user_agent = text("userAgent");
        let owner = text("userId");
        let impersonated_by = text("impersonatedBy");
        let organization = text("activeOrganizationId");
        let now = suitedb::hlc::iso_now();
        let stored = generated.clone();
        self.db.transact(move |tx| {
            tx.upsert(
                "session",
                session_id,
                [
                    ("expiresAt", Value::Text(expires_at)),
                    ("token", Value::Text(stored)),
                    ("createdAt", Value::Text(created_at)),
                    ("updatedAt", Value::Text(now)),
                    ("ipAddress", Value::Text(ip_address)),
                    ("userAgent", Value::Text(user_agent)),
                    ("userId", Value::Text(owner)),
                    ("impersonatedBy", Value::Text(impersonated_by)),
                    ("activeOrganizationId", Value::Text(organization)),
                ],
            )
        })?;
        Ok(Some(generated))
    }

    /// This person's session must sign in again. The row stays. Another person's session is unchanged.
    pub fn require_reauth(&self, user_id: &str, session_id: &str) -> Result<bool> {
        let Some(row) = self.db.get("session", session_id)? else {
            return Ok(false);
        };
        let text = |key: &str| match row.get(key) {
            Some(Value::Text(value)) => value.clone(),
            _ => String::new(),
        };
        if !may_revoke(&text("userId"), user_id) {
            return Ok(false);
        }
        let expires_at = text("expiresAt");
        let token = text("token");
        let created_at = text("createdAt");
        let updated_at = text("updatedAt");
        let ip_address = text("ipAddress");
        let user_agent = text("userAgent");
        let owner = text("userId");
        let impersonated_by = text("impersonatedBy");
        let organization = text("activeOrganizationId");
        let now = suitedb::hlc::iso_now();
        self.db.transact(move |tx| {
            tx.upsert(
                "session",
                session_id,
                [
                    ("expiresAt", Value::Text(expires_at)),
                    ("token", Value::Text(token)),
                    ("createdAt", Value::Text(created_at)),
                    ("updatedAt", Value::Text(updated_at)),
                    ("ipAddress", Value::Text(ip_address)),
                    ("userAgent", Value::Text(user_agent)),
                    ("userId", Value::Text(owner)),
                    ("impersonatedBy", Value::Text(impersonated_by)),
                    ("activeOrganizationId", Value::Text(organization)),
                    ("reauthAt", Value::Text(now)),
                ],
            )
        })?;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::tests::accounts;

    #[test]
    fn a_person_lists_their_sessions_without_the_token_and_ends_one() {
        let auth = accounts();
        let fields = |token: &str, user: &str, agent: &str| {
            [
                ("expiresAt", Value::from("2026-10-31T20:00:00.000Z")),
                ("token", Value::from(token)),
                ("createdAt", Value::from("2026-10-31T18:00:00.000Z")),
                ("updatedAt", Value::from("2026-10-31T18:05:00.000Z")),
                ("ipAddress", Value::from("")),
                ("userAgent", Value::from(agent)),
                ("userId", Value::from(user)),
                ("impersonatedBy", Value::from("")),
                ("activeOrganizationId", Value::from("")),
            ]
        };
        auth.db
            .transact(|tx| {
                tx.upsert(
                    "session",
                    "sam-live",
                    fields("secret-value", "sam", "Garden browser"),
                )?;
                tx.upsert(
                    "session",
                    "sam-old",
                    fields("other-secret", "sam", "Old browser"),
                )?;
                tx.upsert(
                    "session",
                    "priya-live",
                    fields("priya-secret", "priya", "Priya browser"),
                )?;
                Ok(())
            })
            .unwrap();
        let listed = auth.list_sessions("sam", "secret-value").unwrap();
        let text = format!("{listed:?}");
        assert_eq!(listed.len(), 2);
        assert!(
            listed
                .iter()
                .any(|session| session.id == "sam-live" && session.current)
        );
        assert!(
            listed
                .iter()
                .any(|session| session.id == "sam-old" && !session.current)
        );
        assert!(text.contains("Garden browser"));
        assert!(!text.contains("secret"));
        assert!(!text.contains("Priya"));
        assert!(!auth.revoke_session("sam", "priya-live").unwrap());
        assert!(auth.db.get("session", "priya-live").unwrap().is_some());
        assert!(auth.revoke_session("sam", "sam-old").unwrap());
        let again = auth.list_sessions("sam", "secret-value").unwrap();
        assert_eq!(again.len(), 1);
        assert_eq!(again[0].id, "sam-live");
    }

    #[test]
    fn rotating_a_session_replaces_its_token_and_leaves_another_person_alone() {
        let auth = accounts();
        auth.db
            .transact(|tx| {
                tx.upsert(
                    "session",
                    "sam-live",
                    [
                        ("expiresAt", Value::from("2099-10-31T20:00:00.000Z")),
                        ("token", Value::from("secret-value")),
                        ("createdAt", Value::from("2026-10-31T18:00:00.000Z")),
                        ("updatedAt", Value::from("2026-10-31T18:05:00.000Z")),
                        ("ipAddress", Value::from("")),
                        ("userAgent", Value::from("Garden browser")),
                        ("userId", Value::from("sam")),
                        ("impersonatedBy", Value::from("")),
                        ("activeOrganizationId", Value::from("")),
                    ],
                )?;
                tx.upsert(
                    "session",
                    "priya-live",
                    [
                        ("expiresAt", Value::from("2099-10-31T20:00:00.000Z")),
                        ("token", Value::from("priya-secret")),
                        ("createdAt", Value::from("2026-10-31T18:00:00.000Z")),
                        ("updatedAt", Value::from("2026-10-31T18:05:00.000Z")),
                        ("ipAddress", Value::from("")),
                        ("userAgent", Value::from("Priya browser")),
                        ("userId", Value::from("priya")),
                        ("impersonatedBy", Value::from("")),
                        ("activeOrganizationId", Value::from("")),
                    ],
                )?;
                Ok(())
            })
            .unwrap();
        assert!(auth.rotate_session("sam", "priya-live").unwrap().is_none());
        assert!(auth.session_user("priya-secret").unwrap().is_some());
        let rotated = auth
            .rotate_session("sam", "sam-live")
            .unwrap()
            .expect("token");
        assert_ne!(rotated, "secret-value");
        assert!(auth.session_user("secret-value").unwrap().is_none());
        let signed_in = auth.session_user(&rotated).unwrap().expect("sam");
        assert_eq!(signed_in.id, "sam");
        let listed = auth.list_sessions("sam", "secret-value").unwrap();
        assert!(!listed[0].current);
        let current = auth.list_sessions("sam", &rotated).unwrap();
        assert!(current[0].current);
        assert!(!format!("{current:?}").contains(&rotated));
    }

    #[test]
    fn requiring_a_fresh_sign_in_stops_only_that_session() {
        let auth = accounts();
        auth.db
            .transact(|tx| {
                tx.upsert(
                    "session",
                    "sam-live",
                    [
                        ("expiresAt", Value::from("2099-10-31T20:00:00.000Z")),
                        ("token", Value::from("secret-value")),
                        ("createdAt", Value::from("2026-10-31T18:00:00.000Z")),
                        ("updatedAt", Value::from("2026-10-31T18:05:00.000Z")),
                        ("ipAddress", Value::from("")),
                        ("userAgent", Value::from("Garden browser")),
                        ("userId", Value::from("sam")),
                        ("impersonatedBy", Value::from("")),
                        ("activeOrganizationId", Value::from("")),
                    ],
                )?;
                tx.upsert(
                    "session",
                    "priya-live",
                    [
                        ("expiresAt", Value::from("2099-10-31T20:00:00.000Z")),
                        ("token", Value::from("priya-secret")),
                        ("createdAt", Value::from("2026-10-31T18:00:00.000Z")),
                        ("updatedAt", Value::from("2026-10-31T18:05:00.000Z")),
                        ("ipAddress", Value::from("")),
                        ("userAgent", Value::from("Priya browser")),
                        ("userId", Value::from("priya")),
                        ("impersonatedBy", Value::from("")),
                        ("activeOrganizationId", Value::from("")),
                    ],
                )?;
                Ok(())
            })
            .unwrap();
        assert!(!auth.require_reauth("sam", "priya-live").unwrap());
        assert!(auth.session_user("priya-secret").unwrap().is_some());
        assert!(!auth.require_reauth("sam", "missing-session").unwrap());
        assert!(auth.require_reauth("sam", "sam-live").unwrap());
        assert!(auth.session_user("secret-value").unwrap().is_none());
        assert!(auth.db.get("session", "sam-live").unwrap().is_some());
        assert!(auth.session_user("priya-secret").unwrap().is_some());
    }

    #[test]
    fn a_lost_device_signs_out_only_that_persons_matching_session() {
        let auth = accounts();
        auth.db
            .transact(|tx| {
                tx.upsert(
                    "session",
                    "sam-garden",
                    [
                        ("expiresAt", Value::from("2099-10-31T20:00:00.000Z")),
                        ("token", Value::from("garden-token")),
                        ("createdAt", Value::from("2026-10-31T18:00:00.000Z")),
                        ("updatedAt", Value::from("2026-10-31T18:05:00.000Z")),
                        ("ipAddress", Value::from("")),
                        ("userAgent", Value::from("Garden browser")),
                        ("userId", Value::from("sam")),
                        ("impersonatedBy", Value::from("")),
                        ("activeOrganizationId", Value::from("")),
                    ],
                )?;
                tx.upsert(
                    "session",
                    "sam-phone",
                    [
                        ("expiresAt", Value::from("2099-10-31T20:00:00.000Z")),
                        ("token", Value::from("phone-token")),
                        ("createdAt", Value::from("2026-10-31T18:00:00.000Z")),
                        ("updatedAt", Value::from("2026-10-31T18:05:00.000Z")),
                        ("ipAddress", Value::from("")),
                        ("userAgent", Value::from("Lost phone")),
                        ("userId", Value::from("sam")),
                        ("impersonatedBy", Value::from("")),
                        ("activeOrganizationId", Value::from("")),
                    ],
                )?;
                tx.upsert(
                    "session",
                    "priya-phone",
                    [
                        ("expiresAt", Value::from("2099-10-31T20:00:00.000Z")),
                        ("token", Value::from("priya-token")),
                        ("createdAt", Value::from("2026-10-31T18:00:00.000Z")),
                        ("updatedAt", Value::from("2026-10-31T18:05:00.000Z")),
                        ("ipAddress", Value::from("")),
                        ("userAgent", Value::from("Lost phone")),
                        ("userId", Value::from("priya")),
                        ("impersonatedBy", Value::from("")),
                        ("activeOrganizationId", Value::from("")),
                    ],
                )?;
                Ok(())
            })
            .unwrap();
        let missed = auth.revoke_lost_device("sam", "secret-value").unwrap();
        assert_eq!(missed, 0);
        assert!(!format!("{missed}").contains("secret-value"));
        assert_eq!(
            auth.revoke_lost_device("sam", "  ")
                .unwrap_err()
                .to_string(),
            "Name the device to sign out."
        );
        assert_eq!(auth.revoke_lost_device("sam", "Lost phone").unwrap(), 1);
        assert!(auth.session_user("phone-token").unwrap().is_none());
        assert!(auth.session_user("garden-token").unwrap().is_some());
        assert!(auth.session_user("priya-token").unwrap().is_some());
    }
}
