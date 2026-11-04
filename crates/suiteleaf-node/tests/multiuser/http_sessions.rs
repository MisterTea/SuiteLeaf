//! Session routes over HTTP: a lost device, an emergency sign-in, and rotation.

use serde_json::{Value, json};

use crate::support::*;

#[tokio::test(flavor = "multi_thread")]
async fn a_lost_device_over_http_signs_out_only_that_session() {
    let cluster = Cluster::boot().await;
    let sam = cluster.person("sam");
    let priya = cluster.person("priya");
    cluster
        .db(
            0,
            json!({
                "op": "update",
                "model": "session",
                "where": [{ "field": "id", "value": "sam-session" }],
                "update": { "userAgent": "Garden browser" }
            }),
        )
        .await;
    cluster
        .db(
            0,
            json!({
                "op": "update",
                "model": "session",
                "where": [{ "field": "id", "value": "priya-session" }],
                "update": { "userAgent": "Lost phone" }
            }),
        )
        .await;
    cluster
        .db(
            0,
            json!({
                "op": "create",
                "model": "session",
                "data": {
                    "id": "sam-phone",
                    "token": "phone-token",
                    "userId": "sam",
                    "userAgent": "Lost phone",
                    "expiresAt": "2099-01-01T00:00:00.000Z",
                    "createdAt": AT,
                    "updatedAt": AT
                }
            }),
        )
        .await;
    let blank = cluster
        .request(
            0,
            sam,
            reqwest::Method::POST,
            "/api/node/sessions/lost-device",
            Some(serde_json::to_vec(&json!({ "device": "  " })).unwrap()),
            None,
        )
        .await;
    let blank_status = blank.status();
    let blank_text = blank.text().await.unwrap_or_default();
    assert_eq!(blank_status, reqwest::StatusCode::BAD_REQUEST);
    assert!(
        blank_text.contains("Name the device to sign out."),
        "{blank_text}"
    );
    let missed = cluster
        .json(
            0,
            sam,
            reqwest::Method::POST,
            "/api/node/sessions/lost-device",
            Some(serde_json::to_vec(&json!({ "device": "secret-value" })).unwrap()),
        )
        .await;
    assert_eq!(missed["ended"], 0);
    assert!(!missed.to_string().contains("secret-value"));
    let ended = cluster
        .json(
            0,
            sam,
            reqwest::Method::POST,
            "/api/node/sessions/lost-device",
            Some(serde_json::to_vec(&json!({ "device": "Lost phone" })).unwrap()),
        )
        .await;
    assert_eq!(ended["ended"], 1);
    assert!(!ended.to_string().contains("Lost phone"));
    let phone = Person {
        id: "sam".into(),
        name: "Sam".into(),
        token: "phone-token".into(),
    };
    let denied = cluster
        .request(
            0,
            &phone,
            reqwest::Method::GET,
            "/api/drive/items",
            None,
            None,
        )
        .await;
    assert_eq!(denied.status(), reqwest::StatusCode::UNAUTHORIZED);
    cluster
        .json(0, sam, reqwest::Method::GET, "/api/drive/items", None)
        .await;
    cluster
        .json(0, priya, reqwest::Method::GET, "/api/drive/items", None)
        .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn an_emergency_sign_in_over_http_uses_the_code_once() {
    let code = "garden-emergency-code";
    let cluster = Cluster::boot_with(Some(code)).await;
    for node in 0..cluster.nodes.len() {
        let updated = cluster
            .db(
                node,
                json!({
                    "op": "update",
                    "model": "user",
                    "where": [{ "field": "id", "value": "sam" }],
                    "update": { "role": "admin", "banned": 0 }
                }),
            )
            .await;
        assert!(updated["role"] == "admin", "{updated}");
    }
    let url = format!("{}/api/node/emergency", cluster.nodes[0].http);
    let post = |body: Value| {
        let url = url.clone();
        let http = cluster.http.clone();
        async move { http.post(url).json(&body).send().await.expect("emergency") }
    };
    let wrong = post(json!({
        "userId": "sam",
        "code": "secret-value",
        "reason": "the issuer was wrong"
    }))
    .await;
    let wrong_status = wrong.status();
    let wrong_text = wrong.text().await.unwrap_or_default();
    assert_eq!(wrong_status, reqwest::StatusCode::UNAUTHORIZED);
    assert!(wrong_text.contains("does not match"), "{wrong_text}");
    assert!(!wrong_text.contains("secret-value"));
    assert!(!wrong_text.contains(code));
    let priya = post(json!({
        "userId": "priya",
        "code": code,
        "reason": "the issuer was wrong"
    }))
    .await;
    let priya_text = priya.text().await.unwrap_or_default();
    assert!(priya_text.contains("administrator"), "{priya_text}");
    assert!(!priya_text.contains(code));
    let coded = post(json!({
        "userId": "sam",
        "code": code,
        "reason": code
    }))
    .await;
    let coded_text = coded.text().await.unwrap_or_default();
    assert!(coded_text.contains("not the code"), "{coded_text}");
    assert!(!coded_text.contains(code));
    let opened = post(json!({
        "userId": "sam",
        "code": code,
        "reason": "the issuer was wrong"
    }))
    .await;
    let opened_status = opened.status();
    let opened_text = opened.text().await.unwrap_or_default();
    assert!(opened_status.is_success(), "{opened_text}");
    assert!(!opened_text.contains(code));
    let body: Value = serde_json::from_str(&opened_text).unwrap();
    let token = body["token"].as_str().unwrap();
    assert_ne!(token, code);
    assert_eq!(body["userId"], "sam");
    let listed = cluster
        .http
        .get(format!("{}/api/drive/items", cluster.nodes[0].http))
        .header("authorization", format!("Bearer {token}"))
        .send()
        .await
        .unwrap();
    assert!(listed.status().is_success());
    let again = post(json!({
        "userId": "sam",
        "code": code,
        "reason": "the issuer was wrong"
    }))
    .await;
    let again_text = again.text().await.unwrap_or_default();
    assert!(again_text.contains("already used"), "{again_text}");
    assert!(!again_text.contains(code));
    let audit = cluster
        .db(
            0,
            json!({
                "op": "findMany",
                "model": "audit_event",
                "where": [{ "field": "action", "value": "emergency.sign-in" }]
            }),
        )
        .await;
    let audit_text = audit.to_string();
    assert!(audit_text.contains("emergency.sign-in"), "{audit_text}");
    assert!(audit_text.contains("the issuer was wrong"), "{audit_text}");
    assert!(!audit_text.contains(code), "{audit_text}");
}

#[tokio::test(flavor = "multi_thread")]
async fn rotating_a_session_over_http_replaces_only_that_token() {
    let cluster = Cluster::boot().await;
    let sam = cluster.person("sam");
    let priya = cluster.person("priya");
    let missing = cluster
        .request(
            0,
            sam,
            reqwest::Method::POST,
            "/api/node/sessions/secret-value/rotate",
            None,
            None,
        )
        .await;
    let missing_status = missing.status();
    let missing_text = missing.text().await.unwrap_or_default();
    assert_eq!(missing_status, reqwest::StatusCode::NOT_FOUND);
    assert!(!missing_text.contains("secret-value"));
    let other = cluster
        .request(
            0,
            sam,
            reqwest::Method::POST,
            "/api/node/sessions/priya-session/rotate",
            None,
            None,
        )
        .await;
    assert_eq!(other.status(), reqwest::StatusCode::NOT_FOUND);
    cluster
        .json(0, priya, reqwest::Method::GET, "/api/drive/items", None)
        .await;
    let rotated = cluster
        .json(
            0,
            sam,
            reqwest::Method::POST,
            "/api/node/sessions/sam-session/rotate",
            None,
        )
        .await;
    let token = rotated["token"].as_str().unwrap().to_owned();
    assert_ne!(token, "sam-token");
    let stale = cluster
        .request(0, sam, reqwest::Method::GET, "/api/drive/items", None, None)
        .await;
    assert_eq!(stale.status(), reqwest::StatusCode::UNAUTHORIZED);
    let next = Person {
        id: "sam".into(),
        name: "Sam".into(),
        token: token.clone(),
    };
    cluster
        .json(0, &next, reqwest::Method::GET, "/api/drive/items", None)
        .await;
    let listed = cluster
        .json(0, &next, reqwest::Method::GET, "/api/node/sessions", None)
        .await;
    let listed_text = listed.to_string();
    assert!(listed_text.contains("sam-session"), "{listed_text}");
    assert!(listed_text.contains("\"current\":true"), "{listed_text}");
    assert!(!listed_text.contains(&token), "{listed_text}");
    cluster
        .json(0, priya, reqwest::Method::GET, "/api/drive/items", None)
        .await;
}
