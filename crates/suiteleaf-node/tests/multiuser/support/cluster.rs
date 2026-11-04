//! Booting the cluster, signing people in, and HTTP and database helpers.

use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tokio::time::{sleep, timeout};
use tokio_tungstenite::connect_async;

use super::client::wait_multi;
use super::yjs::{contains, document};
use super::{AT, Cluster, LiveClient, Node, Person, TOKEN, init, start, start_in};

impl Cluster {
    pub(crate) async fn boot() -> Self {
        Self::boot_with(None).await
    }

    pub(crate) async fn boot_with(emergency: Option<&str>) -> Self {
        let dirs: Vec<_> = (0..3).map(|_| tempfile::tempdir().unwrap()).collect();
        init(dirs[0].path(), None);
        let key = dirs[0].path().join("swarm.key");
        init(dirs[1].path(), Some(&key));
        init(dirs[2].path(), Some(&key));
        let first = start_in(dirs[0].path(), None, emergency);
        let second = start_in(dirs[1].path(), Some(&first.p2p), emergency);
        let third = start_in(dirs[2].path(), Some(&first.p2p), emergency);
        let cluster = Cluster {
            _dirs: dirs,
            nodes: vec![first, second, third],
            http: reqwest::Client::new(),
            people: Vec::new(),
        };
        let specs = [
            ("maya", "Maya"),
            ("sam", "Sam"),
            ("ravi", "Ravi"),
            ("noor", "Noor"),
            ("priya", "Priya"),
            ("lars", "Lars"),
        ];
        for (id, name) in specs {
            cluster
                .db(
                    0,
                    json!({
                        "op": "create",
                        "model": "user",
                        "data": {
                            "id": id,
                            "name": name,
                            "email": format!("{id}@gardenclub.org"),
                            "role": "user",
                            "emailVerified": 1,
                            "createdAt": AT,
                            "updatedAt": AT
                        }
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
                            "id": format!("{id}-session"),
                            "token": format!("{id}-token"),
                            "userId": id,
                            "expiresAt": "2099-01-01T00:00:00.000Z",
                            "createdAt": AT,
                            "updatedAt": AT
                        }
                    }),
                )
                .await;
        }
        let mut cluster = cluster;
        cluster.people = specs
            .into_iter()
            .map(|(id, name)| Person {
                id: id.into(),
                name: name.into(),
                token: format!("{id}-token"),
            })
            .collect();
        cluster
            .wait_until("sessions on every node", || async {
                for node in &cluster.nodes {
                    for person in &cluster.people {
                        if !cluster.can_list(node, person).await {
                            return false;
                        }
                    }
                }
                true
            })
            .await;
        cluster
    }

    pub(crate) fn person(&self, id: &str) -> &Person {
        self.people.iter().find(|person| person.id == id).expect(id)
    }

    pub(crate) async fn db(&self, node: usize, body: Value) -> Value {
        let response = self
            .http
            .post(format!("{}/internal/db", self.nodes[node].internal))
            .header("x-suiteleaf-internal", TOKEN)
            .json(&body)
            .send()
            .await
            .unwrap();
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        assert!(status.is_success(), "internal db {status}: {text}");
        serde_json::from_str::<Value>(&text).unwrap()["result"].clone()
    }

    async fn can_list(&self, node: &Node, person: &Person) -> bool {
        self.http
            .get(format!("{}/api/drive/items", node.http))
            .header("authorization", format!("Bearer {}", person.token))
            .send()
            .await
            .map(|response| response.status().is_success())
            .unwrap_or(false)
    }

    pub(crate) async fn request(
        &self,
        node: usize,
        person: &Person,
        method: reqwest::Method,
        path: &str,
        body: Option<Vec<u8>>,
        if_match: Option<&str>,
    ) -> reqwest::Response {
        let mut builder = self
            .http
            .request(method, format!("{}{path}", self.nodes[node].http))
            .header("authorization", format!("Bearer {}", person.token));
        if let Some(tag) = if_match {
            builder = builder.header("if-match", tag);
        }
        if let Some(body) = body {
            builder = builder
                .header("content-type", "application/json")
                .body(body);
        }
        builder.send().await.expect(path)
    }

    pub(crate) async fn json(
        &self,
        node: usize,
        person: &Person,
        method: reqwest::Method,
        path: &str,
        body: Option<Vec<u8>>,
    ) -> Value {
        let what = format!("{method} {path}");
        let response = self.request(node, person, method, path, body, None).await;
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        assert!(status.is_success(), "{what} -> {status} {text}");
        serde_json::from_str(&text).unwrap_or_else(|err| panic!("{path} not json ({err}): {text}"))
    }

    pub(crate) async fn shared_notes(&self) -> String {
        self.publish(
            "Garden notes.sldoc",
            "North bed",
            document("Garden notes", &["North bed", "South bed"]),
        )
        .await
    }

    pub(crate) async fn publish(&self, name: &str, marker: &str, bytes: Vec<u8>) -> String {
        let maya = self.person("maya");
        let created = self
            .json(
                0,
                maya,
                reqwest::Method::POST,
                "/api/drive/items",
                Some(
                    serde_json::to_vec(&json!({
                        "name": name,
                        "kind": "file",
                        "mime": "application/json"
                    }))
                    .unwrap(),
                ),
            )
            .await;
        let item = created["id"].as_str().unwrap().to_owned();
        let saved = self
            .request(
                0,
                maya,
                reqwest::Method::PUT,
                &format!("/api/drive/items/{item}/content"),
                Some(bytes),
                None,
            )
            .await;
        assert!(
            saved.status().is_success(),
            "save {name}: {}",
            saved.status()
        );
        for (id, role) in [
            ("sam", "editor"),
            ("ravi", "editor"),
            ("noor", "editor"),
            ("priya", "commenter"),
            ("lars", "viewer"),
        ] {
            let response = self
                .request(
                    0,
                    maya,
                    reqwest::Method::PUT,
                    &format!("/api/drive/items/{item}/acl"),
                    Some(
                        serde_json::to_vec(&json!({
                            "principalType": "user",
                            "principalId": id,
                            "role": role
                        }))
                        .unwrap(),
                    ),
                    None,
                )
                .await;
            assert!(
                response.status().is_success(),
                "share {name} with {id}: {}",
                response.status()
            );
        }
        self.wait_until(&format!("{name} is readable on every node"), || async {
            self.read_content(2, self.person("lars"), &item)
                .await
                .is_some_and(|bytes| contains(&bytes, marker))
        })
        .await;
        item
    }

    pub(crate) async fn read_content(
        &self,
        node: usize,
        person: &Person,
        item: &str,
    ) -> Option<Vec<u8>> {
        let response = self
            .request(
                node,
                person,
                reqwest::Method::GET,
                &format!("/api/drive/items/{item}/content"),
                None,
                None,
            )
            .await;
        if response.status().is_success() {
            Some(response.bytes().await.unwrap().to_vec())
        } else {
            None
        }
    }

    pub(crate) async fn connect(&self, node: usize, item: &str, person_id: &str) -> LiveClient {
        let person = self.person(person_id);
        let url = format!(
            "{}/api/drive/items/{item}/session?access_token={}",
            self.nodes[node].http.replacen("http", "ws", 1),
            person.token
        );
        let (socket, _) = timeout(Duration::from_secs(10), connect_async(&url))
            .await
            .unwrap_or_else(|_| panic!("{person_id} timed out joining the room"))
            .unwrap_or_else(|err| panic!("{person_id} could not join: {err}"));
        LiveClient::spawn(person.name.clone(), socket).await
    }

    pub(crate) async fn editors(&self, node: usize, item: &str, ids: &[&str]) -> Vec<LiveClient> {
        let clients = futures::future::join_all(
            ids.iter()
                .map(|id| self.connect(node, item, id))
                .collect::<Vec<_>>(),
        )
        .await;
        wait_multi(&clients).await;
        clients
    }

    pub(crate) async fn wait_for_text_everywhere(&self, item: &str, texts: &[&str]) {
        self.wait_until("compacted notes on every node", || async {
            for node in 0..self.nodes.len() {
                let Some(bytes) = self.read_content(node, self.person("maya"), item).await else {
                    return false;
                };
                if texts.iter().any(|text| !contains(&bytes, text)) {
                    return false;
                }
                let file: Value = match serde_json::from_slice(&bytes) {
                    Ok(file) => file,
                    Err(_) => return false,
                };
                let authors: Vec<_> = file["edits"]
                    .as_array()
                    .map(|edits| {
                        edits
                            .iter()
                            .filter_map(|edit| edit["by"]["id"].as_str())
                            .collect()
                    })
                    .unwrap_or_default();
                if !authors.contains(&"maya") || !authors.contains(&"sam") {
                    return false;
                }
            }
            true
        })
        .await;
    }

    pub(crate) fn restart(&mut self, index: usize) {
        let dir = self._dirs[index].path().to_owned();
        drop(self.nodes.remove(index));
        self.nodes.insert(index, start(&dir, None));
    }

    pub(crate) fn assert_alive(&mut self) {
        for (index, node) in self.nodes.iter_mut().enumerate() {
            match node.child.try_wait() {
                Ok(None) => {}
                Ok(Some(status)) => panic!("node {index} exited: {status}"),
                Err(err) => panic!("node {index} status: {err}"),
            }
        }
    }

    pub(crate) async fn wait_until(&self, what: &str, mut check: impl AsyncFnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(20);
        while Instant::now() < deadline {
            if check().await {
                return;
            }
            sleep(Duration::from_millis(80)).await;
        }
        panic!("timed out waiting for {what}");
    }
}
