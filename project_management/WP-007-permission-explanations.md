---
id: "WP-007"
title: "Explainable sharing and safe permission changes"
type: "work_package"
status: "in_progress"
priority: "P0"
phase: 2
area: "administration"
created: "2026-10-29"
updated: "2026-10-30"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S09", "S10", "S11"]
---

# Explainable sharing and safe permission changes

## Outcome and rationale

Help people understand who has access and why, and prevent folder moves or group changes from unexpectedly broadening access.

## Existing implementation and starting points

SuiteDrive already has inherited ACLs, user/organization sharing, expiry UI, and nested groups. Inspect `crates/suitedrive/src/lib.rs`, `crates/suiteleaf-node/src/admin_api.rs`, `apps/web/src/drive/ShareDialog.tsx`, and `apps/web/src/drive/roles.ts`.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Implement one authoritative effective-access evaluator and an explanation endpoint showing direct grants, folder inheritance, nested membership, expiry, and administrative access.
- Add person-centric and file-centric access inspection, with restricted visibility of group membership information.
- Provide preview/dry-run for folder moves, share changes, and group membership updates showing users gaining/losing access. Revalidate the preview at commit time.
- Define restricted-subfolder behavior and conflict precedence explicitly; do not introduce ambiguous deny semantics. Preserve existing policies through versioned migrations.
- Add expiring guest workflows, external-sharing review, and before/after audit records. Honor revocation in live sessions, search, and APIs.

## Dependencies and delivery

No hard work-package prerequisites. Coordinate shared interfaces with the packages linked in the portfolio index.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- For direct, inherited, nested-group, expired, and restricted access, the displayed explanation matches the server authorization decision.
- A move preview accurately predicts access changes and refuses stale approval when the policy changes underneath it.
- Cycles in nested groups terminate safely and produce actionable diagnostics.
- Sharing-policy migrations produce a reviewable impact report and a rollback/recovery plan.

## Verification

- Rust permission-matrix and property tests; Vitest/jsdom explanation and preview tests.
- Test unauthorized users cannot enumerate hidden files or membership via explanations.
- Test revocation behavior across nodes and live sessions against documented consistency bounds.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

This extends existing sharing rather than replacing it. Legal holds, retention, and sensitive-data policies belong to WP-032.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S09`, `S10`, `S11`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.

# Progress

2026-10-30: In progress. `Drive::role` now returns the role from `Drive::explain`, so the explanation is the authorization decision. The explanation names one reason for the caller: administrator, owner, a direct or inherited user/group grant, an expired grant, or no grant. It does not list other people's grants. A membership cycle is named in `group_loops`, and the walk still finishes. `cargo test -p suitedrive --test directory` passed (8 tests), including `an_explanation_matches_the_role_decision` and `a_membership_cycle_is_named_and_the_walk_still_finishes`. `cargo test -p suitedrive --test drive` passed (25 tests) after the role path changed.

2026-10-30, later: `GET /api/drive/items/{id}/explanation` returns that decision for the signed-in person. The share dialog shows one sentence from it. A grant id is not repeated. `npx vitest run tests/access-explanation.test.ts` passed (1 test). The node crate compiled with the new route. The dialog was not opened in the browser. A move preview, restricted subfolders, and taking access away from a session that is already open are still open. Limits are in `docs/access.md`.

2026-10-31: `POST /api/drive/items/{id}/move-preview` compares the approved item and destination explanations with those explanations now. A difference refuses the move and still returns the current prediction. A direct grant stays with the item. Access inherited from the old folder is replaced by the destination, and a destination grant is marked inherited. The route does not move the file. `cargo test -p suitedrive --lib move_preview` passed (2 tests), and the node crate compiled with the route.

2026-10-31, later: `set_restricted` marks a folder. Sam has Editor on `Garden`, and `Beds` inside it is restricted. Sam’s role on the file inside `Beds` is none, and the explanation is that restricted folder. A grant on `Beds` itself still applies, and it is inherited. Sam cannot clear the restriction. A file cannot be restricted. `cargo test -p suitedrive --test directory a_restricted_folder_blocks_a_grant_from_the_folder_above_it` passed. `npx vitest run tests/access-explanation.test.ts` passed (1 test). The sentence names `Beds` and leaves the folder id out. The share dialog was not opened in the browser.

2026-10-31, later still: `plan_restrict` lists Sam, who has Editor on `Garden`, and Priya, who has Viewer through the Garden club group. On the file inside `Beds`, Sam would go from Editor to no role, and Priya from Viewer to no role. The plan says to clear the restriction on `Beds` and that grants stay. Planning does not change Sam’s role. `restrict_folder` then applies it, and `restore_inheritance` brings Editor and Viewer back. `cargo test -p suitedrive --test directory restricting_a_folder_lists_who_loses_access_and_can_be_undone` passed. An organization grant is not expanded into people. The share dialog was not opened in the browser. Taking access away from an open collaboration socket is recorded on WP-002: the next message is not applied, the socket closes, and a later read is refused. The socket is not closed at the instant the grant changes.

2026-10-31, later: Sam can open `Garden`, so the explanation of the file inside restricted `Beds` names `Beds`. Noor cannot open `Garden`, so the same file’s explanation does not include the name `Beds` or the folder id. `cargo test -p suitedrive --test directory a_restricted_folder_blocks_a_grant_from_the_folder_above_it` passed. `npx vitest run tests/access-explanation.test.ts` passed (1 test). The share dialog was not opened in the browser.

2026-10-31, later: Garden is shared with the organization `club` as Editor. Noor is a member of that organization. The restriction plan for Beds lists Noor on the file inside it, going from Editor to no role. The plan does not list `club` as a person. Noor’s role is still Editor because planning does not change it. `cargo test -p suitedrive --test directory restricting_a_folder_names_a_person_in_an_organization_grant` passed. The share dialog was not opened in the browser.

2026-10-31, later: `share_guest` changes Sam from Editor to Viewer on `Watering rota.sldoc` until `2099-01-03T00:00:00.000Z`. Sam can open the file and cannot write it. An editor role, the date `secret-value`, and `2000-01-01T00:00:00.000Z` are refused, and Sam stays Editor. Those errors do not contain `secret-value`. The audit row `guest.before` says `sam editor`. `guest.after` says `sam viewer` and the end date. Neither row contains `Monday: Rosa`. Eve’s permanent Viewer grant is not in Rosa’s review. Sam’s review and Priya’s review are empty. `cargo test -p suitedrive --test directory a_guest_share_ends_and_a_permanent_share_stays_off_the_review` passed. This is not an HTTP route. The share dialog was not opened in the browser.

2026-10-31, later: `POST /api/drive/items/{id}/guest` shares a viewer or a commenter until an end date. A role of `secret-value` is refused with `A guest share is a viewer or a commenter.` and that word is not in the error. `GET /api/drive/guests` lists the owner's guest review. `cargo test -p suitedrive --lib a_guest_role_is_viewer_or_commenter` passed. The node binary compiled with those routes. The routes were not requested over the network. The share dialog was not opened in the browser.

2026-10-31, later: a cluster test posted `secret-value` as the guest role and as the end date. Both were refused, and neither refusal contained `secret-value`. Posting Sam as a viewer until `2099-01-03T00:00:00.000Z` succeeded. Maya's `GET /api/drive/guests` listed Sam as a viewer with that date and did not include `North bed`. Sam's review was empty. `cargo test -p suiteleaf-node --test multiuser a_guest_share_over_http_refuses_a_bad_role` passed. The share dialog was not opened in the browser.

2026-11-01: `plan_member` lists the files where a person's role would change if they joined or left a group. Adding Sam to Garden club would make Sam an editor of `Watering rota.sldoc`. Sam's role stays none. Removing Priya would take Editor away. Priya stays an editor. An empty name says to name the person, and that message does not contain `secret-value`. The plan does not contain the file body `secret-value`. `cargo test -p suitedrive --test directory planning_a_group_change_names_who_gains_or_loses_access_and_writes_nothing` passed. Nothing is written. The share dialog was not opened in the browser.

2026-11-01: `POST /api/admin/groups/{id}/member-plan` was requested on a running node. Maya, who is not an administrator, is refused. An empty name is refused with `Name the person.` and the body does not contain `secret-value`. Adding Sam would make him an editor of `Watering rota.sldoc`. Lars still cannot read that file. Removing Priya would take Editor away, and Priya can still read the file. The plan does not contain `secret-value`. `cargo test -p suiteleaf-node --test multiuser a_group_member_plan_over_http_does_not_change_access` passed. The share dialog was not opened in the browser.

2026-11-01: the group page can preview adding a person before it writes the membership. Adding Sam to Garden club would change `Watering rota.sldoc` from no role to editor. The sentence does not contain `secret-value`, which was the group id, the person id, and the file id. An empty change says removing Priya would not change access. Both sentences say nothing is changed. `npx vitest run tests/member-plan-text.test.ts tests/ui/member-plan-preview.test.tsx` passed (3 tests). The preview button was rendered by itself. The Admin page was not opened in the browser. The share dialog was not opened.

2026-11-01: `commit_member` checks the plan again before it writes. A plan that says Sam would become a viewer, while the live plan says editor, is refused with `The access plan changed. Review it again.` Sam's role stays none. The matching plan makes Sam an editor of `Watering rota.sldoc`. The refusal does not contain `secret-value`. `cargo test -p suitedrive --test directory committing_a_group_change_checks_the_plan_again` passed. The share dialog was not opened in the browser.

2026-11-01: the group page shows Apply reviewed plan after the preview. A refusal that is not the plan-changed sentence says `The reviewed plan was not applied.` and does not repeat `secret-value`. A second click says `The reviewed plan was applied.` `POST /api/admin/groups/{id}/member-commit` calls `commit_member`. `npx vitest run tests/ui/member-plan-preview.test.tsx` passed (2 tests). `cargo test -p suiteleaf-node --bin suiteleaf-node -- the_oldest_account_becomes_admin_when_nobody_is` passed and compiled that route. The route was not requested over the network. The Admin page was not opened in the browser. The share dialog was not opened.

2026-11-01: `externalShareReview` counts two grants outside the organization. The listed name is Ada. Sam is a member and is not listed. A blank name is counted and not listed. The note does not contain `secret-value` or `Beds`. The list passed in is not changed. `npx vitest run tests/ui/external-share-note.test.tsx` passed (1 test). This note was not added to the share dialog or the Admin page. Those pages were not opened.

2026-11-01: a group grant on a folder says `You have access from a group on “Beds”.` A group grant on the item says `You were given access through a group.` Neither sentence contains `secret-group` or `secret-value`. A grant to the person still says `You were given access on this item.` `npx vitest run tests/access-explanation.test.ts` passed (1 test). The share dialog shows this sentence. It was not opened in the browser.

2026-11-01: `folderMovePreview` names who would gain or lose access. Priya would gain access from the destination folder. Sam would lose access that came from the current folder. Ada’s direct grant stays. The note says `This move changes who has access.` A principal id `secret-value` is not in the result. The lists passed in stay as they were, and the file is not moved. `npx vitest run tests/folder-move-preview.test.ts` passed (1 test). The move control does not call this yet. The share dialog was not opened.

2026-11-01: a folder-move preview can be accepted only while the grants are unchanged. The matching stamp is accepted and the note stays `This move changes who has access.` A stamp of `secret-value` is refused with `The access plan changed. Review it again.` and that word is not in the refusal. The file is not moved. `npx vitest run tests/folder-move-preview.test.ts` passed (1 test). The move control does not call this yet. The share dialog was not opened.

2026-11-01: a group membership preview does not repeat a role that is not a SuiteLeaf role. Adding Sam to Garden club would change Beds from `another role` to viewer. The word `secret-value` is not in that sentence. `npx vitest run tests/member-plan-text.test.ts tests/ui/member-plan-preview.test.tsx` passed (5 tests). The Admin page was not opened.

2026-11-01: a folder move still changes access when the new person has no name. The note is `This move changes who has access.` The id `secret-value` is not in the preview. `npx vitest run tests/folder-move-preview.test.ts` passed (2 tests). The file is not moved. The move control does not call this yet. The share dialog was not opened.

2026-11-01: owning a file with no name says `You own this item.` The item id is not in that sentence. A named file still says `You own “Notes”.` `npx vitest run tests/access-explanation.test.ts` passed (1 test). The share dialog was not opened.

2026-11-01: an expired grant on the file does not hide a live grant on the destination folder. After the move the caller would be an editor from that folder. When the destination has no role, the expired grant stays and the role stays none. The file is not moved. `cargo test -p suitedrive --lib destination` passed (3 tests). The move route was not requested over the network. The share dialog was not opened.

2026-11-01: the Move dialog shows who would gain or lose access before the file moves. Choosing Beds says Priya would gain access and Sam would lose access. An expired grant and a person id `secret-value` are not in that note. Move here sends the file only while that plan still matches. A later grant says `The access plan changed. Review it again.` and the file stays. A failed access read says `The access plan could not be read.` and does not repeat `secret-value`. `npx vitest run tests/ui/move-access-preview.test.tsx` passed (3 tests). The Move dialog was not opened in the browser. The file was not moved on a SuiteDrive node.

2026-11-01: the share dialog waits before it changes a role. Changing Priya from editor to viewer says `Priya would change from editor to viewer.` The principal id `secret-value` is not in that sentence. Share is not called until Apply this access change. A role that is not a SuiteLeaf role is called another role when someone would lose access, and `secret-value` is not repeated. A blank name says Someone. `npx vitest run tests/ui/share-change-preview.test.tsx` passed (2 tests). The share dialog was not opened in the browser. The grant was not written on a SuiteDrive node.

2026-11-01: an access explanation names the role the server decided. A group grant on “Beds” for an editor says `You have access from a group on “Beds” as an editor.` A direct grant for a viewer says `You were given access on this item as a viewer.` A role `secret-value` says `as another role`, and that word is not in the sentence. An expired grant still says `Your access has expired.` `npx vitest run tests/access-explanation.test.ts` passed (1 test). The share dialog was not opened in the browser.

2026-11-01: a responder's new response keeps the questions. Plot stays `Plot`, and the answer `North` is stored. An answer for a field that is not a question is left out, so `secret-value` is not stored. The question list passed in stays `Plot`. The form editor uses this when the person can only respond. `npx vitest run tests/form.test.ts` passed (7 tests). The form was not opened in the browser.

2026-11-01: a responder cannot change another part of the form while appending a response. Adding a title `secret-value` and another response is refused. The saved form still has Sam and Leo, and it does not contain `secret-value`. Questions still cannot be edited, and an earlier response still cannot be rewritten. `cargo test -p suitedrive --test drive a_responder_can_append` passed (1 test). This does not start a node.

2026-11-01: a responder submit keeps the other fields on the form. The title stays `Beds`, the note stays `Water the beds`, and the new answer `West` is appended after `North`. An answer for a field that is not a question is left out, so `secret-value` is not in the response list. The form passed in still has one response. `npx vitest run tests/form.test.ts -t "other form fields"` passed (1 test). The form was not opened in the browser.

2026-11-01: a choice answer has to be one of the listed choices. ` Beds ` is stored as `Beds`. An answer `secret-value` is refused with `Plot size must be one of the choices`, and that sentence does not include the refused answer. The question still lists ` Beds `. `npx vitest run tests/form.test.ts -t "listed choice"` passed (1 test). `cargo test -p suitedrive --test drive a_sign_up_link_stores_a_trimmed_choice` passed (1 test). The form was not opened in the browser. The sign-up page was not opened.

2026-11-01: a grid answer is stored with the spaces trimmed. A row ` Mon ` and a column ` Yes ` are stored as `Mon` and `Yes`. An answer `secret-value` is refused with `Which days? must be one of the columns`, and that sentence does not include the refused answer. The question still lists ` Mon ` and ` Yes `. `npx vitest run tests/form.test.ts -t "listed grid"` passed (1 test). `cargo test -p suitedrive --test drive a_sign_up_link_stores_a_trimmed_grid` passed (1 test). The form was not opened in the browser. The sign-up page was not opened.

2026-11-01: a share preview names responder and owner. Priya would change from responder to editor, and from owner to editor. A role `secret-value` is called another role, and that word is not repeated. `npx vitest run tests/ui/share-change-preview.test.tsx -t "real role change"` passed (1 test). The share dialog was not opened in the browser. Nothing was shared.

2026-11-01: adding a group lists each person whose access would change. Volunteers contains Sam and Priya. Adding it to Garden club would make Sam an editor of the watering rota. Priya is already in Garden club, so she is not listed. Applying that plan makes Sam an editor. Removing Volunteers would take Sam's editor role away and would leave Priya's. The file body `secret-value` is not in the plan. Nothing is written by the preview. The group page has a preview beside Add group. `cargo test -p suitedrive --test directory planning_a_nested_group` passed (1 test). The Admin page was not opened. A sharing-policy migration still does not produce an impact report.

2026-11-01: a guest end date has to be a real calendar day. 31 November and 29 February 2100 are refused with `That day is not on the calendar.` 28 February 2099 is accepted. A stored end of `secret-value` does not open the file, and that word is not repeated. `cargo test -p suitedrive --test directory an_impossible_guest_day` passed (1 test). `cargo test -p suitedrive --test directory a_guest_share_ends` passed (1 test). The share dialog was not opened. Nothing was shared with a person outside this test.

2026-11-01: an owner can migrate direct editor grants to viewer. Sam's editor grant on Garden would become viewer, including on the watering rota inside it. Priya's viewer grant is left out. The plan does not include the file body `secret-value`. A stamp `secret-value` says `The access plan changed. Review it again.` and that word is not in the refusal. Applying the matching plan makes Sam a viewer. Rolling it back makes Sam an editor again. If Sam was changed to a commenter, the rollback writes nothing. `cargo test -p suitedrive --test directory an_editor_policy` passed (1 test). The Admin page was not opened. This is not an organization-wide policy.

2026-11-01: an explanation for a hidden file matches a missing file. Eve, who has no grant, and Noor, who cannot see the restricted folder, both get `not found`. That result does not include the file name, the file id, or `secret-value`. Sam, who can open the folder above, still hears that Beds is restricted. The explanation route uses this check. `cargo test -p suitedrive --test directory an_explanation` passed (1 test). `cargo test -p suitedrive --test directory a_restricted_folder` passed (1 test). `cargo check -p suiteleaf-node` passed. The route was not requested over the network. The share dialog was not opened.

2026-11-01: an external-sharing review leaves out a guest whose access has ended. On 2026-11-01, Ada's end of 2026-01-01 is not listed. Noor's end of 2026-12-01 is still listed. A date that is not a real day is still listed, and that date is not in the note. The principal id `secret-value` is not in the note. `npx vitest run tests/ui/external-share-note.test.tsx` passed (2 tests) at 00:43:51. The share dialog was not opened. The Admin page was not opened. Nothing was shared.

2026-11-02: a guest end written with an offset is stored in UTC. `2099-02-28T23:00:00-05:00` is stored as `2099-03-01T04:00:00.000Z`. An offset that is not a real zone is refused with `A guest share needs an end date.` and that offset is not repeated. A day that is not on the calendar is still refused. `cargo test -p suitedrive --test directory a_guest_end_with_an_offset` passed (1 test). `cargo test -p suitedrive --test directory an_impossible_guest_day` passed (1 test). The share dialog was not opened. Nothing was shared over the network.
