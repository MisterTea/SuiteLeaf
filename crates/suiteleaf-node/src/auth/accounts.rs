//! Looking up people on this server for a share dialog.

use anyhow::Result;
use serde::Serialize;
use suitedb::Value;

use super::Auth;

impl Auth {
    /// Accounts whose name, username, or email contains `query` (at least two
    /// characters). `exclude` drops the caller, so people don't share with themselves.
    pub fn search_accounts(
        &self,
        query: &str,
        exclude: Option<&str>,
    ) -> Result<Vec<AccountProfile>> {
        let query = query.trim();
        if query.chars().count() < 2 {
            return Ok(vec![]);
        }
        let rows = self.db.query(
            "SELECT id, name, email, username FROM user
             WHERE id != ?2
               AND id NOT IN (SELECT loser FROM _conflicts WHERE tbl = 'user')
               AND (banned IS NULL OR banned = 0)
               AND (
                 LOWER(IFNULL(name, '')) LIKE ?1 ESCAPE '\\'
                 OR LOWER(IFNULL(email, '')) LIKE ?1 ESCAPE '\\'
                 OR LOWER(IFNULL(username, '')) LIKE ?1 ESCAPE '\\'
               )
             ORDER BY name COLLATE NOCASE, email COLLATE NOCASE
             LIMIT 8",
            &[
                Value::Text(like_contains(query)),
                Value::Text(exclude.unwrap_or("").into()),
            ],
        )?;
        Ok(rows.into_iter().filter_map(profile_from_row).collect())
    }

    /// Profiles for the given account ids, for labelling a share list.
    pub fn accounts(&self, ids: &[String]) -> Result<Vec<AccountProfile>> {
        if ids.is_empty() {
            return Ok(vec![]);
        }
        let marks: Vec<String> = (0..ids.len()).map(|i| format!("?{}", i + 1)).collect();
        let params: Vec<Value> = ids.iter().cloned().map(Value::Text).collect();
        let rows = self.db.query(
            &format!(
                "SELECT id, name, email, username FROM user
                 WHERE id IN ({})
                   AND id NOT IN (SELECT loser FROM _conflicts WHERE tbl = 'user')",
                marks.join(", ")
            ),
            &params,
        )?;
        Ok(rows.into_iter().filter_map(profile_from_row).collect())
    }
}

/// A person on this server, safe to show in a share dialog.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountProfile {
    pub id: String,
    pub name: Option<String>,
    pub email: Option<String>,
    pub username: Option<String>,
}

fn like_contains(query: &str) -> String {
    let mut escaped = String::new();
    for c in query.chars() {
        if c == '\\' || c == '%' || c == '_' {
            escaped.push('\\');
        }
        escaped.extend(c.to_lowercase());
    }
    format!("%{escaped}%")
}

fn profile_from_row(row: std::collections::BTreeMap<String, Value>) -> Option<AccountProfile> {
    let text = |k: &str| match row.get(k) {
        Some(Value::Text(s)) if !s.is_empty() => Some(s.clone()),
        _ => None,
    };
    Some(AccountProfile {
        id: text("id")?,
        name: text("name"),
        email: text("email"),
        username: text("username"),
    })
}

#[cfg(test)]
mod tests {

    use crate::auth::tests::accounts;

    #[test]
    fn search_matches_name_username_or_email_and_skips_others() {
        let auth = accounts();
        let sam = auth.search_accounts("sa", None).unwrap();
        assert_eq!(sam.len(), 1);
        assert_eq!(sam[0].name.as_deref(), Some("Sam Okafor"));
        assert_eq!(sam[0].email.as_deref(), Some("sam@gardenclub.org"));
        assert_eq!(
            auth.search_accounts("PRI", None).unwrap()[0].id,
            "priya",
            "username match is case-insensitive"
        );
        assert!(
            auth.search_accounts("sam@", None)
                .unwrap()
                .iter()
                .any(|a| a.id == "sam")
        );
        assert!(
            auth.search_accounts("lee@example.com", None)
                .unwrap()
                .is_empty()
        );
        assert_eq!(auth.search_accounts("l", None).unwrap().len(), 0);
        let literal = auth.search_accounts("lee_", None).unwrap();
        assert_eq!(literal.len(), 1);
        assert!(auth.search_accounts("lee%", None).unwrap().is_empty());
        assert!(auth.search_accounts("sa", Some("sam")).unwrap().is_empty());
        assert!(
            auth.search_accounts("banned", None).unwrap().is_empty(),
            "banned accounts are not suggested"
        );
        assert_eq!(
            auth.accounts(&["priya".into(), "missing".into()])
                .unwrap()
                .len(),
            1
        );
    }
}
