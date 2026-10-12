use std::{collections::BTreeMap, fmt};

use libp2p_identity::{PeerId, PublicKey, ed25519};
use serde::{Deserialize, Serialize};

use crate::{Error, Result, hlc::Hlc};

#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct OpId(#[serde(with = "serde_bytes")] pub [u8; 32]);

impl fmt::Display for OpId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&hex::encode(self.0))
    }
}

impl fmt::Debug for OpId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "OpId({})", &hex::encode(self.0)[..12])
    }
}

/// A SQLite storage value.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Value {
    Null,
    Integer(i64),
    Real(f64),
    Text(String),
    Blob(#[serde(with = "serde_bytes")] Vec<u8>),
}

impl From<&str> for Value {
    fn from(v: &str) -> Self {
        Value::Text(v.to_owned())
    }
}
impl From<String> for Value {
    fn from(v: String) -> Self {
        Value::Text(v)
    }
}
impl From<i64> for Value {
    fn from(v: i64) -> Self {
        Value::Integer(v)
    }
}
impl From<f64> for Value {
    fn from(v: f64) -> Self {
        Value::Real(v)
    }
}
impl From<bool> for Value {
    fn from(v: bool) -> Self {
        Value::Integer(v as i64)
    }
}
impl<T: Into<Value>> From<Option<T>> for Value {
    fn from(v: Option<T>) -> Self {
        v.map_or(Value::Null, Into::into)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum ChangeKind {
    Upsert(BTreeMap<String, Value>),
    Delete,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Change {
    pub table: String,
    pub pk: String,
    pub kind: ChangeKind,
}

/// The signed part of an op.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct OpBody {
    /// The author's DAG heads when the op was created.
    pub parents: Vec<OpId>,
    pub hlc: Hlc,
    pub schema: u32,
    /// Raw Ed25519 public key of the authoring node.
    #[serde(with = "serde_bytes")]
    pub author: [u8; 32],
    pub changes: Vec<Change>,
}

/// An immutable, signed batch of row changes. Ops form a hash-linked DAG
/// through `parents`; the op ID is the BLAKE3 hash of the encoded body.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Op {
    pub body: OpBody,
    #[serde(with = "serde_bytes")]
    pub sig: Vec<u8>,
}

pub(crate) fn cbor<T: Serialize>(value: &T) -> Vec<u8> {
    let mut out = Vec::new();
    ciborium::into_writer(value, &mut out).expect("CBOR encoding into a Vec cannot fail");
    out
}

impl Op {
    pub fn sign(body: OpBody, key: &ed25519::Keypair) -> Op {
        let sig = key.sign(&cbor(&body));
        Op { body, sig }
    }

    pub fn id(&self) -> OpId {
        OpId(*blake3::hash(&cbor(&self.body)).as_bytes())
    }

    pub fn encode(&self) -> Vec<u8> {
        cbor(self)
    }

    pub fn decode(bytes: &[u8]) -> Result<Op> {
        ciborium::from_reader(bytes).map_err(|e| Error::Invalid(format!("undecodable op: {e}")))
    }

    pub fn author_key(&self) -> Result<ed25519::PublicKey> {
        ed25519::PublicKey::try_from_bytes(&self.body.author)
            .map_err(|_| Error::Invalid("malformed author key".into()))
    }

    pub fn author_peer(&self) -> Result<PeerId> {
        Ok(PublicKey::from(self.author_key()?).to_peer_id())
    }

    pub fn verify(&self) -> Result<()> {
        if self.author_key()?.verify(&cbor(&self.body), &self.sig) {
            Ok(())
        } else {
            Err(Error::Invalid(format!("bad signature on op {}", self.id())))
        }
    }
}

/// The HLC component that identifies a node.
pub fn node_tag(key: &ed25519::PublicKey) -> u64 {
    let hash = blake3::hash(&key.to_bytes());
    u64::from_be_bytes(hash.as_bytes()[..8].try_into().unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(key: &ed25519::Keypair) -> OpBody {
        OpBody {
            parents: vec![],
            hlc: Hlc {
                wall: 1,
                counter: 0,
                node: node_tag(&key.public()),
            },
            schema: 1,
            author: key.public().to_bytes(),
            changes: vec![Change {
                table: "t".into(),
                pk: "a".into(),
                kind: ChangeKind::Upsert(BTreeMap::from([("x".into(), Value::Real(1.5))])),
            }],
        }
    }

    #[test]
    fn signed_ops_round_trip_with_a_stable_id() {
        let key = ed25519::Keypair::generate();
        let op = Op::sign(body(&key), &key);
        op.verify().unwrap();
        let decoded = Op::decode(&op.encode()).unwrap();
        assert_eq!(decoded, op);
        assert_eq!(decoded.id(), op.id());
    }

    #[test]
    fn tampering_breaks_the_signature() {
        let key = ed25519::Keypair::generate();
        let mut op = Op::sign(body(&key), &key);
        op.body.changes[0].pk = "b".into();
        assert!(op.verify().is_err());
        let other = ed25519::Keypair::generate();
        let mut forged = Op::sign(body(&key), &key);
        forged.body.author = other.public().to_bytes();
        assert!(forged.verify().is_err());
    }
}
