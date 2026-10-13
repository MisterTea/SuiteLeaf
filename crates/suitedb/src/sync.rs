//! The `/suiteleaf/suitedb/sync/1` protocol.
//!
//! A node catches up from a peer by paging through the peer's op-log from a
//! saved per-peer cursor. Gossip delivers new ops in real time; the cursor
//! pull fills gaps after downtime or partitions.

use std::future::Future;

use serde::{Deserialize, Serialize};

use crate::{Db, IngestReport, OpId, SyncBatch, op::cbor};

/// Topic on which nodes gossip newly created ops.
pub const OPS_TOPIC: &str = "suiteleaf/suitedb/ops/1";
/// Target size of one sync page.
pub const BATCH_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize)]
pub enum SyncRequest {
    Since { epoch: Option<String>, cursor: u64 },
    Heads,
}

#[derive(Debug, Serialize, Deserialize)]
pub enum SyncResponse {
    Batch(SyncBatch),
    Heads(Vec<OpId>),
    Error(String),
}

pub(crate) mod byte_vecs {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};
    use serde_bytes::ByteBuf;

    pub fn serialize<S: Serializer>(v: &[Vec<u8>], s: S) -> Result<S::Ok, S::Error> {
        v.iter()
            .map(|b| serde_bytes::Bytes::new(b))
            .collect::<Vec<_>>()
            .serialize(s)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<Vec<u8>>, D::Error> {
        Ok(Vec::<ByteBuf>::deserialize(d)?
            .into_iter()
            .map(ByteBuf::into_vec)
            .collect())
    }
}

impl Db {
    /// Answer a peer's sync request.
    pub fn handle_sync(&self, request: &[u8]) -> Vec<u8> {
        let response = match ciborium::from_reader::<SyncRequest, _>(request) {
            Ok(SyncRequest::Since { epoch, cursor }) => self
                .ops_since(epoch.as_deref(), cursor, BATCH_BYTES)
                .map_or_else(|e| SyncResponse::Error(e.to_string()), SyncResponse::Batch),
            Ok(SyncRequest::Heads) => self
                .heads()
                .map_or_else(|e| SyncResponse::Error(e.to_string()), SyncResponse::Heads),
            Err(e) => SyncResponse::Error(format!("bad sync request: {e}")),
        };
        cbor(&response)
    }

    /// Pull every op `peer` has that this node has not paged through yet.
    pub async fn pull_from<F, Fut>(
        &self,
        peer: &str,
        mut request: F,
    ) -> anyhow::Result<IngestReport>
    where
        F: FnMut(Vec<u8>) -> Fut,
        Fut: Future<Output = anyhow::Result<Vec<u8>>>,
    {
        let mut total = IngestReport::default();
        loop {
            let (epoch, cursor) = self.cursor(peer)?;
            let reply = request(cbor(&SyncRequest::Since { epoch, cursor })).await?;
            let batch = match ciborium::from_reader::<SyncResponse, _>(reply.as_slice())? {
                SyncResponse::Batch(b) => b,
                SyncResponse::Error(e) => anyhow::bail!("peer {peer}: {e}"),
                SyncResponse::Heads(_) => anyhow::bail!("peer {peer} sent an unexpected reply"),
            };
            let report = self.ingest_many(batch.ops.iter().map(Vec::as_slice))?;
            total.applied += report.applied;
            total.duplicate += report.duplicate;
            total.pending = report.pending;
            total.rejected += report.rejected;
            self.set_cursor(peer, &batch.epoch, batch.next)?;
            if !batch.more {
                return Ok(total);
            }
        }
    }
}
