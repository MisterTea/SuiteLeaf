//! Three real nodes on localhost: writes made on any node reach the others
//! through gossip, and a node that was offline catches up when it returns.
// Children are moved into `Node`, whose `Drop` kills and waits for them.
#![allow(clippy::zombie_processes)]

use std::{
    io::{BufRead, BufReader},
    path::Path,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

use serde_json::{Value, json};

const TOKEN: &str = "cluster-test-token";

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

fn start(dir: &Path, listen: &str, bootstrap: Option<&str>) -> Node {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_suiteleaf-node"));
    cmd.args([
        "run",
        "--no-auth",
        "--http",
        "127.0.0.1:0",
        "--listen",
        listen,
        "--sync-interval",
        "1",
    ])
    .arg("--data-dir")
    .arg(dir)
    .env("SUITELEAF_INTERNAL_TOKEN", TOKEN)
    .env("RUST_LOG", "warn")
    .stdout(Stdio::piped());
    if let Some(addr) = bootstrap {
        cmd.args(["--bootstrap", addr]);
    }
    let mut child = cmd.spawn().expect("start suiteleaf-node");
    let stdout = child.stdout.take().unwrap();
    let mut line = String::new();
    let mut reader = BufReader::new(stdout);
    loop {
        line.clear();
        assert!(
            reader.read_line(&mut line).unwrap() > 0,
            "node exited before it was ready"
        );
        if let Some(ready) = line.strip_prefix("SUITELEAF_NODE_READY ") {
            let ready: Value = serde_json::from_str(ready).unwrap();
            return Node {
                child,
                http: ready["http"].as_str().unwrap().into(),
                internal: ready["internal"].as_str().unwrap().into(),
                p2p: ready["p2p"][0].as_str().unwrap().into(),
            };
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
    assert!(cmd.status().unwrap().success());
}

async fn db(client: &reqwest::Client, node: &Node, body: Value) -> Value {
    let response = client
        .post(format!("{}/internal/db", node.internal))
        .header("x-suiteleaf-internal", TOKEN)
        .json(&body)
        .send()
        .await
        .unwrap();
    assert!(
        response.status().is_success(),
        "{}",
        response.text().await.unwrap()
    );
    response.json::<Value>().await.unwrap()["result"].clone()
}

async fn eventually(what: &str, mut check: impl AsyncFnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
        if check().await {
            return;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    panic!("timed out waiting for {what}");
}

async fn user_name(client: &reqwest::Client, node: &Node, id: &str) -> Option<String> {
    let row = db(
        client,
        node,
        json!({ "op": "findOne", "model": "user", "where": [{ "field": "id", "value": id }] }),
    )
    .await;
    row["name"].as_str().map(str::to_owned)
}

#[tokio::test(flavor = "multi_thread")]
async fn writes_reach_every_node_and_offline_nodes_catch_up() {
    let dirs: Vec<_> = (0..3).map(|_| tempfile::tempdir().unwrap()).collect();
    init(dirs[0].path(), None);
    let key = dirs[0].path().join("swarm.key");
    init(dirs[1].path(), Some(&key));
    init(dirs[2].path(), Some(&key));

    const ANY: &str = "/ip4/127.0.0.1/tcp/0";
    let a = start(dirs[0].path(), ANY, None);
    let mut b = Some(start(dirs[1].path(), ANY, Some(&a.p2p)));
    let c = start(dirs[2].path(), ANY, Some(&b.as_ref().unwrap().p2p));
    let client = reqwest::Client::new();

    db(&client, &c, json!({ "op": "create", "model": "user", "data": { "id": "u1", "name": "From C", "email": "c@example.com" } })).await;
    eventually("C's write on A", async || {
        user_name(&client, &a, "u1").await.as_deref() == Some("From C")
    })
    .await;

    let b_addr = b.as_ref().unwrap().p2p.clone();
    drop(b.take());
    // B restarts on the same port so C's bootstrap address still reaches it.
    db(&client, &a, json!({ "op": "update", "model": "user", "where": [{ "field": "id", "value": "u1" }], "update": { "name": "Renamed on A" } })).await;
    db(&client, &a, json!({ "op": "create", "model": "user", "data": { "id": "u2", "name": "While B was away" } })).await;

    let port = b_addr.split('/').nth(4).unwrap();
    let b = start(
        dirs[1].path(),
        &format!("/ip4/127.0.0.1/tcp/{port}"),
        Some(&a.p2p),
    );
    eventually("B catching up", async || {
        user_name(&client, &b, "u1").await.as_deref() == Some("Renamed on A")
            && user_name(&client, &b, "u2").await.is_some()
    })
    .await;
    eventually("C converging", async || {
        user_name(&client, &c, "u2").await.is_some()
    })
    .await;

    let heads = |node: &Node| {
        let client = client.clone();
        let url = format!("{}/api/node/info", node.http);
        async move {
            client
                .get(url)
                .send()
                .await
                .unwrap()
                .json::<Value>()
                .await
                .unwrap()["suitedb"]["heads"]
                .clone()
        }
    };
    eventually("identical heads", async || {
        let (ha, hb, hc) = (heads(&a).await, heads(&b).await, heads(&c).await);
        ha == hb && hb == hc
    })
    .await;
}
