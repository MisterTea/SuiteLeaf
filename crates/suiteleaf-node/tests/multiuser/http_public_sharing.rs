//! Anonymous reads use capabilities; all management and writes still need auth.
use crate::support::*;
use serde_json::json;

#[tokio::test(flavor = "multi_thread")]
async fn public_file_http_is_anonymous_read_only_and_revocable() {
    use reqwest::{Method, StatusCode};
    let cluster = Cluster::boot().await;
    let item = cluster.shared_notes().await;
    let maya = cluster.person("maya");
    let sam = cluster.person("sam");
    let base = &cluster.nodes[0].http;
    let manage = format!("/api/drive/items/{item}/public-link");
    let private = format!("{base}/api/drive/items/{item}/content");
    assert_eq!(
        cluster.http.get(&private).send().await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        cluster
            .http
            .post(format!("{base}{manage}"))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        cluster
            .request(0, sam, Method::POST, &manage, None, None)
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    let link = cluster.json(0, maya, Method::POST, &manage, None).await;
    let token = link["token"].as_str().unwrap();
    let public = format!("{base}/api/public/files/{token}");
    let read = cluster.http.get(&public).send().await.unwrap();
    assert_eq!(read.status(), StatusCode::OK);
    assert_eq!(read.headers()["cache-control"], "no-store");
    assert_eq!(read.headers()["x-robots-tag"], "noindex, nofollow");
    let content = read.text().await.unwrap();
    assert!(content.contains("North bed"));
    assert!(!content.contains("maya-token"));
    assert_eq!(
        cluster
            .http
            .put(&public)
            .body("changed")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::METHOD_NOT_ALLOWED
    );
    assert_eq!(
        cluster
            .http
            .get(format!("{base}/api/public/files/{item}"))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        cluster
            .request(0, maya, Method::DELETE, &manage, None, None)
            .await
            .status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        cluster.http.get(&public).send().await.unwrap().status(),
        StatusCode::NOT_FOUND
    );

    // The admin setting is protected independently of link ownership.
    let policy = "/api/admin/public-sharing";
    assert_eq!(
        cluster
            .request(0, maya, Method::GET, policy, None, None)
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        cluster
            .request(
                0,
                maya,
                Method::PUT,
                policy,
                Some(br#"{"allowed":false}"#.to_vec()),
                None
            )
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    cluster.db(0, json!({"op":"update", "model":"user", "where":[{"field":"id", "value":"maya"}], "update":{"role":"admin"}})).await;
    cluster
        .json(
            0,
            maya,
            Method::PUT,
            policy,
            Some(br#"{"allowed":false}"#.to_vec()),
        )
        .await;
    let status = cluster.json(0, maya, Method::GET, &manage, None).await;
    assert_eq!(status["allowed"], false);
    assert_eq!(
        cluster
            .request(0, maya, Method::POST, &manage, None, None)
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        cluster
            .http
            .get(format!("{base}{policy}"))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
}
