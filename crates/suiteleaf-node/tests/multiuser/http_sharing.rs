//! Sharing routes over HTTP: guest shares and a group member plan.

use serde_json::json;

use crate::support::*;

#[tokio::test(flavor = "multi_thread")]
async fn a_guest_share_over_http_refuses_a_bad_role() {
    let cluster = Cluster::boot().await;
    let item = cluster.shared_notes().await;
    let maya = cluster.person("maya");
    let path = format!("/api/drive/items/{item}/guest");
    let bad = cluster
        .request(
            0,
            maya,
            reqwest::Method::POST,
            &path,
            Some(
                serde_json::to_vec(&json!({
                    "principalId": "sam",
                    "role": "secret-value",
                    "expiresAt": "2099-01-03T00:00:00.000Z"
                }))
                .unwrap(),
            ),
            None,
        )
        .await;
    let status = bad.status();
    let text = bad.text().await.unwrap_or_default();
    assert_eq!(status, reqwest::StatusCode::BAD_REQUEST);
    assert!(text.contains("viewer or a commenter"), "{text}");
    assert!(!text.contains("secret-value"));
    let dated = cluster
        .request(
            0,
            maya,
            reqwest::Method::POST,
            &path,
            Some(
                serde_json::to_vec(&json!({
                    "principalId": "sam",
                    "role": "viewer",
                    "expiresAt": "secret-value"
                }))
                .unwrap(),
            ),
            None,
        )
        .await;
    let dated_text = dated.text().await.unwrap_or_default();
    assert!(dated_text.contains("end date"), "{dated_text}");
    assert!(!dated_text.contains("secret-value"));
    let saved = cluster
        .json(
            0,
            maya,
            reqwest::Method::POST,
            &path,
            Some(
                serde_json::to_vec(&json!({
                    "principalId": "sam",
                    "role": "viewer",
                    "expiresAt": "2099-01-03T00:00:00.000Z"
                }))
                .unwrap(),
            ),
        )
        .await;
    assert_eq!(saved["ok"], true);
    let review = cluster
        .json(0, maya, reqwest::Method::GET, "/api/drive/guests", None)
        .await;
    let encoded = review.to_string();
    assert!(encoded.contains("sam"), "{encoded}");
    assert!(encoded.contains("viewer"), "{encoded}");
    assert!(encoded.contains("2099-01-03T00:00:00.000Z"), "{encoded}");
    assert!(!encoded.contains("North bed"));
    assert!(!encoded.contains("secret-value"));
    let sam = cluster.person("sam");
    let own = cluster
        .json(0, sam, reqwest::Method::GET, "/api/drive/guests", None)
        .await;
    assert_eq!(own["guests"].as_array().map(|rows| rows.len()), Some(0));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_group_member_plan_over_http_does_not_change_access() {
    let cluster = Cluster::boot().await;
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
    let maya = cluster.person("maya");
    let sam = cluster.person("sam");
    let priya = cluster.person("priya");
    let lars = cluster.person("lars");
    let created = cluster
        .json(
            0,
            maya,
            reqwest::Method::POST,
            "/api/drive/items",
            Some(serde_json::to_vec(&json!({ "name": "Watering rota.sldoc" })).unwrap()),
        )
        .await;
    let item = created["id"].as_str().unwrap().to_owned();
    let saved = cluster
        .request(
            0,
            maya,
            reqwest::Method::PUT,
            &format!("/api/drive/items/{item}/content"),
            Some(b"secret-value".to_vec()),
            None,
        )
        .await;
    assert!(saved.status().is_success(), "{}", saved.status());
    let group = cluster
        .json(
            0,
            sam,
            reqwest::Method::POST,
            "/api/admin/groups",
            Some(serde_json::to_vec(&json!({ "name": "Garden club" })).unwrap()),
        )
        .await;
    let group_id = group["id"].as_str().unwrap().to_owned();
    cluster
        .json(
            0,
            maya,
            reqwest::Method::PUT,
            &format!("/api/drive/items/{item}/acl"),
            Some(
                serde_json::to_vec(&json!({
                    "principalType": "group",
                    "principalId": group_id,
                    "role": "editor"
                }))
                .unwrap(),
            ),
        )
        .await;
    cluster
        .json(
            0,
            sam,
            reqwest::Method::POST,
            &format!("/api/admin/groups/{group_id}/members"),
            Some(
                serde_json::to_vec(&json!({
                    "memberType": "user",
                    "memberId": "priya"
                }))
                .unwrap(),
            ),
        )
        .await;
    let path = format!("/api/admin/groups/{group_id}/member-plan");
    let refused = cluster
        .request(
            0,
            maya,
            reqwest::Method::POST,
            &path,
            Some(serde_json::to_vec(&json!({ "memberId": "sam", "adding": true })).unwrap()),
            None,
        )
        .await;
    assert_eq!(refused.status(), reqwest::StatusCode::FORBIDDEN);
    let blank = cluster
        .request(
            0,
            sam,
            reqwest::Method::POST,
            &path,
            Some(serde_json::to_vec(&json!({ "memberId": " ", "adding": true })).unwrap()),
            None,
        )
        .await;
    let blank_status = blank.status();
    let blank_text = blank.text().await.unwrap_or_default();
    assert_eq!(blank_status, reqwest::StatusCode::BAD_REQUEST);
    assert!(blank_text.contains("Name the person."));
    assert!(!blank_text.contains("secret-value"));
    let added = cluster
        .json(
            0,
            sam,
            reqwest::Method::POST,
            &path,
            Some(serde_json::to_vec(&json!({ "memberId": "sam", "adding": true })).unwrap()),
        )
        .await;
    let added_text = added.to_string();
    assert!(added_text.contains(&item), "{added_text}");
    assert!(added_text.contains("\"after\":\"editor\""), "{added_text}");
    assert!(!added_text.contains("secret-value"), "{added_text}");
    let lars_read = cluster
        .request(
            0,
            lars,
            reqwest::Method::GET,
            &format!("/api/drive/items/{item}/content"),
            None,
            None,
        )
        .await;
    assert!(!lars_read.status().is_success(), "{}", lars_read.status());
    let removed = cluster
        .json(
            0,
            sam,
            reqwest::Method::POST,
            &path,
            Some(serde_json::to_vec(&json!({ "memberId": "priya", "adding": false })).unwrap()),
        )
        .await;
    let removed_text = removed.to_string();
    assert!(
        removed_text.contains("\"before\":\"editor\""),
        "{removed_text}"
    );
    assert!(removed_text.contains("\"after\":null"), "{removed_text}");
    assert!(!removed_text.contains("secret-value"), "{removed_text}");
    cluster
        .request(
            0,
            priya,
            reqwest::Method::GET,
            &format!("/api/drive/items/{item}/content"),
            None,
            None,
        )
        .await
        .error_for_status()
        .expect("Priya still has the file");
}

#[tokio::test(flavor = "multi_thread")]
async fn an_org_editor_policy_over_http_names_another_owners_file() {
    let cluster = Cluster::boot().await;
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
    let maya = cluster.person("maya");
    let sam = cluster.person("sam");
    let priya = cluster.person("priya");
    let created = cluster
        .json(
            0,
            maya,
            reqwest::Method::POST,
            "/api/drive/items",
            Some(serde_json::to_vec(&json!({ "name": "Watering rota.sldoc" })).unwrap()),
        )
        .await;
    let item = created["id"].as_str().unwrap().to_owned();
    let saved = cluster
        .request(
            0,
            maya,
            reqwest::Method::PUT,
            &format!("/api/drive/items/{item}/content"),
            Some(b"secret-value".to_vec()),
            None,
        )
        .await;
    assert!(saved.status().is_success(), "{}", saved.status());
    cluster
        .json(
            0,
            maya,
            reqwest::Method::PUT,
            &format!("/api/drive/items/{item}/acl"),
            Some(
                serde_json::to_vec(&json!({
                    "principalType": "user",
                    "principalId": "priya",
                    "role": "editor"
                }))
                .unwrap(),
            ),
        )
        .await;
    let refused = cluster
        .request(
            0,
            maya,
            reqwest::Method::GET,
            "/api/admin/editor-policy",
            None,
            None,
        )
        .await;
    assert_eq!(refused.status(), reqwest::StatusCode::FORBIDDEN);
    let plan = cluster
        .json(
            0,
            sam,
            reqwest::Method::GET,
            "/api/admin/editor-policy",
            None,
        )
        .await;
    let text = plan.to_string();
    assert!(text.contains("priya"), "{text}");
    assert!(text.contains("Watering rota.sldoc"), "{text}");
    assert!(!text.contains("secret-value"), "{text}");
    let stamp = plan["stamp"].as_str().unwrap();
    let stale = cluster
        .request(
            0,
            sam,
            reqwest::Method::POST,
            "/api/admin/editor-policy",
            Some(serde_json::to_vec(&json!({ "stamp": "secret-value" })).unwrap()),
            None,
        )
        .await;
    let stale_status = stale.status();
    let stale_text = stale.text().await.unwrap_or_default();
    assert_eq!(stale_status, reqwest::StatusCode::BAD_REQUEST);
    assert!(stale_text.contains("The access plan changed. Review it again."));
    assert!(!stale_text.contains("secret-value"));
    cluster
        .json(
            0,
            sam,
            reqwest::Method::POST,
            "/api/admin/editor-policy",
            Some(serde_json::to_vec(&json!({ "stamp": stamp })).unwrap()),
        )
        .await;
    let read = cluster
        .request(
            0,
            priya,
            reqwest::Method::PUT,
            &format!("/api/drive/items/{item}/content"),
            Some(b"changed".to_vec()),
            None,
        )
        .await;
    assert_eq!(read.status(), reqwest::StatusCode::FORBIDDEN);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_person_access_list_over_http_hides_another_persons_files() {
    let cluster = Cluster::boot().await;
    let maya = cluster.person("maya");
    let sam = cluster.person("sam");
    let created = cluster
        .json(
            0,
            maya,
            reqwest::Method::POST,
            "/api/drive/items",
            Some(serde_json::to_vec(&json!({ "name": "Watering rota.sldoc" })).unwrap()),
        )
        .await;
    let item = created["id"].as_str().unwrap().to_owned();
    let saved = cluster
        .request(
            0,
            maya,
            reqwest::Method::PUT,
            &format!("/api/drive/items/{item}/content"),
            Some(b"secret-value".to_vec()),
            None,
        )
        .await;
    assert!(saved.status().is_success(), "{}", saved.status());
    cluster
        .json(
            0,
            maya,
            reqwest::Method::PUT,
            &format!("/api/drive/items/{item}/acl"),
            Some(
                serde_json::to_vec(&json!({
                    "principalType": "user",
                    "principalId": "sam",
                    "role": "editor"
                }))
                .unwrap(),
            ),
        )
        .await;
    let refused = cluster
        .request(
            0,
            maya,
            reqwest::Method::GET,
            "/api/drive/people/sam/access",
            None,
            None,
        )
        .await;
    assert_eq!(refused.status(), reqwest::StatusCode::FORBIDDEN);
    let listed = cluster
        .json(
            0,
            sam,
            reqwest::Method::GET,
            "/api/drive/people/sam/access",
            None,
        )
        .await;
    let text = listed.to_string();
    assert!(text.contains("Watering rota.sldoc"), "{text}");
    assert!(text.contains("\"role\":\"editor\""), "{text}");
    assert!(!text.contains("secret-value"), "{text}");
}
