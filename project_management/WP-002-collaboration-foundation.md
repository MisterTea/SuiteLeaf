---
id: "WP-002"
title: "Durable document collaboration and session protocol"
type: "work_package"
status: "done"
priority: "P0"
phase: 1
area: "collaboration"
created: "2026-10-29"
updated: "2026-11-04"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S01", "S02"]
---

# Durable document collaboration and session protocol

## Outcome and rationale

Make simultaneous document editing survive disconnects, restarts, and node changes without dropping content or granting unintended access. This provides the durable collaboration contract for spreadsheets and slides.

## Existing implementation and starting points

Inspect `apps/web/src/collab/session.ts`, `apps/web/src/editors/Docs.tsx`, `packages/core/src/collab.ts`, `crates/suiteleaf-node/src/collab.rs`, and `crates/suiteleaf-node/src/replication.rs`. Docs receives a Y.Doc. The inspected client has no obvious reconnect handler; server compaction extracts paragraph text from a baseline. These are audit leads requiring reproduction, not confirmed runtime failures.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Specify join, seed, update, acknowledgement, reconnect, presence, leave, and snapshot messages; distinguish per-device sessions from user identity. Define idempotency, ordering, document generations, and protocol versions.
- Persist complete rich-document state, including formatting, tables, objects, comments, and structural edits. Replace or correct any text-only compaction path that cannot faithfully reconstruct that state.
- Durably journal acknowledged updates and recover rooms after process death. Define cross-node room ownership/routing or replication so clients on different nodes converge; avoid treating replicated presence as live-document replication.
- Add reconnect with bounded backoff, token renewal, queued local changes, state-vector reconciliation, and clear recovery UI. Prevent duplicate initial seeding and mode-switch data loss.
- Enforce authorization on connection and updates, including revoked access, commenter restrictions, and token expiration. Validate update content server-side rather than trusting client-supplied operation labels.
- Implement live selections, participant presence, collaborative undo scoped to the local user's operations, and honest idle/disconnected state. Define how read-only viewers receive live updates.

## Dependencies and delivery

No hard work-package prerequisites. Coordinate shared interfaces with the packages linked in the portfolio index.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- Two users on different nodes edit text, formatting, tables, and inserted images; both converge and reopening preserves the complete document.
- Network loss, token expiration, duplicate messages, simultaneous joins, and node restart lose no acknowledged edit.
- Revoking access prevents further server reads/writes according to a documented bounded enforcement policy; commenters cannot forge editing operations.
- Undo of one user's operation preserves unrelated remote work; idle transitions do not silently discard unsaved changes.

## Verification

- Use Rust integration tests for durable log recovery, protocol authorization, and multi-node convergence; Vitest for client state transitions and replay.
- Use real-browser typing tests for caret, selections, collaborative typing, and keyboard undo only; test rich-state persistence independently in unit/integration tests.
- Record deterministic fault-injection cases and repeat them against the same protocol fixture set.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Do not claim spreadsheet or presentation collaboration until WP-003 and WP-004 complete. Do not retain bearer tokens in diagnostics or URL logs; replace or redact the existing query-token transport where necessary.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S01`, `S02`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.

# Progress

2026-10-30: In progress. Compaction now prefers the `prosemirror` Yjs fragment the editor already syncs, so marks and tables in that fragment survive instead of being rewritten as plain paragraph strings. The TypeScript room and the node both do this. `tests/collab-rich.test.ts` passed (3 tests). `cargo test -p suiteleaf-node -- a_formatted_fragment_keeps_marks_and_a_table` passed, and the existing paragraph-string compaction test still passed. A room with no fragment still falls back to paragraph strings. `applyParagraphTexts` also keeps marks on an unchanged block and on a single text run.

2026-10-30, later: the browser socket no longer puts the bearer token in the URL. It sends `{type:"auth", accessToken}` as the first message, and the node accepts that message only when the upgrade had no query token. The existing `access_token` query still works for the Rust multiuser test. A dropped socket reconnects at 200 ms, doubling until 6.4 s, and queues updates until the next `joined`. Unauthorized or forbidden responses stop the retries. `tests/collab-reconnect.test.ts` passed (3 tests). `cargo test -p suiteleaf-node -- an_auth_message_is_the_only_place_a_token_is_accepted` passed. Evidence is that unit test and the auth-message parser. A two-browser reconnect run is still open.

2026-10-30, later still: a new process rebuilds a multiuser room from `drive_room_update` rows for that file and generation, in id order, before it serves the Yjs state. `cargo test -p suiteleaf-node -- a_new_process_replays_saved_updates_for_the_open_generation` passed. A corrupt row is skipped. Rows are not deleted when the room is compacted, so a later generation must not be mixed in; the replay uses the generation stored on `drive_room`.

2026-10-30, later: closing a collaboration socket calls `leave`, which removes that person from `drive_presence` immediately. `occupants` lists everyone who has joined and not left, including someone who has not typed. The `joined` message includes those names and roles. `cargo test -p suiteleaf-node -- leaving_drops_a_person_before_the_idle_sweep` passed. The editor chips still come from the separate SuiteDrive presence beats, not from this room list.

2026-10-30, later: a shared document uses `yUndoPlugin` instead of the single-user undo stack. Undo and redo, including Mod-z, go through that stack, which tracks local edits and not remote ones. `npx vitest run tests/collab-undo.test.ts` passed: undoing the local origin leaves the other person's text in place, and redo puts the local text back. A document that is not in a room still uses the ordinary undo stack. This was not typed in two browsers.

2026-10-30, later: `catch_up` applies `drive_room_update` rows for the current generation onto a room that is already open in memory. An older in-memory generation is replaced by that log. An update this room already has does not change the text again. The idle sweep calls this for every open room. `cargo test -p suiteleaf-node -- a_second_process_catches_up_to_updates_in_the_shared_log` passed. The two rooms in that test share one database. It does not run two nodes or replicate the op log between them. A local edit that was not written to the log is dropped when the generation moves ahead.

2026-10-31: an edit made by two people on one node is in the room when another person opens that file on a second node. The test waits until `drive_room` is `multiuser` on the second node and a `drive_room_update` row is there, then joins. The paragraphs are "Tomatoes are in" and "Beans are staked". `cargo test -p suiteleaf-node --test multiuser an_edit_on_one_node_is_in_the_room_on_another` passed. This does not type in two browsers. Limits are in `docs/collaboration.md`.

2026-10-31, later: a room that is already open on the second node reads a later edit from the first node. Ravi joined after the first paragraphs had replicated, then Maya changed the first paragraph to "Tomatoes are picked" without Ravi reconnecting. His open room showed that paragraph and still showed "Beans are staked". `cargo test -p suiteleaf-node --test multiuser an_open_room_on_another_node_reads_a_later_edit` passed. The test sweep is shorter than the 30 second production sweep. This was not typed in two browsers.

2026-10-31, later still: bold text, a table cell, and an image node converge on a room that is already open on the second node. The bold word is "Keep", the cell text is "Beds", and the image alternative text is "North beds". Sam on the first node and Ravi on the second node saw the same fragment. `cargo test -p suiteleaf-node --test multiuser formatted_text_a_table_and_an_image_converge_on_another_node` passed. This was not typed in two browsers.

2026-10-31, later: that image source is the picture's embedded PNG data, and both nodes saw the same data. Saving the room keeps those bytes in the file, and reading the file back still has them. A second image whose source is the file name `bed.png` is left out of the saved file, so the file still opens. `npx vitest run tests/collab-rich.test.ts` passed (4 tests). `cargo test -p suiteleaf-node --bin suiteleaf-node -- compaction_keeps_embedded_image_bytes_and_drops_a_file_name` passed. `cargo test -p suiteleaf-node --test multiuser formatted_text_a_table_and_an_image_converge_on_another_node` passed. This was not typed in two browsers.

2026-10-31, later: stopping the node after the paragraphs were in `drive_room_update`, then starting that same data directory again, still shows "Tomatoes are in" and "Beans are staked" when Maya opens the file. `cargo test -p suiteleaf-node --test multiuser a_restart_keeps_an_edit_that_was_written_to_the_log` passed. An edit that was not written to the log is still lost. This was not typed in two browsers.

2026-10-31, later: Maya and Sam joined a room that has no saved file. Maya’s paragraph `Tomatoes are in` was applied. After both left, the room was still multiuser and the paragraph was still `Tomatoes are in`. `cargo test -p suiteleaf-node --bin suiteleaf-node -- an_idle_room_keeps_text_when_there_is_no_file_to_write` passed. The open document is cleared only after the file write returns. An edit that was never written to the log is still lost on a restart. This was not typed in two browsers.

2026-10-31, later: Maya's connection was dropped after the first paragraphs were stored. Sam changed the second paragraph to "Beans are picked" and sent that same update again. Maya reconnected and both saw "Tomatoes are in" and "Beans are picked" once. Maya's session was then set to expire in 2000, and a new connection was refused. Sam still saw those paragraphs. `cargo test -p suiteleaf-node --test multiuser a_dropped_connection_and_a_duplicate_edit_keep_the_saved_text` passed. An edit that never reached the log is still lost. This was not typed in two browsers.

2026-10-31, later: an already open socket is closed when that person's session has expired. Maya's session was set to expire in 2000 while she was connected. Her next edit, changing the first paragraph to "Tomatoes are gone", was not applied, and the socket closed. Sam still saw "Tomatoes are in" and "Beans are staked". `cargo test -p suiteleaf-node --test multiuser an_expired_session_cannot_change_the_open_room` passed, and the earlier dropped-connection test still passed. A person with no session row is left connected. This was not typed in two browsers.

2026-10-31, later: removing Sam's grant while he is connected closes his socket on the next message. His edit, changing the first paragraph to "Tomatoes are gone", was not applied. A later read of the file was refused. Maya still saw "Tomatoes are in" and "Beans are staked". `cargo test -p suiteleaf-node --test multiuser removing_access_closes_the_open_room_and_keeps_the_saved_text` passed. The socket is not closed at the instant the grant changes; it is closed on the next message. This was not typed in two browsers.

2026-10-31, later: Ravi and Noor opened the file on the second node at the same time, after the room there was multiuser and a saved update had arrived. Both saw "Tomatoes are in" and "Beans are staked". Maya and Sam, still connected on the first node, still saw those paragraphs. `cargo test -p suiteleaf-node --test multiuser simultaneous_joins_see_the_saved_edit` passed. This was not typed in two browsers.

2026-10-31, later: Ravi and Noor opened the file on the second node before Maya and Sam edited it on the first node. After that edit, both saw "Tomatoes are in" and "Beans are staked" without reconnecting. Maya and Sam still saw those paragraphs. `cargo test -p suiteleaf-node --test multiuser joins_before_the_log_arrives_still_see_the_edit` passed. This was not typed in two browsers.

Spreadsheet and slide collaboration stay in WP-003 and WP-004.

2026-10-31, later: Maya added `Tomatoes are in` and Sam added `Beans are staked`. Undoing Maya's paragraph left `Beans are staked` for both of them. `cargo test -p suiteleaf-node --test multiuser undoing_one_paragraph_keeps_the_other_persons_text` passed. The editor Undo button was not the control used here. This was not typed in two browsers. An edit that never reached the log is still lost.

2026-10-31, later: Lars, a viewer, joined the open document and saw the same paragraphs as Maya. His edit `VIEWER SHOULD NOT LAND` was not applied. A commenter still cannot change the body. `cargo test -p suiteleaf-node --test multiuser converge_across_a_cluster` passed (2 tests), and `cargo test -p suiteleaf-node --bin suiteleaf-node -- a_viewer_or_commenter_cannot_change_the_live_document` passed. `cargo test -p suiteleaf-node --test multiuser removing_access_closes_the_open_room_and_keeps_the_saved_text` passed, so a missing grant still closes the socket on the next message. This was not typed in two browsers.

2026-10-31, later: The web client opens the document room for a viewer. The editor stays read-only, and a viewer's open paragraphs are not copied into the shared document. `npx vitest run tests/collab-reconnect.test.ts tests/collab-viewer.test.ts tests/history.test.ts tests/history-clock.test.ts` passed (41 tests). The editor attaches when a joined message says the room is shared. When a second person arrives, the person already in the room receives that message again. Lars opened the file alone, then Maya joined and added `Tomatoes are in`. Lars saw that paragraph without sending another join. `cargo test -p suiteleaf-node --test multiuser a_viewer_who_opened_first_hears_when_the_room_is_shared` passed, and `cargo test -p suiteleaf-node --test multiuser converge_across_a_cluster` passed (2 tests). This was not opened in a browser.

2026-10-31, later: The shared editor's undo function removed `Tomatoes are in` and left `Beans are staked`. That is the function Mod-z and the toolbar call when a shared document is open. `npx vitest run tests/collab-undo.test.ts` passed (2 tests). The toolbar was not clicked and no key was pressed. This was not typed in two browsers.

2026-10-31, later: Maya's edit `Tomatoes are in` was acknowledged only after it was stored. The answer was `ack` for id `edit-1` and did not contain the paragraph. Lars's edit was `reject` for id `view-1`, and `VIEWER SHOULD NOT LAND` was not in the document. `cargo test -p suiteleaf-node --test multiuser a_stored_edit_is_acknowledged_and_a_viewer_edit_is_refused` passed. The browser keeps an edit until that answer, and sends it again if the socket drops first. `npx vitest run tests/collab-reconnect.test.ts` passed (4 tests). This was not typed in two browsers.

2026-10-31, later: Maya's caret from position 1 through 4 reached Sam. The paragraphs did not change. A caret message that also carried `Tomatoes are in` is not used as the caret. `cargo test -p suiteleaf-node --test multiuser a_live_caret_reaches_the_other_person_without_changing_the_text` passed. `npx vitest run tests/collab-selection.test.ts` passed (1 test). The shared editor reports the local caret while the room is open. The other person's caret is not drawn. This was not typed in two browsers.

2026-10-31, later: the shared editor draws Maya's caret at positions 1 through 4 on the paragraph `Tomatoes are in`. The mark is named Maya. The document text stays `Tomatoes are in`. `npx vitest run tests/collab-caret-mark.test.ts` passed (1 test). That mark was drawn in a test view. The SuiteLeaf window was not opened with two people.

2026-10-31, later: the browser auth message sends `protocol` 1. A message with no protocol number is accepted as protocol 1. A protocol of 2, and a protocol of `secret-value`, are both refused with `This app speaks collaboration protocol 1.` The refusal does not contain `secret-value`. `cargo test -p suiteleaf-node --bin suiteleaf-node -- an_auth_message_is_the_only_place_a_token_is_accepted` passed. The socket was not opened over the network. A query token still does not carry a protocol number. This was not typed in two browsers.

2026-11-01: a later join message sends protocol 1. `protocol_supported` refuses a join whose protocol is `secret-value` with `This app speaks collaboration protocol 1.` The join branch sends that refusal and returns before `rooms.join`. The browser stops retrying and shows that sentence, which does not contain `secret-value`. `npx vitest run tests/collab-recovery.test.ts` passed (1 test). `cargo test -p suiteleaf-node --bin suiteleaf-node -- an_auth_message_is_the_only_place_a_token_is_accepted` passed (1 test). The socket was not opened over the network. This was not typed in two browsers.

2026-10-31, later: a commenter who labels a paragraph or a sheet cell as `comment` does not change the live room. The paragraph and the cell both contain `secret-value`, and that word is not in the room afterward. A comment whose text is `from a comment` is still applied. `cargo test -p suiteleaf-node --bin suiteleaf-node -- a_viewer_or_commenter_cannot_change_the_live_document` passed. This was not typed in two browsers.

2026-10-31, later: the first seed of an empty room stores `Tomatoes are in`. A second seed of that sentence, from a separate document, is not applied, so the sentence stays once. A later paragraph update still adds `Beans are staked`. `cargo test -p suiteleaf-node --bin suiteleaf-node -- a_second_seed_does_not_repeat_the_document` passed. This was not typed in two browsers.

2026-10-31, later: the second person's open file is not copied over text the room already has. The room had `Tomatoes are in` and `Beans are staked`. The open file also contained `secret-value`, and that word stayed out of the room. An empty room still takes the open file. An empty shared fragment follows the room's paragraphs instead of the open file. `npx vitest run tests/collab-seed-local.test.ts tests/collab-rich.test.ts tests/collab-reconnect.test.ts` passed (10 tests). This was not typed in two browsers.

2026-11-01: a local edit that the node has not acknowledged stays on this device when the tab is hidden. The notice reads `1 edit is waiting to be stored.` After the socket drops it reads `Reconnecting. 1 edit is still on this device.` The next connection sends that edit again. The notice does not contain `secret-value` or `token-not-shown`. `npx vitest run tests/collab-recovery.test.ts tests/ui/collab-recovery.test.tsx` passed (2 tests). The SuiteLeaf window was not opened. This was not typed in two browsers. An edit that never reached the log is still lost on another node.

2026-11-01: when the room refuses the token, the notice is `Sign in again to open the shared document.` It does not contain `token-not-shown`. A waiting edit says `Sign in again. Edits still on this device were not stored.` Lost access says `You no longer have access to this shared document.` The socket is not opened again. `npx vitest run tests/collab-recovery.test.ts tests/ui/collab-recovery.test.tsx` passed (3 tests). The SuiteLeaf window was not opened. This was not typed in two browsers. An edit that never reached the log is still lost on another node.

2026-11-01: an edit that is waiting is written in session storage for that file. A new queue reads that update back, including its bytes. A stored value that is not a list is removed and is not thrown. The room test stores one waiting edit, and the notice does not contain `secret-value` or `token-not-shown`. `npx vitest run tests/collab-reconnect.test.ts tests/collab-recovery.test.ts tests/ui/collab-recovery.test.tsx` passed (8 tests). The SuiteLeaf window was not opened. This was not typed in two browsers. The edit is still not on another node until that node stores it.

2026-11-01: a presence beat within 5 seconds stays editing or viewing. Jordan's beat from 6 seconds ago stays on the list and is idle, even though the beat said editing. Casey's beat at the same moment stays viewing. A beat older than 15 seconds is left off the list. The chip text is `Jordan is idle`. `cargo test -p suitedrive --test drive presence_names_other_people_and_drops_stale_beats` passed. `npx vitest run tests/presence-label.test.ts` passed (1 test). The SuiteLeaf window was not opened with two people. This was not typed in two browsers.

2026-11-01: undoing a shared edit drops the newest waiting update and leaves the seed. The dropped update is not returned, so its bytes are not in the result. A second undo leaves the seed. With no room bound, undo does not drop anything. `npx vitest run tests/collab-reconnect.test.ts tests/collab-undo.test.ts` passed (8 tests). The SuiteLeaf window was not opened. This was not typed in two browsers. An edit that never reached the log is still lost on another node.

2026-11-01: a reconnect wait that is not a number is 200 milliseconds. The fifth wait and a later try stay at 6,400 milliseconds. A value `secret-value` is not a wait and is not repeated. `npx vitest run tests/collab-reconnect.test.ts` passed (6 tests). The SuiteLeaf window was not opened. This was not typed in two browsers.

2026-11-01: the room address drops a user, a password, a query, and a fragment. `https://user:secret-value@leaf.example/app?token=secret-value` becomes `wss://leaf.example/api/drive/items/file-1/session`. A page address that is not a web address says `The collaboration address is not a web address.` and does not repeat `secret-value`. `npx vitest run tests/collab-reconnect.test.ts` passed (6 tests). The SuiteLeaf window was not opened. This was not typed in two browsers.

2026-11-01: queuing the same update id again keeps the first copy. The first bytes stay `beds`. A second copy whose bytes are `secret-value` is not stored. `npx vitest run tests/collab-reconnect.test.ts` passed (7 tests). The SuiteLeaf window was not opened. This was not typed in two browsers.

2026-11-01: loading a saved queue keeps the first copy of an update id. The first bytes stay `beds`. A second saved copy whose bytes are `secret-value` is not stored. `npx vitest run tests/collab-reconnect.test.ts` passed (8 tests). The SuiteLeaf window was not opened. This was not typed in two browsers.

2026-11-01: a presence name with a line break stays one line. `Ada` and `Lovelace` say `Ada Lovelace is editing`. A blank name says `Someone is idle`. `npx vitest run tests/presence-label.test.ts` passed (1 test). The SuiteLeaf window was not opened. This was not typed in two browsers.

2026-11-01: undo leaves an update that was already handed to the socket. The unsent edit after it is dropped, and the sent update stays. A seed stays. `npx vitest run tests/collab-reconnect.test.ts` passed (8 tests). The SuiteLeaf window was not opened. This was not typed in two browsers.

2026-11-01: sending the same stored edit again is acknowledged and does not add a second journal row. `Beds` stays `Beds`. `cargo test -p suiteleaf-node --bin suiteleaf-node -- a_repeated_update_is_acknowledged_once_in_the_journal` passed (1 test). The SuiteLeaf window was not opened. This was not typed in two browsers. An edit that never reached the log is still lost on another node.

2026-11-01: a comment thread stays with the shared fragment. The paragraph `ripe` and the thread quote `ripe` with the message `Water the beds` are both in the compacted document. A stored value `secret-value` that is not a list of threads is left out, and that word is not in the document. `npx vitest run tests/collab-rich.test.ts -t "comment thread"` passed. `cargo test -p suiteleaf-node --bin suiteleaf-node -- a_comment_thread_stays_with_the_fragment` passed. The SuiteLeaf window was not opened. This was not typed in two browsers.

2026-11-01: a commenter may store a comment and may not store another document attribute. `Water the beds` stays on the comment list. A paragraph style labeled as a comment is refused, and `secret-value` is not on the room. `cargo test -p suiteleaf-node --bin suiteleaf-node -- a_commenter_may_store_a_comment` passed (1 test). The SuiteLeaf window was not opened. This was not typed in two browsers.

2026-11-01: a commenter cannot store a separate map by labeling it as a comment. A form map holding `secret-value` is refused. The comment `Water the beds` stays, and that form map is not on the room. `cargo test -p suiteleaf-node --bin suiteleaf-node -- a_commenter_may_store_a_comment` passed (1 test). The SuiteLeaf window was not opened. This was not typed in two browsers.

2026-11-01: compaction keeps an attribute that only looks like a number. An id `012` stays `012`, and the paragraph text stays `Beds`. A heading level `1` is still the number 1. `cargo test -p suiteleaf-node --bin suiteleaf-node -- a_numeric_looking_attribute` passed (1 test). `cargo test -p suiteleaf-node --bin suiteleaf-node -- a_formatted_fragment` passed (1 test). The SuiteLeaf window was not opened. This was not typed in two browsers.

2026-11-01: a commenter cannot change text in another fragment by labeling it as a comment. A notes fragment that says `secret-value` is refused. The comment `Water the beds` stays, and that word is not on the room. `cargo test -p suiteleaf-node --bin suiteleaf-node -- a_commenter_may_store_a_comment` passed (1 test). The SuiteLeaf window was not opened. This was not typed in two browsers.

2026-11-01: an edit is written to the journal before the live room changes. A repeated send of `Beds` still stores one row. A new room on the same database reads `Beds` from that row. `cargo test -p suiteleaf-node --bin suiteleaf-node -- a_repeated_update_is_acknowledged_once` passed (1 test). The SuiteLeaf window was not opened. This was not typed in two browsers. An edit that never reached the log is still lost on another node.

2026-11-01: a commenter cannot change XML text stored on a map or in a list. The map keeps `Beds` and the list keeps `North`. Replacing both with `secret-value` is refused, and that word is not on the room. The comment `Water the beds` stays. `cargo test -p suiteleaf-node --bin suiteleaf-node -- a_commenter_may_store_a_comment` passed (1 test). The SuiteLeaf window was not opened. This was not typed in two browsers.

2026-11-01: an expired token pauses the room and keeps the waiting edit. Signing in again can send it. A lost grant still stops the room. A reason `secret-value` is not a stop, and that word is not in the plan. `npx vitest run tests/collab-reconnect.test.ts` passed (9 tests). The SuiteLeaf window was not opened. This was not typed in two browsers. An edit that never reached the log is still lost on another node.

2026-11-01: a presence time of 0 does not count as idle. Ann stays in the room and the text stays `Beds`. Sam, whose time is old, leaves. The room stays shared. `cargo test -p suiteleaf-node --bin suiteleaf-node -- a_presence_time_that_is_not_a_time` passed (1 test). The SuiteLeaf window was not opened. This was not typed in two browsers. An edit that never reached the log is still lost on another node.

2026-11-02: undo removes a local bold mark and a local picture and leaves the other person's paragraph. `Beds` stays, without the bold, and the picture is gone. The other paragraph stays. `npx vitest run tests/collab-undo.test.ts` passed (3 tests) at 02:17:34. The SuiteLeaf window was not opened. This was not typed in two browsers. An edit that never reached the log is still lost on another node.

2026-11-02: a person whose name contains a line break is listed as Someone. The stored name stays `Garden` and the rest of that name. The listed name does not include the break. `cargo test -p suiteleaf-node --bin suiteleaf-node -- a_name_with_a_line_break` passed (1 test). The SuiteLeaf window was not opened. This was not typed in two browsers. An edit that never reached the log is still lost on another node.

2026-11-03: an idle device signs out as idle, not as an expired token. The sign-in sentence is `This device is idle. Sign in again. Changes you made are safe on this device.` The waiting room edit `West` and the upload `North` stay. The session itself is removed. `npx vitest run tests/session-idle.test.ts tests/session-policy.test.ts` passed (3 tests). Coverage for `apps/web/src/session-policy.ts` was 90.78% statements, 91.2% branches, 100% functions, and 100% lines. The sign-in page was not opened. This was not typed in two browsers. An edit that never reached the log is still lost on another node.

2026-11-03: the person already in the document copies the file into the empty room, and the seed marker stays off the shared document so the other person's updates are not stuck behind it. Sam typed ` stay` after Beds. Maya typed ` plot` after North. Both editors showed `North plot` and `Beds stay`. The paragraphs were not repeated. `npx playwright test tests/browser/doc-collab.spec.ts --project=chromium` passed (1 test). This was opened in two browsers. Pressing Undo afterward left `Beds stay` on the screen, so that key is not part of the pass. An edit that never reached the log is still lost on another node.

2026-11-03, later: the shared editor's Yjs undo stack stayed empty after real typing, so each local paragraph change is recorded beside it. Sam pressed ControlOrMeta+z once for each character of ` stay`. That paragraph went back to `Beds` on both screens. Maya's `North plot` stayed. `npx playwright test tests/browser/doc-collab.spec.ts --project=chromium` passed (1 test) at 17:55:38Z. This was opened in two browsers. Redo of that undo was not pressed. An edit that never reached the log is still lost on another node.

2026-11-03, later still: each local paragraph change keeps the whole paragraph, marks included, and redo keeps the inverse. Sam pressed ControlOrMeta+z for each character of ` stay`, then ControlOrMeta+Shift+z the same number of times. Both screens showed `Beds`, then `Beds stay` again, and `North plot` stayed bold in the unit case and plain in the browser. `npx vitest run tests/doc-local-undo.test.ts` passed (4 tests). Coverage for `apps/web/src/editors/doc-local-undo.ts` was 100% statements, branches, functions, and lines. `npx playwright test tests/browser/doc-collab.spec.ts --project=chromium` passed (1 test). This was opened in two browsers. Adding or deleting a paragraph is not on this stack. An edit that never reached the log is still lost on another node.

2026-11-03, later: bold text, a table cell, and an embedded picture reached the other node, and both nodes' saved files still had them after everyone left. The text was `Keep` with a bold mark. The cell said `Beds`. The picture alt was `North beds` and its source was the embedded PNG. Opening the room again on the other node showed that same fragment. `cargo test -p suiteleaf-node --test multiuser formatted_text_a_table_and_an_image_converge_on_another_node` passed (1 test) in 6.73s. The SuiteLeaf window was not opened. An edit that never reached the log is still lost on another node.

2026-11-03, later: Sam selected the first letters of `Beds` and pressed Shift-Right. Maya's page showed a caret and a selection named Sam Ortiz inside that paragraph. The mark sat inside the document. `North` and `Beds` stayed whole on both pages. `npx playwright test tests/browser/doc-collab.spec.ts --project=chromium -g "caret and selection"` passed (1 test) in 2.2s. This was opened in two browsers. An edit that never reached the log is still lost on another node.

2026-11-03, later: a layout transaction was clearing the shared undo flag, so a keystroke in that batch was not undoable. The flag stays when the batch also has a real edit. Undo then removes a new paragraph `West` and leaves `Beds` and the other person's `North`. Without that fix the undo stack stayed empty. `npx vitest run tests/doc-collab-history.test.ts` passed (3 tests). Coverage for `apps/web/src/editors/doc-collab-history.ts` was 100% statements, branches, functions, and lines. `npx playwright test tests/browser/doc-collab.spec.ts --project=chromium` passed (2 tests). The typing and caret checks were opened in two browsers. Adding a paragraph was not pressed in that window. An edit that never reached the log is still lost on another node.

2026-11-03, later: a viewer who opens the file first cannot copy it into the room, so the editor who arrives does. Sam opened Notes as view only. Maya typed ` plot` after North. Sam's page showed `North plot` and `Beds`. The document was not editable, and typing on Sam's page left `Beds` as `Beds`. `cargo test -p suiteleaf-node --test multiuser a_viewer_who_opened_first_hears_when_the_room_is_shared` passed (1 test). `npx playwright test tests/browser/doc-collab.spec.ts --project=chromium` passed (3 tests). This was opened in two browsers. An edit that never reached the log is still lost on another node.

2026-11-03, later: Maya selected `Beds` and posted the comment `Water the beds`. Sam's page showed that comment on `Beds`. `North` stayed on both pages. After both people left, the saved file still contained `Water the beds`. Opening it again showed that comment on `Beds` and the paragraph `North`. `npx playwright test tests/browser/doc-collab.spec.ts --project=chromium -g "comment on one screen"` passed (1 test) in 3.4s. This was opened in two browsers. An edit that never reached the log is still lost on another node.

2026-11-03, later: a comment beside the file was only on the commenter's screen. It now shows for anyone who has the file open, and it refreshes while the file stays open. A viewer can read it and is not given the box. Sam, who can comment, wrote `Water the beds`. Maya's open document showed that note. `North` and `Beds` stayed as they were, and Sam's document was not editable. `npx vitest run tests/ui/file-comments.test.tsx` passed (3 tests). Coverage for `apps/web/src/drive/file-comments.tsx` was 97.56% statements, 90.62% branches, 100% functions, and 100% lines. `npx playwright test tests/browser/doc-collab.spec.ts --project=chromium -g "commenter adds"` passed (1 test) in 6.3s. This was opened in two browsers. An edit that never reached the log is still lost on another node.

2026-11-03, later: going offline did not say the shared document was reconnecting, because the room socket stayed open. The document now says `Reconnecting to the shared document.` and closes that socket. Maya typed ` plot` after North while Sam was offline. When Sam was online again, that sentence was gone and his page showed `North plot` and `Beds`. Sam went offline again and typed `X` after Beds. The document said that edit was still on this device. When he was online again, Maya's page showed `BedsX` and `North plot` stayed. `npx playwright test tests/browser/doc-collab.spec.ts --project=chromium -g "dropped connection"` passed (1 test) in 2.7s. This was opened in two browsers. An edit that never reached the log is still lost on another node.

2026-11-03: an idle compact that does not change the paragraphs keeps the saved bytes. `One` and `Two` stay, and `updatedAt` stays `2026-10-13T18:00:00.000Z`. A later time `secret-value` is not written. Changing the first paragraph to `One more` still records `2026-11-03T00:00:00.000Z`, and compacting that same text again does not change the bytes. `cargo test -p suiteleaf-node --bin suiteleaf-node an_unchanged_compact_keeps_the_saved_time` passed (1 test). The earlier paragraph compaction test still passed. The SuiteLeaf window was not opened. This was not typed in two browsers. An edit that never reached the log is still lost on another node.

2026-11-03: an unchanged sheet cell and an unchanged slide keep the saved bytes. A cell that is already `North` stays the file bytes. Changing it to `West` writes `West`. A slide that is already `s1` stays the file bytes. Changing its title to `West` writes `West`. `secret-value` is not written. `cargo test -p suiteleaf-node --bin suiteleaf-node an_unchanged_sheet_cell_keeps_the_saved_bytes` passed (1 test). `cargo test -p suiteleaf-node --bin suiteleaf-node an_unchanged_slide_keeps_the_saved_bytes` passed (1 test). The earlier sheet and slide compaction tests still passed. The SuiteLeaf window was not opened. The painted grid was not used. Spreadsheet and slide collaboration stay in WP-003 and WP-004. An edit that never reached the log is still lost on another node.

2026-11-04: an open socket is checked again every 5 seconds, even when the client sends nothing. Before this, the check waited for that person's next message, so a viewer who only read kept receiving live edits after losing access. Lars, a quiet viewer, was closed with `forbidden` after his grant was removed, and he did not receive Maya's later edit `Tomatoes are picked`. Sam was closed with `unauthorized` after his session was deleted. Ravi was closed with `role-changed` when his role went from editor to viewer, and his edit after reopening was refused. A token renewed on the open socket replaces the one it signed in with: deleting Sam's first session left him connected, and deleting the renewed session closed him. Another person's token closes the socket. The browser asks for a token every 30 seconds and sends it only when it has changed. Tokens last 15 minutes. `cargo test -p suiteleaf-node --test multiuser standing` passed (4 tests). With the check moved to 10 minutes, all four failed. `cargo test -p suiteleaf-node standing::` passed (5 unit tests).

2026-11-04: each shared room names its generation in `joined`, and each edit names the generation it was made in. An edit from another generation is refused with `reject` and `reason: "stale"` and is not stored. Before this, a client that came back after the room had been written to the file and shared again merged the new room into its old Yjs copy, so the text could repeat, and its waiting edit could never be placed. Now it starts a new copy from the snapshot. The new copy held `Beds` once, and the waiting edit was saved as the separate local file "Notes (your edits)" with a status line naming it. With that step turned off, the old copy was reused and the test failed. `cargo test -p suiteleaf-node --test multiuser generations` passed (1 test): Sam's edit from the first room was refused as stale in the next generation, and `Tomatoes are gone` did not reach the room. `npx vitest run tests/ui/collab-session-room.test.tsx tests/collab-reconnect.test.ts tests/collab-recovery.test.ts tests/workspace-room-stranded.test.ts` passed.

2026-11-04: the protocol is written in `docs/collaboration-protocol.md`. It covers messages, ordering, idempotency, acknowledgement, generations, presence, the access bound, reconnecting, and replication across nodes. The capability `cap-doc-collaboration` is `verified`, with Rust, browser, and unit evidence and the limits below. The README no longer says real-time editing is deferred. Full runs: `npx vitest run --coverage` passed (614 files, 4,467 tests); statements were 93.82% and lines 96.69%. `apps/web/src/collab/session.ts` was at 97.43% statements, `recovery.ts` at 100%, `connection.ts` at 93.4%, and `workspace/workspace-room.ts` at 93.75%. `cargo test -p suiteleaf-node` passed (65 unit, 1 cluster, 36 multiuser). `cargo clippy -p suiteleaf-node --all-targets` reported nothing. `npx playwright test tests/browser/doc-collab.spec.ts --project=chromium` passed (6 tests). This was opened in two browsers.

Acceptance evidence:
- Different nodes converge on text, formatting, tables, and images, and reopening keeps them: `formatted_text_a_table_and_an_image_converge_on_another_node`.
- Network loss: `a_dropped_connection_and_a_duplicate_edit_keep_the_saved_text` and the browser test `a dropped connection says it is reconnecting`.
- Token expiration: `an_expired_session_cannot_change_the_open_room` and the `standing` tests.
- Duplicate messages: `a_repeated_update_is_acknowledged_once_in_the_journal`.
- Simultaneous joins: `simultaneous_joins_see_the_saved_edit` and `joins_before_the_log_arrives_still_see_the_edit`.
- Node restart: `a_restart_keeps_an_edit_that_was_written_to_the_log`.
- Revoked access within a documented bound of 5 seconds: the `standing` tests. Commenters cannot forge edits: `a_viewer_or_commenter_cannot_change_the_live_document` and `a_commenter_may_store_a_comment`.
- Undo keeps the other person's work: the browser undo and redo test and `undoing_one_paragraph_keeps_the_other_persons_text`.
- Going idle keeps edits: `tests/session-idle.test.ts`.
- The fault cases replay the same three-node fixture: Garden notes, with "North bed" and "South bed".

Known limits, not hidden:
- Waiting edits live in the tab's session storage, so closing the tab before an `ack` loses them.
- Reconnecting sends the full room state, not a diff against a state vector.
- A role change stops the room until the file is opened again.
- An open room on another node can be one 30-second sweep behind.
- Old-generation edits are kept as a local copy, not merged.

Status is `in_review`, not `done`. The portfolio clears a prerequisite only after its evidence is accepted, so WP-003, WP-004, and WP-018 stay blocked on WP-002 until then.

2026-11-04, later: the product owner accepted the evidence above. Status is `done`. WP-003, WP-004, and WP-018 no longer wait on WP-002. The known limits listed above still apply.
