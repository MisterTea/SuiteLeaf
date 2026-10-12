use std::{
    fmt, fs,
    io::Write,
    path::{Path, PathBuf},
    str::FromStr,
};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

/// Content is split into chunks of this size before hashing.
pub const CHUNK_SIZE: usize = 1024 * 1024;

#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Hash(#[serde(with = "serde_bytes")] pub [u8; 32]);

impl Hash {
    pub fn of(bytes: &[u8]) -> Hash {
        Hash(*blake3::hash(bytes).as_bytes())
    }
}

impl fmt::Display for Hash {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&hex::encode(self.0))
    }
}

impl fmt::Debug for Hash {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Hash({})", &hex::encode(self.0)[..12])
    }
}

impl FromStr for Hash {
    type Err = anyhow::Error;
    fn from_str(s: &str) -> Result<Hash> {
        let bytes = hex::decode(s)?;
        Ok(Hash(
            bytes
                .try_into()
                .map_err(|_| anyhow::anyhow!("hash must be 32 bytes"))?,
        ))
    }
}

/// Lists the chunks of one piece of content. The manifest is itself stored
/// as a blob, and its hash is the content hash recorded in SuiteDB.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Manifest {
    pub size: u64,
    pub chunks: Vec<Hash>,
}

impl Manifest {
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::new();
        ciborium::into_writer(self, &mut out).expect("CBOR encoding into a Vec cannot fail");
        out
    }

    pub fn decode(bytes: &[u8]) -> Result<Manifest> {
        Ok(ciborium::from_reader(bytes)?)
    }
}

/// Content-addressed files under `root/ab/cdef…`. Writes go to a temporary
/// file that is renamed into place, so a blob is either complete or absent.
pub struct BlobStore {
    root: PathBuf,
}

impl BlobStore {
    pub fn open(root: &Path) -> Result<BlobStore> {
        fs::create_dir_all(root).with_context(|| format!("create {}", root.display()))?;
        Ok(BlobStore {
            root: root.to_owned(),
        })
    }

    fn path(&self, hash: &Hash) -> PathBuf {
        let hex = hash.to_string();
        self.root.join(&hex[..2]).join(&hex[2..])
    }

    pub fn has(&self, hash: &Hash) -> bool {
        self.path(hash).exists()
    }

    pub fn get(&self, hash: &Hash) -> Result<Option<Vec<u8>>> {
        match fs::read(self.path(hash)) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn put(&self, bytes: &[u8]) -> Result<Hash> {
        let hash = Hash::of(bytes);
        self.write(&hash, bytes)?;
        Ok(hash)
    }

    /// Store a blob received from a peer after checking its hash.
    pub fn put_verified(&self, hash: &Hash, bytes: &[u8]) -> Result<()> {
        if Hash::of(bytes) != *hash {
            bail!("blob {hash} failed verification");
        }
        self.write(hash, bytes)
    }

    fn write(&self, hash: &Hash, bytes: &[u8]) -> Result<()> {
        let path = self.path(hash);
        if path.exists() {
            return Ok(());
        }
        let dir = path.parent().expect("blob paths have a parent");
        fs::create_dir_all(dir)?;
        let temp = dir.join(format!(
            ".{}.{}.tmp",
            &hash.to_string()[2..],
            uuid::Uuid::new_v4()
        ));
        let result = (|| -> Result<()> {
            let mut file = fs::File::create(&temp)?;
            file.write_all(bytes)?;
            file.sync_all()?;
            fs::rename(&temp, &path)?;
            Ok(())
        })();
        let _ = fs::remove_file(&temp);
        result
    }

    /// Chunk and store content, returning the manifest hash.
    pub fn put_content(&self, bytes: &[u8]) -> Result<Hash> {
        let chunks = bytes
            .chunks(CHUNK_SIZE)
            .map(|c| self.put(c))
            .collect::<Result<Vec<_>>>()?;
        self.put(
            &Manifest {
                size: bytes.len() as u64,
                chunks,
            }
            .encode(),
        )
    }

    /// The full content, or `None` if any part has not replicated here yet.
    pub fn get_content(&self, content: &Hash) -> Result<Option<Vec<u8>>> {
        let Some(manifest) = self.get(content)? else {
            return Ok(None);
        };
        let manifest = Manifest::decode(&manifest)?;
        let mut out = Vec::with_capacity(manifest.size as usize);
        for chunk in &manifest.chunks {
            match self.get(chunk)? {
                Some(bytes) => out.extend_from_slice(&bytes),
                None => return Ok(None),
            }
        }
        Ok(Some(out))
    }

    /// Blobs still needed to assemble `content` locally. Chunks are unknown
    /// until the manifest arrives, so a missing manifest is reported alone.
    pub fn missing(&self, content: &Hash) -> Result<Vec<Hash>> {
        let Some(manifest) = self.get(content)? else {
            return Ok(vec![*content]);
        };
        Ok(Manifest::decode(&manifest)?
            .chunks
            .into_iter()
            .filter(|c| !self.has(c))
            .collect())
    }
}
