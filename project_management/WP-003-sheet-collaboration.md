---
id: "WP-003"
title: "Bidirectional spreadsheet collaboration"
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
related_sources: ["S03"]
---

# Bidirectional spreadsheet collaboration

## Outcome and rationale

Allow teams to edit the same workbook with correct worksheet identity, structural operations, and predictable conflict behavior.

## Existing implementation and starting points

`apps/web/src/collab/session.ts` mirrors sheet mutations, but inspected cell keys use row/column without worksheet ID. `apps/web/src/App.tsx` passes live state into Docs but not Sheets. Start with `apps/web/src/editors/Sheets.tsx`, the Univer event adapters, and `packages/core/src/collab.ts`.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Connect incoming shared updates to the rendered workbook without rebroadcast loops. Key operations by workbook and stable worksheet IDs, with explicit addressing rules for insert/delete/move.
- Define convergence for same-cell edits, pasted ranges, formulas, formatting, sheet creation/deletion/rename, row/column operations, charts, comments, named ranges, and validation resources.
- Preserve formula-reference semantics during concurrent structural changes. Recalculate consistently and distinguish authored formula state from cached values.
- Make personal filter/sort views non-disruptive; make any shared-view operation explicit. Integrate per-user selections and undo.
- Persist and restore complete shared workbook state through the common session protocol; surface unresolved conflicts rather than silently replacing a workbook.

## Dependencies and delivery

Completion is blocked on `WP-002`. Design and isolated prototypes may proceed, but do not bypass the prerequisite contracts or release gates.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- Editing A1 on two different worksheets never collides.
- Concurrent paste, row insertion, worksheet rename, and formula changes converge to a documented result on all clients and after restart.
- Incoming changes appear in the actual grid and do not generate an infinite feedback loop.
- A viewer cannot mutate cells and a commenter cannot change workbook content.

## Verification

- Use Vitest for operation mapping, formula relocation, replay, undo, and resource preservation; node integration tests for recovery.
- Use painted-grid Playwright tests to prove remote values, selections, and charts appear on screen.
- Include a two-node, two-worksheet fixture and an offline reconnect fixture.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Full Excel formula compatibility belongs to WP-015. New analytics features must participate in this operation model rather than inventing separate sync paths.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S03`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
