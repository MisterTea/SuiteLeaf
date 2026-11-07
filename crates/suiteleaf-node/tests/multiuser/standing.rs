//! An open room keeps checking who may stay: a quiet reader is closed after
//! lost access, a revoked session, or a changed role, and a fresh token for
//! the same person keeps the socket open.

use std::time::{Duration, Instant};

use serde_json::json;
use tokio::time::sleep;

use crate::support::*;

/// The node rechecks every 200 ms in these tests. A quiet socket must close well within this.
const BOUND: Duration = Duration::from_secs(5);

async fn wait_closed(client: &LiveClient) -> Duration {
    let started = Instant::now();
    while !client.closed() {
        assert!(
            started.elapsed() < BOUND,
            "{} stayed connected without sending anything",
            client.name
        );
        sleep(Duration::from_millis(20)).await;
    }
    started.elapsed()
}

async fn set_role(cluster: &Cluster, item: &str, person: &str, role: Option<&str>) {
    let response = cluster
        .request(
            0,
            cluster.person("maya"),
            reqwest::Method::PUT,
            &format!("/api/drive/items/{item}/acl"),
            Some(
                serde_json::to_vec(&json!({
                    "principalType": "user",
                    "principalId": person,
                    "role": role
                }))
                .unwrap(),
            ),
            None,
        )
        .await;
    assert!(response.status().is_success(), "acl {}", response.status());
}

async fn delete_session(cluster: &Cluster, id: &str) {
    cluster
        .db(
            0,
            json!({
                "op": "delete",
                "model": "session",
                "where": [{ "field": "id", "value": id }]
            }),
        )
        .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_quiet_viewer_is_closed_after_the_grant_is_removed_and_reads_no_later_edit() {
    let cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    let lars = cluster.connect_quiet(0, &notes, "lars").await;
    different_paragraphs_converge(&editors).await;
    wait_paragraphs(
        std::slice::from_ref(&lars),
        &["Tomatoes are in", "Beans are staked"],
    )
    .await;
    set_role(&cluster, &notes, "lars", None).await;
    wait_closed(&lars).await;
    assert_eq!(lars.error().as_deref(), Some("forbidden"));
    let seen = lars.updates();
    editors[0].send_update(
        &editors[0].edit_paragraph(0, "Tomatoes are picked"),
        "paragraph",
        "0",
    );
    wait_paragraphs(&editors, &["Tomatoes are picked", "Beans are staked"]).await;
    sleep(Duration::from_millis(400)).await;
    assert_eq!(lars.updates(), seen, "a removed viewer read a later edit");
    assert_eq!(
        lars.paragraphs(),
        vec!["Tomatoes are in", "Beans are staked"]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_quiet_editor_is_closed_when_the_session_is_revoked() {
    let cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let maya = cluster.connect(0, &notes, "maya").await;
    let sam = cluster.connect_quiet(0, &notes, "sam").await;
    wait_multi(std::slice::from_ref(&maya)).await;
    delete_session(&cluster, "sam-session").await;
    wait_closed(&sam).await;
    assert_eq!(sam.error().as_deref(), Some("unauthorized"));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_lowered_role_closes_the_socket_and_says_the_role_changed() {
    let cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    let ravi = cluster.connect_quiet(0, &notes, "ravi").await;
    different_paragraphs_converge(&editors).await;
    set_role(&cluster, &notes, "ravi", Some("viewer")).await;
    wait_closed(&ravi).await;
    assert_eq!(ravi.error().as_deref(), Some("role-changed"));
    let reopened = cluster.connect(0, &notes, "ravi").await;
    reopened.send_update(
        &root_update("viewerIntrusion", "LOWERED ROLE SHOULD NOT LAND"),
        "paragraph",
        "0",
    );
    sleep(Duration::from_millis(400)).await;
    assert_eq!(editors[0].root("viewerIntrusion"), "");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_renewed_token_keeps_the_socket_and_another_persons_token_closes_it() {
    let cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    cluster
        .db(
            0,
            json!({
                "op": "create",
                "model": "session",
                "data": {
                    "id": "sam-session-2",
                    "token": "sam-token-2",
                    "userId": "sam",
                    "expiresAt": "2099-01-01T00:00:00.000Z",
                    "createdAt": AT,
                    "updatedAt": AT
                }
            }),
        )
        .await;
    let maya = cluster.connect(0, &notes, "maya").await;
    let sam = cluster.connect_quiet(0, &notes, "sam").await;
    wait_multi(std::slice::from_ref(&maya)).await;
    sam.send(&json!({"type": "auth", "accessToken": "sam-token-2", "protocol": 1}));
    let started = Instant::now();
    while sam.renewed() == 0 {
        assert!(started.elapsed() < BOUND, "the renewal was not answered");
        sleep(Duration::from_millis(20)).await;
    }
    // The first session ends. The socket now signs in with the renewed token, so it stays.
    delete_session(&cluster, "sam-session").await;
    sleep(Duration::from_millis(800)).await;
    assert!(
        !sam.closed(),
        "a renewed socket was closed with the old session"
    );
    delete_session(&cluster, "sam-session-2").await;
    wait_closed(&sam).await;
    assert_eq!(sam.error().as_deref(), Some("unauthorized"));

    let noor = cluster.connect_quiet(0, &notes, "noor").await;
    noor.send(&json!({"type": "auth", "accessToken": "ravi-token", "protocol": 1}));
    wait_closed(&noor).await;
    assert_eq!(noor.error().as_deref(), Some("unauthorized"));
    assert_eq!(noor.renewed(), 0);
}
