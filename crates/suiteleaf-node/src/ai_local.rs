//! The local model runner. Started the first time a client asks for the
//! assistant and this node has no `ai.upstream`.

use std::{process::Stdio, sync::Arc, time::Duration};

use anyhow::{Context, Result, bail};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
    sync::{Mutex, watch},
};

use crate::config::Config;

#[derive(Clone)]
pub struct LocalAi {
    url: watch::Sender<Option<String>>,
    rx: watch::Receiver<Option<String>>,
    gate: Arc<Mutex<()>>,
}

impl LocalAi {
    pub fn new() -> Self {
        let (url, rx) = watch::channel(None);
        Self {
            url,
            rx,
            gate: Arc::new(Mutex::new(())),
        }
    }

    /// The runner's base URL, starting it if this is the first request.
    pub async fn ensure(&self, config: &Config) -> Result<String> {
        if let Some(url) = self.rx.borrow().clone() {
            return Ok(url);
        }
        let _lock = self.gate.lock().await;
        if let Some(url) = self.rx.borrow().clone() {
            return Ok(url);
        }
        let (program, args) = config
            .ai
            .command
            .split_first()
            .context("ai.command is empty")?;
        let mut child = Command::new(program)
            .args(args)
            .env("SUITELEAF_MODELS_DIR", config.data_dir.join("models"))
            .env("SUITELEAF_AI_PORT", "0")
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .with_context(|| {
                format!(
                    "Could not start the model runner ({program} {}). Build it with npm run build -w @suiteleaf/ai.",
                    args.join(" ")
                )
            })?;
        let stdout = child.stdout.take().context("model runner stdout")?;
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        let url_tx = self.url.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            let mut ready_tx = Some(ready_tx);
            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(port) = line.strip_prefix("SUITELEAF_AI_READY ") {
                    let url = format!("http://127.0.0.1:{}", port.trim());
                    let _ = url_tx.send(Some(url.clone()));
                    if let Some(tx) = ready_tx.take() {
                        let _ = tx.send(url);
                    }
                } else {
                    tracing::info!(target: "ai", "{line}");
                }
            }
        });
        let url_tx = self.url.clone();
        tokio::spawn(async move {
            let status = child.wait().await;
            tracing::warn!("model runner exited ({status:?})");
            let _ = url_tx.send(None);
        });
        match tokio::time::timeout(Duration::from_secs(30), ready_rx).await {
            Ok(Ok(url)) => Ok(url),
            Ok(Err(_)) => bail!("The model runner stopped before it was ready."),
            Err(_) => bail!("The model runner did not start."),
        }
    }
}
