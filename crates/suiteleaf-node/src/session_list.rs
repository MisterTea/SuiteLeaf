//! A person's sessions, without the session token.

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredSession {
    pub id: String,
    pub user_id: String,
    pub created_at: String,
    pub updated_at: String,
    pub expires_at: String,
    pub user_agent: String,
    pub token: String,
    pub reauth_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisibleSession {
    pub id: String,
    pub created_at: String,
    pub updated_at: String,
    pub expires_at: String,
    pub user_agent: String,
    pub current: bool,
    /// The person must sign in again. The time is not included.
    pub reauth: bool,
}

/// Sessions for one person. The token is not copied. The matching bearer is current.
pub fn visible_sessions(
    rows: &[StoredSession],
    user_id: &str,
    bearer: &str,
    now: &str,
) -> Vec<VisibleSession> {
    rows.iter()
        .filter(|row| row.user_id == user_id)
        .map(|row| VisibleSession {
            id: row.id.clone(),
            created_at: row.created_at.clone(),
            updated_at: row.updated_at.clone(),
            expires_at: row.expires_at.clone(),
            user_agent: shown_agent(&row.user_agent, bearer),
            current: !bearer.is_empty() && row.token == bearer,
            reauth: !row.reauth_at.is_empty() && row.reauth_at.as_str() <= now,
        })
        .collect()
}

fn shown_agent(agent: &str, bearer: &str) -> String {
    let trimmed: String = agent.chars().take(120).collect();
    if !bearer.is_empty() && trimmed.contains(bearer) {
        return String::new();
    }
    trimmed
}

/// A person can end their own session. Someone else's session is left alone.
pub fn may_revoke(owner: &str, actor: &str) -> bool {
    !actor.is_empty() && owner == actor
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: &str, user: &str, token: &str, agent: &str) -> StoredSession {
        StoredSession {
            id: id.into(),
            user_id: user.into(),
            created_at: "2026-10-31T18:00:00.000Z".into(),
            updated_at: "2026-10-31T18:05:00.000Z".into(),
            expires_at: "2026-10-31T20:00:00.000Z".into(),
            user_agent: agent.into(),
            token: token.into(),
            reauth_at: String::new(),
        }
    }

    #[test]
    fn a_list_names_this_session_and_leaves_the_token_out() {
        let agent = "G".repeat(200);
        let rows = vec![
            row("sam-live", "sam", "secret-value", "Garden browser"),
            row("sam-old", "sam", "other-secret", &agent),
            row("priya-live", "priya", "priya-secret", "Priya browser"),
        ];
        let listed = visible_sessions(&rows, "sam", "secret-value", "2026-11-01T00:00:00.000Z");
        let text = format!("{listed:?}");
        assert_eq!(listed.len(), 2);
        assert!(listed[0].current);
        assert!(!listed[1].current);
        assert_eq!(listed[1].user_agent.chars().count(), 120);
        assert!(!text.contains("secret"));
        assert!(!text.contains("Priya browser"));
        assert!(!may_revoke("priya", "sam"));
        assert!(may_revoke("sam", "sam"));
        assert!(!may_revoke("sam", ""));
    }

    #[test]
    fn a_user_agent_that_contains_the_token_is_left_blank() {
        let rows = vec![row(
            "sam-live",
            "sam",
            "other-secret",
            "Garden secret-value browser",
        )];
        let listed = visible_sessions(&rows, "sam", "secret-value", "2026-11-01T00:00:00.000Z");
        assert_eq!(listed[0].user_agent, "");
        assert!(!format!("{listed:?}").contains("secret"));
        assert_eq!(rows[0].user_agent, "Garden secret-value browser");
    }

    #[test]
    fn a_due_reauth_is_a_flag_and_the_time_is_not_listed() {
        let mut due = row("sam-live", "sam", "secret-value", "Garden browser");
        due.reauth_at = "2026-11-01T00:00:00.000Z".into();
        let mut waiting = row("sam-old", "sam", "other-secret", "Phone");
        waiting.reauth_at = "2099-01-01T00:00:00.000Z".into();
        let listed = visible_sessions(
            &[due.clone(), waiting],
            "sam",
            "secret-value",
            "2026-11-01T00:00:00.000Z",
        );
        assert!(listed[0].reauth);
        assert!(!listed[1].reauth);
        let text = format!("{listed:?}");
        assert!(!text.contains("2026-11-01T00:00:00.000Z"));
        assert!(!text.contains("secret"));
        assert_eq!(due.reauth_at, "2026-11-01T00:00:00.000Z");
    }
}
