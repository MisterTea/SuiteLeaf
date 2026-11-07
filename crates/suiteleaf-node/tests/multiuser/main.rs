//! Three real nodes, and several signed-in clients editing one file at once.
//!
//! Sessions replicate through SuiteDB, so any node can authenticate a client.
//! Concurrent edits converge on the node the clients joined. The saved Yjs
//! log replicates with SuiteDB, and a person who then opens the file on
//! another node is given that document. A viewer or commenter must not change the body,
//! and a compacted document has to show up on the other nodes. Sheets,
//! presentations, and drawings converge the same way through their own maps:
//! cells, slides, and drawing lines. Simultaneous saves must leave one head
//! and every accepted version.

#![allow(clippy::zombie_processes)]

mod convergence;
mod cross_node;
mod doc_room;
mod generations;
mod http_files;
mod http_public_sharing;
mod http_sessions;
mod http_sharing;
mod sheets;
mod slides;
mod standing;
mod support;
