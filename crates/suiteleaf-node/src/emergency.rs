//! One-time administrator recovery when ordinary sign-in is broken.
//! The recovery code is compared and then forgotten. The audit records the
//! person and the reason, not the code. `--no-auth` does not set a code.

use std::collections::BTreeSet;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EmergencyAudit {
    pub user_id: String,
    pub reason: String,
    pub at: String,
}

/// Decide whether this code may open one emergency session.
/// A match consumes the code. A refusal leaves the used set unchanged.
pub fn open_emergency(
    configured: Option<&str>,
    offered: &str,
    admin: bool,
    reason: &str,
    at: &str,
    user_id: &str,
    used: &mut BTreeSet<String>,
) -> Result<EmergencyAudit, &'static str> {
    let Some(expected) = configured.map(str::trim).filter(|code| !code.is_empty()) else {
        return Err("emergency sign-in is off");
    };
    if offered != expected {
        return Err("emergency code does not match");
    }
    if !admin {
        return Err("emergency sign-in is for an administrator");
    }
    let reason = reason.trim();
    if reason.is_empty() || reason.contains(expected) {
        return Err("emergency sign-in needs a reason that is not the code");
    }
    if user_id.is_empty() || at.is_empty() {
        return Err("emergency sign-in needs a person and a time");
    }
    if !used.insert(expected.to_owned()) {
        return Err("emergency code was already used");
    }
    Ok(EmergencyAudit {
        user_id: user_id.to_owned(),
        reason: reason.to_owned(),
        at: at.to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_second_use_is_refused_and_the_audit_omits_the_code() {
        let mut used = BTreeSet::new();
        let code = "garden-emergency-code";
        let audit = open_emergency(
            Some(code),
            code,
            true,
            "the issuer was wrong",
            "2026-10-31T18:00:00.000Z",
            "ada",
            &mut used,
        )
        .unwrap();
        assert_eq!(audit.user_id, "ada");
        assert_eq!(audit.reason, "the issuer was wrong");
        assert!(!audit.reason.contains(code));
        assert_eq!(
            open_emergency(
                Some(code),
                code,
                true,
                "the issuer was wrong",
                "2026-10-31T18:01:00.000Z",
                "ada",
                &mut used,
            ),
            Err("emergency code was already used")
        );
        assert_eq!(
            open_emergency(
                None,
                code,
                true,
                "the issuer was wrong",
                "t",
                "ada",
                &mut used
            ),
            Err("emergency sign-in is off")
        );
        let mut fresh = BTreeSet::new();
        assert_eq!(
            open_emergency(
                Some(code),
                "other-code",
                true,
                "the issuer was wrong",
                "t",
                "ada",
                &mut fresh,
            ),
            Err("emergency code does not match")
        );
        assert!(fresh.is_empty());
        assert_eq!(
            open_emergency(
                Some(code),
                code,
                false,
                "the issuer was wrong",
                "t",
                "sam",
                &mut fresh,
            ),
            Err("emergency sign-in is for an administrator")
        );
        assert!(fresh.is_empty());
        assert_eq!(
            open_emergency(Some(code), code, true, code, "t", "ada", &mut fresh),
            Err("emergency sign-in needs a reason that is not the code")
        );
        assert!(fresh.is_empty());
    }
}
