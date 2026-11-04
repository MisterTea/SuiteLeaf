//! Simultaneous saves of one file: one head, and every accepted version.

use std::{
    sync::Arc,
    time::{Duration, Instant},
};

use serde_json::{Value, json};
use tokio::time::sleep;

use super::Cluster;
use super::client::spawn_readers;
use super::yjs::document;

impl Cluster {
    pub(crate) async fn concurrent_saves_stay_intact(&self) {
        let maya = self.person("maya");
        let created = self
            .json(
                0,
                maya,
                reqwest::Method::POST,
                "/api/drive/items",
                Some(
                    serde_json::to_vec(&json!({
                        "name": "Rota.sldoc",
                        "kind": "file",
                        "mime": "application/json"
                    }))
                    .unwrap(),
                ),
            )
            .await;
        let item = created["id"].as_str().unwrap().to_owned();
        let initial = document("Rota", &["Monday"]);
        assert!(
            self.request(
                0,
                maya,
                reqwest::Method::PUT,
                &format!("/api/drive/items/{item}/content"),
                Some(initial),
                None,
            )
            .await
            .status()
            .is_success()
        );
        for id in ["sam", "ravi", "noor"] {
            assert!(
                self.request(
                    0,
                    maya,
                    reqwest::Method::PUT,
                    &format!("/api/drive/items/{item}/acl"),
                    Some(
                        serde_json::to_vec(&json!({
                            "principalType": "user",
                            "principalId": id,
                            "role": "editor"
                        }))
                        .unwrap(),
                    ),
                    None,
                )
                .await
                .status()
                .is_success()
            );
        }
        self.wait_until("rota is on every node", || async {
            self.read_content(1, self.person("sam"), &item)
                .await
                .is_some()
                && self
                    .read_content(2, self.person("ravi"), &item)
                    .await
                    .is_some()
        })
        .await;

        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let reader = spawn_readers(self, &item, stop.clone());
        let writers = ["maya", "sam", "ravi", "noor", "maya", "sam"];
        let path = format!("/api/drive/items/{item}/content");
        let mut bodies = Vec::new();
        let mut writes = Vec::new();
        for (index, id) in writers.iter().enumerate() {
            let body = document(&format!("Race {index}"), &[id]);
            bodies.push(body.clone());
            writes.push(self.request(
                index % 3,
                self.person(id),
                reqwest::Method::PUT,
                &path,
                Some(body),
                None,
            ));
        }
        let saved = futures::future::join_all(writes).await;
        for response in &saved {
            assert_eq!(
                response.status(),
                200,
                "a concurrent save failed: {}",
                response.status()
            );
        }
        sleep(Duration::from_millis(200)).await;
        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        let (reads, bad) = reader.await.unwrap();
        assert!(bad.is_empty(), "a reader saw a broken response: {bad:?}");
        assert!(reads > 0, "readers never got the file");

        self.wait_until("one head after the burst", || async {
            let mut heads = Vec::new();
            for node in 0..3 {
                let Some(bytes) = self.read_content(node, self.person("sam"), &item).await else {
                    return false;
                };
                heads.push(bytes);
            }
            heads.windows(2).all(|pair| pair[0] == pair[1])
                && bodies.iter().any(|body| body == &heads[0])
        })
        .await;

        let etag = self.wait_until_etag(&item).await;
        let left = document("Match A", &["Maya's rota"]);
        let right = document("Match B", &["Sam's rota"]);
        let path = format!("/api/drive/items/{item}/content");
        let (first, second) = tokio::join!(
            self.request(
                0,
                self.person("maya"),
                reqwest::Method::PUT,
                &path,
                Some(left.clone()),
                Some(&etag),
            ),
            self.request(
                1,
                self.person("sam"),
                reqwest::Method::PUT,
                &path,
                Some(right.clone()),
                Some(&etag),
            ),
        );
        let mut accepted = Vec::new();
        let mut rejected = Vec::new();
        for (response, body, title) in [(first, &left, "Match A"), (second, &right, "Match B")] {
            let status = response.status().as_u16();
            assert!(
                status == 200 || status == 409,
                "{title} returned {status}, not 200 or 409"
            );
            if status == 200 {
                accepted.push((title, body.clone()));
            } else {
                rejected.push(title);
            }
        }
        assert!(!accepted.is_empty(), "both matched saves were rejected");
        self.wait_until("matched saves converge", || async {
            let mut heads = Vec::new();
            for node in 0..3 {
                let Some(bytes) = self.read_content(node, self.person("maya"), &item).await else {
                    return false;
                };
                heads.push(bytes);
            }
            if heads.windows(2).any(|pair| pair[0] != pair[1]) {
                return false;
            }
            accepted.iter().any(|(_, body)| body == &heads[0])
        })
        .await;
        self.wait_until("every accepted save stays in history", || async {
            let Some(titles) = self.version_titles(&item).await else {
                return false;
            };
            accepted
                .iter()
                .all(|(title, _)| titles.iter().any(|got| got == title))
                && rejected
                    .iter()
                    .all(|title| !titles.iter().any(|got| got == title))
        })
        .await;

        for (id, node) in [("priya", 2), ("lars", 1)] {
            let status = self
                .request(
                    node,
                    self.person(id),
                    reqwest::Method::PUT,
                    &format!("/api/drive/items/{item}/content"),
                    Some(document("Stolen", &["no"])),
                    None,
                )
                .await
                .status();
            assert_eq!(status, 403, "{id} was allowed to overwrite the rota");
        }
    }

    async fn wait_until_etag(&self, item: &str) -> String {
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            if let (Some(left), Some(right)) = (self.etag(0, item).await, self.etag(1, item).await)
                && left == right
            {
                return left;
            }
            if Instant::now() >= deadline {
                panic!("timed out waiting for the same etag on two nodes");
            }
            sleep(Duration::from_millis(80)).await;
        }
    }

    async fn etag(&self, node: usize, item: &str) -> Option<String> {
        let response = self
            .request(
                node,
                self.person("maya"),
                reqwest::Method::GET,
                &format!("/api/drive/items/{item}/content"),
                None,
                None,
            )
            .await;
        response
            .headers()
            .get("etag")
            .and_then(|value| value.to_str().ok())
            .map(|value| value.trim_matches('"').to_owned())
    }

    async fn version_titles(&self, item: &str) -> Option<Vec<String>> {
        let response = self
            .request(
                0,
                self.person("maya"),
                reqwest::Method::GET,
                &format!("/api/drive/items/{item}/versions"),
                None,
                None,
            )
            .await;
        if !response.status().is_success() {
            return None;
        }
        let body: Value = serde_json::from_slice(&response.bytes().await.ok()?).ok()?;
        let mut titles = Vec::new();
        for version in body["versions"].as_array()? {
            let id = version["id"].as_str()?;
            let mut bytes = None;
            for node in 0..3 {
                let response = self
                    .request(
                        node,
                        self.person("maya"),
                        reqwest::Method::GET,
                        &format!("/api/drive/items/{item}/content?version={id}"),
                        None,
                        None,
                    )
                    .await;
                if response.status().is_success() {
                    bytes = Some(response.bytes().await.ok()?.to_vec());
                    break;
                }
            }
            let bytes = bytes?;
            let file: Value = serde_json::from_slice(&bytes).ok()?;
            titles.push(file["title"].as_str()?.to_owned());
        }
        Some(titles)
    }

    pub(crate) async fn heads_match(&self) {
        self.wait_until("identical suite heads", || async {
            let mut heads = Vec::new();
            for node in &self.nodes {
                let response = self
                    .http
                    .get(format!("{}/api/node/info", node.http))
                    .send()
                    .await
                    .ok();
                let Some(response) = response else {
                    return false;
                };
                let body: Value = match response.json().await {
                    Ok(body) => body,
                    Err(_) => return false,
                };
                heads.push(body["suitedb"]["heads"].clone());
            }
            heads.windows(2).all(|pair| pair[0] == pair[1])
        })
        .await;
    }
}
