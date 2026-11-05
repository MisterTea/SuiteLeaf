//! Whether an open collaboration socket may keep reading and writing.
//!
//! Policy: every incoming message checks the session row and the person's
//! role. A recheck tick, every `RECHECK_MS` (5 seconds), also verifies the
//! credentials the socket signed in with, so a person who sends nothing is
//! still disconnected within one tick after their token expires, their session
//! is revoked, their account is banned, or their grant is removed. A changed
//! role closes the socket so the client reopens with the new role.

use std::time::Duration;

use axum::http::{HeaderMap, header};
use suitedrive::Role;

use super::Rooms;
use crate::auth::{Auth, AuthUser};

/// Production recheck interval for open sockets.
pub(crate) const RECHECK_MS: u64 = 5_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Standing {
    Keep,
    /// The token or session no longer signs in. The client may sign in again.
    Unauthorized,
    /// The grant is gone.
    Forbidden,
    /// The grant changed to another role.
    RoleChanged,
}

impl Standing {
    /// The `error` reason sent before the socket closes.
    pub(crate) fn reason(self) -> Option<&'static str> {
        match self {
            Standing::Keep => None,
            Standing::Unauthorized => Some("unauthorized"),
            Standing::Forbidden => Some("forbidden"),
            Standing::RoleChanged => Some("role-changed"),
        }
    }
}

/// `SUITELEAF_RECHECK_MS` shortens the tick for tests. Values under 50 ms are ignored.
pub(crate) fn recheck_every(configured: Option<&str>) -> Duration {
    let ms = configured
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|ms| *ms >= 50)
        .unwrap_or(RECHECK_MS);
    Duration::from_millis(ms)
}

/// Decide from facts already read. `signed_in` is `None` when credentials were not checked.
pub(crate) fn decide(
    joined_as: &str,
    signed_in: Option<Option<&str>>,
    session_expired: bool,
    role_then: Role,
    role_now: Option<Role>,
) -> Standing {
    if let Some(who) = signed_in
        && who != Some(joined_as)
    {
        return Standing::Unauthorized;
    }
    if session_expired {
        return Standing::Unauthorized;
    }
    match role_now {
        None => Standing::Forbidden,
        Some(role) if role != role_then => Standing::RoleChanged,
        Some(_) => Standing::Keep,
    }
}

/// Read the facts and decide. With `credentials`, the token is verified again,
/// and the returned user carries the fresh admin flag.
pub(crate) fn standing(
    rooms: &Rooms,
    user: &AuthUser,
    item: &str,
    role: Role,
    credentials: Option<(&Auth, &HeaderMap)>,
) -> anyhow::Result<(Standing, Option<AuthUser>)> {
    let fresh = credentials.map(|(auth, headers)| auth.user(headers));
    let signed_in = fresh.as_ref().map(|who| who.as_ref().map(|u| u.id.as_str()));
    let admin = match &fresh {
        Some(Some(who)) => who.is_admin(),
        _ => user.is_admin(),
    };
    if let Some(None) = signed_in {
        return Ok((Standing::Unauthorized, None));
    }
    let expired = rooms.session_expired(&user.id)?;
    let now = rooms.current_role(&user.id, admin, item)?;
    let verdict = decide(&user.id, signed_in, expired, role, now);
    Ok((verdict, fresh.flatten()))
}

/// Headers that carry one bearer token, as the HTTP routes receive it.
pub(crate) fn bearer_headers(token: &str) -> Option<HeaderMap> {
    let mut headers = HeaderMap::new();
    headers.insert(header::AUTHORIZATION, format!("Bearer {token}").parse().ok()?);
    Some(headers)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_person_who_still_signs_in_with_the_same_role_stays() {
        let kept = decide("maya", Some(Some("maya")), false, Role::Editor, Some(Role::Editor));
        assert_eq!(kept, Standing::Keep);
        assert_eq!(kept.reason(), None);
        let unchecked = decide("maya", None, false, Role::Viewer, Some(Role::Viewer));
        assert_eq!(unchecked, Standing::Keep);
    }

    #[test]
    fn a_token_that_no_longer_signs_in_or_names_someone_else_is_unauthorized() {
        let gone = decide("maya", Some(None), false, Role::Editor, Some(Role::Editor));
        assert_eq!(gone, Standing::Unauthorized);
        let other = decide("maya", Some(Some("sam")), false, Role::Editor, Some(Role::Editor));
        assert_eq!(other, Standing::Unauthorized);
        let expired = decide("maya", None, true, Role::Editor, Some(Role::Editor));
        assert_eq!(expired.reason(), Some("unauthorized"));
    }

    #[test]
    fn a_removed_grant_is_forbidden_and_a_changed_role_says_so() {
        let removed = decide("maya", Some(Some("maya")), false, Role::Viewer, None);
        assert_eq!(removed.reason(), Some("forbidden"));
        let lowered = decide("maya", None, false, Role::Editor, Some(Role::Viewer));
        assert_eq!(lowered.reason(), Some("role-changed"));
        let raised = decide("maya", None, false, Role::Commenter, Some(Role::Editor));
        assert_eq!(raised, Standing::RoleChanged);
    }

    #[test]
    fn the_recheck_interval_ignores_values_that_are_not_a_short_wait() {
        assert_eq!(recheck_every(None), Duration::from_millis(RECHECK_MS));
        assert_eq!(recheck_every(Some("200")), Duration::from_millis(200));
        assert_eq!(recheck_every(Some("10")), Duration::from_millis(RECHECK_MS));
        assert_eq!(recheck_every(Some("secret-value")), Duration::from_millis(RECHECK_MS));
    }

    #[test]
    fn bearer_headers_refuse_a_token_that_is_not_a_header_value() {
        let headers = bearer_headers("abc").expect("headers");
        assert_eq!(headers.get(header::AUTHORIZATION).unwrap(), "Bearer abc");
        assert!(bearer_headers("line\nbreak").is_none());
    }
}
