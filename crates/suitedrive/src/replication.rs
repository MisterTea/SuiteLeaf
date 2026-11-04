//! Blob replication: answering peers and fetching missing blobs over `/suiteleaf/drive/blob/1`.

use std::{sync::Arc, time::Duration};

use serde::{Deserialize, Serialize};
use serde_bytes::ByteBuf;

use crate::{Drive, DriveResult, Hash, row::text};

const MAX_BLOB_RESPONSE: usize = 24 * 1024 * 1024;

/// Requests and responses of the blob protocol.
#[derive(Debug, Serialize, Deserialize)]
pub struct BlobRequest {
    pub hashes: Vec<Hash>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct BlobResponse {
    pub blobs: Vec<(Hash, Option<ByteBuf>)>,
}

/// How a node reaches its peers for blob replication.
#[async_trait::async_trait]
pub trait BlobTransport: Send + Sync {
    async fn peers(&self) -> Vec<String>;
    async fn request(&self, peer: &str, data: Vec<u8>) -> anyhow::Result<Vec<u8>>;
}

impl Drive {
    /// Content hashes named by file versions. A hash that cannot be read is left out.
    pub fn archived_contents(&self) -> DriveResult<Vec<Hash>> {
        let mut hashes = Vec::new();
        for row in self
            .db
            .query("SELECT DISTINCT contentHash FROM drive_version", &[])?
        {
            let Some(value) = text(&row, "contentHash") else {
                continue;
            };
            if let Ok(hash) = value.parse::<Hash>() {
                hashes.push(hash);
            }
        }
        hashes.sort();
        hashes.dedup();
        Ok(hashes)
    }

    pub(crate) fn want(&self, hash: Hash) {
        if self
            .blobs
            .missing(&hash)
            .map(|m| !m.is_empty())
            .unwrap_or(true)
        {
            self.wanted.lock().unwrap().insert(hash);
            self.notify.notify_one();
        }
    }

    /// Content hashes still waiting for blobs from peers.
    pub fn wanted(&self) -> Vec<Hash> {
        self.wanted.lock().unwrap().iter().copied().collect()
    }

    /// Answer a peer's blob request with as many requested blobs as fit.
    pub fn handle_blob_request(&self, data: &[u8]) -> Vec<u8> {
        let mut response = BlobResponse::default();
        if let Ok(request) = ciborium::from_reader::<BlobRequest, _>(data) {
            let mut size = 0;
            for hash in request.hashes.into_iter().take(256) {
                let blob = self.blobs.get(&hash).ok().flatten();
                let len = blob.as_ref().map_or(0, Vec::len);
                if size > 0 && size + len > MAX_BLOB_RESPONSE {
                    break;
                }
                size += len;
                response.blobs.push((hash, blob.map(ByteBuf::from)));
            }
        }
        let mut out = Vec::new();
        ciborium::into_writer(&response, &mut out).expect("CBOR encoding into a Vec cannot fail");
        out
    }

    /// Fetch every missing blob of `content` from peers. Returns whether the
    /// content is complete locally.
    pub async fn fetch(
        &self,
        content: Hash,
        transport: &dyn BlobTransport,
    ) -> anyhow::Result<bool> {
        loop {
            let missing = self.blobs.missing(&content)?;
            if missing.is_empty() {
                self.wanted.lock().unwrap().remove(&content);
                return Ok(true);
            }
            let mut progress = false;
            for peer in transport.peers().await {
                for batch in missing.chunks(16) {
                    let mut request = Vec::new();
                    ciborium::into_writer(
                        &BlobRequest {
                            hashes: batch.to_vec(),
                        },
                        &mut request,
                    )?;
                    let reply = match transport.request(&peer, request).await {
                        Ok(r) => r,
                        Err(e) => {
                            tracing::debug!("blob request to {peer}: {e:#}");
                            break;
                        }
                    };
                    let response: BlobResponse = ciborium::from_reader(reply.as_slice())?;
                    for (hash, bytes) in response.blobs {
                        if let Some(bytes) = bytes
                            && batch.contains(&hash)
                            && self.blobs.put_verified(&hash, &bytes).is_ok()
                        {
                            progress = true;
                        }
                    }
                }
                if progress {
                    break;
                }
            }
            if !progress {
                return Ok(false);
            }
        }
    }

    /// Fetch wanted content whenever new versions arrive, and retry
    /// periodically for content no connected peer had yet.
    pub async fn replicate(self: Arc<Self>, transport: Arc<dyn BlobTransport>, retry: Duration) {
        loop {
            tokio::select! {
                _ = self.notify.notified() => {}
                _ = tokio::time::sleep(retry) => {}
            }
            for hash in self.wanted() {
                match self.fetch(hash, transport.as_ref()).await {
                    Ok(true) => tracing::info!("replicated content {hash}"),
                    Ok(false) => {}
                    Err(e) => tracing::warn!("replicating {hash}: {e:#}"),
                }
            }
        }
    }
}
