//! Three real nodes, and several signed-in clients editing one file at once.
//!
//! Sessions replicate through SuiteDB, so any node can authenticate a client.
//! Concurrent edits converge on the node the clients joined. The saved Yjs
//! log replicates with SuiteDB, and a person who then opens the file on
//! another node is given that document. A viewer or commenter must not change the body,
//! and a compacted document has to show up on the other nodes. Sheets,
//! presentations, and drawings converge the same way through their own maps:
//! cells, slides, and drawing lines. Simultaneous saves must leave one head
//! and every accepted version.

#![allow(clippy::zombie_processes)]

use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read},
    path::Path,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use base64::{Engine, engine::general_purpose::STANDARD};
use futures::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::{
    sync::mpsc,
    task::JoinHandle,
    time::{sleep, timeout},
};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use yrs::{
    Any, Array, Doc, GetString, Map, Out, ReadTxn, StateVector, Text, TextPrelim, Transact, Update,
    Xml, XmlElementPrelim, XmlFragment, XmlOut, XmlTextPrelim, types::Attrs, undo::UndoManager,
    updates::decoder::Decode,
};

const TOKEN: &str = "multiuser-test-token";
const ANY: &str = "/ip4/127.0.0.1/tcp/0";
const AT: &str = "2026-10-30T18:00:00.000Z";

struct Node {
    child: Child,
    http: String,
    internal: String,
    p2p: String,
}

impl Drop for Node {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct Person {
    id: String,
    name: String,
    token: String,
}

struct Cluster {
    _dirs: Vec<tempfile::TempDir>,
    nodes: Vec<Node>,
    http: reqwest::Client,
    people: Vec<Person>,
}

struct ClientInner {
    doc: Doc,
    mode: String,
    accepted: bool,
    joins: u64,
    failed: Option<String>,
    closed: bool,
    reply: Option<(String, String)>,
    caret: Option<(String, u64, u64)>,
}

struct LiveClient {
    name: String,
    state: Arc<Mutex<ClientInner>>,
    outgoing: mpsc::UnboundedSender<String>,
    tasks: Mutex<Vec<JoinHandle<()>>>,
}

impl Drop for LiveClient {
    fn drop(&mut self) {
        for task in self.tasks.lock().expect("client tasks").drain(..) {
            task.abort();
        }
    }
}

fn init(dir: &Path, swarm_key: Option<&Path>) {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_suiteleaf-node"));
    cmd.arg("init")
        .arg("--data-dir")
        .arg(dir)
        .stdout(Stdio::null());
    if let Some(key) = swarm_key {
        cmd.arg("--swarm-key").arg(key);
    }
    assert!(cmd.status().unwrap().success(), "init node");
}

fn start(dir: &Path, bootstrap: Option<&str>) -> Node {
    start_in(dir, bootstrap, None)
}

fn start_in(dir: &Path, bootstrap: Option<&str>, emergency: Option<&str>) -> Node {
    start_env(dir, bootstrap, emergency, &[])
}

fn start_env(
    dir: &Path,
    bootstrap: Option<&str>,
    emergency: Option<&str>,
    extra: &[(&str, &str)],
) -> Node {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_suiteleaf-node"));
    cmd.args([
        "run",
        "--no-auth",
        "--http",
        "127.0.0.1:0",
        "--listen",
        ANY,
        "--sync-interval",
        "1",
    ])
    .arg("--data-dir")
    .arg(dir)
    .env("SUITELEAF_INTERNAL_TOKEN", TOKEN)
    .env("SUITELEAF_IDLE_MS", "5000")
    .env("SUITELEAF_KICK_EVERY_MS", "200")
    .env("RUST_LOG", "warn")
    .stdout(Stdio::piped())
    .stderr(Stdio::inherit());
    if let Some(code) = emergency {
        cmd.env("SUITELEAF_EMERGENCY_CODE", code);
    }
    for (name, value) in extra {
        cmd.env(name, value);
    }
    if let Some(addr) = bootstrap {
        cmd.args(["--bootstrap", addr]);
    }
    let mut child = cmd.spawn().expect("start suiteleaf-node");
    let mut reader = BufReader::new(child.stdout.take().unwrap());
    let mut line = String::new();
    let ready = loop {
        line.clear();
        assert!(
            reader.read_line(&mut line).unwrap() > 0,
            "node exited before it was ready"
        );
        if let Some(ready) = line.strip_prefix("SUITELEAF_NODE_READY ") {
            break ready.to_owned();
        }
    };
    std::thread::spawn(move || {
        let mut rest = Vec::new();
        let _ = reader.read_to_end(&mut rest);
    });
    let ready: Value = serde_json::from_str(&ready).unwrap();
    Node {
        child,
        http: ready["http"].as_str().unwrap().into(),
        internal: ready["internal"].as_str().unwrap().into(),
        p2p: ready["p2p"][0].as_str().unwrap().into(),
    }
}

impl Cluster {
    async fn boot() -> Self {
        Self::boot_with(None).await
    }

    async fn boot_with(emergency: Option<&str>) -> Self {
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

    fn person(&self, id: &str) -> &Person {
        self.people.iter().find(|person| person.id == id).expect(id)
    }

    async fn db(&self, node: usize, body: Value) -> Value {
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

    async fn request(
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

    async fn json(
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

    async fn shared_notes(&self) -> String {
        self.publish(
            "Garden notes.sldoc",
            "North bed",
            document("Garden notes", &["North bed", "South bed"]),
        )
        .await
    }

    async fn publish(&self, name: &str, marker: &str, bytes: Vec<u8>) -> String {
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

    async fn read_content(&self, node: usize, person: &Person, item: &str) -> Option<Vec<u8>> {
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

    async fn connect(&self, node: usize, item: &str, person_id: &str) -> LiveClient {
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

    async fn editors(&self, node: usize, item: &str, ids: &[&str]) -> Vec<LiveClient> {
        let clients = futures::future::join_all(
            ids.iter()
                .map(|id| self.connect(node, item, id))
                .collect::<Vec<_>>(),
        )
        .await;
        wait_multi(&clients).await;
        clients
    }

    async fn wait_for_text_everywhere(&self, item: &str, texts: &[&str]) {
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

    async fn concurrent_saves_stay_intact(&self) {
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

    async fn heads_match(&self) {
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

    fn restart(&mut self, index: usize) {
        let dir = self._dirs[index].path().to_owned();
        drop(self.nodes.remove(index));
        self.nodes.insert(index, start(&dir, None));
    }

    fn assert_alive(&mut self) {
        for (index, node) in self.nodes.iter_mut().enumerate() {
            match node.child.try_wait() {
                Ok(None) => {}
                Ok(Some(status)) => panic!("node {index} exited: {status}"),
                Err(err) => panic!("node {index} status: {err}"),
            }
        }
    }

    async fn wait_until(&self, what: &str, mut check: impl AsyncFnMut() -> bool) {
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

fn spawn_readers(
    cluster: &Cluster,
    item: &str,
    stop: Arc<std::sync::atomic::AtomicBool>,
) -> JoinHandle<(u32, Vec<String>)> {
    let http = cluster.http.clone();
    let urls: Vec<String> = cluster.nodes.iter().map(|node| node.http.clone()).collect();
    let token = cluster.person("maya").token.clone();
    let item = item.to_owned();
    tokio::spawn(async move {
        let mut reads = 0u32;
        let mut bad = Vec::new();
        while !stop.load(std::sync::atomic::Ordering::Relaxed) {
            for url in &urls {
                let Ok(response) = http
                    .get(format!("{url}/api/drive/items/{item}/content"))
                    .header("authorization", format!("Bearer {token}"))
                    .send()
                    .await
                else {
                    continue;
                };
                let status = response.status().as_u16();
                if status == 503 {
                    continue;
                }
                if status != 200 {
                    let text = response.text().await.unwrap_or_default();
                    bad.push(format!("{status} {text}"));
                    continue;
                }
                let bytes = response.bytes().await.unwrap_or_default();
                if serde_json::from_slice::<Value>(&bytes).is_err() {
                    bad.push(format!("torn {}", String::from_utf8_lossy(&bytes)));
                } else {
                    reads += 1;
                }
            }
            sleep(Duration::from_millis(20)).await;
        }
        (reads, bad)
    })
}

impl LiveClient {
    async fn spawn(
        name: String,
        socket: tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
    ) -> Self {
        let (mut write, mut read) = socket.split();
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        let state = Arc::new(Mutex::new(ClientInner {
            doc: Doc::new(),
            mode: String::new(),
            accepted: false,
            joins: 0,
            failed: None,
            closed: false,
            reply: None,
            caret: None,
        }));
        let writer = tokio::spawn(async move {
            while let Some(text) = rx.recv().await {
                if write.send(Message::text(text)).await.is_err() {
                    break;
                }
            }
        });
        let reader_state = state.clone();
        let reader = tokio::spawn(async move {
            while let Some(message) = read.next().await {
                let message = match message {
                    Ok(Message::Text(text)) => text.to_string(),
                    Ok(Message::Close(_)) | Err(_) => break,
                    _ => continue,
                };
                let value: Value = match serde_json::from_str(&message) {
                    Ok(value) => value,
                    Err(err) => {
                        reader_state.lock().expect("client").failed = Some(err.to_string());
                        break;
                    }
                };
                let mut inner = reader_state.lock().expect("client");
                let kind = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if kind == "selection" {
                    let name = value.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    let anchor = value.get("anchor").and_then(|v| v.as_u64());
                    let head = value.get("head").and_then(|v| v.as_u64());
                    if let (Some(anchor), Some(head)) = (anchor, head) {
                        inner.caret = Some((name.to_owned(), anchor, head));
                    }
                    continue;
                }
                if kind == "ack" || kind == "reject" {
                    if let Some(id) = value.get("id").and_then(|v| v.as_str()) {
                        inner.reply = Some((kind.to_owned(), id.to_owned()));
                    }
                    continue;
                }
                if kind == "update" {
                    if let Some(encoded) = value.get("update").and_then(|v| v.as_str())
                        && let Err(err) = integrate(&inner.doc, &decode_b64(encoded))
                    {
                        inner.failed = Some(err);
                    }
                    continue;
                }
                if kind != "joined" {
                    continue;
                }
                if let Some(encoded) = value.get("state").and_then(|v| v.as_str())
                    && let Err(err) = integrate(&inner.doc, &decode_b64(encoded))
                {
                    inner.failed = Some(err);
                }
                inner.mode = value
                    .get("mode")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_owned();
                inner.accepted = value
                    .get("joined")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                inner.joins += 1;
            }
            reader_state.lock().expect("client").closed = true;
        });
        let heartbeat_tx = tx.clone();
        let heartbeat = tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(1));
            loop {
                tick.tick().await;
                if heartbeat_tx
                    .send(json!({"type": "activity"}).to_string())
                    .is_err()
                {
                    break;
                }
            }
        });
        let client = LiveClient {
            name,
            state,
            outgoing: tx,
            tasks: Mutex::new(vec![writer, reader, heartbeat]),
        };
        if timeout(Duration::from_secs(10), client.wait_joins(1))
            .await
            .is_err()
        {
            panic!("{} never received joined", client.name);
        }
        client
    }

    fn closed(&self) -> bool {
        self.state.lock().expect("client").closed
    }

    fn send(&self, message: &Value) {
        self.outgoing
            .send(message.to_string())
            .unwrap_or_else(|_| panic!("{} socket closed", self.name));
    }

    fn try_send_update(&self, bytes: &[u8], unit: &str, key: &str) -> bool {
        if bytes.len() <= 2 {
            return false;
        }
        self.outgoing
            .send(
                json!({
                    "type": "update",
                    "update": STANDARD.encode(bytes),
                    "unit": unit,
                    "key": key,
                    "at": AT
                })
                .to_string(),
            )
            .is_ok()
    }

    fn send_update(&self, bytes: &[u8], unit: &str, key: &str) {
        if bytes.len() <= 2 {
            return;
        }
        self.send(&json!({
            "type": "update",
            "update": STANDARD.encode(bytes),
            "unit": unit,
            "key": key,
            "at": AT
        }));
    }

    fn paragraphs(&self) -> Vec<String> {
        let inner = self.state.lock().expect("client");
        let failed = inner.failed.clone();
        let texts = paragraph_strings(&inner.doc);
        drop(inner);
        if let Some(err) = failed {
            panic!("{}: {err}", self.name);
        }
        texts
    }

    fn root(&self, name: &str) -> String {
        let inner = self.state.lock().expect("client");
        let text = root_text(&inner.doc, name);
        let failed = inner.failed.clone();
        drop(inner);
        if let Some(err) = failed {
            panic!("{}: {err}", self.name);
        }
        text
    }

    fn mode(&self) -> String {
        self.state.lock().expect("client").mode.clone()
    }

    fn caret(&self) -> Option<(String, u64, u64)> {
        self.state.lock().expect("client").caret.clone()
    }

    fn reply(&self) -> Option<(String, String)> {
        self.state.lock().expect("client").reply.clone()
    }

    fn accepted(&self) -> bool {
        self.state.lock().expect("client").accepted
    }

    fn joins(&self) -> u64 {
        self.state.lock().expect("client").joins
    }

    async fn wait_joins(&self, count: u64) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while self.joins() < count {
            if Instant::now() >= deadline {
                panic!(
                    "{} saw {} joined messages, wanted {count} ({})",
                    self.name,
                    self.joins(),
                    self.mode()
                );
            }
            sleep(Duration::from_millis(20)).await;
        }
    }

    fn seed(&self, texts: &[&str]) -> Vec<u8> {
        let inner = self.state.lock().expect("client");
        let update = seed_paragraphs(&inner.doc, texts);
        drop(inner);
        self.send_update(&update, "paragraph", "0");
        update
    }

    fn edit_paragraph(&self, index: u32, text: &str) -> Vec<u8> {
        let inner = self.state.lock().expect("client");
        let update = replace_paragraph(&inner.doc, index, text);
        drop(inner);
        self.send_update(&update, "paragraph", &index.to_string());
        update
    }

    fn set_entry(&self, map: &str, key: &str, value: &str, unit: &str) -> Vec<u8> {
        let inner = self.state.lock().expect("client");
        let update = put_map(&inner.doc, map, key, value);
        drop(inner);
        self.send_update(&update, unit, key);
        update
    }

    fn entry(&self, map: &str, key: &str) -> Option<String> {
        let inner = self.state.lock().expect("client");
        let failed = inner.failed.clone();
        let value = read_map(&inner.doc, map, key);
        drop(inner);
        if let Some(err) = failed {
            panic!("{}: {err}", self.name);
        }
        value
    }

    /// Track only this client's later paragraph edits. Remote updates are not undone.
    fn track_own_paragraphs(&self) -> UndoManager<()> {
        let inner = self.state.lock().expect("client");
        let paragraphs = inner.doc.get_or_insert_array("paragraphs");
        let mut options = yrs::undo::Options::default();
        options.capture_timeout_millis = 0;
        let mut undo = UndoManager::with_scope_and_options(&inner.doc, &paragraphs, options);
        undo.include_origin(inner.doc.client_id());
        undo
    }

    fn append_own_paragraph(&self, text: &str) {
        let inner = self.state.lock().expect("client");
        let origin = inner.doc.client_id();
        let paragraphs = inner.doc.get_or_insert_array("paragraphs");
        let before = inner.doc.transact().state_vector();
        {
            let mut txn = inner.doc.transact_mut_with(origin);
            let index = paragraphs.len(&txn);
            paragraphs.insert(&mut txn, index, TextPrelim::new(text));
        }
        let update = inner.doc.transact().encode_state_as_update_v1(&before);
        drop(inner);
        self.send_update(&update, "paragraph", "0");
    }

    fn undo_own_paragraph(&self, undo: &mut UndoManager<()>) {
        let inner = self.state.lock().expect("client");
        let before = inner.doc.transact().state_vector();
        let undone = undo.undo_blocking();
        assert!(undone, "{} had no paragraph of its own to undo", self.name);
        let update = inner.doc.transact().encode_state_as_update_v1(&before);
        drop(inner);
        self.send_update(&update, "paragraph", "undo");
    }

    fn append_paragraph(&self, text: &str) {
        let inner = self.state.lock().expect("client");
        let paragraphs = inner.doc.get_or_insert_array("paragraphs");
        let update = transact_update(&inner.doc, |txn| {
            let index = paragraphs.len(&*txn);
            paragraphs.insert(txn, index, TextPrelim::new(text));
        });
        drop(inner);
        self.send_update(&update, "paragraph", "0");
    }
}

async fn wait_multi(clients: &[LiveClient]) {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if clients
            .iter()
            .all(|client| client.accepted() && client.mode() == "multiuser")
        {
            return;
        }
        for client in clients {
            client.send(&json!({"type": "join"}));
        }
        if Instant::now() >= deadline {
            let modes: Vec<_> = clients
                .iter()
                .map(|client| format!("{}:{}", client.name, client.mode()))
                .collect();
            panic!("room stayed solo: {modes:?}");
        }
        sleep(Duration::from_millis(50)).await;
    }
}

async fn wait_paragraphs(clients: &[LiveClient], expected: &[&str]) {
    let expected: Vec<String> = expected.iter().map(|text| (*text).to_owned()).collect();
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if clients.iter().all(|client| client.paragraphs() == expected) {
            return;
        }
        if Instant::now() >= deadline {
            let got: Vec<_> = clients.iter().map(|client| client.paragraphs()).collect();
            panic!("paragraphs did not converge to {expected:?}: {got:?}");
        }
        sleep(Duration::from_millis(40)).await;
    }
}

fn transact_update(doc: &Doc, edit: impl FnOnce(&mut yrs::TransactionMut)) -> Vec<u8> {
    let before = doc.transact().state_vector();
    edit(&mut doc.transact_mut());
    doc.transact().encode_state_as_update_v1(&before)
}

fn seed_paragraphs(doc: &Doc, texts: &[&str]) -> Vec<u8> {
    let paragraphs = doc.get_or_insert_array("paragraphs");
    transact_update(doc, |txn| {
        for text in texts {
            let index = paragraphs.len(&*txn);
            paragraphs.insert(txn, index, TextPrelim::new(*text));
        }
    })
}

fn replace_paragraph(doc: &Doc, index: u32, text: &str) -> Vec<u8> {
    let paragraphs = doc.get_or_insert_array("paragraphs");
    transact_update(doc, |txn| {
        while paragraphs.len(&*txn) <= index {
            let at = paragraphs.len(&*txn);
            paragraphs.insert(txn, at, TextPrelim::new(""));
        }
        let Some(Out::YText(block)) = paragraphs.get(&*txn, index) else {
            panic!("paragraph {index} is not text");
        };
        let len = block.len(&*txn);
        if len > 0 {
            block.remove_range(txn, 0, len);
        }
        if !text.is_empty() {
            block.insert(txn, 0, text);
        }
    })
}

fn paragraph_strings(doc: &Doc) -> Vec<String> {
    let txn = doc.transact();
    let Some(array) = txn.get_array("paragraphs") else {
        return Vec::new();
    };
    (0..array.len(&txn))
        .filter_map(|index| match array.get(&txn, index) {
            Some(Out::YText(text)) => Some(text.get_string(&txn)),
            _ => None,
        })
        .collect()
}

fn root_text(doc: &Doc, name: &str) -> String {
    let txn = doc.transact();
    txn.get_text(name)
        .map(|text| text.get_string(&txn))
        .unwrap_or_default()
}

fn integrate(doc: &Doc, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() <= 2 {
        return Ok(());
    }
    let update = Update::decode_v1(bytes).map_err(|err| err.to_string())?;
    doc.transact_mut()
        .apply_update(update)
        .map_err(|err| err.to_string())
}

fn decode_b64(encoded: &str) -> Vec<u8> {
    STANDARD.decode(encoded).unwrap_or_default()
}

fn root_update(name: &str, text: &str) -> Vec<u8> {
    let doc = Doc::new();
    let root = doc.get_or_insert_text(name);
    transact_update(&doc, |txn| root.insert(txn, 0, text))
}

fn put_map(doc: &Doc, name: &str, key: &str, value: &str) -> Vec<u8> {
    let map = doc.get_or_insert_map(name);
    transact_update(doc, |txn| {
        map.insert(txn, key, value);
    })
}

fn read_map(doc: &Doc, name: &str, key: &str) -> Option<String> {
    let txn = doc.transact();
    let map = txn.get_map(name)?;
    match map.get(&txn, key)? {
        Out::Any(Any::String(text)) => Some(text.to_string()),
        other => Some(format!("{other:?}")),
    }
}

fn map_update(name: &str, key: &str, value: &str) -> Vec<u8> {
    let doc = Doc::new();
    put_map(&doc, name, key, value)
}

fn envelope(kind: &str, title: &str, content: Value) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "format": "suiteleaf",
        "version": 1,
        "id": kind,
        "kind": kind,
        "title": title,
        "createdAt": AT,
        "updatedAt": AT,
        "content": content
    }))
    .unwrap()
}

fn document(title: &str, paragraphs: &[&str]) -> Vec<u8> {
    let content: Vec<_> = paragraphs
        .iter()
        .map(|text| json!({"type": "paragraph", "content": [{"type": "text", "text": text}]}))
        .collect();
    serde_json::to_vec(&json!({
        "format": "suiteleaf",
        "version": 1,
        "id": "notes",
        "kind": "doc",
        "title": title,
        "createdAt": AT,
        "updatedAt": AT,
        "content": {"type": "doc", "content": content}
    }))
    .unwrap()
}

fn contains(bytes: &[u8], text: &str) -> bool {
    bytes
        .windows(text.len())
        .any(|window| window == text.as_bytes())
}

async fn different_paragraphs_converge(clients: &[LiveClient]) {
    clients[0].seed(&["North bed", "South bed"]);
    wait_paragraphs(clients, &["North bed", "South bed"]).await;
    let (left, right) = {
        let maya = clients[0].state.lock().expect("client");
        let sam = clients[1].state.lock().expect("client");
        let left = replace_paragraph(&maya.doc, 0, "Tomatoes are in");
        let right = replace_paragraph(&sam.doc, 1, "Beans are staked");
        (left, right)
    };
    clients[0].send_update(&left, "paragraph", "0");
    clients[1].send_update(&right, "paragraph", "1");
    wait_paragraphs(clients, &["Tomatoes are in", "Beans are staked"]).await;
    clients[1].send_update(&right, "paragraph", "1");
    wait_paragraphs(clients, &["Tomatoes are in", "Beans are staked"]).await;
}

async fn same_paragraph_merges(cluster: &Cluster, item: &str, clients: &[LiveClient]) {
    clients[0].seed(&["Tomatoes are in", "Beans are staked"]);
    wait_paragraphs(clients, &["Tomatoes are in", "Beans are staked"]).await;
    let (snapshot, left, right) = {
        let maya = clients[0].state.lock().expect("client");
        let sam = clients[1].state.lock().expect("client");
        let snapshot = maya
            .doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        let left = replace_paragraph(&maya.doc, 0, "Tomatoes and basil");
        let right = replace_paragraph(&sam.doc, 0, "Tomatoes and dill");
        (snapshot, left, right)
    };
    clients[0].send_update(&left, "paragraph", "0");
    clients[1].send_update(&right, "paragraph", "0");
    let referee = Doc::new();
    integrate(&referee, &snapshot).unwrap();
    integrate(&referee, &left).unwrap();
    integrate(&referee, &right).unwrap();
    let expected = paragraph_strings(&referee);
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if clients.iter().all(|client| client.paragraphs() == expected) {
            break;
        }
        if Instant::now() >= deadline {
            let got: Vec<_> = clients.iter().map(|client| client.paragraphs()).collect();
            panic!("same-paragraph edits did not match the merged document {expected:?}: {got:?}");
        }
        sleep(Duration::from_millis(40)).await;
    }
    let late = cluster.connect(0, item, "maya").await;
    assert_eq!(
        late.paragraphs(),
        expected,
        "a late joiner saw a different document"
    );
    assert_eq!(
        expected.get(1).map(String::as_str),
        Some("Beans are staked")
    );
}

async fn rejected_writers_leave_the_body(cluster: &Cluster, item: &str, editors: &[LiveClient]) {
    let lars = cluster.connect(0, item, "lars").await;
    assert!(lars.accepted(), "a viewer was turned away");
    assert_eq!(lars.paragraphs(), editors[0].paragraphs());
    lars.send_update(
        &root_update("viewerIntrusion", "VIEWER SHOULD NOT LAND"),
        "paragraph",
        "0",
    );
    let priya = cluster.connect(0, item, "priya").await;
    assert!(priya.accepted(), "a commenter was turned away");
    priya.send_update(
        &root_update("commenterBody", "COMMENTER SHOULD NOT LAND"),
        "paragraph",
        "0",
    );
    priya.send_update(
        &root_update("commentBody", "Bring the hose"),
        "comment",
        "0",
    );
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if editors[0].root("commentBody") == "Bring the hose" {
            break;
        }
        if Instant::now() >= deadline {
            panic!(
                "the comment never arrived: {:?}",
                editors[0].root("commentBody")
            );
        }
        sleep(Duration::from_millis(40)).await;
    }
    let seen = editors[0].joins();
    editors[0].send(&json!({"type": "join"}));
    editors[0].wait_joins(seen + 1).await;
    assert_eq!(editors[0].root("viewerIntrusion"), "");
    assert_eq!(editors[0].root("commenterBody"), "");
    assert_eq!(editors[0].root("commentBody"), "Bring the hose");
    for (id, node) in [("priya", 2usize), ("lars", 1)] {
        let status = cluster
            .request(
                node,
                cluster.person(id),
                reqwest::Method::PUT,
                &format!("/api/drive/items/{item}/content"),
                Some(document("Stolen", &["no"])),
                None,
            )
            .await
            .status();
        assert_eq!(status, 403, "{id} overwrote the shared notes");
    }
}

async fn own_paragraphs_survive_a_burst(
    cluster: &Cluster,
    item: &str,
    editors: &mut Vec<LiveClient>,
) {
    editors.extend(cluster.editors(0, item, &["ravi", "noor"]).await);
    wait_multi(editors).await;
    editors[0].append_paragraph("East bed");
    editors[0].append_paragraph("West bed");
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let texts = editors[0].paragraphs();
        if texts.len() == 4
            && texts[2] == "East bed"
            && texts[3] == "West bed"
            && editors.iter().all(|client| client.paragraphs() == texts)
        {
            break;
        }
        if Instant::now() >= deadline {
            let got: Vec<_> = editors.iter().map(|client| client.paragraphs()).collect();
            panic!("the four beds did not sync: {got:?}");
        }
        sleep(Duration::from_millis(40)).await;
    }
    let labels = ["north", "south", "east", "west"];
    for round in 0..8 {
        let writes = editors.iter().enumerate().map(|(index, client)| {
            let text = format!("{}-{round}", labels[index]);
            async move {
                client.edit_paragraph(index as u32, &text);
            }
        });
        futures::future::join_all(writes).await;
    }
    let expected = ["north-7", "south-7", "east-7", "west-7"];
    wait_paragraphs(editors, &expected).await;
    let late = cluster.connect(0, item, "sam").await;
    assert_eq!(
        late.paragraphs(),
        expected
            .iter()
            .map(|text| (*text).to_owned())
            .collect::<Vec<_>>()
    );
    assert_eq!(late.root("commentBody"), "Bring the hose");
    assert_eq!(late.root("viewerIntrusion"), "");
}

#[tokio::test(flavor = "multi_thread")]
async fn concurrent_clients_converge_across_a_cluster() {
    let mut cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;

    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    different_paragraphs_converge(&editors).await;
    drop(editors);
    cluster
        .wait_for_text_everywhere(&notes, &["Tomatoes are in", "Beans are staked"])
        .await;

    let mut editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    same_paragraph_merges(&cluster, &notes, &editors).await;
    rejected_writers_leave_the_body(&cluster, &notes, &editors).await;
    own_paragraphs_survive_a_burst(&cluster, &notes, &mut editors).await;
    drop(editors);

    cluster.concurrent_saves_stay_intact().await;
    cluster.heads_match().await;
    cluster.assert_alive();
}

#[tokio::test(flavor = "multi_thread")]
async fn a_viewer_who_opened_first_hears_when_the_room_is_shared() {
    let cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let lars = cluster.connect(0, &notes, "lars").await;
    assert_eq!(lars.mode(), "solo");
    let maya = cluster.connect(0, &notes, "maya").await;
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if lars.mode() == "multiuser" {
            break;
        }
        if Instant::now() >= deadline {
            panic!("viewer stayed {}", lars.mode());
        }
        sleep(Duration::from_millis(40)).await;
    }
    maya.append_paragraph("Tomatoes are in");
    wait_paragraphs(&[lars, maya], &["Tomatoes are in"]).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_stored_edit_is_acknowledged_and_a_viewer_edit_is_refused() {
    let cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    let update = {
        let inner = editors[0].state.lock().expect("client");
        seed_paragraphs(&inner.doc, &["Tomatoes are in"])
    };
    editors[0].send(&json!({
        "type": "update",
        "id": "edit-1",
        "update": STANDARD.encode(update),
        "unit": "paragraph",
        "key": "0",
        "at": AT
    }));
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if editors[0].reply() == Some(("ack".into(), "edit-1".into())) {
            break;
        }
        if Instant::now() >= deadline {
            panic!(
                "the stored edit was not acknowledged: {:?}",
                editors[0].reply()
            );
        }
        sleep(Duration::from_millis(40)).await;
    }
    wait_paragraphs(&editors, &["Tomatoes are in"]).await;
    let lars = cluster.connect(0, &notes, "lars").await;
    lars.send(&json!({
        "type": "update",
        "id": "view-1",
        "update": STANDARD.encode(root_update("viewerIntrusion", "VIEWER SHOULD NOT LAND")),
        "unit": "paragraph",
        "key": "0",
        "at": AT
    }));
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if lars.reply() == Some(("reject".into(), "view-1".into())) {
            break;
        }
        if Instant::now() >= deadline {
            panic!("the viewer edit was not refused: {:?}", lars.reply());
        }
        sleep(Duration::from_millis(40)).await;
    }
    assert_eq!(editors[0].root("viewerIntrusion"), "");
    assert_eq!(editors[0].paragraphs(), ["Tomatoes are in"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_live_caret_reaches_the_other_person_without_changing_the_text() {
    let cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    let before = editors[1].paragraphs();
    editors[0]
        .send(&json!({"type": "selection", "anchor": 1, "head": 4, "text": "Tomatoes are in"}));
    editors[0].send(&json!({"type": "selection", "anchor": 1, "head": 4}));
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if editors[1].caret() == Some(("Maya".into(), 1, 4)) {
            break;
        }
        if Instant::now() >= deadline {
            panic!("Sam did not see Maya's caret: {:?}", editors[1].caret());
        }
        sleep(Duration::from_millis(40)).await;
    }
    assert_eq!(editors[1].paragraphs(), before);
}

struct MapCase {
    name: &'static str,
    file_name: &'static str,
    marker: &'static str,
    bytes: Vec<u8>,
    map: &'static str,
    unit: &'static str,
    left_key: &'static str,
    right_key: &'static str,
    left: &'static str,
    right: &'static str,
    left_alt: &'static str,
    right_alt: &'static str,
}

async fn maps_converge(cluster: &Cluster, case: &MapCase) {
    let item = cluster
        .publish(case.file_name, case.marker, case.bytes.clone())
        .await;
    let editors = cluster.editors(0, &item, &["maya", "sam"]).await;
    let (left, right) = {
        let maya = editors[0].state.lock().expect("client");
        let sam = editors[1].state.lock().expect("client");
        let left = put_map(&maya.doc, case.map, case.left_key, case.left);
        let right = put_map(&sam.doc, case.map, case.right_key, case.right);
        (left, right)
    };
    editors[0].send_update(&left, case.unit, case.left_key);
    editors[1].send_update(&right, case.unit, case.right_key);
    wait_entries(
        &editors,
        case.map,
        &[(case.left_key, case.left), (case.right_key, case.right)],
    )
    .await;
    editors[1].send_update(&right, case.unit, case.right_key);
    wait_entries(
        &editors,
        case.map,
        &[(case.left_key, case.left), (case.right_key, case.right)],
    )
    .await;

    let (snapshot, again_left, again_right) = {
        let maya = editors[0].state.lock().expect("client");
        let sam = editors[1].state.lock().expect("client");
        let snapshot = maya
            .doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        let again_left = put_map(&maya.doc, case.map, case.left_key, case.left_alt);
        let again_right = put_map(&sam.doc, case.map, case.left_key, case.right_alt);
        (snapshot, again_left, again_right)
    };
    editors[0].send_update(&again_left, case.unit, case.left_key);
    editors[1].send_update(&again_right, case.unit, case.left_key);
    let referee = Doc::new();
    integrate(&referee, &snapshot).unwrap();
    integrate(&referee, &again_left).unwrap();
    integrate(&referee, &again_right).unwrap();
    let merged = read_map(&referee, case.map, case.left_key).unwrap_or_default();
    wait_entries(
        &editors,
        case.map,
        &[(case.left_key, &merged), (case.right_key, case.right)],
    )
    .await;
    let late = cluster.connect(0, &item, "maya").await;
    assert_eq!(
        late.entry(case.map, case.left_key).as_deref(),
        Some(merged.as_str())
    );
    assert_eq!(
        late.entry(case.map, case.right_key).as_deref(),
        Some(case.right)
    );
    drop(late);

    for round in 0..8 {
        let left = format!("{}-{round}", case.left_key);
        let right = format!("{}-{round}", case.right_key);
        tokio::join!(
            async {
                editors[0].set_entry(case.map, case.left_key, &left, case.unit);
            },
            async {
                editors[1].set_entry(case.map, case.right_key, &right, case.unit);
            },
        );
    }
    let left_final = format!("{}-7", case.left_key);
    let right_final = format!("{}-7", case.right_key);
    wait_entries(
        &editors,
        case.map,
        &[
            (case.left_key, left_final.as_str()),
            (case.right_key, right_final.as_str()),
        ],
    )
    .await;

    let lars = cluster.connect(0, &item, "lars").await;
    assert!(
        lars.accepted(),
        "a viewer was turned away from {}",
        case.name
    );
    assert_eq!(
        lars.entry(case.map, case.left_key),
        editors[0].entry(case.map, case.left_key),
        "{}",
        case.name
    );
    lars.send_update(
        &map_update(case.map, "intrusion", "VIEWER SHOULD NOT LAND"),
        case.unit,
        "intrusion",
    );
    let priya = cluster.connect(0, &item, "priya").await;
    assert!(
        priya.accepted(),
        "a commenter was turned away from {}",
        case.name
    );
    priya.send_update(
        &map_update(case.map, "body", "COMMENTER SHOULD NOT LAND"),
        case.unit,
        "body",
    );
    let seen = editors[0].joins();
    editors[0].send(&json!({"type": "join"}));
    editors[0].wait_joins(seen + 1).await;
    assert_eq!(
        editors[0].entry(case.map, "intrusion"),
        None,
        "{}",
        case.name
    );
    assert_eq!(editors[0].entry(case.map, "body"), None, "{}", case.name);
    drop(lars);
    drop(priya);
    drop(editors);
}

async fn wait_entries(clients: &[LiveClient], map: &str, expected: &[(&str, &str)]) {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let ready = clients.iter().all(|client| {
            expected
                .iter()
                .all(|(key, value)| client.entry(map, key).as_deref() == Some(*value))
        });
        if ready {
            return;
        }
        if Instant::now() >= deadline {
            let got: Vec<_> = clients
                .iter()
                .map(|client| {
                    expected
                        .iter()
                        .map(|(key, _)| format!("{key}={:?}", client.entry(map, key)))
                        .collect::<Vec<_>>()
                })
                .collect();
            panic!("{map} did not converge to {expected:?}: {got:?}");
        }
        sleep(Duration::from_millis(40)).await;
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn sheets_presentations_and_drawings_converge_across_a_cluster() {
    let mut cluster = Cluster::boot().await;
    let cases = [
        MapCase {
            name: "sheet",
            file_name: "Beds.slsheet",
            marker: "sheet-seed",
            bytes: envelope(
                "sheet",
                "Beds",
                json!({"name": "sheet-seed", "sheets": [{"id": "beds"}]}),
            ),
            map: "cells",
            unit: "cell",
            left_key: "0:0",
            right_key: "1:0",
            left: "\"Tomatoes\"",
            right: "\"Beans\"",
            left_alt: "\"Tomatoes and basil\"",
            right_alt: "\"Tomatoes and dill\"",
        },
        MapCase {
            name: "presentation",
            file_name: "Show.slslides",
            marker: "slide-seed",
            bytes: envelope(
                "slide",
                "Show",
                json!({
                    "title": "slide-seed",
                    "slideOrder": ["s1", "s2"],
                    "slides": {"s1": {"id": "s1"}, "s2": {"id": "s2"}}
                }),
            ),
            map: "slides",
            unit: "slide",
            left_key: "s1",
            right_key: "s2",
            left: "{\"id\":\"s1\",\"title\":\"Tomatoes\"}",
            right: "{\"id\":\"s2\",\"title\":\"Beans\"}",
            left_alt: "{\"id\":\"s1\",\"title\":\"Tomatoes and basil\"}",
            right_alt: "{\"id\":\"s1\",\"title\":\"Tomatoes and dill\"}",
        },
        MapCase {
            name: "drawing",
            file_name: "Plan.sldraw",
            marker: "drawing-seed",
            bytes: envelope(
                "drawing",
                "Plan",
                json!({"format": "svg", "source": "drawing-seed\nline two"}),
            ),
            map: "lines",
            unit: "paragraph",
            left_key: "0",
            right_key: "1",
            left: "rect tomatoes",
            right: "ellipse beans",
            left_alt: "rect tomatoes and basil",
            right_alt: "rect tomatoes and dill",
        },
    ];
    for case in &cases {
        maps_converge(&cluster, case).await;
    }
    cluster.heads_match().await;
    cluster.assert_alive();
}

#[tokio::test(flavor = "multi_thread")]
async fn an_edit_on_one_node_is_in_the_room_on_another() {
    let mut cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    different_paragraphs_converge(&editors).await;
    cluster
        .wait_until("the collaboration log reaches another node", || async {
            let room = cluster
                .db(
                    1,
                    json!({
                        "op": "findOne",
                        "model": "drive_room",
                        "where": [{ "field": "id", "value": notes }]
                    }),
                )
                .await;
            let updates = cluster
                .db(
                    1,
                    json!({
                        "op": "findMany",
                        "model": "drive_room_update",
                        "where": [{ "field": "itemId", "value": notes }]
                    }),
                )
                .await;
            room["mode"].as_str() == Some("multiuser")
                && updates.as_array().is_some_and(|rows| !rows.is_empty())
        })
        .await;
    let remote = cluster.connect(1, &notes, "ravi").await;
    let expected = vec!["Tomatoes are in".to_owned(), "Beans are staked".to_owned()];
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if remote.paragraphs() == expected {
            break;
        }
        if Instant::now() >= deadline {
            panic!(
                "the other node's room showed {:?}, mode {}",
                remote.paragraphs(),
                remote.mode()
            );
        }
        sleep(Duration::from_millis(100)).await;
    }
    drop(editors);
    cluster.assert_alive();
}

#[tokio::test(flavor = "multi_thread")]
async fn an_open_room_on_another_node_reads_a_later_edit() {
    let mut cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    different_paragraphs_converge(&editors).await;
    cluster
        .wait_until("the collaboration log reaches another node", || async {
            let room = cluster
                .db(
                    1,
                    json!({
                        "op": "findOne",
                        "model": "drive_room",
                        "where": [{ "field": "id", "value": notes }]
                    }),
                )
                .await;
            room["mode"].as_str() == Some("multiuser")
        })
        .await;
    let remote = cluster.connect(1, &notes, "ravi").await;
    let first = vec!["Tomatoes are in".to_owned(), "Beans are staked".to_owned()];
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if remote.paragraphs() == first {
            break;
        }
        if Instant::now() >= deadline {
            panic!("the open room started as {:?}", remote.paragraphs());
        }
        sleep(Duration::from_millis(100)).await;
    }
    let before = cluster
        .db(
            1,
            json!({
                "op": "findMany",
                "model": "drive_room_update",
                "where": [{ "field": "itemId", "value": notes }]
            }),
        )
        .await
        .as_array()
        .map(|rows| rows.len())
        .unwrap_or(0);
    editors[0].edit_paragraph(0, "Tomatoes are picked");
    cluster
        .wait_until("the later edit reaches the other node's log", || async {
            let updates = cluster
                .db(
                    1,
                    json!({
                        "op": "findMany",
                        "model": "drive_room_update",
                        "where": [{ "field": "itemId", "value": notes }]
                    }),
                )
                .await;
            updates.as_array().is_some_and(|rows| rows.len() > before)
        })
        .await;
    let expected = vec![
        "Tomatoes are picked".to_owned(),
        "Beans are staked".to_owned(),
    ];
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if remote.paragraphs() == expected {
            break;
        }
        if Instant::now() >= deadline {
            panic!(
                "the room that was already open showed {:?}, mode {}",
                remote.paragraphs(),
                remote.mode()
            );
        }
        sleep(Duration::from_millis(100)).await;
    }
    drop(editors);
    cluster.assert_alive();
}

#[tokio::test(flavor = "multi_thread")]
async fn formatted_text_a_table_and_an_image_converge_on_another_node() {
    let mut cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    cluster
        .wait_until("the room is multiuser on another node", || async {
            let room = cluster
                .db(
                    1,
                    json!({
                        "op": "findOne",
                        "model": "drive_room",
                        "where": [{ "field": "id", "value": notes }]
                    }),
                )
                .await;
            room["mode"].as_str() == Some("multiuser")
        })
        .await;
    let remote = cluster.connect(1, &notes, "ravi").await;
    let update = {
        let maya = editors[0].state.lock().expect("client");
        insert_rich(&maya.doc)
    };
    editors[0].send_update(&update, "paragraph", "rich");
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let sam = editors[1].state.lock().expect("client");
        let remote_doc = remote.state.lock().expect("client");
        let sam_rich = rich_snapshot(&sam.doc);
        let remote_rich = rich_snapshot(&remote_doc.doc);
        drop(sam);
        drop(remote_doc);
        let ready = |text: &str| {
            text.contains("Keep")
                && text.contains("bold")
                && text.contains("table level=1")
                && text.contains("tableCell")
                && text.contains("Beds")
                && text.contains("image alt=North beds")
                && text.contains("src=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
        };
        if ready(&sam_rich) && remote_rich == sam_rich {
            break;
        }
        if Instant::now() >= deadline {
            panic!("the other node showed {remote_rich:?} and the first node showed {sam_rich:?}");
        }
        sleep(Duration::from_millis(100)).await;
    }
    drop(editors);
    cluster.assert_alive();
}

fn insert_rich(doc: &Doc) -> Vec<u8> {
    let fragment = doc.get_or_insert_xml_fragment("prosemirror");
    let before = doc.transact().state_vector();
    let mut txn = doc.transact_mut();
    let paragraph = fragment.push_back(&mut txn, XmlElementPrelim::empty("paragraph"));
    let text = paragraph.push_back(&mut txn, XmlTextPrelim::new("Keep"));
    let mut bold = Attrs::new();
    bold.insert(Arc::from("bold"), Any::Map(Arc::new(HashMap::new())));
    text.format(&mut txn, 0, 4, bold);
    let table = fragment.push_back(&mut txn, XmlElementPrelim::empty("table"));
    table.insert_attribute(&mut txn, "level", "1");
    let row = table.push_back(&mut txn, XmlElementPrelim::empty("tableRow"));
    let cell = row.push_back(&mut txn, XmlElementPrelim::empty("tableCell"));
    cell.push_back(&mut txn, XmlTextPrelim::new("Beds"));
    let image = fragment.push_back(&mut txn, XmlElementPrelim::empty("image"));
    image.insert_attribute(&mut txn, "alt", "North beds");
    image.insert_attribute(
        &mut txn,
        "src",
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    );
    drop(txn);
    doc.transact().encode_state_as_update_v1(&before)
}

fn rich_snapshot(doc: &Doc) -> String {
    let txn = doc.transact();
    let Some(fragment) = txn.get_xml_fragment("prosemirror") else {
        return String::new();
    };
    let mut out = String::new();
    for child in fragment.children(&txn) {
        let XmlOut::Element(element) = child else {
            continue;
        };
        out.push_str(element.tag().as_ref());
        let mut attrs: Vec<_> = element
            .attributes(&txn)
            .map(|(key, value)| format!("{key}={value}"))
            .collect();
        attrs.sort();
        for attr in attrs {
            out.push(' ');
            out.push_str(&attr);
        }
        out.push('\n');
        write_xml_children(&txn, &element, &mut out);
    }
    out
}

fn write_xml_children(txn: &impl ReadTxn, element: &impl XmlFragment, out: &mut String) {
    for grandchild in element.children(txn) {
        match grandchild {
            XmlOut::Text(text) => {
                out.push_str(&text.get_string(txn));
                for chunk in text.diff(txn, |_| ()) {
                    let Some(attributes) = chunk.attributes else {
                        continue;
                    };
                    let mut names: Vec<_> = attributes
                        .iter()
                        .map(|(name, _)| name.as_ref().to_owned())
                        .collect();
                    names.sort();
                    for name in names {
                        out.push(' ');
                        out.push_str(&name);
                    }
                }
                out.push('\n');
            }
            XmlOut::Element(child) => {
                out.push_str(child.tag().as_ref());
                out.push('\n');
                write_xml_children(txn, &child, out);
            }
            XmlOut::Fragment(_) => {}
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_restart_keeps_an_edit_that_was_written_to_the_log() {
    let mut cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    different_paragraphs_converge(&editors).await;
    cluster
        .wait_until("the edit is stored before the node stops", || async {
            let updates = cluster
                .db(
                    0,
                    json!({
                        "op": "findMany",
                        "model": "drive_room_update",
                        "where": [{ "field": "itemId", "value": notes }]
                    }),
                )
                .await;
            updates.as_array().is_some_and(|rows| !rows.is_empty())
        })
        .await;
    cluster.restart(0);
    drop(editors);
    let again = cluster.connect(0, &notes, "maya").await;
    let expected = vec!["Tomatoes are in".to_owned(), "Beans are staked".to_owned()];
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if again.paragraphs() == expected {
            break;
        }
        if Instant::now() >= deadline {
            panic!(
                "after restart the room showed {:?}, mode {}",
                again.paragraphs(),
                again.mode()
            );
        }
        sleep(Duration::from_millis(100)).await;
    }
    cluster.assert_alive();
}

#[tokio::test(flavor = "multi_thread")]
async fn a_dropped_connection_and_a_duplicate_edit_keep_the_saved_text() {
    let mut cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let mut editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    different_paragraphs_converge(&editors).await;
    drop(editors.remove(0));
    let bytes = editors[0].edit_paragraph(1, "Beans are picked");
    editors[0].send_update(&bytes, "paragraph", "1");
    let expected = vec!["Tomatoes are in".to_owned(), "Beans are picked".to_owned()];
    let returned = cluster.connect(0, &notes, "maya").await;
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if editors[0].paragraphs() == expected && returned.paragraphs() == expected {
            break;
        }
        if Instant::now() >= deadline {
            panic!(
                "after the dropped connection Sam showed {:?} and Maya showed {:?}",
                editors[0].paragraphs(),
                returned.paragraphs()
            );
        }
        sleep(Duration::from_millis(100)).await;
    }
    cluster
        .db(
            0,
            json!({
                "op": "update",
                "model": "session",
                "where": [{ "field": "id", "value": "maya-session" }],
                "update": { "expiresAt": "2000-01-01T00:00:00.000Z" }
            }),
        )
        .await;
    assert!(
        connection_is_refused(&cluster, &notes, "maya").await,
        "an expired session opened the room"
    );
    assert_eq!(editors[0].paragraphs(), expected);
    drop(returned);
    drop(editors);
    cluster.assert_alive();
}

async fn connection_is_refused(cluster: &Cluster, item: &str, person_id: &str) -> bool {
    let person = cluster.person(person_id);
    let url = format!(
        "{}/api/drive/items/{item}/session?access_token={}",
        cluster.nodes[0].http.replacen("http", "ws", 1),
        person.token
    );
    match timeout(Duration::from_secs(5), connect_async(&url)).await {
        Ok(Ok(_)) => false,
        _ => true,
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn an_expired_session_cannot_change_the_open_room() {
    let mut cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    different_paragraphs_converge(&editors).await;
    let expected = vec!["Tomatoes are in".to_owned(), "Beans are staked".to_owned()];
    cluster
        .db(
            0,
            json!({
                "op": "update",
                "model": "session",
                "where": [{ "field": "id", "value": "maya-session" }],
                "update": { "expiresAt": "2000-01-01T00:00:00.000Z" }
            }),
        )
        .await;
    let inner = editors[0].state.lock().expect("client");
    let update = replace_paragraph(&inner.doc, 0, "Tomatoes are gone");
    drop(inner);
    let _ = editors[0].try_send_update(&update, "paragraph", "0");
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let sam = editors[1].paragraphs();
        if sam != expected {
            panic!("an expired session changed the room to {sam:?}");
        }
        if editors[0].closed() {
            break;
        }
        if Instant::now() >= deadline {
            panic!("the expired session stayed connected");
        }
        sleep(Duration::from_millis(50)).await;
    }
    assert_eq!(editors[1].paragraphs(), expected);
    drop(editors);
    cluster.assert_alive();
}

#[tokio::test(flavor = "multi_thread")]
async fn removing_access_closes_the_open_room_and_keeps_the_saved_text() {
    let mut cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    different_paragraphs_converge(&editors).await;
    let expected = vec!["Tomatoes are in".to_owned(), "Beans are staked".to_owned()];
    let maya = Person {
        id: "maya".into(),
        name: "Maya".into(),
        token: cluster.person("maya").token.clone(),
    };
    let removed = cluster
        .request(
            0,
            &maya,
            reqwest::Method::PUT,
            &format!("/api/drive/items/{notes}/acl"),
            Some(
                serde_json::to_vec(&json!({
                    "principalType": "user",
                    "principalId": "sam",
                    "role": null
                }))
                .unwrap(),
            ),
            None,
        )
        .await;
    assert!(
        removed.status().is_success(),
        "removing access failed: {}",
        removed.status()
    );
    let inner = editors[1].state.lock().expect("client");
    let update = replace_paragraph(&inner.doc, 0, "Tomatoes are gone");
    drop(inner);
    let _ = editors[1].try_send_update(&update, "paragraph", "0");
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let maya_text = editors[0].paragraphs();
        if maya_text != expected {
            panic!("a removed editor changed the room to {maya_text:?}");
        }
        if editors[1].closed() {
            break;
        }
        if Instant::now() >= deadline {
            panic!("the removed editor stayed connected");
        }
        sleep(Duration::from_millis(50)).await;
    }
    let sam = Person {
        id: "sam".into(),
        name: "Sam".into(),
        token: cluster.person("sam").token.clone(),
    };
    let read = cluster
        .request(
            0,
            &sam,
            reqwest::Method::GET,
            &format!("/api/drive/items/{notes}/content"),
            None,
            None,
        )
        .await;
    assert!(
        !read.status().is_success(),
        "a removed editor could still read the file"
    );
    assert_eq!(editors[0].paragraphs(), expected);
    drop(editors);
    cluster.assert_alive();
}

#[tokio::test(flavor = "multi_thread")]
async fn simultaneous_joins_see_the_saved_edit() {
    let mut cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    different_paragraphs_converge(&editors).await;
    let expected = vec!["Tomatoes are in".to_owned(), "Beans are staked".to_owned()];
    cluster
        .wait_until("the saved edit is on the other node", || async {
            let room = cluster
                .db(
                    1,
                    json!({
                        "op": "findOne",
                        "model": "drive_room",
                        "where": [{ "field": "id", "value": notes }]
                    }),
                )
                .await;
            let updates = cluster
                .db(
                    1,
                    json!({
                        "op": "findMany",
                        "model": "drive_room_update",
                        "where": [{ "field": "itemId", "value": notes }]
                    }),
                )
                .await;
            room["mode"].as_str() == Some("multiuser")
                && updates.as_array().is_some_and(|rows| !rows.is_empty())
        })
        .await;
    let (ravi, noor) = tokio::join!(
        cluster.connect(1, &notes, "ravi"),
        cluster.connect(1, &notes, "noor"),
    );
    assert_eq!(ravi.paragraphs(), expected);
    assert_eq!(noor.paragraphs(), expected);
    assert_eq!(editors[0].paragraphs(), expected);
    assert_eq!(editors[1].paragraphs(), expected);
    drop(ravi);
    drop(noor);
    drop(editors);
    cluster.assert_alive();
}

#[tokio::test(flavor = "multi_thread")]
async fn joins_before_the_log_arrives_still_see_the_edit() {
    let mut cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let (ravi, noor) = tokio::join!(
        cluster.connect(1, &notes, "ravi"),
        cluster.connect(1, &notes, "noor"),
    );
    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    different_paragraphs_converge(&editors).await;
    let expected = vec!["Tomatoes are in".to_owned(), "Beans are staked".to_owned()];
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        if ravi.paragraphs() == expected && noor.paragraphs() == expected {
            break;
        }
        if Instant::now() >= deadline {
            panic!(
                "opened before the log: Ravi showed {:?} and Noor showed {:?}",
                ravi.paragraphs(),
                noor.paragraphs()
            );
        }
        sleep(Duration::from_millis(100)).await;
    }
    assert_eq!(editors[0].paragraphs(), expected);
    assert_eq!(editors[1].paragraphs(), expected);
    drop(ravi);
    drop(noor);
    drop(editors);
    cluster.assert_alive();
}

#[tokio::test(flavor = "multi_thread")]
async fn undoing_one_paragraph_keeps_the_other_persons_text() {
    let mut cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    let mut maya_undo = editors[0].track_own_paragraphs();
    editors[0].append_own_paragraph("Tomatoes are in");
    wait_paragraphs(&editors, &["Tomatoes are in"]).await;
    editors[1].append_paragraph("Beans are staked");
    wait_paragraphs(&editors, &["Tomatoes are in", "Beans are staked"]).await;
    editors[0].undo_own_paragraph(&mut maya_undo);
    wait_paragraphs(&editors, &["Beans are staked"]).await;
    drop(editors);
    cluster.assert_alive();
}

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

#[tokio::test]
async fn a_content_range_upload_finishes_over_http() {
    let dir = tempfile::tempdir().unwrap();
    init(dir.path(), None);
    let node = start(dir.path(), None);
    let http = reqwest::Client::new();
    for (model, data) in [
        (
            "user",
            json!({
                "id": "ada",
                "name": "Ada",
                "email": "ada@gardenclub.org",
                "role": "user",
                "emailVerified": 1,
                "createdAt": AT,
                "updatedAt": AT
            }),
        ),
        (
            "session",
            json!({
                "id": "ada-session",
                "token": "ada-token",
                "userId": "ada",
                "expiresAt": "2099-01-01T00:00:00.000Z",
                "createdAt": AT,
                "updatedAt": AT
            }),
        ),
    ] {
        let response = http
            .post(format!("{}/internal/db", node.internal))
            .header("x-suiteleaf-internal", TOKEN)
            .json(&json!({ "op": "create", "model": model, "data": data }))
            .send()
            .await
            .unwrap();
        assert!(response.status().is_success(), "{model}");
    }
    let created = http
        .post(format!("{}/api/drive/items", node.http))
        .header("authorization", "Bearer ada-token")
        .json(&json!({
            "name": "Notes.sldoc",
            "kind": "file",
            "mime": "text/plain"
        }))
        .send()
        .await
        .unwrap();
    assert!(created.status().is_success(), "{}", created.status());
    let item = created.json::<Value>().await.unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let path = format!("{}/api/drive/items/{item}/content", node.http);
    let first = http
        .put(&path)
        .header("authorization", "Bearer ada-token")
        .header("content-type", "text/plain")
        .header("content-range", "bytes 0-3/10")
        .body("Beds")
        .send()
        .await
        .unwrap();
    assert_eq!(first.status(), reqwest::StatusCode::ACCEPTED);
    let first_body = first.text().await.unwrap();
    assert!(first_body.contains("\"accepted\":4"), "{first_body}");
    assert!(!first_body.contains("Beds"), "{first_body}");
    let gap = http
        .put(&path)
        .header("authorization", "Bearer ada-token")
        .header("content-type", "text/plain")
        .header("content-range", "bytes 6-9/10")
        .body("secret-value")
        .send()
        .await
        .unwrap();
    assert_eq!(gap.status(), reqwest::StatusCode::BAD_REQUEST);
    let gap_body = gap.text().await.unwrap();
    assert!(
        gap_body.contains("That upload does not continue the saved part."),
        "{gap_body}"
    );
    assert!(!gap_body.contains("secret-value"), "{gap_body}");
    let done = http
        .put(&path)
        .header("authorization", "Bearer ada-token")
        .header("content-type", "text/plain")
        .header("content-range", "bytes 4-9/10")
        .body(" north")
        .send()
        .await
        .unwrap();
    assert!(done.status().is_success(), "{}", done.status());
    let read = http
        .get(&path)
        .header("authorization", "Bearer ada-token")
        .send()
        .await
        .unwrap();
    assert!(read.status().is_success());
    assert_eq!(read.text().await.unwrap(), "Beds north");
    let blank = http
        .post(format!("{}/api/drive/items", node.http))
        .header("authorization", "Bearer ada-token")
        .json(&json!({
            "name": "Blank.sldoc",
            "kind": "file",
            "mime": "text/plain"
        }))
        .send()
        .await
        .unwrap();
    assert!(blank.status().is_success(), "{}", blank.status());
    let blank_id = blank.json::<Value>().await.unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let blank_path = format!("{}/api/drive/items/{blank_id}/content", node.http);
    let empty = http
        .put(&blank_path)
        .header("authorization", "Bearer ada-token")
        .header("content-type", "text/plain")
        .header("content-range", "bytes 0-0/0")
        .body("")
        .send()
        .await
        .unwrap();
    assert!(empty.status().is_success(), "{}", empty.status());
    let empty_body = empty.text().await.unwrap();
    assert!(!empty_body.contains("secret-value"), "{empty_body}");
    let empty_read = http
        .get(&blank_path)
        .header("authorization", "Bearer ada-token")
        .send()
        .await
        .unwrap();
    assert!(empty_read.status().is_success());
    assert_eq!(empty_read.text().await.unwrap(), "");
}

#[tokio::test]
async fn a_due_backup_seals_the_live_file_over_http() {
    let dir = tempfile::tempdir().unwrap();
    init(dir.path(), None);
    let key_path = dir.path().join("backup.key");
    std::fs::write(&key_path, [7u8; 32]).unwrap();
    let sealed = dir.path().join("sealed").join("backup.seal");
    let copy = dir.path().join("away").join("backup.seal");
    let fresh = dir.path().join("fresh");
    std::fs::create_dir_all(sealed.parent().unwrap()).unwrap();
    std::fs::create_dir_all(copy.parent().unwrap()).unwrap();
    let node = start_env(
        dir.path(),
        None,
        None,
        &[
            ("SUITELEAF_BACKUP_EVERY_HOURS", "24"),
            ("SUITELEAF_BACKUP_KEY_FILE", key_path.to_str().unwrap()),
            ("SUITELEAF_BACKUP_SEALED", sealed.to_str().unwrap()),
            ("SUITELEAF_BACKUP_COPY", copy.to_str().unwrap()),
            ("SUITELEAF_BACKUP_DIR", fresh.to_str().unwrap()),
        ],
    );
    let http = reqwest::Client::new();
    for (model, data) in [
        (
            "user",
            json!({
                "id": "ada",
                "name": "Ada",
                "email": "ada@gardenclub.org",
                "role": "admin",
                "emailVerified": 1,
                "createdAt": AT,
                "updatedAt": AT
            }),
        ),
        (
            "session",
            json!({
                "id": "ada-session",
                "token": "ada-token",
                "userId": "ada",
                "expiresAt": "2099-01-01T00:00:00.000Z",
                "createdAt": AT,
                "updatedAt": AT
            }),
        ),
    ] {
        let response = http
            .post(format!("{}/internal/db", node.internal))
            .header("x-suiteleaf-internal", TOKEN)
            .json(&json!({ "op": "create", "model": model, "data": data }))
            .send()
            .await
            .unwrap();
        assert!(response.status().is_success(), "{model}");
    }
    let created = http
        .post(format!("{}/api/drive/items", node.http))
        .header("authorization", "Bearer ada-token")
        .json(&json!({
            "name": "Notes.sldoc",
            "kind": "file",
            "mime": "text/plain"
        }))
        .send()
        .await
        .unwrap();
    assert!(created.status().is_success(), "{}", created.status());
    let item = created.json::<Value>().await.unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let wrote = http
        .put(format!("{}/api/drive/items/{item}/content", node.http))
        .header("authorization", "Bearer ada-token")
        .header("content-type", "text/plain")
        .body("keep this")
        .send()
        .await
        .unwrap();
    assert!(wrote.status().is_success(), "{}", wrote.status());
    let ran = http
        .post(format!("{}/api/admin/backup", node.http))
        .header("authorization", "Bearer ada-token")
        .send()
        .await
        .unwrap();
    assert!(ran.status().is_success(), "{}", ran.status());
    let body = ran.text().await.unwrap();
    assert!(body.contains("\"wrote\":true"), "{body}");
    assert!(body.contains("No backup has been recorded."), "{body}");
    assert!(!body.contains("secret-value"), "{body}");
    assert!(!body.contains("keep this"), "{body}");
    let again = http
        .post(format!("{}/api/admin/backup", node.http))
        .header("authorization", "Bearer ada-token")
        .send()
        .await
        .unwrap();
    let again_body = again.text().await.unwrap();
    assert!(again_body.contains("\"wrote\":false"), "{again_body}");
    assert!(
        again_body.contains("The last backup is still inside the schedule."),
        "{again_body}"
    );
    assert!(!again_body.contains("secret-value"), "{again_body}");
    let opened = dir.path().join("opened");
    let manifest = suitedrive::seal::open_sealed(&copy, &[7u8; 32], &opened).unwrap();
    assert!(!manifest.recorded_at.is_empty());
    assert_eq!(
        suitedrive::blobs::BlobStore::open(&opened.join("blobs"))
            .unwrap()
            .get_content(&manifest.contents[0].parse().unwrap())
            .unwrap()
            .unwrap(),
        b"keep this"
    );
}
