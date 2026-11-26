//! Hosted registration and cross-instance mutation locking.
use crate::{auth::RequireUser, http::AppState};
use axum::{
    Json,
    extract::{Request, State},
    http::{HeaderMap, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use std::sync::Arc;
use suitedb::{Db, LockScope, Value};

pub const REGISTRATION_HEADER: &str = "x-suiteleaf-registration";
pub fn token_hash(token: &str) -> String {
    blake3::hash(token.as_bytes()).to_hex().to_string()
}

/// A sign-up allowed by a current invitation (or the bootstrap token while
/// there are no users). It holds the `accounts` lock until it is dropped, so
/// the check, the account creation behind it, and consuming the invitation
/// happen as one step: two concurrent sign-ups can never both use one
/// single-use invitation or both become the bootstrap first admin. Only
/// sign-ups and account administration wait on it.
pub struct Registration {
    pub digest: String,
    _lock: Option<suitedb::CloudLock>,
}

pub fn claim_registration(
    db: &Db,
    headers: &HeaderMap,
    body: &[u8],
) -> anyhow::Result<Option<Registration>> {
    let bootstrap = std::env::var("SUITELEAF_BOOTSTRAP_TOKEN_HASH").ok();
    claim_registration_with(db, headers, body, bootstrap.as_deref())
}

pub fn claim_registration_with(
    db: &Db,
    headers: &HeaderMap,
    body: &[u8],
    bootstrap_hash: Option<&str>,
) -> anyhow::Result<Option<Registration>> {
    let token = headers
        .get("x-suiteleaf-invite")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if token.len() < 32 || token.len() > 256 {
        return Ok(None);
    }
    let digest = token_hash(token);
    // Checked only after the lock, so the answer stays true until the
    // claimant finishes (and the next claimant sees its effects).
    let lock = db.lock_all(&[LockScope::exclusive(ACCOUNTS_LOCK)])?;
    let claim = |digest: String| Registration {
        digest,
        _lock: lock,
    };
    let users = db.query("SELECT id FROM user LIMIT 1", &[])?;
    if users.is_empty() && bootstrap_hash == Some(digest.as_str()) {
        return Ok(Some(claim(digest)));
    }
    let Some(invite) = db.get("cloud_invite", &digest)? else {
        return Ok(None);
    };
    let Ok(body) = serde_json::from_slice::<serde_json::Value>(body) else {
        return Ok(None);
    };
    let email = body.get("email").and_then(|s| s.as_str()).unwrap_or("");
    let matches = matches!(invite.get("email"),Some(Value::Text(expected)) if expected.eq_ignore_ascii_case(email));
    let current = matches!(invite.get("expiresAt"),Some(Value::Text(expiry)) if expiry>&suitedb::hlc::iso_now());
    Ok((matches && current && !users.is_empty()).then(|| claim(digest)))
}

/// Drive-wide reader/writer lock. Item-level work (content saves, section
/// commits, room edits, comments) holds it shared and runs concurrently;
/// work that changes the tree or access (create, move, trash/delete, sharing,
/// owner transfer, copies, admin changes) and blob garbage collection in
/// `delete_forever` hold it exclusively. That keeps a commit's "every blob
/// exists" check and its new version pointer atomic with respect to GC, and
/// stops a write to an item that a folder delete is removing.
pub const DRIVE_LOCK: &str = "drive";
/// Account lifecycle: sign-up (single-use invites and the bootstrap first
/// admin), invitations, sessions, user and role changes.
pub const ACCOUNTS_LOCK: &str = "accounts";

/// The per-item lock. HTTP mutations of one item and its collaboration room
/// share it, so a room's read-merge-write never interleaves with a content
/// save or a restore of the same file, while different items never wait on
/// each other.
pub fn item_lock(id: &str) -> String {
    format!("item:{id}")
}

/// Locks for room work and other item-level mutations of `id`.
pub fn item_locks(id: &str) -> Vec<LockScope> {
    vec![
        LockScope::shared(DRIVE_LOCK),
        LockScope::exclusive(item_lock(id)),
    ]
}

/// The advisory locks a request holds for its whole handler. Empty means the
/// request takes no request-level lock (reads, idempotent or append-only
/// writes, and routes that lock internally).
pub(crate) fn mutation_locks(method: &Method, path: &str) -> Vec<LockScope> {
    if matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS) {
        return vec![];
    }
    // AI calls write nothing shared. Better Auth writes its own rows through
    // the sidecar's internal DB route; sign-up claims the `accounts` lock
    // itself in the proxy (see `claim_registration`), so sign-in, session
    // refresh and token minting never queue behind anything.
    if path.starts_with("/api/ai/") || path.starts_with("/api/auth/") {
        return vec![];
    }
    let segments: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    match segments.as_slice() {
        // Immutable content-addressed blob uploads (chunked parts take their
        // own short upload lock) and read-only probes/previews.
        ["api", "drive", "items", _, "blobs", ..] if *method == Method::PUT => vec![],
        ["api", "drive", "items", _, "sections", "missing"] => vec![],
        ["api", "drive", "items", _, "move-preview"] => vec![],
        // Creating an item reads its parent's access and siblings' names.
        ["api", "drive", "items"] => vec![LockScope::exclusive(DRIVE_LOCK)],
        // Tree and access changes: rename/move/trash, delete forever (which
        // also garbage-collects blobs), ACL, expiry, guests, owner, copies.
        ["api", "drive", "items", _]
        | [
            "api",
            "drive",
            "items",
            _,
            "acl" | "expiry" | "guest" | "owner" | "copy",
        ]
        | ["api", "drive", "items", _, "versions", _, "copy"] => {
            vec![LockScope::exclusive(DRIVE_LOCK)]
        }
        // Everything else about one item: content, section commits, version
        // names and restores, public/respond links, comments, presence.
        ["api", "drive", "items", id, ..] if !id.is_empty() => item_locks(id),
        // Public form answers belong to the form behind the token.
        ["api", "respond", token] => vec![
            LockScope::shared(DRIVE_LOCK),
            LockScope::exclusive(format!("respond:{token}")),
        ],
        // Per-person notice dismissal.
        ["api", "drive", "notices", ..] => vec![LockScope::shared(DRIVE_LOCK)],
        // An invitation is one blind row write; sessions and emergency sign-in
        // only touch account rows.
        ["api", "admin", "invitations"] | ["api", "node", ..] => {
            vec![LockScope::exclusive(ACCOUNTS_LOCK)]
        }
        ["api", "admin", "public-sharing"] => vec![LockScope::exclusive(DRIVE_LOCK)],
        // Admin user/group/policy/backup changes alter who can see what.
        // Unknown mutating routes take the same conservative pair.
        _ => vec![
            LockScope::exclusive(ACCOUNTS_LOCK),
            LockScope::exclusive(DRIVE_LOCK),
        ],
    }
}

/// Holds a request's [`mutation_locks`] for the whole handler. A lock wait
/// that hits the 10s `lock_timeout` returns 503 instead of hanging.
pub async fn lock_mutation(State(db): State<Arc<Db>>, req: Request, next: Next) -> Response {
    let scopes = if db.is_postgres() {
        mutation_locks(req.method(), req.uri().path())
    } else {
        vec![]
    };
    let lock = match db.lock_all(&scopes) {
        Ok(lock) => lock,
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };
    let response = next.run(req).await;
    drop(lock);
    response
}

#[derive(Deserialize)]
pub struct Invite {
    email: String,
}
pub async fn invite(
    State(state): State<AppState>,
    RequireUser(user): RequireUser,
    Json(input): Json<Invite>,
) -> Response {
    if !user.is_admin() {
        return StatusCode::FORBIDDEN.into_response();
    }
    if !state.config.cloud {
        return StatusCode::NOT_FOUND.into_response();
    }
    let email = input.email.trim().to_lowercase();
    if !email.contains('@') || email.len() > 320 {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let hash = token_hash(&token);
    let expiry = suitedb::hlc::iso_from_ms(suitedb::hlc::now_ms() + 7 * 24 * 60 * 60 * 1000);
    if state
        .db
        .transact(|tx| {
            tx.upsert(
                "cloud_invite",
                &hash,
                [
                    ("email", Value::Text(email)),
                    ("expiresAt", Value::Text(expiry)),
                ],
            )
        })
        .is_err()
    {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    Json(serde_json::json!({"url":format!("{}/#/?invite={token}",state.config.public_url())}))
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn modes(method: Method, path: &str) -> Vec<(String, suitedb::LockMode)> {
        mutation_locks(&method, path)
            .into_iter()
            .map(|s| (s.scope, s.mode))
            .collect()
    }
    use suitedb::LockMode::{Exclusive, Shared};

    #[test]
    fn reads_auth_ai_blob_uploads_and_probes_take_no_request_lock() {
        for (method, path) in [
            (Method::GET, "/api/drive/items/abc/content"),
            (Method::POST, "/api/ai/chat"),
            (Method::POST, "/api/auth/sign-in/email"),
            (Method::POST, "/api/auth/sign-up/email"),
            (Method::POST, "/api/auth/get-session"),
            (Method::PUT, "/api/drive/items/abc/blobs/deadbeef"),
            (Method::POST, "/api/drive/items/abc/sections/missing"),
            (Method::POST, "/api/drive/items/abc/move-preview"),
        ] {
            assert!(modes(method, path).is_empty(), "{path}");
        }
    }

    #[test]
    fn item_mutations_lock_only_their_item_and_share_the_drive() {
        for path in [
            "/api/drive/items/abc/content",
            "/api/drive/items/abc/sections/commit",
            "/api/drive/items/abc/versions/v1/restore",
            "/api/drive/items/abc/comments",
            "/api/drive/items/abc/public-link",
        ] {
            assert_eq!(
                modes(Method::POST, path),
                vec![("drive".into(), Shared), ("item:abc".into(), Exclusive)],
                "{path}"
            );
        }
        assert_ne!(
            mutation_locks(&Method::PUT, "/api/drive/items/a/content"),
            mutation_locks(&Method::PUT, "/api/drive/items/b/content")
        );
    }

    #[test]
    fn tree_and_access_changes_hold_the_drive_exclusively() {
        for (method, path) in [
            (Method::POST, "/api/drive/items"),
            (Method::PATCH, "/api/drive/items/abc"),
            (Method::DELETE, "/api/drive/items/abc"),
            (Method::PUT, "/api/drive/items/abc/acl"),
            (Method::POST, "/api/drive/items/abc/owner"),
            (Method::POST, "/api/drive/items/abc/copy"),
            (Method::POST, "/api/drive/items/abc/versions/v1/copy"),
            (Method::PUT, "/api/admin/public-sharing"),
        ] {
            assert_eq!(
                modes(method, path),
                vec![("drive".into(), Exclusive)],
                "{path}"
            );
        }
    }

    #[test]
    fn account_and_admin_changes_take_the_accounts_lock() {
        assert_eq!(
            modes(Method::POST, "/api/admin/invitations"),
            vec![("accounts".into(), Exclusive)]
        );
        assert_eq!(
            modes(Method::DELETE, "/api/node/sessions/s1"),
            vec![("accounts".into(), Exclusive)]
        );
        for path in [
            "/api/admin/users/u1/role",
            "/api/admin/groups/g1/members",
            "/api/somewhere-new",
        ] {
            assert_eq!(
                modes(Method::POST, path),
                vec![("accounts".into(), Exclusive), ("drive".into(), Exclusive)],
                "{path}"
            );
        }
    }

    /// Two sign-ups racing on one claim: each waits on the barrier, claims,
    /// and on success creates the account and consumes the invitation the
    /// way the auth proxy does. Returns how many succeeded.
    fn race(token: &str, email: &str, bootstrap: Option<&str>) -> usize {
        let barrier = std::sync::Barrier::new(2);
        let wins = std::sync::atomic::AtomicUsize::new(0);
        std::thread::scope(|s| {
            for n in 0..2 {
                let (barrier, wins) = (&barrier, &wins);
                s.spawn(move || {
                    let db = crate::collab::tests::postgres::pg_db();
                    let mut headers = HeaderMap::new();
                    headers.insert("x-suiteleaf-invite", token.parse().unwrap());
                    let body = serde_json::json!({ "email": email }).to_string();
                    barrier.wait();
                    let claim =
                        claim_registration_with(&db, &headers, body.as_bytes(), bootstrap).unwrap();
                    if let Some(claim) = claim {
                        // Better Auth creating the account takes a moment.
                        std::thread::sleep(std::time::Duration::from_millis(300));
                        let id = format!("{email}-{n}-{}", uuid::Uuid::now_v7());
                        db.transact(|tx| {
                            tx.upsert("user", &id, [("email", Value::from(email))])?;
                            tx.delete("cloud_invite", &claim.digest)
                        })
                        .unwrap();
                        wins.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    }
                });
            }
        });
        wins.into_inner()
    }

    #[test]
    #[ignore = "requires an isolated Postgres database"]
    fn postgres_concurrent_first_admin_and_invite_sign_ups_cannot_both_succeed() {
        let db = crate::collab::tests::postgres::pg_db();
        // Start from an empty instance (throwaway database only).
        let users = db.query("SELECT id FROM user", &[]).unwrap();
        db.transact(|tx| {
            for row in &users {
                if let Some(Value::Text(id)) = row.get("id") {
                    tx.delete("user", id)?;
                }
            }
            Ok(())
        })
        .unwrap();

        let bootstrap = "b".repeat(40);
        let wins = race(
            &bootstrap,
            "founder@example.com",
            Some(&token_hash(&bootstrap)),
        );
        assert_eq!(
            wins, 1,
            "only one bootstrap sign-up becomes the first admin"
        );

        let invite = "i".repeat(48);
        let expiry = suitedb::hlc::iso_from_ms(suitedb::hlc::now_ms() + 60_000);
        db.transact(|tx| {
            tx.upsert(
                "cloud_invite",
                &token_hash(&invite),
                [
                    ("email", Value::from("guest@example.com")),
                    ("expiresAt", Value::Text(expiry)),
                ],
            )
        })
        .unwrap();
        let wins = race(&invite, "guest@example.com", None);
        assert_eq!(wins, 1, "a single-use invitation is redeemed once");
        assert!(
            db.get("cloud_invite", &token_hash(&invite))
                .unwrap()
                .is_none()
        );
    }
}
