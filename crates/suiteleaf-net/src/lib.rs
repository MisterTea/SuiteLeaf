//! The SuiteLeaf libp2p swarm.
//!
//! Connections use TCP inside a private network (pre-shared key), then Noise
//! and Yamux. Application crates see only byte payloads: gossip on named
//! topics and request/response on the [`Protocol`] variants.

use std::{
    collections::{HashMap, HashSet},
    hash::{DefaultHasher, Hash, Hasher},
    str::FromStr,
    time::Duration,
};

use anyhow::{Context, Result, anyhow, bail};
use futures::{FutureExt, StreamExt, future::BoxFuture, stream::FuturesUnordered};
use libp2p::{
    StreamProtocol, Swarm, Transport,
    core::upgrade::Version,
    gossipsub, identify, kad, mdns, noise, ping,
    pnet::{PnetConfig, PreSharedKey},
    request_response::{self, OutboundRequestId, ProtocolSupport, ResponseChannel},
    swarm::{NetworkBehaviour, SwarmEvent, behaviour::toggle::Toggle},
    tcp, yamux,
};
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, oneshot};

pub use libp2p::{Multiaddr, PeerId, identity};

/// Largest single request or response payload.
pub const MAX_MESSAGE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_GOSSIP_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Protocol {
    DbSync,
    Blob,
}

impl Protocol {
    pub fn name(self) -> &'static str {
        match self {
            Protocol::DbSync => "/suiteleaf/suitedb/sync/1",
            Protocol::Blob => "/suiteleaf/drive/blob/1",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Raw(#[serde(with = "serde_bytes")] Vec<u8>);

/// Read a key in the go-ipfs `swarm.key` format.
pub fn parse_swarm_key(text: &str) -> Result<PreSharedKey> {
    PreSharedKey::from_str(text).map_err(|e| anyhow!("invalid swarm key: {e}"))
}

/// A new random key in the go-ipfs `swarm.key` format.
pub fn generate_swarm_key() -> String {
    let bytes: [u8; 32] = rand_bytes();
    format!("/key/swarm/psk/1.0.0/\n/base16/\n{}\n", hex::encode(bytes))
}

fn rand_bytes<const N: usize>() -> [u8; N] {
    // An Ed25519 secret is 32 bytes of OS randomness; reuse it rather than add a dependency.
    let mut out = [0u8; N];
    for chunk in out.chunks_mut(32) {
        let secret = identity::ed25519::SecretKey::generate();
        chunk.copy_from_slice(&secret.as_ref()[..chunk.len()]);
    }
    out
}

pub struct NetConfig {
    pub keypair: identity::Keypair,
    pub swarm_key: PreSharedKey,
    pub listen: Vec<Multiaddr>,
    /// Peers to keep connected; each address must end in `/p2p/<peer id>`.
    pub bootstrap: Vec<Multiaddr>,
    /// When set, connections from any other peer are closed.
    pub allowlist: Option<HashSet<PeerId>>,
    pub mdns: bool,
    pub topics: Vec<String>,
}

#[derive(Debug)]
pub enum NetEvent {
    Gossip {
        topic: String,
        source: Option<PeerId>,
        data: Vec<u8>,
    },
    Request {
        protocol: Protocol,
        peer: PeerId,
        data: Vec<u8>,
        reply: oneshot::Sender<Vec<u8>>,
    },
    Connected(PeerId),
    Disconnected(PeerId),
    Listening(Multiaddr),
}

enum Command {
    Publish(String, Vec<u8>, oneshot::Sender<Result<()>>),
    Request(PeerId, Protocol, Vec<u8>, oneshot::Sender<Result<Vec<u8>>>),
    Peers(oneshot::Sender<Vec<PeerId>>),
    Listeners(oneshot::Sender<Vec<Multiaddr>>),
    Dial(Multiaddr, oneshot::Sender<Result<()>>),
}

/// A cheap, cloneable handle to the running swarm task.
#[derive(Clone)]
pub struct NetHandle {
    tx: mpsc::Sender<Command>,
    local: PeerId,
}

impl NetHandle {
    pub fn local_peer_id(&self) -> PeerId {
        self.local
    }

    async fn call<T>(&self, make: impl FnOnce(oneshot::Sender<T>) -> Command) -> Result<T> {
        let (tx, rx) = oneshot::channel();
        self.tx
            .send(make(tx))
            .await
            .map_err(|_| anyhow!("network stopped"))?;
        rx.await.map_err(|_| anyhow!("network stopped"))
    }

    /// Publish to a topic. Having no subscribed peers is not an error.
    pub async fn publish(&self, topic: &str, data: Vec<u8>) -> Result<()> {
        self.call(|tx| Command::Publish(topic.to_owned(), data, tx))
            .await?
    }

    pub async fn request(
        &self,
        peer: PeerId,
        protocol: Protocol,
        data: Vec<u8>,
    ) -> Result<Vec<u8>> {
        self.call(|tx| Command::Request(peer, protocol, data, tx))
            .await?
    }

    pub async fn peers(&self) -> Vec<PeerId> {
        self.call(Command::Peers).await.unwrap_or_default()
    }

    pub async fn listen_addrs(&self) -> Vec<Multiaddr> {
        self.call(Command::Listeners).await.unwrap_or_default()
    }

    pub async fn dial(&self, addr: Multiaddr) -> Result<()> {
        self.call(|tx| Command::Dial(addr, tx)).await?
    }
}

#[derive(NetworkBehaviour)]
struct Behaviour {
    identify: identify::Behaviour,
    ping: ping::Behaviour,
    kad: kad::Behaviour<kad::store::MemoryStore>,
    gossipsub: gossipsub::Behaviour,
    mdns: Toggle<mdns::tokio::Behaviour>,
    db_sync: request_response::cbor::Behaviour<Raw, Raw>,
    blob: request_response::cbor::Behaviour<Raw, Raw>,
}

fn request_behaviour(protocol: Protocol) -> request_response::cbor::Behaviour<Raw, Raw> {
    request_response::cbor::Behaviour::with_codec(
        request_response::cbor::codec::Codec::default()
            .set_request_size_maximum(MAX_MESSAGE_BYTES)
            .set_response_size_maximum(MAX_MESSAGE_BYTES),
        [(StreamProtocol::new(protocol.name()), ProtocolSupport::Full)],
        request_response::Config::default().with_request_timeout(Duration::from_secs(120)),
    )
}

fn build_swarm(config: &NetConfig) -> Result<Swarm<Behaviour>> {
    let psk = config.swarm_key;
    let mdns_enabled = config.mdns;
    let swarm = libp2p::SwarmBuilder::with_existing_identity(config.keypair.clone())
        .with_tokio()
        .with_other_transport(|key| -> Result<_, BoxError> {
            Ok(
                tcp::tokio::Transport::new(tcp::Config::default().nodelay(true))
                    .and_then(move |socket, _| PnetConfig::new(psk).handshake(socket))
                    .upgrade(Version::V1Lazy)
                    .authenticate(noise::Config::new(key)?)
                    .multiplex(yamux::Config::default())
                    .timeout(Duration::from_secs(20)),
            )
        })?
        .with_dns()?
        .with_behaviour(|key| -> Result<Behaviour, BoxError> {
            let peer_id = key.public().to_peer_id();
            let gossip_config = gossipsub::ConfigBuilder::default()
                .heartbeat_interval(Duration::from_secs(1))
                .validation_mode(gossipsub::ValidationMode::Strict)
                .max_transmit_size(MAX_GOSSIP_BYTES)
                .message_id_fn(|m: &gossipsub::Message| {
                    let mut h = DefaultHasher::new();
                    m.data.hash(&mut h);
                    m.topic.hash(&mut h);
                    gossipsub::MessageId::from(h.finish().to_be_bytes().to_vec())
                })
                .build()
                .map_err(|e| format!("gossipsub config: {e}"))?;
            let mut kad_config = kad::Config::new(StreamProtocol::new("/suiteleaf/kad/1.0.0"));
            kad_config.set_query_timeout(Duration::from_secs(30));
            let mut kad = kad::Behaviour::with_config(
                peer_id,
                kad::store::MemoryStore::new(peer_id),
                kad_config,
            );
            kad.set_mode(Some(kad::Mode::Server));
            Ok(Behaviour {
                identify: identify::Behaviour::new(identify::Config::new(
                    "/suiteleaf/1.0.0".into(),
                    key.public(),
                )),
                ping: ping::Behaviour::default(),
                kad,
                gossipsub: gossipsub::Behaviour::new(
                    gossipsub::MessageAuthenticity::Signed(key.clone()),
                    gossip_config,
                )
                .map_err(|e| format!("gossipsub: {e}"))?,
                mdns: Toggle::from(if mdns_enabled {
                    Some(mdns::tokio::Behaviour::new(
                        mdns::Config::default(),
                        peer_id,
                    )?)
                } else {
                    None
                }),
                db_sync: request_behaviour(Protocol::DbSync),
                blob: request_behaviour(Protocol::Blob),
            })
        })?
        .with_swarm_config(|c| c.with_idle_connection_timeout(Duration::from_secs(300)))
        .build();
    Ok(swarm)
}

fn peer_of(addr: &Multiaddr) -> Option<PeerId> {
    addr.iter().find_map(|p| match p {
        libp2p::multiaddr::Protocol::P2p(id) => Some(id),
        _ => None,
    })
}

type BoxError = Box<dyn std::error::Error + Send + Sync>;

type InboundReply = BoxFuture<'static, (Protocol, ResponseChannel<Raw>, Option<Vec<u8>>)>;

struct Runner {
    swarm: Swarm<Behaviour>,
    events: mpsc::Sender<NetEvent>,
    bootstrap: Vec<Multiaddr>,
    allowlist: Option<HashSet<PeerId>>,
    topics: HashMap<gossipsub::TopicHash, String>,
    outbound: HashMap<(Protocol, OutboundRequestId), oneshot::Sender<Result<Vec<u8>>>>,
    inbound: FuturesUnordered<InboundReply>,
    connected: HashSet<PeerId>,
}

/// Start the swarm on the current Tokio runtime.
pub fn start(config: NetConfig) -> Result<(NetHandle, mpsc::Receiver<NetEvent>)> {
    let mut swarm = build_swarm(&config)?;
    let mut topics = HashMap::new();
    for name in &config.topics {
        let topic = gossipsub::IdentTopic::new(name);
        swarm
            .behaviour_mut()
            .gossipsub
            .subscribe(&topic)
            .map_err(|e| anyhow!("subscribe {name}: {e}"))?;
        topics.insert(topic.hash(), name.clone());
    }
    for addr in &config.listen {
        swarm
            .listen_on(addr.clone())
            .with_context(|| format!("listen on {addr}"))?;
    }
    for addr in &config.bootstrap {
        let Some(peer) = peer_of(addr) else {
            bail!("bootstrap address {addr} must end in /p2p/<peer id>");
        };
        swarm.behaviour_mut().kad.add_address(&peer, addr.clone());
    }
    let local = *swarm.local_peer_id();
    let (cmd_tx, cmd_rx) = mpsc::channel(256);
    let (event_tx, event_rx) = mpsc::channel(1024);
    let runner = Runner {
        swarm,
        events: event_tx,
        bootstrap: config.bootstrap,
        allowlist: config.allowlist,
        topics,
        outbound: HashMap::new(),
        inbound: FuturesUnordered::new(),
        connected: HashSet::new(),
    };
    tokio::spawn(runner.run(cmd_rx));
    Ok((NetHandle { tx: cmd_tx, local }, event_rx))
}

impl Runner {
    async fn run(mut self, mut commands: mpsc::Receiver<Command>) {
        self.dial_bootstrap();
        let mut redial = tokio::time::interval(Duration::from_secs(15));
        loop {
            tokio::select! {
                event = self.swarm.select_next_some() => self.on_swarm(event).await,
                command = commands.recv() => match command {
                    Some(c) => self.on_command(c),
                    None => break,
                },
                Some((protocol, channel, reply)) = self.inbound.next(), if !self.inbound.is_empty() => {
                    if let Some(reply) = reply {
                        let behaviour = self.swarm.behaviour_mut();
                        let sent = match protocol {
                            Protocol::DbSync => behaviour.db_sync.send_response(channel, Raw(reply)),
                            Protocol::Blob => behaviour.blob.send_response(channel, Raw(reply)),
                        };
                        if sent.is_err() {
                            tracing::debug!("peer closed before the {} response", protocol.name());
                        }
                    }
                }
                _ = redial.tick() => self.dial_bootstrap(),
            }
        }
    }

    fn dial_bootstrap(&mut self) {
        for addr in self.bootstrap.clone() {
            if peer_of(&addr).is_some_and(|p| !self.connected.contains(&p))
                && let Err(e) = self.swarm.dial(addr.clone())
            {
                tracing::debug!("dial {addr}: {e}");
            }
        }
        if !self.connected.is_empty() {
            let _ = self.swarm.behaviour_mut().kad.bootstrap();
        }
    }

    fn on_command(&mut self, command: Command) {
        match command {
            Command::Publish(topic, data, reply) => {
                let result = match self
                    .swarm
                    .behaviour_mut()
                    .gossipsub
                    .publish(gossipsub::IdentTopic::new(topic), data)
                {
                    Ok(_)
                    | Err(gossipsub::PublishError::NoPeersSubscribedToTopic)
                    | Err(gossipsub::PublishError::Duplicate) => Ok(()),
                    Err(e) => Err(anyhow!("publish: {e}")),
                };
                let _ = reply.send(result);
            }
            Command::Request(peer, protocol, data, reply) => {
                let behaviour = self.swarm.behaviour_mut();
                let id = match protocol {
                    Protocol::DbSync => behaviour.db_sync.send_request(&peer, Raw(data)),
                    Protocol::Blob => behaviour.blob.send_request(&peer, Raw(data)),
                };
                self.outbound.insert((protocol, id), reply);
            }
            Command::Peers(reply) => {
                let _ = reply.send(self.connected.iter().copied().collect());
            }
            Command::Listeners(reply) => {
                let _ = reply.send(self.swarm.listeners().cloned().collect());
            }
            Command::Dial(addr, reply) => {
                let _ = reply.send(self.swarm.dial(addr).map_err(|e| anyhow!("dial: {e}")));
            }
        }
    }

    fn emit(&self, event: NetEvent) -> impl Future<Output = ()> + Send + 'static {
        let events = self.events.clone();
        async move {
            let _ = events.send(event).await;
        }
    }

    async fn on_swarm(&mut self, event: SwarmEvent<BehaviourEvent>) {
        match event {
            SwarmEvent::NewListenAddr { address, .. } => {
                tracing::info!("listening on {address}");
                self.emit(NetEvent::Listening(address)).await;
            }
            SwarmEvent::ConnectionEstablished {
                peer_id,
                num_established,
                ..
            } => {
                if let Some(allow) = &self.allowlist
                    && !allow.contains(&peer_id)
                {
                    tracing::warn!("closing connection from non-allowlisted peer {peer_id}");
                    let _ = self.swarm.disconnect_peer_id(peer_id);
                    return;
                }
                if num_established.get() == 1 && self.connected.insert(peer_id) {
                    tracing::info!("connected to {peer_id}");
                    self.emit(NetEvent::Connected(peer_id)).await;
                }
            }
            SwarmEvent::ConnectionClosed {
                peer_id,
                num_established,
                ..
            } => {
                if num_established == 0 && self.connected.remove(&peer_id) {
                    self.emit(NetEvent::Disconnected(peer_id)).await;
                }
            }
            SwarmEvent::Behaviour(event) => self.on_behaviour(event).await,
            _ => {}
        }
    }

    async fn on_behaviour(&mut self, event: BehaviourEvent) {
        match event {
            BehaviourEvent::Identify(identify::Event::Received { peer_id, info, .. }) => {
                if self.allowlist.as_ref().is_none_or(|a| a.contains(&peer_id)) {
                    for addr in info.listen_addrs {
                        self.swarm.behaviour_mut().kad.add_address(&peer_id, addr);
                    }
                }
            }
            BehaviourEvent::Mdns(mdns::Event::Discovered(found)) => {
                for (peer, addr) in found {
                    if self.allowlist.as_ref().is_none_or(|a| a.contains(&peer)) {
                        self.swarm
                            .behaviour_mut()
                            .kad
                            .add_address(&peer, addr.clone());
                        if !self.connected.contains(&peer) {
                            let _ = self.swarm.dial(addr);
                        }
                    }
                }
            }
            BehaviourEvent::Gossipsub(gossipsub::Event::Message { message, .. }) => {
                if let Some(topic) = self.topics.get(&message.topic) {
                    let event = NetEvent::Gossip {
                        topic: topic.clone(),
                        source: message.source,
                        data: message.data,
                    };
                    self.emit(event).await;
                }
            }
            BehaviourEvent::DbSync(e) => self.on_request_event(Protocol::DbSync, e).await,
            BehaviourEvent::Blob(e) => self.on_request_event(Protocol::Blob, e).await,
            _ => {}
        }
    }

    async fn on_request_event(
        &mut self,
        protocol: Protocol,
        event: request_response::Event<Raw, Raw>,
    ) {
        match event {
            request_response::Event::Message { peer, message, .. } => match message {
                request_response::Message::Request {
                    request, channel, ..
                } => {
                    let (tx, rx) = oneshot::channel();
                    self.emit(NetEvent::Request {
                        protocol,
                        peer,
                        data: request.0,
                        reply: tx,
                    })
                    .await;
                    self.inbound
                        .push(rx.map(move |r| (protocol, channel, r.ok())).boxed());
                }
                request_response::Message::Response {
                    request_id,
                    response,
                } => {
                    if let Some(reply) = self.outbound.remove(&(protocol, request_id)) {
                        let _ = reply.send(Ok(response.0));
                    }
                }
            },
            request_response::Event::OutboundFailure {
                request_id,
                error,
                peer,
                ..
            } => {
                if let Some(reply) = self.outbound.remove(&(protocol, request_id)) {
                    let _ = reply.send(Err(anyhow!(
                        "{} request to {peer} failed: {error}",
                        protocol.name()
                    )));
                }
            }
            request_response::Event::InboundFailure { peer, error, .. } => {
                tracing::debug!("inbound {} from {peer} failed: {error}", protocol.name());
            }
            request_response::Event::ResponseSent { .. } => {}
        }
    }
}
