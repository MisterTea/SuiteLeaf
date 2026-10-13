use std::time::Duration;

use suiteleaf_net::{
    Multiaddr, NetConfig, NetEvent, NetHandle, Protocol, generate_swarm_key, identity,
    parse_swarm_key, start,
};
use tokio::{sync::mpsc, time::timeout};

const TOPIC: &str = "suiteleaf/test/1";

async fn node(
    key: &str,
    bootstrap: Vec<Multiaddr>,
) -> (NetHandle, mpsc::Receiver<NetEvent>, Multiaddr) {
    let (handle, mut events) = start(NetConfig {
        keypair: identity::Keypair::generate_ed25519(),
        swarm_key: parse_swarm_key(key).unwrap(),
        listen: vec!["/ip4/127.0.0.1/tcp/0".parse().unwrap()],
        bootstrap,
        allowlist: None,
        mdns: false,
        topics: vec![TOPIC.into()],
    })
    .unwrap();
    let addr = loop {
        if let Some(NetEvent::Listening(a)) = events.recv().await {
            break a;
        }
    };
    let full = format!("{addr}/p2p/{}", handle.local_peer_id())
        .parse()
        .unwrap();
    (handle, events, full)
}

async fn wait_connected(events: &mut mpsc::Receiver<NetEvent>) {
    timeout(Duration::from_secs(10), async {
        loop {
            if let Some(NetEvent::Connected(_)) = events.recv().await {
                return;
            }
        }
    })
    .await
    .expect("peers did not connect");
}

#[tokio::test]
async fn peers_with_the_same_key_exchange_requests_and_gossip() {
    let key = generate_swarm_key();
    let (a, mut a_events, a_addr) = node(&key, vec![]).await;
    let (b, mut b_events, _) = node(&key, vec![a_addr]).await;
    wait_connected(&mut b_events).await;
    wait_connected(&mut a_events).await;

    let responder = tokio::spawn(async move {
        loop {
            match a_events.recv().await {
                Some(NetEvent::Request {
                    protocol,
                    data,
                    reply,
                    ..
                }) => {
                    assert_eq!(protocol, Protocol::DbSync);
                    let mut out = data.clone();
                    out.reverse();
                    reply.send(out).unwrap();
                }
                Some(NetEvent::Gossip { data, .. }) => return (a_events, data),
                Some(_) => {}
                None => panic!("events closed"),
            }
        }
    });
    let response = b
        .request(a.local_peer_id(), Protocol::DbSync, vec![1, 2, 3])
        .await
        .unwrap();
    assert_eq!(response, vec![3, 2, 1]);

    // Gossipsub needs a heartbeat to build the mesh before publishing reaches the peer.
    let gossip = timeout(Duration::from_secs(15), async {
        loop {
            b.publish(TOPIC, b"hello".to_vec()).await.unwrap();
            tokio::time::sleep(Duration::from_millis(500)).await;
            if responder.is_finished() {
                return responder.await.unwrap().1;
            }
        }
    })
    .await
    .expect("gossip was not delivered");
    assert_eq!(gossip, b"hello");
    assert_eq!(b.peers().await, vec![a.local_peer_id()]);
}

#[tokio::test]
async fn peers_with_a_different_key_cannot_connect() {
    let (_a, _a_events, a_addr) = node(&generate_swarm_key(), vec![]).await;
    let (b, mut b_events, _) = node(&generate_swarm_key(), vec![a_addr]).await;
    let connected = timeout(Duration::from_secs(3), async {
        loop {
            if let Some(NetEvent::Connected(_)) = b_events.recv().await {
                return;
            }
        }
    })
    .await;
    assert!(
        connected.is_err(),
        "a peer outside the private network connected"
    );
    assert!(b.peers().await.is_empty());
}
