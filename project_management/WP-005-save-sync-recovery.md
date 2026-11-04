---
id: "WP-005"
title: "Explainable saving, synchronization, and conflict recovery"
type: "work_package"
status: "in_progress"
priority: "P0"
phase: 1
area: "storage"
created: "2026-10-29"
updated: "2026-10-30"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S04", "S05", "S06"]
---

# Explainable saving, synchronization, and conflict recovery

## Outcome and rationale

Remove uncertainty about where work is saved. Users must distinguish a durable local edit from one safely synchronized to SuiteDrive and recover from conflicts without guesswork.

## Existing implementation and starting points

Start with `apps/web/src/storage.ts`, `apps/web/src/drive/status.ts`, `apps/web/src/drive-watch.ts`, `apps/web/src/node-client.ts`, `apps/desktop/src/store.ts`, and `crates/suiteleaf-node/src/drive_api.rs`. Existing local drafts, atomic desktop writes, upload/version conflicts, and history are foundations to extend.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Define a revision-aware save state machine: editing, saving locally, saved locally/pending sync, syncing, synced, offline, conflict, and failed. A success label must refer to a persisted revision.
- Persist a resumable per-file upload queue with idempotency, retry/backoff, last success, pending size, and an actionable failure reason. Account for expired credentials and quotas.
- Provide local-versus-remote comparison, save-both, and selective recovery where editor diffs permit it; preserve both source versions before resolution.
- Show storage location and sync target in the editor/library. Never silently redirect a local file into hosted storage.
- Expose non-content sync health for administration and diagnostics. Coordinate version/ack semantics with WP-002 when collaboration is active.

## Dependencies and delivery

No hard work-package prerequisites. Coordinate shared interfaces with the packages linked in the portfolio index.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- A locally saved but unsynchronized edit is never labeled fully synced.
- Crash/relaunch and offline/reconnect retain pending work; retry does not create duplicate versions or copies.
- External desktop modification and remote version conflicts retain both versions until the user resolves them.
- Each failed item offers a specific remedy and can be retried independently.

## Verification

- Vitest state-machine, persistence, idempotency, and conflict tests; Rust tests for preconditions and upload failures.
- Use temporary files for desktop atomic-write/recovery verification and simulated network/auth failures for queue tests.
- Test failure of a queued save does not poison later saves.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

This package does not make third-party Google Drive/Dropbox sync reliable; show the boundary when users choose their folders. Replication health and backup are separate states.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S04`, `S05`, `S06`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.

# Progress

2026-10-30: In progress. `apps/web/src/save-state.ts` is the status decision for the open file. The label `Saved to SuiteDrive` is produced only when `drive.syncedAt` equals `file.updatedAt`. A local edit that has not been uploaded is `Saved on this device · not yet on SuiteDrive`, a signed-out pending upload says to sign in, and an offline pending upload says offline. A revision that already matches stays `synced` while the browser is offline. Conflict and a failed local save take precedence. The editor status in `App.tsx` uses this for load, local save, SuiteDrive upload, save-to-drive, conflict copy, and version restore. `tests/save-state.test.ts` passed (4 tests).

2026-10-30, later: `apps/web/src/upload-queue.ts` stores one pending SuiteDrive upload per file in `localStorage`. A repeated enqueue of the same revision keeps the attempt count. A newer revision replaces the older job for that file. Network, quota, and other failures back off from 1s to 30s and can be retried from the status line without changing other files' schedules. A conflict or a signed-out session is not written again on a timer. Before a retry writes, the editor reads the remote body and adopts that version when the bytes already match, so a lost response does not create a second version. `tests/upload-queue.test.ts` passed (4 tests). The web app typecheck passed.

2026-10-30, later still: `mergeDocumentBlocks` combines a document when each changed block differs from the last synchronized copy on only one side. Both the local and remote documents are copied into the result first. A block changed on both sides is refused and no combined document is returned. The conflict banner's Combine separate edits action uploads the local document as “your edits” before it replaces the open file with the combination and points the next upload at the SuiteDrive version just read. A spreadsheet, extra tabs, or a missing synchronized copy stays as two versions. `npx vitest run tests/conflict-merge.test.ts` passed (5 tests). This path was not exercised in the browser; it needs two SuiteDrive versions of one document.

2026-10-30, later: `syncHealth` summarizes this browser's upload queue as file counts, byte size, retries, and the remedy for each failure kind. The report omits file ids, revisions, names, and server error text. Admin shows it as “Uploads from this browser” and refreshes every 2 seconds. `npx vitest run tests/upload-queue.test.ts tests/ui/sync-health.test.tsx` passed (6 tests). The note is inside the cluster Admin screen, so a single-node library does not show it. It is this browser's queue, not other people's uploads or node replication lag.

2026-10-30, later: `Db::replication_lag` reports how many operations each known peer is behind this node. A peer from a different database is not compared with its old cursor; it is behind by the whole log. The report has peer ids and counts, not op payloads. Admin loads `/api/admin/replication` every 2 seconds and shows those counts. `cargo test -p suitedb --test crdt replication_lag_counts_ops_and_leaves_out_payloads` passed. `npx vitest run tests/ui/sync-health.test.tsx` passed (2 tests). The panel is on the cluster Admin screen. A single-node library redirects away from Admin, so it was not shown in the browser.

2026-10-30, later: Reload from SuiteDrive first saves the open file as a new local file titled with “(your edits)” and no SuiteDrive link, then opens the remote version in the original file. If that local save fails, the remote version is not opened. `npx vitest run tests/conflict-merge.test.ts` passed (6 tests). The existing browser conflict spec still expects the open editor to show the SuiteDrive text after reload; that spec was not re-run here.

2026-10-31: a file saved as `Original` is changed on disk to `Cloud edit`. Saving the open title `Unsaved local edit` is refused. The file on disk still contains `Cloud edit` and does not contain `Unsaved local edit`. The library keeps a recovery draft titled `Unsaved local edit`. `npx vitest run tests/store.test.ts -t "preserves recovery drafts"` passed. The two copies stay until the file is removed or saved another way.

2026-10-31, later: two failed uploads keep their own schedules. Releasing the quota failure makes that file due now. The unreachable file stays on its later time. The admin list shows `File 1. Free space in SuiteDrive, then retry this file.` and a Retry button. The file id `secret-item` is not shown. Clicking the first Retry reports that id and not the other file. `npx vitest run tests/upload-queue.test.ts tests/ui/failed-uploads.test.tsx tests/ui/sync-health.test.tsx` passed (10 tests). A single-node library redirects away from Admin, so the list was not opened in the browser. The open editor's Retry sync button still retries only the open file.

2026-10-31, later: a conflict on `beds` is still not due after a new queue reads the same stored jobs. A stored entry for `secret-item` whose next time is `soon` is left out, and a later save of `beds` revision `rev-2` is due. `npx vitest run tests/upload-queue.test.ts tests/ui/failed-uploads.test.tsx tests/ui/sync-health.test.tsx` passed (11 tests). The test used an in-memory store with the same read and write path. It was not a browser reload. The open editor's Retry sync button still retries only the open file.

2026-10-31, later: the editor lists each failed upload. Retrying Beds uploads the saved revision `2026-10-31T18:00:00.000Z` and leaves Paths on its later schedule. When SuiteDrive already has those bytes, no new version is written. A newer local revision of Beds is not uploaded in place of the queued one, and a file that is not on this device is not uploaded. The list shows the remedy and not the file id. `npx vitest run tests/retry-upload.test.ts tests/ui/editor-failed-uploads.test.tsx tests/ui/failed-uploads.test.tsx` passed (5 tests). The list was not opened in the browser. The open file's Retry sync button still retries only that open file.

2026-10-31, later: `runDueUploads` tries each file that is due. Beds fails because SuiteDrive is unreachable, and Paths is still uploaded and removed from the queue. A second pass at the same time does not upload Paths again. Beds keeps a network failure and waits for its own retry. `npx vitest run tests/upload-queue.test.ts` passed (8 tests). The open editor's Retry sync button still retries only the open file. This runner is not that button.

2026-11-01: a conflict whose report is `newer secret-value` stores `The SuiteDrive copy changed.` An unreachable report that includes `secret-value` stores `SuiteDrive could not be reached.` Neither stored failure contains `secret-value`. `npx vitest run tests/upload-queue.test.ts` passed (9 tests). The upload was not sent. The conflict bar was not opened in the browser.

2026-10-31, later: Retry sync still uploads the open file. It also retries every other failed upload that is due. A failed read of Beds does not stop Paths. Paths is uploaded and removed. Beds keeps a network failure. `npx vitest run tests/retry-upload.test.ts` passed (4 tests). The button was not clicked in the browser.

2026-10-31, later: a full SuiteDrive is not retried on a timer. The stored note is `SuiteDrive does not have room for this file.` and does not contain `secret-value`. An expired sign-in uses `SuiteDrive needs a sign-in before this file can upload.` and also leaves out `secret-value`. Neither file is due until it is released. `npx vitest run tests/upload-queue.test.ts tests/retry-upload.test.ts tests/ui/failed-uploads.test.tsx tests/ui/editor-failed-uploads.test.tsx tests/ui/sync-health.test.tsx` passed (17 tests). The list was not opened in the browser.

2026-10-31, later: a file with no SuiteDrive link is `local`. The label stays `Saved on this device`. A desktop file stays `Saved to file`, and a draft stays `Draft saved · choose Save As`. A SuiteDrive file whose local revision is newer stays `pending-sync`, labeled `Saved on this device · not yet on SuiteDrive`. `npx vitest run tests/save-state.test.ts` passed (4 tests). The status line was not opened in the browser.

2026-11-01: each library row shows the same save label. Beds with no SuiteDrive link reads `Saved on this device` and does not say it was saved to SuiteDrive. A matching SuiteDrive revision reads `Saved to SuiteDrive`. A newer local revision reads `Saved on this device · not yet on SuiteDrive`. A desktop path reads `Saved to file`. The file id `secret-value` is not shown. `npx vitest run tests/ui/file-library-row.test.tsx tests/save-state.test.ts` passed (5 tests). At `http://127.0.0.1:5173/` the library links included `Untitled document Saved on this device`. Those files were already on this computer. No SuiteDrive file was opened in that check. The preview server is stopped and port 5173 is free.

2026-11-01: a successful upload of `secret-value` records `2026-11-01T00:00:00.000Z` and removes that file from the queue. The health report includes that time and does not include `secret-value`. A stored time of `secret-value` is ignored. The admin note says `The last successful upload was at 2026-11-01T00:00:00.000Z.` With no time it says `No upload has succeeded from this browser.` `npx vitest run tests/upload-queue.test.ts tests/ui/sync-health.test.tsx tests/retry-upload.test.ts` passed (16 tests). The admin page was not opened in the browser.

2026-11-01: Keep both parts stacks a paragraph that changed on both sides. `North` stays, then `secret-value`. The separate merge still has no combined document, and its explanation does not contain `secret-value`. The local and remote copies passed in stay as they were. `npx vitest run tests/conflict-merge.test.ts` passed (7 tests). The conflict bar was not opened in the browser.

2026-11-01: Keep both parts on a spreadsheet adds the other copy of a changed sheet. The open sheet stays `North`. The added sheet is `Sheet1 (other copy)` and its cell stays `secret-value`. Cells are not merged. Choosing the document combine still returns no spreadsheet. The local workbook passed in still has one sheet. `npx vitest run tests/conflict-merge.test.ts` passed (8 tests). The conflict bar was not opened in the browser.

2026-11-01: a changed sheet is still added when `other` plus that sheet id is already used. The sheet named `Taken` stays `West`. The remote cell `secret-value` is added as `Sheet1 (other copy 2)`. The open sheet stays as it was. `npx vitest run tests/conflict-merge.test.ts -t "another sheet"` passed (1 test). The conflict bar was not opened in the browser.

2026-11-01: a changed slide is still added when `other` plus that slide id is already used. The slide titled `Taken` stays `West`. The remote title text `secret-value` is added as `Slide (other copy 2)`. The open slide stays `North`. `npx vitest run tests/conflict-merge.test.ts -t "another slide"` passed (1 test). The conflict bar was not opened in the browser.

2026-11-01: Keep both parts on a presentation adds the other copy of a changed slide. The open slide stays `North`. The added slide is titled `Slide (other copy)` and its title text stays `secret-value`. Objects are not merged. The deck passed in still has one slide. `npx vitest run tests/conflict-merge.test.ts` passed (9 tests). The conflict bar was not opened in the browser.

2026-11-01: Keep both parts keeps a master object that is only on the other presentation. The open master stays `North` on a white background. The other object's text `Beds` is added. The other deck still has a black background and both objects. `npx vitest run tests/conflict-merge.test.ts -t "master object"` passed (1 test). The conflict bar was not opened in the browser. The slides were not drawn.

2026-11-01: named cells can be taken from the other spreadsheet. `B1` becomes `secret-value` and `A1` stays `North`. An address `secret-value` is refused with `Name a cell, such as B2.` and that word is not in the message. The spreadsheet passed in stays `Bean` in `B1`. `npx vitest run tests/conflict-merge.test.ts` passed (10 tests). The conflict bar does not ask for these cells yet, and it was not opened in the browser.

2026-11-01: the conflict bar asks which cells to take. A bad address shows `Name a cell, such as B2.` and does not repeat `secret-value`. Taking `B1` and `A1` says `Those cells were taken from the other copy.` `npx vitest run tests/ui/conflict-cells.test.tsx tests/conflict-merge.test.ts` passed (11 tests). The conflict bar was not opened in the browser.

2026-11-01: an edit titled `My edit` stays as a recovery draft when the file on disk was changed to `External edit`. Reloading reads `External edit`. Opening the store again still has the draft. The refusal says the file changed outside SuiteLeaf. `npx vitest run tests/store.test.ts -t "recovery draft"` passed (2 tests). The desktop app was not started.

2026-11-01: a success time is kept only when it is a whole number of milliseconds. A blank time, a fraction, and a negative time are left off the upload note. A known time still says `The last successful upload was at 2026-11-01T00:00:00.000Z.` `npx vitest run tests/upload-queue.test.ts tests/ui/sync-health.test.tsx` passed (13 tests). The admin page was not opened in the browser.

2026-11-01: an upload remembers how many bytes were accepted. A 2,500-byte file with 1,000 bytes accepted has its next slice from 1,000 to 2,000. A failure keeps that place, and the failure sentence does not include `secret-value`. When all 2,500 bytes are accepted, there is no further slice. A stored count that is not a whole number is ignored. `npx vitest run tests/upload-queue.test.ts` passed (11 tests). This records the place and does not itself send the file. The admin page was not opened in the browser.

2026-11-01: a file the server has already accepted is not sent again. A 2,500-byte file with 2,500 bytes accepted is marked done, and the sender is not called. A file with 1,000 bytes accepted is handed to the sender, and the next slice is 1,000 to 2,000. `npx vitest run tests/upload-queue.test.ts` passed (12 tests). The SuiteDrive save in the app still sends the whole body. The admin page was not opened in the browser.

2026-11-01: a named cell can name its sheet. `Fees!B2` becomes 9 from the other copy, and the first sheet stays `North`. A sheet named `secret-value` says `That sheet is not in the other copy.` and that name is not in the message. `npx vitest run tests/conflict-merge.test.ts` passed (10 tests). The conflict bar was not opened in the browser.

2026-11-01: a range of cells can be taken from the other spreadsheet. `B1:B2` takes both cells and leaves `A1` as `North`. A range of more than 256 cells says `Name a smaller range.` and does not repeat the address. `npx vitest run tests/conflict-merge.test.ts` passed (10 tests). The conflict bar was not opened in the browser.

2026-11-01: an empty file is sent until the server accepts it. A new empty file calls the sender once. After those zero bytes are accepted, the sender is not called again. `npx vitest run tests/upload-queue.test.ts` passed (13 tests). The SuiteDrive save still sends the whole body. The conflict bar was not opened.

2026-11-01: a range can name its sheet. `Fees!B2:C2` takes 9 and 4 from the Fees sheet on the other copy. The first sheet stays `North`. `npx vitest run tests/conflict-merge.test.ts` passed (10 tests). The conflict bar was not opened in the browser.

2026-11-01: a SuiteDrive save sends the next slice instead of the whole file. `Beds` is kept until ` north` arrives, and the saved file is `Beds north`. A slice that starts at the wrong place says `That upload does not continue the saved part.` and does not repeat `secret-value`. The first part stays. The editor asks for each slice and records how far the server got. An empty file is still sent whole. `cargo test -p suitedrive --test drive a_span_upload_keeps_the_first_part` passed (1 test). `npx vitest run tests/upload-queue.test.ts -t "sends the next slice"` passed (1 test). The content route was not requested over the network. A partial upload is kept in the node process, so a restart asks for the file from the start. The editor was not opened.

2026-11-01: the accepted part of an upload is kept on disk. After the store is opened again, `Beds` is still there and ` north` completes `Beds north`. The partial file is removed. `cargo test -p suitedrive --test drive a_restart_keeps_the_accepted_part` passed (1 test). The content route was not requested over the network. The editor was not opened.

2026-11-01: `PUT /api/drive/items/{id}/content` with `Content-Range` was requested on a running node. The first slice is accepted and does not repeat `Beds`. A range that does not continue says `That upload does not continue the saved part.` and does not repeat `secret-value`. The next slice stores `Beds north`, and reading the file returns that text. `cargo test -p suiteleaf-node --test multiuser a_content_range_upload_finishes_over_http` passed (1 test). The editor was not opened.

2026-11-01: Keep both parts on a form keeps a changed response and a response that only the other copy has. The open answer stays `North`. The other copy of that response stays `secret-value` under a new id, and `West` is added. When the questions differ, both versions stay separate and that sentence does not include `secret-value`. The form passed in still has one response. `npx vitest run tests/conflict-merge.test.ts -t "another response"` passed (1 test). The conflict bar was not opened in the browser.

2026-11-01: Keep both parts on a drawing places the other picture under the local one. The local picture still says `Hello`, and the other picture still says `secret-value`. A picture that contains a script is not combined, and that sentence does not include the script. A Mermaid diagram appends the other copy after `%% other copy`. The drawing passed in still says `Hello`. `npx vitest run tests/conflict-merge.test.ts -t "other drawing"` passed (1 test). The conflict bar was not opened in the browser.

2026-11-01: a document merge keeps comment threads from the copy that changed them. The combined document has the local paragraph `ONE` and the other copy's thread `Water the beds`. Changing the thread afterward does not change the combined document. When both copies change those settings, both versions stay separate. The notice does not include `secret-value`, and that thread stays on the copy passed in. `npx vitest run tests/conflict-merge.test.ts -t "comment threads|document settings"` passed. The conflict bar was not opened in the browser.

2026-11-01: comments added on each copy combine when each thread has its own id. One copy's thread `North` and the other copy's thread `Water the beds` both stay. A paragraph style on one copy and a comment on the other both stay. A thread both copies rewrote stays separate. The notice does not include `secret-value`. `npx vitest run tests/conflict-merge.test.ts -t "different ids|different copies|both copies rewrote|comment threads|document settings"` passed (5 tests). The conflict bar was not opened in the browser.

2026-11-01: Keep both parts keeps a chart from the other spreadsheet on the copied sheet. The chart title stays `Fees`, and its source range names that copied sheet. The open sheet stays `North`. The spreadsheet passed in still has no charts, and the other copy's chart still names its own sheet. `npx vitest run tests/conflict-merge.test.ts -t "chart from the other"` passed (1 test). The conflict bar was not opened in the browser. The chart was not drawn.

2026-11-01: Keep both parts keeps a pivot from the other spreadsheet on the copied sheet. The pivot title stays `Sales`. Its source range and its result both name that copied sheet. The open sheet stays `North`. The spreadsheet passed in still has no pivots, and the other copy's pivot still names its own sheet. `npx vitest run tests/conflict-merge.test.ts -t "pivot from the other"` passed (1 test). The conflict bar was not opened in the browser. The pivot was not calculated.

2026-11-01: an empty file is sent as `bytes 0-0/0` and becomes a version. Reading it back is empty. A range `bytes 1-1/0` is not a range. `Beds north` still arrives as two slices. `cargo test -p suitedrive --test drive a_span_upload_keeps_the_first_part` passed (1 test). `cargo test -p suiteleaf-node --test multiuser a_content_range_upload_finishes_over_http` passed (1 test). `npx vitest run tests/upload-queue.test.ts -t "empty file"` passed (2 tests). The editor was not opened. The SuiteDrive save uses that same range for an empty body.

2026-11-01: a storage budget refuses a file that does not fit. A budget of 8 bytes refuses `keep this`. `beds` is stored. A later write of `secret-value` is refused with `SuiteDrive does not have room for this file.` and that word is not in the sentence. The saved file stays `beds`. A budget written as `secret-value` says `The storage budget is not a whole number of bytes.` and that word is not in the sentence. A span whose total does not fit is refused too. `cargo test -p suitedrive --test drive a_storage_budget_refuses_a_file_that_does_not_fit` passed (1 test). `cargo check -p suiteleaf-node` passed. The content route was not requested over the network. The editor was not opened.

2026-11-01: a SuiteDrive refusal to change a file is not retried on a timer. The stored note is `You cannot change this SuiteDrive file.` and `Ask for access, then retry this file. This copy stays on this device.` The server sentence `secret-value` is not stored. Another file stays due. Reloading the queue keeps that refusal. `npx vitest run tests/upload-queue.test.ts tests/retry-upload.test.ts tests/ui/sync-health.test.tsx` passed (23 tests). The editor was not opened. The upload was not sent.

2026-11-02: a SuiteDrive file that is not there is not retried on a timer. The stored note is `That SuiteDrive file is not there.` and `Check the folder, then retry this file. This copy stays on this device.` The server sentence `secret-value` is not stored. Another file stays due. Reloading the queue keeps that missing file. `npx vitest run tests/upload-queue.test.ts -t "not on SuiteDrive|cannot change"` passed (2 tests) at 02:25:04. The editor was not opened. The upload was not sent.

2026-11-02: a SuiteDrive node that answers 429 is not retried on a timer. The stored note is `SuiteDrive is busy with other uploads.` and `Wait, then retry this file. This copy stays on this device.` The server sentence is not stored. Another file stays due. Reloading the queue keeps that busy file. `npx vitest run tests/upload-queue.test.ts -t "too busy"` passed (1 test) at 05:10:32. The editor was not opened. The upload was not sent.

2026-11-03: a SuiteDrive save is synced only when both times are the same stored revision. `2026-10-30T18:00:00.000Z` says `Saved to SuiteDrive` and the library row shows that time. A matching pair of `secret-value`, and a matching pair of `2026-02-31T00:00:00.000Z`, stay `Saved on this device · not yet on SuiteDrive`. Neither value is in the label. A newer local revision still does not say it was saved to SuiteDrive. `npx vitest run tests/save-state.test.ts tests/ui/file-library-row.test.tsx` passed (5 tests). Coverage for `apps/web/src/save-state.ts` was 96.36% statements, 95.31% branches, 100% functions, and 94.87% lines. The editor status line was not opened. The library row was rendered in a test page.

2026-11-03: the open editor names that same stored revision. The status text stays `Saved to SuiteDrive`. The title on that status is `2026-10-30T18:00:00.000Z` when the revision matches. A newer local revision leaves the title empty, and so does a matching pair of `secret-value`. `npx vitest run tests/save-state.test.ts` passed (4 tests). Coverage for `apps/web/src/save-state.ts` was 96.55% statements, 95.71% branches, 100% functions, and 95.12% lines. The SuiteLeaf window was not opened.

2026-11-03: saving the same bytes again does not add a version. `beds` stays one version, and the head id does not change. `beds north` adds a second version. Saving `secret-value` twice stays one version of that text, so the file has three versions in all. `cargo test -p suitedrive --test drive a_retry_of_the_same_bytes` passed (1 test). The earlier conflict test still passed. The editor was not opened. This does not start a node.

2026-11-03: an idle compact of the same bytes also does not add a version. `write_head` of `secret-value` keeps the same head. `beds again` adds one version. `cargo test -p suitedrive --test drive a_retry_of_the_same_bytes` passed (1 test). `cargo test -p suiteleaf-node --bin suiteleaf-node compaction_keeps_both_paragraphs` passed (1 test). The editor was not opened. This does not start a node. An edit that never reached the log is still lost on another node.

2026-11-03: the library row names the SuiteDrive host. `http://127.0.0.1:8787` says `SuiteDrive on 127.0.0.1:8787`. `https://user:secret-value@leaf.example/drive?token=secret-value` says `leaf.example`, and that word is not in the host. An address that is not a web address is left out. `npx vitest run tests/save-state.test.ts tests/ui/file-library-row.test.tsx` passed (5 tests). Coverage for `apps/web/src/save-state.ts` was 97.1% statements, 96.25% branches, 100% functions, and 95.91% lines. The library row was rendered in a test page. The SuiteLeaf window was not opened.

2026-11-03: the open editor's status title names that host with the stored revision. The visible words stay `Saved to SuiteDrive`. The title is `2026-10-30T18:00:00.000Z · leaf.example`. A password `secret-value` in the address is not in the title. `npx vitest run tests/save-state.test.ts` passed (4 tests). Coverage for `apps/web/src/save-state.ts` was 97.26% statements, 96.47% branches, 100% functions, and 96.15% lines. The SuiteLeaf window was not opened.

2026-11-03: a shared edit that is still on this device is not labeled saved to SuiteDrive. The file times match, and the label stays `Saved on this device · not yet on SuiteDrive`. The revision is empty. After that edit is stored, the label is `Saved to SuiteDrive` again. A count that is not a number does not change the label, and `secret-value` is not in it. `npx vitest run tests/save-state.test.ts tests/ui/file-library-row.test.tsx` passed (6 tests). Coverage for `apps/web/src/save-state.ts` was 97.43% statements, 96.9% branches, 100% functions, and 96.49% lines. The SuiteLeaf window was not opened. An edit that never reached the log is still lost on another node.
