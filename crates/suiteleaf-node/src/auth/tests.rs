use std::sync::Arc;

use super::*;
use crate::schema::node_schema;
use suitedb::Db;

#[test]
fn decodes_percent_encoded_cookie_values() {
    assert_eq!(percent_decode("abc.def%3D"), "abc.def=");
    assert_eq!(percent_decode("100%"), "100%");
}

pub(super) fn accounts() -> Auth {
    let db = Arc::new(
        Db::open_in_memory(
            suiteleaf_net::identity::ed25519::Keypair::generate(),
            node_schema(None).unwrap(),
        )
        .unwrap(),
    );
    db.transact(|tx| {
        tx.upsert(
            "user",
            "sam",
            [
                ("name", Value::from("Sam Okafor")),
                ("email", Value::from("sam@gardenclub.org")),
                ("username", Value::from("sam")),
                ("banned", Value::Integer(0)),
            ],
        )?;
        tx.upsert(
            "user",
            "priya",
            [
                ("name", Value::from("Priya Shah")),
                ("email", Value::from("priya@gardenclub.org")),
                ("username", Value::from("priya")),
            ],
        )?;
        tx.upsert(
            "user",
            "lee",
            [
                ("name", Value::from("Lee_Ann")),
                ("email", Value::from("lee_ann@gardenclub.org")),
            ],
        )?;
        tx.upsert(
            "user",
            "banned",
            [
                ("name", Value::from("Sam Banned")),
                ("email", Value::from("banned@gardenclub.org")),
                ("banned", Value::Integer(1)),
            ],
        )
    })
    .unwrap();
    Auth::new(db)
}

fn cookie(token: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::COOKIE,
        format!("better-auth.session_token={token}")
            .parse()
            .unwrap(),
    );
    headers
}

#[test]
fn an_expired_idle_or_deleted_session_does_not_sign_in() {
    let db = Arc::new(
        Db::open_in_memory(
            suiteleaf_net::identity::ed25519::Keypair::generate(),
            node_schema(None).unwrap(),
        )
        .unwrap(),
    );
    let now = suitedb::hlc::iso_now();
    db.transact(|tx| {
        tx.upsert(
            "user",
            "sam",
            [
                ("name", Value::from("Sam")),
                ("email", Value::from("sam@gardenclub.org")),
                ("banned", Value::Integer(0)),
            ],
        )?;
        tx.upsert(
            "session",
            "live",
            [
                ("token", Value::from("live-token")),
                ("userId", Value::from("sam")),
                ("expiresAt", Value::from("2099-01-01T00:00:00.000Z")),
                ("createdAt", Value::from(now.clone())),
                ("updatedAt", Value::from(now.clone())),
            ],
        )?;
        tx.upsert(
            "session",
            "old",
            [
                ("token", Value::from("old-token")),
                ("userId", Value::from("sam")),
                ("expiresAt", Value::from("2000-01-01T00:00:00.000Z")),
                ("createdAt", Value::from("2000-01-01T00:00:00.000Z")),
                ("updatedAt", Value::from("2000-01-01T00:00:00.000Z")),
            ],
        )?;
        tx.upsert(
            "session",
            "idle",
            [
                ("token", Value::from("idle-token")),
                ("userId", Value::from("sam")),
                ("expiresAt", Value::from("2099-01-01T00:00:00.000Z")),
                ("createdAt", Value::from("2000-01-01T00:00:00.000Z")),
                ("updatedAt", Value::from("2000-01-01T00:00:00.000Z")),
            ],
        )
    })
    .unwrap();
    let auth = Auth::new(db.clone());
    assert_eq!(auth.user(&cookie("live-token")).unwrap().id, "sam");
    assert!(auth.user(&cookie("old-token")).is_none());
    assert_eq!(auth.user(&cookie("idle-token")).unwrap().id, "sam");
    auth.set_idle_limit(Some(Duration::from_secs(30 * 60)));
    assert!(auth.user(&cookie("idle-token")).is_none());
    assert_eq!(auth.user(&cookie("live-token")).unwrap().id, "sam");
    db.transact(|tx| tx.delete("session", "live")).unwrap();
    assert!(auth.user(&cookie("live-token")).is_none());
}

#[test]
fn an_emergency_code_opens_one_admin_session_and_the_audit_omits_it() {
    let auth = accounts();
    let code = "garden-emergency-code";
    let off = auth
        .emergency_sign_in("sam", code, "the issuer was wrong")
        .unwrap_err();
    assert!(off.to_string().contains("off"));
    auth.set_emergency_code(Some(code.to_owned()));
    auth.db
        .transact(|tx| {
            tx.upsert(
                "user",
                "sam",
                [
                    ("name", Value::from("Sam Okafor")),
                    ("email", Value::from("sam@gardenclub.org")),
                    ("role", Value::from("admin")),
                    ("banned", Value::Integer(0)),
                ],
            )?;
            tx.upsert(
                "user",
                "ada",
                [
                    ("name", Value::from("Ada Banned")),
                    ("email", Value::from("ada-banned@gardenclub.org")),
                    ("role", Value::from("admin")),
                    ("banned", Value::Integer(1)),
                ],
            )
        })
        .unwrap();
    let refused = auth
        .emergency_sign_in("priya", code, "the issuer was wrong")
        .unwrap_err();
    assert!(refused.to_string().contains("administrator"));
    let banned = auth
        .emergency_sign_in("ada", code, "the issuer was wrong")
        .unwrap_err();
    assert!(banned.to_string().contains("administrator"));
    let leaked = auth.emergency_sign_in("sam", code, code).unwrap_err();
    assert!(leaked.to_string().contains("reason"));
    let session = auth
        .emergency_sign_in("sam", code, "the issuer was wrong")
        .unwrap();
    assert_eq!(session.user.id, "sam");
    assert!(session.user.is_admin());
    assert_ne!(session.token, code);
    let mut headers = HeaderMap::new();
    headers.insert(
        header::AUTHORIZATION,
        format!("Bearer {}", session.token).parse().unwrap(),
    );
    assert_eq!(auth.user(&headers).unwrap().id, "sam");
    let rows = auth
        .db
        .query(
            "SELECT action, name FROM audit_event WHERE action = 'emergency.sign-in'",
            &[],
        )
        .unwrap();
    assert_eq!(rows.len(), 1);
    let name = match rows[0].get("name") {
        Some(Value::Text(text)) => text.clone(),
        _ => String::new(),
    };
    assert_eq!(name, "the issuer was wrong");
    assert!(!name.contains(code));
    let again = auth
        .emergency_sign_in("sam", code, "the issuer was wrong")
        .unwrap_err();
    assert!(again.to_string().contains("already used"));
    let still = auth
        .db
        .query(
            "SELECT id FROM audit_event WHERE action = 'emergency.sign-in'",
            &[],
        )
        .unwrap();
    assert_eq!(still.len(), 1);
}
