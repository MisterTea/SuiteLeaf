---
id: "WP-010"
title: "Independent backups and disaster recovery"
type: "work_package"
status: "in_progress"
priority: "P0"
phase: 1
area: "operations"
created: "2026-10-29"
updated: "2026-10-30"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S14"]
---

# Independent backups and disaster recovery

## Outcome and rationale

Protect against deletions, corruption, operator mistakes, and loss of an entire cluster. Full replication copies failures too and is not an independent backup.

## Existing implementation and starting points

Start with `docs/suitedb.md`, `docs/architecture.md`, `crates/suitedb`, `crates/suitedrive/src/blobs.rs`, and `deploy/`. Each node holds accounts/files; desktop local drafts live separately from document files.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Define consistent backup manifests spanning database state, blobs, versions, configuration, and recoverable key material. Avoid snapshots whose database references missing blobs.
- Support scheduled encrypted backups to independent storage with retention, integrity verification, resumable transfer, and separate credentials; document immutable/offline storage options.
- Implement file/version, folder, and full-cluster restore with dry-run and restore-as-copy options. Validate tenant/identity/ACL mapping when restoring into a different environment.
- Add routine automated restore drills and last-success/last-tested indicators. Define measurable recovery point and recovery time objectives from pilot requirements.
- Document local-desktop backup boundaries, encryption-key recovery, and how to recover without a functioning original cluster.

## Dependencies and delivery

No hard work-package prerequisites. Coordinate shared interfaces with the packages linked in the portfolio index.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- Restore a complete cluster into a clean environment and verify content hashes, versions, permissions, and authentication configuration.
- Recover a deleted folder without rolling unrelated files backward.
- Corrupt or incomplete backups are rejected before they overwrite live data.
- Operators can see backup freshness and actual successful restore-test evidence.

## Verification

- Rust/integration tests with consistent snapshot and restore fixtures; fault injection during backup and restore.
- Test lost nodes, missing blobs, encrypted backup with incorrect key, and incremental-chain gaps.
- Measure recovery time/data loss on a documented representative dataset; do not invent service guarantees.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Replication, legal retention, and device sync are separate functions. Do not advertise end-to-end encryption simply because backup archives are encrypted.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S14`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.

# Progress

2026-10-30: In progress. `crates/suitedrive/src/backup.rs` writes a directory of file bytes plus `manifest.json` only when every referenced content hash and chunk is already present. A missing chunk removes the directory. `verify_backup` checks each blob's hash. `restore_blobs` runs that check before copying into a live store, and a dry run writes nothing. A corrupt archive fails the check and leaves the live store unchanged. `cargo test -p suitedrive --lib backup` passed (3 tests). The limits are in `docs/backup.md`. `recordedAt` is the archive time.

2026-10-30, later: `export_backup_with_database` adds a caller-supplied `database.sqlite` and records its hash. `verify_backup` checks that hash before `restore_blobs` copies anything. A flipped byte fails the check and leaves the live blob store unchanged. `cargo test -p suitedrive --lib backup` passed (4 tests). The function does not open the database or recreate accounts.

2026-10-30, later still: `restore_contents` copies one set of content hashes and their chunks after `verify_backup`. A dry run writes nothing. A hash that is not in the manifest copies nothing, including the other files that were requested with it. A second file that is in the archive but not requested stays out of the live store. `cargo test -p suitedrive --lib backup` passed (5 tests).

2026-10-30, later: `Db::checkpoint_copy` uses SQLite's backup API, and `export_backup_from_database` stores that snapshot. A row written after the checkpoint is not in the archived file. The temporary checkpoint file is removed. `cargo test -p suitedrive --lib backup` passed (6 tests). The snapshot is not applied onto a running node's accounts.

2026-10-30, later still: `record_restore_drill` restores into a scratch store, reassembles every content, and writes `drill.json` only after that succeeds. `drilledAt` is the drill time and is not `recordedAt`. A corrupt blob leaves no `drill.json`. The scratch directory is removed and an unrelated live store is unchanged. `cargo test -p suitedrive --lib backup` passed (7 tests).

2026-10-30, later: `seal_backup` encrypts a finished backup directory with a caller-supplied 32-byte key. `open_sealed` decrypts into a new directory and checks hashes. A wrong key or a flipped byte leaves no directory. `cargo test -p suitedrive --lib seal` passed (1 test). The key is not a passphrase. This is not end-to-end encryption of documents on the node, and nothing uploads the sealed file or applies a retention schedule.

2026-10-30, later: `retention_plan` keeps the newest backup even when it is older than the cutoff, and keeps a copy with no recorded time. `apply_retention` deletes only the directories that plan lists. A plan whose kept directory has no `manifest.json` deletes nothing. `cargo test -p suitedrive --lib backup` passed (8 tests). The newest copy's `recordedAt` is the freshness time. This does not measure recovery time and does not send the archive to other storage.

2026-10-31: `drill.json` now includes `elapsedMs`, the wall time of that successful drill. The unit fixture is one content, `drill me`, and the saved file's `elapsedMs` matches the value returned by the drill. A corrupt archive still writes no `drill.json`. `cargo test -p suitedrive --lib backup` passed (8 tests). `elapsedMs` is not a recovery-time target. 2026-10-31, later: `store_sealed` copies a sealed backup into a different directory and keeps that copy only when the key opens it. A copy in the sealed file's own directory is refused and no file is left there. A wrong key removes the copy. The test archive holds one content, `offsite bed`, and the kept copy opens to that content. `cargo test -p suitedrive --lib seal` passed (2 tests). The destination is another directory on this machine, not a remote storage service.

2026-10-31, later still: `restore_folder` writes one folder and the files inside it from the backup snapshot into a live database. The folder name is "Beds" and the file is "Tomatoes". A different file, "Other", keeps its current version `v-stay` and the backup's older bytes for that file are not copied. `cargo test -p suitedrive --lib a_deleted_folder_comes_back_without_changing_another_file` passed. The same test copies the folder grant for Sam as editor and leaves the grant on "Other" as owner. The backup's older viewer grant on "Other" is not written. The same test copies Sam's account because the folder grant names Sam and the live database has no Sam. Noor's account is not copied. Ada's existing account stays "Ada" instead of the snapshot's "Ada old". A second restore leaves Sam's updated email `sam-live@example.com` in place. Desktop drafts are not in this archive.

2026-10-31, later: the same folder restore copies Sam’s name and email and leaves the password column empty. The snapshot stored `secret-value` on Sam, and that value is not on the restored account. `cargo test -p suitedrive --lib a_deleted_folder_comes_back_without_changing_another_file` passed. A password hash, token, or private key is left out the same way. This does not restore a node identity or a swarm key.

2026-10-31, later: `restore_auth_config` copies the organization sign-in row onto a database that has none. The issuer is `https://idp.example`, the audience is `suiteleaf`, and the idle time is 1800 seconds. The snapshot’s client secret `secret-value` is not on the restored row. A second restore leaves the live issuer `https://kept.example` in place. `cargo test -p suitedrive --lib a_clean_database_gets_the_sign_in_settings_without_the_client_secret` passed. This does not restore a node identity or a swarm key, and it does not apply the row onto a running node by itself.

2026-10-31, later: `backup_freshness` reports the archive time `2026-10-31T12:00:00.000Z`, one file, and no restore test when `drill.json` is absent. After a successful drill it reports `2026-10-31T13:00:00.000Z` and 12 ms. The report does not contain `secret-hash-value` or `secret-value`. Admin shows that sentence. `cargo test -p suitedrive --lib freshness_names_the_backup_time_and_a_successful_drill` passed. `npx vitest run tests/ui/backup-freshness.test.tsx` passed (1 test). The node compiles with `GET /api/admin/backup`. The directory is `SUITELEAF_BACKUP_DIR`, not a path from the request. A single-node library redirects away from Admin, so the note was not opened in the browser. `elapsedMs` is not a recovery-time target.

2026-11-01: a `drill.json` that is not a drill record makes `backup_freshness` return `That restore drill record cannot be read.` The file text `secret-value` is not in that error. `cargo test -p suitedrive --lib a_broken_drill_record_does_not_repeat_its_text` passed (1 test). This does not restore the archive and does not upload it.

2026-10-31, later: `resume_sealed_copy` copies 16 bytes of a sealed archive, then a later call copies the rest. The content is `resume bed`. A destination that starts with `other-bytes` is left as `other-bytes`. A copy beside the sealed file is refused. A wrong key removes the finished copy and leaves no file. `cargo test -p suitedrive --lib seal` passed (3 tests). The destination is another directory on this machine, not a remote storage service. A partial copy is not opened.

2026-11-01: sealing `secret-value.seal` a second time says `That sealed backup already exists.` The sentence does not contain `secret-value` or the key. A backup directory that is already there says `That backup destination already exists.` An independent copy that is already there says `That independent copy already exists.` `cargo test -p suitedrive --lib a_wrong_key_or_a_changed_byte_writes_nothing` passed. This does not upload the sealed file. This is not end-to-end encryption of documents on the node.

2026-10-31, later: `restore_clean` writes the snapshot into an empty database. Beds, Tomatoes, and Other all come back. Tomatoes reads `tomatoes` and Other reads `old other`. Sam is editor on Beds and viewer on Other. Sam’s password `secret-value` is not on the restored account. Noor is not copied. The sign-in issuer is `https://idp.example` and the client secret is not copied. A database that already has Notes is left as Notes, and that attempt copies no bytes. `cargo test -p suitedrive --lib a_clean_database_gets_the_snapshot_and_a_used_database_is_left_alone` passed. This does not start a node, and it does not copy a node identity or a swarm key.

2026-10-31, later: `export_incremental` stores Paths without copying the Beds blobs already in Monday's archive. Wednesday names Tuesday's manifest. Checking Monday, Tuesday, and Wednesday succeeds. Tuesday alone is a chain gap. Monday then Wednesday, skipping Tuesday, is a chain gap. Changing Monday's recorded time after Tuesday was written is a chain gap. The live store does not receive Paths, North, or Beds from that failed check. `cargo test -p suitedrive --lib backup` passed (13 tests). These are directories on this machine, not a remote storage service.

2026-10-31, later: `restore_chain` copies Beds, Paths, and North into a live store after Monday, Tuesday, and Wednesday check. A dry run names 3 contents and writes nothing. Monday then Wednesday, skipping Tuesday, writes nothing. Changing Monday's recorded time and then restoring Monday and Tuesday also writes nothing into a second store. The earlier live store still reads `beds`. `cargo test -p suitedrive --lib an_incremental_chain_refuses_a_missing_middle_backup` passed. These are directories on this machine, not a remote storage service. This does not start a node.

2026-10-31, later: `attach_database` stores a SuiteDB snapshot on Tuesday. `restore_chain_database` writes Beds and Paths into an empty database. Beds is read from Monday and Paths from Tuesday. A changed snapshot copies nothing. A database that already has Notes stays Notes, and that attempt copies no blobs. Sam's password `secret-value` is not on the restored account. The issuer `https://idp.example` is copied and the client secret is not. `cargo test -p suitedrive --lib an_incremental_chain_restores_the_newest_database_into_an_empty_one` passed, and `cargo test -p suitedrive --lib a_clean_database_gets_the_snapshot_and_a_used_database_is_left_alone` passed. This does not start a node, and it does not copy a node identity or a swarm key.

2026-11-01: `restore_folder_copy` writes Beds as `copy-beds` and leaves the live Beds row in place. Tomatoes in the copy is `copy-tomatoes` and its parent is `copy-beds`. Other stays on version `v-stay`. Sam's password `secret-value` is not on the account. A folder id `secret-value` is refused, and that word is not in the message. A second copy is refused with `That copy is already in this database.` and the live Beds name stays Beds. `cargo test -p suitedrive --lib a_deleted_folder_comes_back_without_changing_another_file` passed. This is another directory on this machine, not a remote storage service. This does not start a node.

2026-11-01: `plan_file_restore` names Tomatoes and one version, and the Tomatoes row is still missing. `restore_file` writes the missing Tomatoes file and its version back. The content is `tomatoes`. Other stays on version `v-stay`. A second restore says `That file is already on this node.` A folder id says `That backup item is not a file.` A file id `secret-value` is refused, and that word is not in the message. `cargo test -p suitedrive --lib a_deleted_folder_comes_back_without_changing_another_file` passed. This is another directory on this machine, not a remote storage service. This does not start a node.

2026-11-01: `restore_version` copies `v-old` onto Other. The content is `old other`. Other's current version stays `v-stay`. A second copy says `That version is already on this node.` A version id `secret-value` is refused, and that word is not in the message. `cargo test -p suitedrive --lib a_deleted_folder_comes_back_without_changing_another_file` passed. This is another directory on this machine, not a remote storage service. This does not start a node.

2026-11-01: restoring Beds also copies a missing owner. Priya owns Tomatoes and is not on a grant. Her account is copied, and her password `secret-value` is not. Sam is still copied from the grant, without a password. Ada already exists and stays Ada. Noor is not copied. `cargo test -p suitedrive --lib a_deleted_folder_comes_back_without_changing_another_file` passed. This is another directory on this machine, not a remote storage service. This does not start a node.

2026-11-01: restoring Priya also leaves out an `apiKey`. The restored row keeps her name and email. The password and the key value are null, and `secret-value` is not in the row. `cargo test -p suitedrive --lib a_deleted_folder_comes_back_without_changing_another_file` passed. This is another directory on this machine, not a remote storage service. This does not start a node.

2026-11-01: the backup note does not repeat a time that is not a timestamp. A recorded time `secret-value` says `The backup time is not a date.` A restore-test time that is the same word says `The restore test time is not a date.` Neither sentence contains that word. A real timestamp is still shown. `npx vitest run tests/ui/backup-freshness.test.tsx` passed (1 test). The Admin page was not opened in the browser. This is not a recovery-time target.

2026-11-01: a changed backup blob is refused with `That backup blob is corrupt.` The blob id is not in that sentence. The live store is not changed. A backup that is not a SuiteLeaf backup says `That backup is not a SuiteLeaf backup.` `cargo test -p suitedrive --lib a_corrupt_archive_is_rejected_before_it_changes_live_blobs` passed. This is another directory on this machine, not a remote storage service. This does not start a node.

2026-11-01: an account column named `passwd` is treated as a secret, the same as `password`. A name column and an email column are not. `cargo test -p suitedrive --lib a_passwd_column_is_not_copied` passed. This is another directory on this machine, not a remote storage service. This does not start a node.

2026-11-01: a file version whose content is not listed in the backup is refused with `That file content is not in this backup.` The content id is not in that sentence, and the empty database is left empty. A content id that cannot be read, a restored content that cannot be read back, and a drill content that cannot be reassembled use the same kind of static sentence. `cargo test -p suitedrive --lib a_clean_database_gets_the_snapshot_and_a_used_database_is_left_alone` passed. This is another directory on this machine, not a remote storage service. This does not start a node.

2026-11-01: a restore test earlier than the backup is not treated as a test of that backup. The backup at `2026-10-31T12:00:00.000Z` and a restore test at `2026-10-31T11:00:00.000Z` says `Restore test 2026-10-31T11:00:00.000Z is older than this backup.` The 12 ms from that older test is not shown. A later restore test still shows its time and duration. `npx vitest run tests/ui/backup-freshness.test.tsx` passed (1 test). The Admin page was not opened in the browser. This is not a recovery-time target.

2026-11-01: a folder restore stops when a content id cannot be read. The sentence is `A content id in this backup is not a content id.` The id `secret-value` is not in that sentence. Notes is not written into the live database. `cargo test -p suitedrive --lib a_bad_content_id_is_not_repeated` passed. This is another directory on this machine, not a remote storage service. This does not start a node.

2026-11-01: a restore of a content id that is not in the backup says `That backup does not contain that content.` The content id is not in that sentence, and the other archived file stays out. A backup name `secret-value/beds` says `That backup name is not a single directory.` and that name is not repeated. `cargo test -p suitedrive --lib a_folder_restore_copies` passed (1 test), and `cargo test -p suitedrive --lib retention_keeps_the_newest` passed (1 test). This does not start a node. This is not a remote storage service.

2026-11-01: a content id in the backup manifest restores when it is written in upper case. The restored bytes stay `keep this`. The id used to ask for the content stays lower case. `cargo test -p suitedrive --lib an_uppercase_content_id` passed (1 test). This does not start a node. This is not a remote storage service.

2026-11-01: a backup schedule says when the next copy is due. No recorded backup says `No backup has been recorded.` A backup at `2026-11-01T00:00:00.000Z` is still inside a 24 hour schedule at noon, and it is due a day later. A last time of `secret-value` says `The last backup time is not a time.` A schedule of `secret-value` says `The backup schedule must be from 1 to 168 hours.` Neither sentence repeats that word. The backup note shows `A backup is due.` and hides a schedule sentence that is not one of those. `cargo test -p suitedrive --lib a_backup_is_due` passed (1 test). `npx vitest run tests/ui/backup-freshness.test.tsx` passed (1 test). The status route was not requested over the network. This decision does not write a backup. The Admin page was not opened. This does not start a node. This is not a remote storage service.

2026-11-01: a due schedule writes the backup, and a schedule that is still inside its hours does not. The copy recorded at `2026-11-02T00:00:00.000Z` restores the bytes `keep this`. The noon check leaves no directory. A current time of `secret-value` says `The current time is not a time.` and writes nothing. `cargo test -p suitedrive --lib a_due_schedule_writes_a_backup` passed (1 test). This does not start a node. This is not a remote storage service. The backup was not sealed and was not copied to another machine.

2026-11-01: a due schedule seals the backup and copies that sealed file outside its directory. Opening the copy with the key returns `keep this`. The plaintext directory is removed. A schedule that is still inside its hours leaves no directory and no sealed file. A key that is not 32 bytes says `The backup key must be 32 bytes.` and the word `secret-value` is not in that sentence. `cargo test -p suitedrive --lib a_due_schedule_seals` passed (1 test). This does not start a node. This is not a remote storage service. The copy stayed on this machine.

2026-11-01: `POST /api/admin/backup` seals a due backup of the live file. The copy opens to `keep this`. The response says `No backup has been recorded.` and does not include that text. A second request the same day writes nothing and says `The last backup is still inside the schedule.` `cargo test -p suitedrive --lib a_scheduled_seal_records_the_time` passed (1 test). `cargo test -p suiteleaf-node --test multiuser a_due_backup_seals_the_live_file` passed (1 test). The Admin page was not opened. This is not a remote storage service. The copy stayed on this machine.

2026-11-01: a later due seal keeps the earlier copy. The first copy still opens to `keep this`. The next day writes another sealed file and opens to `north bed`. The reason is `A backup is due.` and does not contain `secret-value`. `cargo test -p suitedrive --lib a_later_due_seal_keeps_the_earlier_copy` passed (1 test). `cargo test -p suitedrive --lib a_scheduled_seal_records_the_time` passed (1 test). The admin route was not requested again. The Admin page was not opened. This is not a remote storage service. The copies stayed on this machine.

2026-11-01: restoring a deleted folder leaves a file that is still on this node alone. Beds comes back. Tomatoes stays `Ripe` and its bytes stay `ripe`. The other file stays on its current version. The result does not contain `secret-value`. `cargo test -p suitedrive --lib a_deleted_folder_comes_back` passed (1 test). The Admin page was not opened. This is not a remote storage service. The restore stayed on this machine.

2026-11-01: restoring a missing file also brings back a comment that is not already on this node. Tomatoes comes back with `Water the beds`. A comment id already stored as `Kept` stays `Kept`. A comment on a file outside the folder is not written, and that text is not in the restore summary. After Tomatoes is renamed, a later folder restore leaves the comment `Ripe note`. A copy of the folder stores the backup comment on `copy-tomatoes`. Deleting Tomatoes and restoring that file brings `Water the beds` back and still leaves `Kept`. `cargo fmt -p suitedrive && cargo test -p suitedrive --lib a_deleted_folder_comes_back` passed (1 test). The Admin page was not opened. This is not a remote storage service. The restore stayed on this machine.
