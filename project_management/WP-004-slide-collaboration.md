---
id: "WP-004"
title: "Bidirectional presentation collaboration"
type: "work_package"
status: "in_progress"
priority: "P0"
phase: 1
area: "collaboration"
created: "2026-10-29"
updated: "2026-11-03"
owner: "unassigned"
blocked: true
blocked_on: ["WP-002"]
related_sources: ["S01", "S02"]
---

# Bidirectional presentation collaboration

## Outcome and rationale

Support simultaneous slide authoring without whole-slide overwrites erasing another person's work.

## Existing implementation and starting points

Inspect `apps/web/src/collab/session.ts`, `apps/web/src/App.tsx`, `apps/web/src/editors/Slides.tsx`, and `packages/core/src/slide-diff.ts`. The current mirror writes serialized slides; complete inbound editor integration was not evident in the inspected props.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Bind incoming shared state into the visible slide editor. Use stable slide/object IDs and define conflict handling for object properties and text rather than relying solely on whole-slide replacement.
- Synchronize ordering, layouts, backgrounds, masters, notes, comments, media references, transitions, and animations.
- Define concurrent delete/edit and reorder behavior with explicit recovery of displaced content. Prevent duplicated IDs after reconnect or slide duplication.
- Add remote selection/presence and local-user undo; distinguish another user's selected slide from the user's own navigation.
- Persist full decks and media references through room recovery and export snapshots.

## Dependencies and delivery

Completion is blocked on `WP-002`. Design and isolated prototypes may proceed, but do not bypass the prerequisite contracts or release gates.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- Two users editing different objects on the same slide retain both edits, including after reconnect and reopen.
- Concurrent reorder/delete operations yield the same slide order everywhere without orphaned visible objects.
- Speaker notes, comments, master edits, and media references survive shared-session recovery.
- Users see incoming edits on the real canvas while their own selection remains usable.

## Verification

- Unit-test merge/replay semantics, ordering, object IDs, and deck serialization.
- Use painted-canvas tests for remote movement, selection, and text appearance.
- Test server restart during a shared deck edit and export the recovered deck.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Advanced animations and recording are separate packages. Avoid claiming collaboration parity based only on successful WebSocket exchange.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S01`, `S02`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.

# Progress

2026-10-30: Not started. Front matter status is `blocked`. `blocked` is true. `blocked_on` is ["WP-002"]. No product behavior for this package changed on this date. Active work is the WP-001 catalog and a mark-preservation slice of WP-002.

2026-11-03: a slide titled North is stored under id s2, and the order is s1 then s2. The other deck shows North after Beds. Reordering puts s2 first. Removing s2 drops it. A slide id that breaks across a line is not stored, and that id is not in the result. `npx vitest run tests/slide-room.test.ts` passed (1 test). Coverage for `apps/web/src/collab/slide-room.ts` was 97.8% statements, 96% branches, 100% functions, and 100% lines. The presentation was not opened with two people. Completion stays blocked on WP-002.

2026-11-03: an object titled North on slide s1 is stored beside the object Beds, not inside one slide blob. Editing Beds to West removes North because the saved slide no longer lists it. An object named Keep that the shared order has not listed stays. A repeated object id is stored once. `npx vitest run tests/slide-room.test.ts` passed (1 test). Coverage for `apps/web/src/collab/slide-room.ts` was 95.9% statements, 91.91% branches, 100% functions, and 99.25% lines. The presentation was not opened with two people. Completion stays blocked on WP-002.

2026-11-03: editing the object Beds to West leaves the object North on the same slide. North is removed only when the edit names that object. An object named Keep stays. An object id that breaks across a line is not removed, and that id is not in the result. `npx vitest run tests/slide-room.test.ts` passed (1 test). Coverage for `apps/web/src/collab/slide-room.ts` was 96.25% statements, 90.9% branches, 96.55% functions, and 100% lines. The presentation was not opened with two people. Completion stays blocked on WP-002.

2026-11-03: a slide keeps the speaker note `Water the beds` and the comment thread `thread-1`. A comment id that breaks across a line is not stored, and that id is not in the result. The picture source stays on the object. The master picture stays, and a master color that breaks across a line is not stored. A later master color `#112233` reaches the other deck. After the watcher stops, a later color is not applied. `npx vitest run tests/slide-room.test.ts` passed (2 tests). Coverage for `apps/web/src/collab/slide-room.ts` was 95.49% statements, 90.74% branches, 94.73% functions, and 100% lines. The presentation was not opened with two people. Completion stays blocked on WP-002.

2026-11-03: an order that still names the deleted slide North does not put North back. The deck order is Beds only. A slide id that breaks across a line is not a removal, and that id is not in the result. Adding North again clears the removal. `npx vitest run tests/slide-room.test.ts` passed (3 tests). Coverage for `apps/web/src/collab/slide-room.ts` was 95.73% statements, 90.58% branches, 95% functions, and 100% lines. The presentation was not opened with two people. Completion stays blocked on WP-002.

2026-11-03: closing the room writes the presentation file. Beds keeps the note `Water the beds` and the comment `thread-1`. The picture source stays on the object. North is the first slide and Beds is the second. The deleted slide Gone is not in the file. The master picture stays. The file does not contain `secret-value`. A spreadsheet is left unchanged. `cargo test -p suiteleaf-node --bin suiteleaf-node -- compaction_writes_slide_notes_objects_and_master_into_the_saved_file` passed (1 test). The presentation was not opened. Completion stays blocked on WP-002.

2026-11-03: Maya's selection of slide s2 and object title reaches Sam. Sam stays on slide s1. The message does not include the slide title North beds or the note Water the beds. A slide id that breaks across a line is not sent, and that id is not in the result. The label is `Maya is on North, object title`. A title that breaks across a line is shown as `Maya is on a slide`. `npx vitest run tests/collab-selection.test.ts` passed (2 tests). Coverage for `apps/web/src/collab/selection.ts` was 95.69% statements, 93.1% branches, 100% functions, and 100% lines. The presentation was not opened with two people. Completion stays blocked on WP-002.

2026-11-03: undoing a local object West removes it and leaves Beans, which someone else wrote over North. The notice is `s1 b was changed by someone else and was left as it is.` The notice does not contain North or Beans. Putting the local object back restores West. `npx vitest run tests/slide-undo.test.ts` passed (1 test). Coverage for `apps/web/src/collab/slide-undo.ts` was 100% statements, 96.96% branches, 100% functions, and 100% lines. The Undo button was not clicked. The presentation was not opened with two people. Completion stays blocked on WP-002.

2026-11-03: Maya's object West and Sam's object North stay on slide s1 on both nodes, after Maya reconnects, and in the saved presentation. The note stays `Water the beds`. An object id that breaks across a line is not in the file, and `secret-value` is not in the file. Maya's selection of slide s2 and object title reaches Sam. The selection does not include the title North beds or the note, and the document text is unchanged. `cargo test -p suiteleaf-node --test multiuser -- a_slide_selection_reaches_the_other_person_without_changing_the_text two_slide_objects_converge_on_two_nodes_and_reopen` passed (2 tests). The presentation was not opened on screen. Completion stays blocked on WP-002.

2026-11-03: a node restart keeps West and North on slide s1, including the fade transition, the title-body layout, the background `#112233`, and North's fade animation. The note stays `Water the beds`. `secret-value` is not in the saved file. A restored room now remembers the file, so the deck is written when the room empties. `cargo test -p suiteleaf-node --bin suiteleaf-node -- a_restarted_slide_room_writes_both_objects_and_the_transition` passed (1 test). `cargo test -p suiteleaf-node --test multiuser -- a_restart_keeps_both_slide_objects_and_the_saved_transition` passed (1 test). The presentation was not opened on screen. Completion stays blocked on WP-002.

2026-11-03: Maya and Sam opened Garden.slslides in two browser windows. Maya replaced North with West. Sam's canvas showed West, and the selected object stayed Beds. Maya then opened slide 2. Sam stayed on slide 1 and still saw West and Beds. `npx playwright test tests/browser/slide-collab.spec.ts --project=chromium` passed (1 test). The web app was rebuilt first. Completion stays blocked on WP-002.

2026-11-03: copying a slide gives the copy new object ids. Beds stays `a` and North becomes `copy-b` on the copy. The source slide stays `a` and `b`. The copy is placed after the source. Copying onto a slide that is already there says `That slide is already in the deck.` A slide id that breaks across a line says `Name a new slide.` and does not include `secret-value`. An object id that is already used becomes `copy-a-2`. The source deck is not changed by a refusal. `npx vitest run tests/slide-duplicate.test.ts` passed (2 tests). Coverage for `apps/web/src/collab/slide-duplicate.ts` was 95.31% statements, 90.47% branches, 100% functions, and 100% lines. The presentation was not opened. The copy was not drawn. Completion stays blocked on WP-002.

2026-11-03: the slide editor's copy gives each object its own id when the id source repeats. Two objects stay, and their ids are not the same. A repeated id `copy-1` is still the new slide id. An id that breaks across a line copies nothing, and the deck stays the one that was passed in. `npx vitest run tests/slide-editing.test.ts tests/slide-comments.test.ts tests/slide-marp-sync.test.ts` passed (65 tests). The presentation was not opened. The copy was not drawn. Completion stays blocked on WP-002.
