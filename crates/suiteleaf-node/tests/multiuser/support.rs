//! The test cluster: nodes, signed-in people, and live clients.

use std::{
    io::{BufRead, BufReader, Read},
    path::Path,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
};

use serde_json::Value;
use tokio::{sync::mpsc, task::JoinHandle};
use yrs::Doc;

mod client;
mod cluster;
mod saves;
mod yjs;

pub(crate) use client::{different_paragraphs_converge, wait_entries, wait_multi, wait_paragraphs};
pub(crate) use yjs::{
    contains, document, envelope, integrate, map_update, paragraph_strings, put_map, read_map,
    replace_paragraph, root_update, seed_paragraphs,
};

pub(crate) const TOKEN: &str = "multiuser-test-token";
const ANY: &str = "/ip4/127.0.0.1/tcp/0";
pub(crate) const AT: &str = "2026-10-30T18:00:00.000Z";

pub(crate) struct Node {
    child: Child,
    pub(crate) http: String,
    pub(crate) internal: String,
    p2p: String,
}

impl Drop for Node {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub(crate) struct Person {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) token: String,
}

pub(crate) struct Cluster {
    _dirs: Vec<tempfile::TempDir>,
    pub(crate) nodes: Vec<Node>,
    pub(crate) http: reqwest::Client,
    people: Vec<Person>,
}

pub(crate) struct ClientInner {
    pub(crate) doc: Doc,
    pub(crate) mode: String,
    pub(crate) accepted: bool,
    pub(crate) joins: u64,
    failed: Option<String>,
    pub(crate) closed: bool,
    pub(crate) reply: Option<(String, String)>,
    pub(crate) caret: Option<(String, u64, u64)>,
    sheet: Option<(String, String, u64, u64, u64, u64)>,
    slide: Option<(String, String, Option<String>)>,
}

pub(crate) struct LiveClient {
    pub(crate) name: String,
    pub(crate) state: Arc<Mutex<ClientInner>>,
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

pub(crate) fn init(dir: &Path, swarm_key: Option<&Path>) {
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

pub(crate) fn start(dir: &Path, bootstrap: Option<&str>) -> Node {
    start_in(dir, bootstrap, None)
}

fn start_in(dir: &Path, bootstrap: Option<&str>, emergency: Option<&str>) -> Node {
    start_env(dir, bootstrap, emergency, &[])
}

pub(crate) fn start_env(
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
