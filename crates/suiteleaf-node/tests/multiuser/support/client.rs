//! A live WebSocket client with its own Yjs document.

use std::{
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
use tokio_tungstenite::tungstenite::Message;
use yrs::{Array, Doc, ReadTxn, TextPrelim, Transact, undo::UndoManager};

use super::yjs::{
    decode_b64, integrate, paragraph_strings, put_map, read_map, replace_paragraph, root_text,
    seed_paragraphs, transact_update,
};
use super::{AT, ClientInner, Cluster, LiveClient};

pub(super) fn spawn_readers(
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
    pub(super) async fn spawn(
        name: String,
        socket: tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        heartbeat: bool,
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
            error: None,
            renewed: 0,
            updates: 0,
            generation: 0,
            reject_reason: None,
            reply: None,
            seed_requested: false,
            caret: None,
            sheet: None,
            slide: None,
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
                    if let Some(sheet_id) = value.get("sheetId").and_then(|v| v.as_str()) {
                        let start_row = value.get("startRow").and_then(|v| v.as_u64());
                        let start_column = value.get("startColumn").and_then(|v| v.as_u64());
                        let end_row = value.get("endRow").and_then(|v| v.as_u64());
                        let end_column = value.get("endColumn").and_then(|v| v.as_u64());
                        if let (
                            Some(start_row),
                            Some(start_column),
                            Some(end_row),
                            Some(end_column),
                        ) = (start_row, start_column, end_row, end_column)
                        {
                            inner.sheet = Some((
                                name.to_owned(),
                                sheet_id.to_owned(),
                                start_row,
                                start_column,
                                end_row,
                                end_column,
                            ));
                        }
                    } else if let Some(slide_id) = value.get("slideId").and_then(|v| v.as_str()) {
                        let element = value
                            .get("elementId")
                            .and_then(|v| v.as_str())
                            .map(str::to_owned);
                        inner.slide = Some((name.to_owned(), slide_id.to_owned(), element));
                    } else {
                        let anchor = value.get("anchor").and_then(|v| v.as_u64());
                        let head = value.get("head").and_then(|v| v.as_u64());
                        if let (Some(anchor), Some(head)) = (anchor, head) {
                            inner.caret = Some((name.to_owned(), anchor, head));
                        }
                    }
                    continue;
                }
                if kind == "ack" || kind == "reject" {
                    inner.reject_reason = value
                        .get("reason")
                        .and_then(|v| v.as_str())
                        .map(str::to_owned);
                    if let Some(id) = value.get("id").and_then(|v| v.as_str()) {
                        inner.reply = Some((kind.to_owned(), id.to_owned()));
                    }
                    continue;
                }
                if kind == "error" {
                    inner.error = value
                        .get("reason")
                        .and_then(|v| v.as_str())
                        .map(str::to_owned);
                    continue;
                }
                if kind == "renewed" {
                    inner.renewed += 1;
                    continue;
                }
                if kind == "update" {
                    inner.updates += 1;
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
                inner.seed_requested = value
                    .get("seed")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                inner.generation = value
                    .get("generation")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(-1);
                inner.joins += 1;
            }
            reader_state.lock().expect("client").closed = true;
        });
        let heartbeat_tx = tx.clone();
        let heartbeat = tokio::spawn(async move {
            if !heartbeat {
                // A quiet client sends nothing on its own, like an idle viewer.
                std::future::pending::<()>().await;
            }
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

    pub(crate) fn error(&self) -> Option<String> {
        self.state.lock().expect("client").error.clone()
    }

    pub(crate) fn generation(&self) -> i64 {
        self.state.lock().expect("client").generation
    }

    pub(crate) fn reject_reason(&self) -> Option<String> {
        self.state.lock().expect("client").reject_reason.clone()
    }

    pub(crate) fn seed_requested(&self) -> bool {
        self.state.lock().expect("client").seed_requested
    }

    pub(crate) fn renewed(&self) -> u64 {
        self.state.lock().expect("client").renewed
    }

    pub(crate) fn updates(&self) -> u64 {
        self.state.lock().expect("client").updates
    }

    pub(crate) fn closed(&self) -> bool {
        self.state.lock().expect("client").closed
    }

    pub(crate) fn send(&self, message: &Value) {
        self.outgoing
            .send(message.to_string())
            .unwrap_or_else(|_| panic!("{} socket closed", self.name));
    }

    pub(crate) fn try_send_update(&self, bytes: &[u8], unit: &str, key: &str) -> bool {
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

    pub(crate) fn send_update(&self, bytes: &[u8], unit: &str, key: &str) {
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

    pub(crate) fn paragraphs(&self) -> Vec<String> {
        let inner = self.state.lock().expect("client");
        let failed = inner.failed.clone();
        let texts = paragraph_strings(&inner.doc);
        drop(inner);
        if let Some(err) = failed {
            panic!("{}: {err}", self.name);
        }
        texts
    }

    pub(crate) fn root(&self, name: &str) -> String {
        let inner = self.state.lock().expect("client");
        let text = root_text(&inner.doc, name);
        let failed = inner.failed.clone();
        drop(inner);
        if let Some(err) = failed {
            panic!("{}: {err}", self.name);
        }
        text
    }

    pub(crate) fn mode(&self) -> String {
        self.state.lock().expect("client").mode.clone()
    }

    pub(crate) fn caret(&self) -> Option<(String, u64, u64)> {
        self.state.lock().expect("client").caret.clone()
    }

    pub(crate) fn sheet_selection(&self) -> Option<(String, String, u64, u64, u64, u64)> {
        self.state.lock().expect("client").sheet.clone()
    }

    pub(crate) fn slide_selection(&self) -> Option<(String, String, Option<String>)> {
        self.state.lock().expect("client").slide.clone()
    }

    pub(crate) fn reply(&self) -> Option<(String, String)> {
        self.state.lock().expect("client").reply.clone()
    }

    pub(crate) fn accepted(&self) -> bool {
        self.state.lock().expect("client").accepted
    }

    pub(crate) fn joins(&self) -> u64 {
        self.state.lock().expect("client").joins
    }

    pub(crate) async fn wait_joins(&self, count: u64) {
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

    pub(crate) fn seed(&self, texts: &[&str]) -> Vec<u8> {
        let inner = self.state.lock().expect("client");
        let update = seed_paragraphs(&inner.doc, texts);
        drop(inner);
        self.send_update(&update, "paragraph", "0");
        update
    }

    pub(crate) fn edit_paragraph(&self, index: u32, text: &str) -> Vec<u8> {
        let inner = self.state.lock().expect("client");
        let update = replace_paragraph(&inner.doc, index, text);
        drop(inner);
        self.send_update(&update, "paragraph", &index.to_string());
        update
    }

    pub(crate) fn set_entry(&self, map: &str, key: &str, value: &str, unit: &str) -> Vec<u8> {
        let inner = self.state.lock().expect("client");
        let update = put_map(&inner.doc, map, key, value);
        drop(inner);
        self.send_update(&update, unit, key);
        update
    }

    pub(crate) fn entry(&self, map: &str, key: &str) -> Option<String> {
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
    pub(crate) fn track_own_paragraphs(&self) -> UndoManager<()> {
        let inner = self.state.lock().expect("client");
        let paragraphs = inner.doc.get_or_insert_array("paragraphs");
        let options = yrs::undo::Options {
            capture_timeout_millis: 0,
            ..Default::default()
        };
        let mut undo = UndoManager::with_scope_and_options(&inner.doc, &paragraphs, options);
        undo.include_origin(inner.doc.client_id());
        undo
    }

    pub(crate) fn append_own_paragraph(&self, text: &str) {
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

    pub(crate) fn undo_own_paragraph(&self, undo: &mut UndoManager<()>) {
        let inner = self.state.lock().expect("client");
        let before = inner.doc.transact().state_vector();
        let undone = undo.undo_blocking();
        assert!(undone, "{} had no paragraph of its own to undo", self.name);
        let update = inner.doc.transact().encode_state_as_update_v1(&before);
        drop(inner);
        self.send_update(&update, "paragraph", "undo");
    }

    pub(crate) fn append_paragraph(&self, text: &str) {
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

pub(crate) async fn wait_multi(clients: &[LiveClient]) {
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

pub(crate) async fn wait_paragraphs(clients: &[LiveClient], expected: &[&str]) {
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

pub(crate) async fn different_paragraphs_converge(clients: &[LiveClient]) {
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

pub(crate) async fn wait_entries(clients: &[LiveClient], map: &str, expected: &[(&str, &str)]) {
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
