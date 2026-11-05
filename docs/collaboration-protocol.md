# Collaboration protocol 1

This is the contract between the SuiteLeaf client (`apps/web/src/collab/`) and a node (`crates/suiteleaf-node/src/collab/`) for a live shared document, spreadsheet, or presentation. [collaboration.md](collaboration.md) records the behavior that tests have shown. This page names the messages and the rules each side follows.

## Connection

The client opens a WebSocket to `/api/drive/items/{itemId}/session`. The address has no user, password, query, or fragment.

A browser cannot set an `Authorization` header on a WebSocket, so its first message must be:

```json
{"type": "auth", "accessToken": "<token>", "protocol": 1}
```

The node waits 5 seconds for it. The token is never put in the address, logged, or echoed back. A tool may instead send an `Authorization: Bearer` header or a session cookie on the upgrade. The `access_token` query parameter is still accepted for tests and command-line tools. Browsers do not use it.

A missing `protocol` means 1. Any other value is refused with `{"type":"reject","reason":"This app speaks collaboration protocol 1."}`, and the socket closes. A `join` message is checked the same way.

A device session is one socket. The person is the account behind the token. Two devices belonging to one person are two sockets with one presence row.

## Messages from the client

| Type | Fields | Meaning |
| --- | --- | --- |
| `auth` | `accessToken`, `protocol` | First message: sign in. Later on the same socket: renew the token. The new token must sign in as the same person. |
| `join` | `protocol` | Ask for a fresh `joined` message, for example when the tab becomes visible again. |
| `activity` | | Keeps this person active in the room. |
| `update` | `id`, `update`, `unit`, `key`, `at`, `generation` | A Yjs v1 update, base64-encoded. `unit` is `paragraph`, `cell`, `slide`, or `comment`. `key` names the paragraph, cell, or slide. `generation` is the room generation the edit was made in. |
| `seed` | `id`, `update`, `generation` | The first copy of the open file into an empty shared room. |
| `selection` | `anchor`, `head`; or `sheetId` and `startRow`, `startColumn`, `endRow`, `endColumn`; or `slideId` and an optional `elementId` | A caret or selection. It never carries document text. A message that does is ignored. |

## Messages from the node

| Type | Fields | Meaning |
| --- | --- | --- |
| `joined` | `joined`, `mode`, `state`, `seed`, `generation`, `occupants` | A snapshot. `mode` is `solo` or `multiuser`. `state` is the room's full Yjs state, or `null` when the room is empty. `seed: true` asks this client to copy its open file into the room. `occupants` lists each person's name and role. The node sends `joined` after sign-in, after a `join`, and to everyone in the room when it becomes shared. |
| `update` | `update` | Another person's stored edit. |
| `selection` | `name` plus the client's fields | Another person's caret or selection. |
| `ack` | `id` | The edit is in the journal. |
| `reject` | `id`, optional `reason` | The edit was not stored. With no reason, the role does not allow it or it was not a valid update. `stale` means it was made in another generation of the room. |
| `renewed` | | A renewal token was accepted. |
| `error` | `reason` | The socket is about to close. `unauthorized`: the token or session no longer signs in, so sign in again. `forbidden`: the grant is gone. `role-changed`: the grant changed, so open the file again. |

## Ordering, idempotency, and acknowledgement

- Yjs updates commute. The order in which updates arrive does not change the converged document.
- Each update `id` is unique for the edit. The client queue keeps the first copy of an id, and so does a queue reloaded from session storage.
- The node writes `drive_room_update` (item, generation, bytes, author, unit, key, time) **before** it changes the live room. Sending the same bytes again in the same generation is acknowledged, and the journal still has one row.
- The client keeps an edit until it gets `ack` or `reject` for its id. A dropped socket sends every unsettled edit again after the next `joined`.
- An `ack` means the edit survives the node restarting, and it reaches other nodes once SuiteDB replicates that row.

## Generations

A room has a generation number, stored on `drive_room`. It goes up when a solo room becomes shared and again when an emptied shared room is written to the file. The journal and its replay only ever use the current generation's rows.

Every edit names the generation it was made in. The node refuses an edit from another generation, or for a room that is no longer shared, with `reject` and `reason: "stale"`, and does not store it. When a `joined` message names a generation different from the one the client had, the client:

1. throws away its Yjs copy and starts a new one from the snapshot, so two logs are never merged and text is never repeated;
2. removes any waiting edits from the old generation;
3. keeps those edits by saving the open file as a separate local file, "*title* (your edits)", and says so in the status line.

## Presence and leaving

`drive_presence` holds one row for each person in a room. `activity`, `join`, and every stored edit refresh it. Closing the socket removes the row at once. The sweep, every 30 seconds, removes a person who has been idle for 15 minutes. A shared room is written to the file only after its last writer has gone.

## Authorization

- The node reads the role when the socket signs in. A viewer receives the document and live edits, and its edits are refused. A commenter may change only the comment list. Every edit is applied to a copy of the room first, and an edit that would change the body, cells, slides, lines, another map, or another fragment is refused.
- Every incoming message checks the session row and the current role.
- Every 5 seconds, the node also verifies the credentials the socket signed in with, even when the client sends nothing. A token that no longer signs in, a revoked or expired session, a banned account, a removed grant, or a changed role closes the socket within one tick. A removed person stops receiving live edits at that point.
- **Bound:** access is withdrawn at most 5 seconds after the change (`SUITELEAF_RECHECK_MS` shortens this in tests), or immediately on that person's next message.
- The client asks for a token every 30 seconds while the room is open and sends `auth` only when the token has changed. Access tokens last 15 minutes and are refreshed a minute before they expire, so an active session never reaches the recheck with an expired token.

## Reconnecting

After a dropped socket, the client waits 200, 400, 800, 1,600, 3,200, and then 6,400 milliseconds between attempts. A browser that goes offline closes the socket and tries again as soon as it is online. `unauthorized` pauses the room until the person signs in again and keeps waiting edits. `forbidden`, `role-changed`, and a protocol refusal stop the room.

## Across nodes

Journal rows replicate with SuiteDB. A node that opens the room later replays the current generation's rows. A room that is already open reads new rows on its 30-second sweep. Presence rows are not used to rebuild the document.

## Known limits

- Waiting edits are kept in the tab's session storage. Closing the tab before the node answers loses them. Reloading the tab does not.
- After a role change, the client stops and asks the person to open the file again. It does not switch to the new role in place.
- An already open room on another node can be up to one sweep (30 seconds) behind.
