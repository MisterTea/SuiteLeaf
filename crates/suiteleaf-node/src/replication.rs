//! Connects SuiteDB (and SuiteDrive blob requests) to the libp2p swarm.

use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
    time::Duration,
};

use suitedb::{Db, sync::OPS_TOPIC};
use suiteleaf_net::{NetEvent, NetHandle, PeerId, Protocol};
use tokio::sync::{mpsc, oneshot};

/// Answers `/suiteleaf/drive/blob/1` requests.
pub trait BlobService: Send + Sync + 'static {
    fn handle(&self, request: Vec<u8>) -> Vec<u8>;
}

#[derive(Clone)]
pub struct Replicator {
    db: Arc<Db>,
    net: NetHandle,
    syncing: Arc<Mutex<HashSet<PeerId>>>,
}

impl Replicator {
    pub fn new(db: Arc<Db>, net: NetHandle) -> Self {
        Replicator {
            db,
            net,
            syncing: Arc::default(),
        }
    }

    /// Page through `peer`'s op-log from the saved cursor. Concurrent pulls
    /// from the same peer are coalesced.
    pub async fn pull(&self, peer: PeerId) {
        if !self.syncing.lock().unwrap().insert(peer) {
            return;
        }
        let net = self.net.clone();
        let result = self
            .db
            .pull_from(&peer.to_string(), |request| {
                let net = net.clone();
                async move { net.request(peer, Protocol::DbSync, request).await }
            })
            .await;
        self.syncing.lock().unwrap().remove(&peer);
        match result {
            Ok(r) if r.applied > 0 || r.rejected > 0 => {
                tracing::info!(
                    "synced from {peer}: {} applied, {} duplicate, {} pending, {} rejected",
                    r.applied,
                    r.duplicate,
                    r.pending,
                    r.rejected
                );
            }
            Ok(_) => {}
            Err(e) => tracing::warn!("sync from {peer} failed: {e:#}"),
        }
    }

    pub async fn pull_all(&self) {
        let peers = self.net.peers().await;
        futures::future::join_all(peers.into_iter().map(|p| self.pull(p))).await;
    }

    /// Run until the swarm stops: gossip local ops, apply remote ones,
    /// answer sync and blob requests, and periodically pull from every peer.
    pub async fn run(
        self,
        mut events: mpsc::Receiver<NetEvent>,
        blobs: Option<Arc<dyn BlobService>>,
        interval: Duration,
    ) {
        let mut local_ops = self.db.subscribe();
        let gossip = self.net.clone();
        tokio::spawn(async move {
            loop {
                match local_ops.recv().await {
                    Ok(op) => {
                        if let Err(e) = gossip.publish(OPS_TOPIC, op).await {
                            tracing::debug!("gossip: {e:#}");
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::debug!("{n} local ops not gossiped; peers will pull them");
                    }
                    Err(_) => return,
                }
            }
        });
        let periodic = self.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(interval);
            loop {
                tick.tick().await;
                periodic.pull_all().await;
            }
        });
        while let Some(event) = events.recv().await {
            match event {
                NetEvent::Connected(peer) => {
                    let this = self.clone();
                    tokio::spawn(async move { this.pull(peer).await });
                }
                NetEvent::Gossip {
                    topic,
                    source,
                    data,
                } if topic == OPS_TOPIC => {
                    let db = self.db.clone();
                    let this = self.clone();
                    tokio::spawn(async move {
                        let report = tokio::task::spawn_blocking(move || db.ingest(&data)).await;
                        if let (Ok(Ok(r)), Some(peer)) = (report, source)
                            && r.pending > 0
                        {
                            this.pull(peer).await;
                        }
                    });
                }
                NetEvent::Request {
                    protocol: Protocol::DbSync,
                    data,
                    reply,
                    ..
                } => {
                    let db = self.db.clone();
                    respond(reply, move || db.handle_sync(&data));
                }
                NetEvent::Request {
                    protocol: Protocol::Blob,
                    data,
                    reply,
                    ..
                } => match &blobs {
                    Some(service) => {
                        let service = service.clone();
                        respond(reply, move || service.handle(data));
                    }
                    None => drop(reply),
                },
                _ => {}
            }
        }
    }
}

fn respond(reply: oneshot::Sender<Vec<u8>>, work: impl FnOnce() -> Vec<u8> + Send + 'static) {
    tokio::spawn(async move {
        if let Ok(bytes) = tokio::task::spawn_blocking(work).await {
            let _ = reply.send(bytes);
        }
    });
}
