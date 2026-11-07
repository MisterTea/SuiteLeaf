//! The Node sidecar owns Vercel SDK credentials. Only loopback authenticated RPC
//! crosses this boundary; hashes and content verification stay in SuiteDrive.
use super::{BlobStore, Hash};
use anyhow::{Result, bail};
use reqwest::{
    StatusCode,
    blocking::{Client, Response},
};
use std::{path::PathBuf, time::Duration};

fn blocking<T: Send>(f: impl FnOnce() -> T + Send) -> T {
    match tokio::runtime::Handle::try_current() {
        Ok(handle) if handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread => {
            tokio::task::block_in_place(f)
        }
        Ok(_) => std::thread::scope(|scope| scope.spawn(f).join().expect("storage worker")),
        Err(_) => f(),
    }
}

pub(super) struct RemoteBlobs {
    client: Client,
    base: String,
    token: String,
}
impl BlobStore {
    pub fn open_remote(base: &str, token: &str) -> Result<Self> {
        let url = reqwest::Url::parse(base)?;
        if url.scheme() != "http"
            || url.host_str() != Some("127.0.0.1")
            || !url.username().is_empty()
            || url.password().is_some()
        {
            bail!("The Blob SDK bridge must use an authenticated loopback URL.");
        }
        if token.len() < 32 {
            bail!("The Blob bridge requires a private authentication token.");
        }
        Ok(Self {
            root: PathBuf::new(),
            remote: Some(RemoteBlobs {
                client: Client::builder()
                    .timeout(Duration::from_secs(90))
                    .redirect(reqwest::redirect::Policy::none())
                    .build()?,
                base: base.trim_end_matches('/').into(),
                token: token.into(),
            }),
        })
    }
}
impl RemoteBlobs {
    fn request(
        &self,
        method: reqwest::Method,
        path: &str,
        bytes: Option<&[u8]>,
    ) -> Result<Response> {
        if tokio::runtime::Handle::try_current().is_ok() {
            return blocking(|| self.request_native(method, path, bytes));
        }
        self.request_native(method, path, bytes)
    }
    fn request_native(
        &self,
        method: reqwest::Method,
        path: &str,
        bytes: Option<&[u8]>,
    ) -> Result<Response> {
        let mut last_err = anyhow::anyhow!("Document storage is unavailable.");
        for attempt in 0..4 {
            if attempt > 0 {
                std::thread::sleep(Duration::from_millis(1000 * (1 << (attempt - 1))));
            }
            let mut request = self
                .client
                .request(
                    method.clone(),
                    format!("{}/internal/cloud/blobs/{path}", self.base),
                )
                .bearer_auth(&self.token);
            if let Some(bytes) = bytes {
                request = request.body(bytes.to_vec());
            }
            match request.send() {
                Ok(response) => {
                    if response.status() == StatusCode::NOT_FOUND || response.status().is_success()
                    {
                        return Ok(response);
                    }
                    if (response.status().is_server_error()
                        || response.status() == StatusCode::TOO_MANY_REQUESTS)
                        && attempt < 3
                    {
                        continue;
                    }
                    bail!("Document storage operation failed ({}).", response.status());
                }
                Err(e) => {
                    last_err = e.into();
                }
            }
        }
        Err(last_err)
    }
    pub(super) fn get(&self, hash: &Hash) -> Result<Option<Vec<u8>>> {
        blocking(|| self.get_native(hash))
    }
    fn get_native(&self, hash: &Hash) -> Result<Option<Vec<u8>>> {
        let response = self.request(reqwest::Method::GET, &hash.to_string(), None)?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        let bytes = response.bytes()?.to_vec();
        if Hash::of(&bytes) != *hash {
            bail!("Document storage failed content verification.")
        }
        Ok(Some(bytes))
    }
    pub(super) fn has(&self, hash: &Hash) -> Result<bool> {
        Ok(self
            .request(reqwest::Method::HEAD, &hash.to_string(), None)?
            .status()
            != StatusCode::NOT_FOUND)
    }
    pub(super) fn put(&self, hash: &Hash, bytes: &[u8]) -> Result<()> {
        self.request(reqwest::Method::PUT, &hash.to_string(), Some(bytes))?;
        Ok(())
    }
    pub(super) fn remove(&self, hash: &Hash) -> Result<()> {
        self.request(reqwest::Method::DELETE, &hash.to_string(), None)?;
        Ok(())
    }
    pub(super) fn stored_bytes(&self) -> Result<u64> {
        blocking(|| {
            Ok(self
                .request(reqwest::Method::GET, "usage", None)?
                .json::<u64>()?)
        })
    }
}
