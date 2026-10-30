---
id: "WP-004"
title: "Bidirectional presentation collaboration"
type: "work_package"
status: "blocked"
priority: "P0"
phase: 1
area: "collaboration"
created: "2026-10-29"
updated: "2026-10-29"
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
