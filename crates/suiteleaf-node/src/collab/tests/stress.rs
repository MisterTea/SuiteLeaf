//! Stress tests for per-resource locking in a fake cloud environment: a
//! throwaway Postgres (SUITELEAF_TEST_POSTGRES_URL), several in-process
//! "instances" (each its own Db pools + Rooms, like Fluid instances), and a
//! local-filesystem blob store in place of Vercel Blob.
//!
//! Run: scripts/stress/run-rust-stress.sh  (or
//! SUITELEAF_TEST_POSTGRES_URL=... cargo test -p suiteleaf-node --bin suiteleaf-node -- --ignored --nocapture --test-threads=1 stress)
use super::postgres::{body, insert, instance, person, pg_db, share};
use crate::collab::*;
use std::sync::Mutex as StdMutex;
use std::time::{Duration, Instant};
use suitedb::LockScope;
use yrs::GetString;

pub(crate) struct Stats(pub Vec<Duration>);
impl Stats {
    pub(crate) fn pct(&self, p: f64) -> Duration {
        let mut v = self.0.clone();
        v.sort();
        if v.is_empty() {
            return Duration::ZERO;
        }
        v[((v.len() as f64 - 1.0) * p).round() as usize]
    }
    pub(crate) fn line(&self, label: &str, wall: Duration) -> String {
        format!(
            "{label}: n={} wall={:.2}s throughput={:.0}/s p50={:.1}ms p99={:.1}ms max={:.1}ms",
            self.0.len(),
            wall.as_secs_f64(),
            self.0.len() as f64 / wall.as_secs_f64(),
            self.pct(0.5).as_secs_f64() * 1e3,
            self.pct(0.99).as_secs_f64() * 1e3,
            self.pct(1.0).as_secs_f64() * 1e3,
        )
    }
}

fn try_push(rooms: &Rooms, item: &str, user: &str, bytes: &[u8]) -> anyhow::Result<bool> {
    rooms.apply_update(LiveUpdate {
        item,
        user_id: user,
        name: user,
        role: Role::Editor,
        bytes,
        unit: "paragraph",
        key: "body",
        at: "2026-11-26T16:00:00.000Z",
    })
}

/// `instances` × `threads` writers editing `rooms` rooms; each writer keeps
/// its own Yjs client per room and appends unique tokens. When `global` is
/// set every edit additionally takes one fleet-wide exclusive lock, which
/// reproduces the old `cloud-mutations` serialization for comparison.
fn room_storm(
    rooms: usize,
    instances: usize,
    threads: usize,
    edits: usize,
    global: bool,
    kick: bool,
) -> (Stats, Duration, Stats) {
    let dir = tempfile::tempdir().unwrap();
    let blobs = dir.path().join("blobs");
    let tag = uuid::Uuid::now_v7().simple().to_string();
    let items: Vec<String> = (0..rooms).map(|n| format!("stress-{tag}-{n}")).collect();
    let fleet: Vec<Rooms> = (0..instances).map(|_| instance(&blobs)).collect();
    for item in &items {
        let refs: Vec<&Rooms> = fleet.iter().collect();
        share(&refs, item);
    }
    let latencies = StdMutex::new(Vec::new());
    let kicks = StdMutex::new(Vec::new());
    let errors = StdMutex::new(Vec::<String>::new());
    let done = std::sync::atomic::AtomicBool::new(false);
    let global_key = format!("stress-global-{tag}");
    let started = Instant::now();
    std::thread::scope(|s| {
        let mut writers = Vec::new();
        for (i, rooms_i) in fleet.iter().enumerate() {
            for t in 0..threads {
                let (items, latencies, errors, global_key) =
                    (&items, &latencies, &errors, &global_key);
                writers.push(s.spawn(move || {
                    let who = format!("p{i}");
                    let docs: Vec<Doc> = items.iter().map(|_| Doc::new()).collect();
                    let mut mine = Vec::with_capacity(edits);
                    for n in 0..edits {
                        let r = (n + t * 7 + i * 13) % items.len();
                        let doc = &docs[r];
                        let len = doc
                            .get_or_insert_text("body")
                            .get_string(&doc.transact())
                            .len() as u32;
                        let update = insert(doc, len, &format!("<{i}.{t}.{n}>"));
                        let begin = Instant::now();
                        let _global = global.then(|| rooms_i.db.exclusive(global_key).unwrap());
                        match try_push(rooms_i, &items[r], &who, &update) {
                            Ok(true) => {}
                            Ok(false) => {
                                errors.lock().unwrap().push(format!("refused {i}.{t}.{n}"))
                            }
                            Err(e) => errors.lock().unwrap().push(format!("{i}.{t}.{n}: {e}")),
                        }
                        mine.push(begin.elapsed());
                    }
                    latencies.lock().unwrap().extend(mine);
                }));
            }
        }
        if kick {
            for rooms_i in &fleet {
                let (kicks, errors, done) = (&kicks, &errors, &done);
                s.spawn(move || {
                    while !done.load(std::sync::atomic::Ordering::SeqCst) {
                        let begin = Instant::now();
                        // Huge pause: nobody is idle, but every lock-taking
                        // step of the sweep still runs against live rooms.
                        if let Err(e) = rooms_i.kick(suitedb::hlc::now_ms() as i64, i64::MAX / 4) {
                            errors.lock().unwrap().push(format!("kick: {e}"));
                        }
                        kicks.lock().unwrap().push(begin.elapsed());
                        std::thread::sleep(Duration::from_millis(20));
                    }
                });
            }
        }
        for w in writers {
            w.join().unwrap();
        }
        done.store(true, std::sync::atomic::Ordering::SeqCst);
    });
    let wall = started.elapsed();
    let errors = errors.into_inner().unwrap();
    assert!(
        errors.is_empty(),
        "{} errors, first: {:?}",
        errors.len(),
        &errors[..errors.len().min(5)]
    );
    // Every instance converges to the same document and nothing is lost.
    for item in &items {
        for rooms_i in &fleet {
            rooms_i.catch_up(item).unwrap();
        }
        let first = body(&fleet[0], item);
        for rooms_i in &fleet[1..] {
            assert_eq!(body(rooms_i, item), first, "instances diverged on {item}");
        }
        let encoded: Vec<Vec<u8>> = fleet
            .iter()
            .map(|r| {
                let live = r.live.lock().unwrap();
                let room = live.get(item).unwrap();
                let txn = room.doc.transact();
                txn.encode_state_as_update_v1(&yrs::StateVector::default())
            })
            .collect();
        assert!(
            encoded.windows(2).all(|w| w[0] == w[1]),
            "state bytes differ on {item}"
        );
    }
    let all: String = items.iter().map(|item| body(&fleet[0], item)).collect();
    for i in 0..instances {
        for t in 0..threads {
            for n in 0..edits {
                let token = format!("<{i}.{t}.{n}>");
                assert_eq!(all.matches(&token).count(), 1, "lost or duplicated {token}");
            }
        }
    }
    (
        Stats(latencies.into_inner().unwrap()),
        wall,
        Stats(kicks.into_inner().unwrap()),
    )
}

#[test]
#[ignore = "stress: requires an isolated Postgres database"]
fn stress_room_edits_converge_across_instances_on_few_and_many_rooms() {
    let mut report = Vec::new();
    for (label, rooms, global) in [
        ("few rooms (2), per-room locks", 2, false),
        ("many rooms (32), per-room locks", 32, false),
        ("many rooms (32), old global lock emulated", 32, true),
    ] {
        let (stats, wall, _) = room_storm(rooms, 4, 4, 40, global, false);
        report.push(stats.line(label, wall));
        if !global {
            assert!(
                stats.pct(1.0) < Duration::from_secs(5),
                "{label}: an edit waited too long"
            );
        }
    }
    println!("STRESS rooms\n  {}", report.join("\n  "));
}

#[test]
#[ignore = "stress: requires an isolated Postgres database"]
fn stress_maintenance_kick_runs_during_edits_without_blocking_them() {
    let (stats, wall, kicks) = room_storm(16, 3, 4, 40, false, true);
    println!(
        "STRESS kick\n  {}\n  {}",
        stats.line("edits with kick loops on every instance", wall),
        kicks.line("kick sweeps", wall)
    );
    assert!(stats.pct(0.99) < Duration::from_secs(2));
    assert!(!kicks.0.is_empty());
}

#[test]
#[ignore = "stress: requires an isolated Postgres database"]
fn stress_kick_skips_a_busy_room_and_kicks_the_rest() {
    let dir = tempfile::tempdir().unwrap();
    let rooms = instance(&dir.path().join("blobs"));
    let tag = uuid::Uuid::now_v7().simple().to_string();
    let (busy, free) = (format!("busy-{tag}"), format!("free-{tag}"));
    rooms
        .join(&busy, &person(&format!("b-{tag}")), Role::Editor, 1)
        .unwrap();
    rooms
        .join(&free, &person(&format!("f-{tag}")), Role::Editor, 1)
        .unwrap();
    let other = pg_db();
    let held = other.lock_all(&crate::cloud::item_locks(&busy)).unwrap();
    let begin = Instant::now();
    let kicked = rooms.kick(i64::MAX / 2, 1).unwrap();
    let took = begin.elapsed();
    assert!(
        took < Duration::from_secs(3),
        "kick waited on a busy room: {took:?}"
    );
    assert!(kicked.contains(&format!("f-{tag}")));
    assert!(
        !kicked.contains(&format!("b-{tag}")),
        "a busy room was kicked"
    );
    drop(held);
    let kicked = rooms.kick(i64::MAX / 2, 1).unwrap();
    assert!(
        kicked.contains(&format!("b-{tag}")),
        "the room is kicked once free"
    );
    println!(
        "STRESS kick-skip: sweep with one busy room took {:.1}ms",
        took.as_secs_f64() * 1e3
    );
}

#[test]
#[ignore = "stress: requires an isolated Postgres database"]
fn stress_a_stuck_room_holder_times_out_in_about_ten_seconds_then_recovers() {
    let dir = tempfile::tempdir().unwrap();
    let blobs = dir.path().join("blobs");
    let rooms = instance(&blobs);
    let tag = uuid::Uuid::now_v7().simple().to_string();
    let (stuck, fine) = (format!("stuck-{tag}"), format!("fine-{tag}"));
    share(&[&rooms], &stuck);
    share(&[&rooms], &fine);
    let other = pg_db();
    let held = other.lock_all(&crate::cloud::item_locks(&stuck)).unwrap();
    let begin = Instant::now();
    let doc = Doc::new();
    let error = try_push(&rooms, &stuck, "p0", &insert(&doc, 0, "x"));
    let waited = begin.elapsed();
    assert!(
        error.is_err(),
        "a stuck holder must fail the waiter, not hang it"
    );
    assert!(
        waited >= Duration::from_secs(9) && waited < Duration::from_secs(15),
        "{waited:?}"
    );
    // Other rooms were never affected.
    let begin = Instant::now();
    assert!(try_push(&rooms, &fine, "p0", &insert(&Doc::new(), 0, "y")).unwrap());
    assert!(begin.elapsed() < Duration::from_secs(2));
    drop(held);
    // The refused edit was not stored; the client resends its state.
    let resend = doc
        .transact()
        .encode_state_as_update_v1(&yrs::StateVector::default());
    assert!(try_push(&rooms, &stuck, "p0", &resend).unwrap());
    assert_eq!(body(&rooms, &stuck), "x");
    println!(
        "STRESS lock-timeout (room): waiter failed after {:.2}s, then recovered",
        waited.as_secs_f64()
    );
}

/// The real request-lock middleware in front of stand-in handlers that hold
/// their locks for `work` (as a slow save would), on a loopback server.
async fn serve(db: Arc<Db>, work: Duration, global: bool) -> String {
    use axum::{Router, routing::any};
    let slow = move || async move {
        tokio::time::sleep(work).await;
        "ok"
    };
    let router = Router::new()
        .route("/api/auth/{*rest}", any(|| async { "ok" }))
        .route("/api/drive/items", any(slow))
        .route("/api/drive/items/{id}/{*rest}", any(slow))
        .route("/api/admin/{*rest}", any(slow));
    let router = if global {
        let key = format!("stress-global-{}", uuid::Uuid::now_v7());
        router.layer(axum::middleware::from_fn(
            move |req: axum::extract::Request, next: axum::middleware::Next| {
                let (db, key) = (db.clone(), key.clone());
                async move {
                    let auth = req.uri().path().starts_with("/api/auth/");
                    let lock = if auth {
                        None
                    } else {
                        db.lock_all(&[LockScope::exclusive(key)]).unwrap()
                    };
                    let response = next.run(req).await;
                    drop(lock);
                    response
                }
            },
        ))
    } else {
        router.layer(axum::middleware::from_fn_with_state(
            db,
            crate::cloud::lock_mutation,
        ))
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    base
}

async fn timed(client: &reqwest::Client, method: reqwest::Method, url: String) -> (u16, Duration) {
    let begin = Instant::now();
    let status = client
        .request(method, url)
        .send()
        .await
        .map(|r| r.status().as_u16())
        .unwrap_or(0);
    (status, begin.elapsed())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 16)]
#[ignore = "stress: requires an isolated Postgres database"]
async fn stress_requests_lock_only_their_resource_and_sign_in_stays_fast() {
    let mut report = Vec::new();
    for global in [false, true] {
        // Two "instances" behind one load generator.
        let bases = [
            serve(pg_db(), Duration::from_millis(30), global).await,
            serve(pg_db(), Duration::from_millis(30), global).await,
        ];
        let client = reqwest::Client::new();
        let tag = uuid::Uuid::now_v7().simple().to_string();
        let begin = Instant::now();
        let mut writers = Vec::new();
        for w in 0..24usize {
            let (client, base, tag) = (client.clone(), bases[w % 2].clone(), tag.clone());
            writers.push(tokio::spawn(async move {
                let mut out = Vec::new();
                for n in 0..15usize {
                    // Mostly item saves on 12 items; every 10th op a tree change.
                    let (method, path) = if (w + n) % 10 == 0 {
                        (reqwest::Method::POST, "/api/drive/items".to_owned())
                    } else {
                        (
                            reqwest::Method::PUT,
                            format!("/api/drive/items/{tag}-{}/content", (w + n) % 12),
                        )
                    };
                    out.push(timed(&client, method, format!("{base}{path}")).await);
                }
                out
            }));
        }
        let signer = {
            let (client, bases) = (client.clone(), bases.clone());
            tokio::spawn(async move {
                let mut out = Vec::new();
                for n in 0..60 {
                    let url = format!("{}/api/auth/sign-in/email", bases[n % 2]);
                    out.push(timed(&client, reqwest::Method::POST, url).await);
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
                out
            })
        };
        let mut writes = Vec::new();
        for w in writers {
            writes.extend(w.await.unwrap());
        }
        let wall = begin.elapsed();
        let signins = signer.await.unwrap();
        let bad: Vec<_> = writes
            .iter()
            .chain(&signins)
            .filter(|(s, _)| *s != 200)
            .collect();
        assert!(
            bad.is_empty(),
            "non-200 responses: {:?}",
            &bad[..bad.len().min(5)]
        );
        let writes = Stats(writes.into_iter().map(|(_, d)| d).collect());
        let signins = Stats(signins.into_iter().map(|(_, d)| d).collect());
        let mode = if global {
            "old global lock emulated"
        } else {
            "per-resource locks"
        };
        report.push(writes.line(&format!("writes, {mode}"), wall));
        report.push(signins.line(&format!("sign-in during writes, {mode}"), wall));
        assert!(
            signins.pct(0.99) < Duration::from_millis(500),
            "sign-in slowed under write load"
        );
    }
    println!("STRESS http\n  {}", report.join("\n  "));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
#[ignore = "stress: requires an isolated Postgres database"]
async fn stress_a_stuck_request_lock_gives_503_after_ten_seconds_then_recovers() {
    let db = pg_db();
    let base = serve(db, Duration::from_millis(5), false).await;
    let client = reqwest::Client::new();
    let tag = uuid::Uuid::now_v7().simple().to_string();
    let item = format!("stuck-{tag}");
    let holder = pg_db();
    let held =
        tokio::task::block_in_place(|| holder.lock_all(&crate::cloud::item_locks(&item)).unwrap());
    let stuck_url = format!("{base}/api/drive/items/{item}/content");
    let (stuck, fine) = tokio::join!(
        timed(&client, reqwest::Method::PUT, stuck_url.clone()),
        timed(
            &client,
            reqwest::Method::PUT,
            format!("{base}/api/drive/items/other-{tag}/content")
        ),
    );
    assert_eq!(stuck.0, 503);
    assert!(
        stuck.1 >= Duration::from_secs(9) && stuck.1 < Duration::from_secs(15),
        "{:?}",
        stuck.1
    );
    assert_eq!(fine.0, 200);
    assert!(fine.1 < Duration::from_secs(2));
    // A drive-wide change also gives up instead of hanging behind it.
    let tree = timed(
        &client,
        reqwest::Method::POST,
        format!("{base}/api/drive/items"),
    )
    .await;
    assert_eq!(tree.0, 503);
    drop(held);
    let after = timed(&client, reqwest::Method::PUT, stuck_url).await;
    assert_eq!(after.0, 200);
    let tree = timed(
        &client,
        reqwest::Method::POST,
        format!("{base}/api/drive/items"),
    )
    .await;
    assert_eq!(tree.0, 200);
    println!(
        "STRESS lock-timeout (http): stuck item 503 after {:.2}s, other item 200 in {:.0}ms, recovered 200 in {:.0}ms",
        stuck.1.as_secs_f64(),
        fine.1.as_secs_f64() * 1e3,
        after.1.as_secs_f64() * 1e3
    );
}

#[test]
#[ignore = "stress: requires an isolated Postgres database"]
fn stress_bursts_of_sign_ups_have_exactly_one_winner() {
    use crate::cloud::{claim_registration_with, token_hash};
    use axum::http::HeaderMap;
    let db = pg_db();
    let users = db.query("SELECT id FROM user", &[]).unwrap();
    db.transact(|tx| {
        for row in &users {
            if let Some(DbValue::Text(id)) = row.get("id") {
                tx.delete("user", id)?;
            }
        }
        Ok(())
    })
    .unwrap();
    let burst = |token: &str, email: &str, bootstrap: Option<&str>| -> (usize, Duration) {
        let barrier = std::sync::Barrier::new(16);
        let wins = std::sync::atomic::AtomicUsize::new(0);
        let begin = Instant::now();
        std::thread::scope(|s| {
            for n in 0..16 {
                let (barrier, wins) = (&barrier, &wins);
                s.spawn(move || {
                    let db = pg_db();
                    let mut headers = HeaderMap::new();
                    headers.insert("x-suiteleaf-invite", token.parse().unwrap());
                    let body = serde_json::json!({ "email": email }).to_string();
                    barrier.wait();
                    if let Some(claim) =
                        claim_registration_with(&db, &headers, body.as_bytes(), bootstrap).unwrap()
                    {
                        std::thread::sleep(Duration::from_millis(50));
                        let id = format!("{email}-{n}-{}", uuid::Uuid::now_v7());
                        db.transact(|tx| {
                            tx.upsert("user", &id, [("email", DbValue::from(email))])?;
                            tx.delete("cloud_invite", &claim.digest)
                        })
                        .unwrap();
                        wins.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    }
                });
            }
        });
        (wins.into_inner(), begin.elapsed())
    };
    let bootstrap = "s".repeat(40);
    let (wins, took) = burst(
        &bootstrap,
        "first@example.com",
        Some(&token_hash(&bootstrap)),
    );
    assert_eq!(wins, 1, "16 concurrent bootstrap sign-ups");
    let mut report = vec![format!(
        "16 bootstrap sign-ups: {wins} winner in {:.2}s",
        took.as_secs_f64()
    )];
    for round in 0..5 {
        let invite = format!("{round}").repeat(48);
        let expiry = suitedb::hlc::iso_from_ms(suitedb::hlc::now_ms() + 60_000);
        db.transact(|tx| {
            tx.upsert(
                "cloud_invite",
                &token_hash(&invite),
                [
                    ("email", DbValue::from("guest@example.com")),
                    ("expiresAt", DbValue::Text(expiry)),
                ],
            )
        })
        .unwrap();
        let (wins, took) = burst(&invite, "guest@example.com", None);
        assert_eq!(
            wins, 1,
            "round {round}: 16 concurrent redemptions of one invite"
        );
        report.push(format!(
            "round {round}: 16 invite redemptions: {wins} winner in {:.2}s",
            took.as_secs_f64()
        ));
    }
    println!("STRESS accounts\n  {}", report.join("\n  "));
}
