---
id: "WP-003"
title: "Bidirectional spreadsheet collaboration"
type: "work_package"
status: "in_progress"
priority: "P0"
phase: 1
area: "collaboration"
created: "2026-10-29"
updated: "2026-11-04"
owner: "unassigned"
blocked: false
blocked_on: []
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

# Progress

2026-10-30: Not started. Front matter status is `blocked`. `blocked` is true. `blocked_on` is ["WP-002"]. No product behavior for this package changed on this date. Active work is the WP-001 catalog and a mark-preservation slice of WP-002.

2026-11-02: A1 on worksheet `fees` and A1 on worksheet `beds` are stored as different cells. The shared value is `{ v: "North" }` on Fees and `{ v: "West" }` on Beds. A local write does not come back as a remote apply. After the watcher stops, a later cell is not applied. A cell with no worksheet id is not stored. A worksheet id that breaks across a line is not stored, and that id is not in the result. A cell marked as a remote apply is not written again. A stored value that is not JSON is skipped. `npx vitest run tests/sheet-collab.test.ts` passed (3 tests). Coverage for `apps/web/src/collab/sheet-cells.ts` was 97.33% statements, 95.16% branches, 100% functions, and 100% lines. The spreadsheet was not opened. The painted grid was not used. Completion stays blocked on WP-002. A viewer still cannot change the shared map.

2026-11-03: a paste on Fees stores North at A2, 10 at B2, and `=A2` at B3. Those cells are not written on Beds. Inserting one row at the second row of Fees leaves North in A1 and moves `=A1&" A2"` to A3. The quoted `A2` stays quoted. A formula on Beds that says `Fees!A2` stays `Fees!A2`. Deleting the first row of Fees removes North and turns the A1 reference into `#REF!`. Inserting a column moves `=B2` to C2. A value stored as a row-and-column matrix is written at that address. A cell whose stored text is not JSON stays that text when a later row is removed. Removing a row tells the other person to clear that cell. `npx vitest run tests/sheet-collab.test.ts` passed (5 tests). Coverage for `apps/web/src/collab/sheet-cells.ts` was 93.11% statements, 90.21% branches, 100% functions, and 100% lines. The spreadsheet was not opened. The painted grid was not used. Worksheet rename is not done. Completion stays blocked on WP-002.

2026-11-03: renaming Fees to Plots leaves North on the Fees worksheet id and rewrites `=Fees!A2` on Beds to `=Plots!A2`. The quoted `Fees!A2` stays quoted. A name that breaks across a line is not stored, and that name is not in the result. The other person hears the new name Plots. After the watcher stops, a later name is not applied. `npx vitest run tests/sheet-collab.test.ts` passed (6 tests). Coverage for `apps/web/src/collab/sheet-cells.ts` was 93.53% statements, 90.53% branches, 100% functions, and 100% lines. The spreadsheet was not opened. The painted grid was not used. Completion stays blocked on WP-002.

2026-11-03: adding Plots stores North in its A1 and leaves `=Fees!A2` on Beds. Deleting Fees removes North and rewrites `=Fees!A2:B3` to `#REF!`. The quoted `Fees!A2` stays quoted. A new sheet id that breaks across a line is not stored. `npx vitest run tests/sheet-collab.test.ts` passed (7 tests). Coverage for `apps/web/src/collab/sheet-cells.ts` was 93.91% statements, 90.19% branches, 100% functions, and 100% lines. The spreadsheet was not opened. The painted grid was not used. Completion stays blocked on WP-002.

2026-11-03: a filter that names `secret-value` leaves North in A1, and that word is not stored. A commenter write of West leaves North. A viewer write does not replace West after two people have written the same cell; both copies keep West, the later write. `npx vitest run tests/sheet-collab.test.ts` passed (8 tests). Coverage for `apps/web/src/collab/sheet-cells.ts` was 93.65% statements, 90.27% branches, 100% functions, and 99.67% lines. The spreadsheet was not opened. The painted grid was not used. Completion stays blocked on WP-002.

2026-11-03: a named range Total stores `=Fees!A2` on Fees. Renaming Fees to Plots rewrites that formula to `=Plots!A2`. Deleting Fees removes the named range. A commenter does not add a named range. A validation rule `whole` is stored for Fees and removed by a later removal. A rule id that breaks across a line is not stored, and that id is not in the result. `npx vitest run tests/sheet-collab.test.ts` passed (9 tests). Coverage for `apps/web/src/collab/sheet-cells.ts` was 94.54% statements, 90.8% branches, 100% functions, and 99.76% lines. The spreadsheet was not opened. The painted grid was not used. Completion stays blocked on WP-002.

2026-11-03: a journal row that stores Fees A1 as North, the worksheet name Fees, the named range Total, and the validation rule whole is replayed by a new room. The restored cell contains North and does not contain `secret-value`. The worksheet name is Fees. The named range is Total. The rule type is whole. `cargo test -p suiteleaf-node --bin suiteleaf-node -- a_restart_keeps_sheet_cells_names_and_rules` passed (1 test). This does not start a second process. The spreadsheet was not opened. Completion stays blocked on WP-002.

2026-11-03: writing the shared room into a spreadsheet file sets Fees A1 to North and the tab name to Fees. The named range Total keeps `=A2`. The validation rule whole is stored. The chart Dues is stored. The written file does not contain `secret-value`. A document file is left unchanged. `cargo test -p suiteleaf-node --bin suiteleaf-node -- compaction_writes_sheet_cells_into_the_saved_file` passed (1 test). The room calls this when the saved file is a spreadsheet. The spreadsheet was not opened. Completion stays blocked on WP-002.

2026-11-03: a chart titled Dues is stored under its id. A later snapshot that adds Paths and lists Dues as removed drops Dues and keeps Paths. A chart id that breaks across a line is not stored, and that id is not in the result. A commenter does not remove Dues. `npx vitest run tests/sheet-charts.test.ts` passed (1 test). Coverage for `apps/web/src/collab/sheet-charts.ts` was 97.56% statements, 96.87% branches, 100% functions, and 100% lines. The chart was not drawn. The spreadsheet was not opened. Completion stays blocked on WP-002.

2026-11-03: a commenter stores the note Water the beds on Fees. Resolving it keeps the note. A viewer cannot replace the text. Deleting the comment removes it. Updating the note stores Stake the beans. Deleting Fees removes the note. A comment id that breaks across a line is not stored, and that id is not in the result. A comment that arrives from someone else is reported until the watcher stops. The saved spreadsheet stores the note. `npx vitest run tests/sheet-comments.test.ts tests/sheet-collab.test.ts` passed (10 tests). Coverage for `apps/web/src/collab/sheet-comments.ts` was 95.95% statements, 95% branches, 100% functions, and 100% lines. Coverage for `apps/web/src/collab/sheet-cells.ts` stayed at 94.04% statements, 90.17% branches, 100% functions, and 99.33% lines. `cargo test -p suiteleaf-node --bin suiteleaf-node -- compaction_writes_sheet_cells_into_the_saved_file` covers the file write. The comment was not shown on the grid. The spreadsheet was not opened with two people. Completion stays blocked on WP-002.

2026-11-03: Maya's selection of Fees A1:B2 reaches Sam. The range does not include the cell value North. A worksheet id that breaks across a line is not sent, and that id is not in the result. A document caret is not treated as a worksheet range. The document text is unchanged. `npx vitest run tests/collab-selection.test.ts` passed (1 test). Coverage for `apps/web/src/collab/selection.ts` was 95.45% statements, 95.71% branches, 100% functions, and 100% lines. `cargo test -p suiteleaf-node --test multiuser a_sheet_selection_reaches_the_other_person_without_changing_the_text` covers the relay. The range is shown as text beside the grid. The painted grid was not used. This was not selected in two browsers. Completion stays blocked on WP-002.

2026-11-03: a formula `=A2` is stored with its bold style and without the calculated result 10. A personal reorder leaves North in Fees A1 and West in A2. Sort for everyone swaps them. An edit on the personally sorted first row is stored on the second row, which is where that cell lives. A worksheet id that breaks across a line is not a sort. `npx vitest run tests/sheet-sort.test.ts tests/sheet-collab.test.ts tests/sheet-comments.test.ts tests/sheet-charts.test.ts` passed (13 tests). Coverage for `apps/web/src/collab/sheet-sort.ts` was 96.77% statements, 96% branches, 100% functions, and 100% lines. Coverage for `apps/web/src/collab/sheet-cells.ts` was 93.94% statements, 90.05% branches, 100% functions, and 99.37% lines. The sort dialog was not clicked. The spreadsheet was not opened with two people. Completion stays blocked on WP-002.

2026-11-03: undoing a local write of North on Fees A1 removes it for both people and leaves West on Beds AA1. Putting that edit back restores North. After someone else writes West on Fees A1, undo leaves West and the notice says `fees A1 was changed by someone else and was left as it is.` The notice does not contain North. `npx vitest run tests/sheet-undo.test.ts` passed (1 test). Coverage for `apps/web/src/collab/sheet-undo.ts` was 100% statements, 96.15% branches, 100% functions, and 100% lines. The Undo button was not clicked. The spreadsheet was not opened with two people. Completion stays blocked on WP-002.

2026-11-03: Maya writes North on Fees A1 and Sam writes West on Beds A1. Both people, and a third person on another node, keep those as different cells. Maya disconnects. Sam writes `=A1` on Fees A2. When Maya reconnects, Fees A1 is still North, Beds A1 is still West, and Fees A2 is `=A1`. The stored cells do not contain `secret-value`. `cargo test -p suiteleaf-node --test multiuser -- two_worksheets_converge_on_two_nodes_and_after_reconnect` passed (1 test). This starts two nodes in the test cluster. The spreadsheet was not opened. Completion stays blocked on WP-002.

2026-11-03: North on Fees A1 is stored with bold (`bl: 1`) instead of the style id `bold`. A style id that breaks across a line is not stored, and that id is not in the result. A style id with no definition stays an id. A new worksheet Plots stores North with the same bold style. `npx vitest run tests/sheet-collab.test.ts tests/sheet-comments.test.ts tests/sheet-charts.test.ts tests/sheet-sort.test.ts` passed (14 tests). Coverage for `apps/web/src/collab/sheet-cells.ts` was 94.21% statements, 90.7% branches, 100% functions, and 99.4% lines. The bold cell was not painted. The spreadsheet was not opened. Completion stays blocked on WP-002.

2026-11-03: moving North from Fees A1 to Beds A1 clears Fees and stores the formula `=A2` with bold on Beds. The calculated value is not stored. A worksheet id that breaks across a line is not used, and that id is not in the result. West is still stored on Beds. `npx vitest run tests/sheet-collab.test.ts tests/sheet-comments.test.ts tests/sheet-charts.test.ts tests/sheet-sort.test.ts` passed (15 tests). Coverage for `apps/web/src/collab/sheet-cells.ts` was 93.95% statements, 90.46% branches, 100% functions, and 99.23% lines. The spreadsheet was not opened. The painted grid was not used. Completion stays blocked on WP-002.

2026-11-03: dragging Fees row 1 down moves North with it and rewrites `=A1&" A1"` to `=A2&" A1"`. The quoted `A1` stays quoted. `Fees!A1` on Beds stays. A drag that overlaps itself leaves North. A worksheet id that breaks across a line is not used, and that id is not in the result. Dragging column AA rewrites `=AA1` to `=AB1`. `npx vitest run tests/sheet-move.test.ts` passed (1 test). Coverage for `apps/web/src/collab/sheet-move.ts` was 93.15% statements, 90.27% branches, 100% functions, and 100% lines. The spreadsheet was not opened. The painted grid was not used. Completion stays blocked on WP-002.

2026-11-03: Fees A1:B2 is stored as one merged area. Inserting a row inside it extends the merge. Deleting the first row shortens it. A commenter cannot remove it. Deleting every row of the merge removes it. A worksheet id that breaks across a line is not stored, and that id is not in the result. Dragging the first row of a one-row merge moves the merge to the next row. The saved spreadsheet stores the merge on Fees. `npx vitest run tests/sheet-merges.test.ts tests/sheet-collab.test.ts tests/sheet-comments.test.ts tests/sheet-charts.test.ts tests/sheet-sort.test.ts tests/sheet-move.test.ts` passed (17 tests). Coverage for `apps/web/src/collab/sheet-merges.ts` was 96.07% statements, 91.89% branches, 100% functions, and 100% lines. Coverage for `apps/web/src/collab/sheet-cells.ts` stayed at 93.72% statements, 90.45% branches, 100% functions, and 99.25% lines. `cargo test -p suiteleaf-node --bin suiteleaf-node -- compaction_writes_sheet_cells_into_the_saved_file` passed (1 test). The merge was not drawn. The spreadsheet was not opened. Completion stays blocked on WP-002.

2026-11-03: Fees column A is stored at width 120. A hidden column is not stored. A commenter cannot change the width. Inserting a row moves a row height from row 2 to row 3. Deleting that row removes the height. The saved spreadsheet stores the column width. `npx vitest run tests/sheet-sizes.test.ts` passed (1 test). Coverage for `apps/web/src/collab/sheet-sizes.ts` was 94.28% statements, 92.76% branches, 100% functions, and 100% lines. `cargo test -p suiteleaf-node --bin suiteleaf-node -- compaction_writes_sheet_cells_into_the_saved_file` passed (1 test). The column was not measured on screen. The spreadsheet was not opened. Completion stays blocked on WP-002.

2026-11-03: Maya and Sam leave a spreadsheet room after writing North on Fees A1 and West on Beds A1. The saved file on this node and on the other node has those two cells. The file does not contain `secret-value`. `cargo test -p suiteleaf-node --test multiuser -- a_sheet_room_writes_both_worksheets_into_the_file` passed (1 test). The room writes the file when the last person leaves. The spreadsheet was not opened. Completion stays blocked on WP-002.

2026-11-03: Maya and Sam opened Plots.slsheet in two browser windows. Maya typed North into Fees A1. Sam stayed on Fees B1, whose value stayed Stay, and then Fees A1 showed North. Beds A1 stayed West. `npx playwright test tests/browser/sheet-collab.spec.ts --project=chromium` passed (1 test). Completion stays blocked on WP-002.

2026-11-03, later: Maya moved to Fees A1. Sam's page showed `Maya Chen A1` beside the grid and a box with that name sitting on the grid over that cell. Sam's selected cell stayed B1, whose value stayed Stay. The box does not include the cell value. `npx playwright test tests/browser/sheet-collab.spec.ts --project=chromium` passed (1 test) in 18.2s. `npx vitest run tests/sheet-remote-selection.test.ts` passed (1 test). Coverage for `apps/web/src/editors/sheet-remote-selection.ts` was 100% statements, branches, functions, and lines. The box is drawn over the grid, not into the canvas pixels. Completion stays blocked on WP-002.

2026-11-03, later: a chart was stored in the room and not drawn on the other grid. An incoming chart is now placed on that sheet. Maya created a chart from Fees A1:B2. Sam's grid showed the same chart. `npx vitest run tests/sheet-charts.test.ts` passed (2 tests). Coverage for `apps/web/src/collab/sheet-charts.ts` was 93.58% statements, 90.38% branches, 100% functions, and 96.77% lines. `npx playwright test tests/browser/sheet-collab.spec.ts --project=chromium` passed (1 test) in 18.9s. This was opened in two browsers. Completion stays blocked on WP-002.

2026-11-03: inserting a row on Fees moves a reference on another sheet. `=Fees!A2` on Beds becomes `=Fees!A3`. `=Other!A2` stays. Deleting the row a `Fees!` reference points at becomes `#REF!`. A quoted `'fees'!A2` becomes `'fees'!A3`. A local `=A2` on another sheet stays when only the Fees reference should move. A worksheet id that breaks across a line does not move `Fees!A2`. `npx vitest run tests/sheet-collab.test.ts tests/sheet-move.test.ts tests/sheet-merges.test.ts tests/sheet-sizes.test.ts tests/sheet-comments.test.ts tests/sheet-charts.test.ts tests/sheet-sort.test.ts` passed (19 tests). Coverage for `apps/web/src/collab/sheet-cells.ts` was 93.88% statements, 90.53% branches, 100% functions, and 99.28% lines. The spreadsheet was not opened. The painted grid was not used. This is not Univer recalculation. Completion stays blocked on WP-002.

2026-11-03: a renamed worksheet's formulas move with a row insert. Fees is named Plots. `=Plots!A2` on Beds becomes `=Plots!A3` when a row is inserted on that sheet. A named range Total on that sheet, `=Plots!A2`, becomes `=Plots!A3`. A local `=A2` on that sheet becomes `=A3`. `=Other!A2` stays. None of those formulas include `secret-value`. A validation rule on Fees, formula `=Plots!A2` covering stored rows 1 through 2, becomes `=Plots!A3` covering stored rows 2 through 3. A rule on Beds keeps `=Other!A2` and its row. Deleting the only row of a rule removes that span. `npx vitest run tests/sheet-validation-shift.test.ts tests/sheet-collab.test.ts` passed (13 tests). Coverage for `apps/web/src/collab/sheet-validation-shift.ts` was 96.36% statements, 90.07% branches, 100% functions, and 100% lines. `npx vitest run tests/sheet-collab.test.ts tests/sheet-move.test.ts tests/sheet-merges.test.ts tests/sheet-sizes.test.ts tests/sheet-comments.test.ts tests/sheet-charts.test.ts tests/sheet-sort.test.ts` passed (19 tests). Coverage for `apps/web/src/collab/sheet-cells.ts` was 94.04% statements, 90.41% branches, 100% functions, and 99.3% lines. The spreadsheet was not opened. The painted grid was not used. This is not Univer recalculation. Completion stays blocked on WP-002.

2026-11-03: a chart moves with a row insert on its sheet. Dues on Fees, covering stored rows 1 through 2, covers stored rows 2 through 3. Its series and its anchor move with it. A chart on Beds stays on stored row 1. Deleting those Fees rows marks the chart invalid. A stored value `secret-value` that is not a chart stays as it was. `npx vitest run tests/sheet-charts.test.ts` passed (3 tests). Coverage for `apps/web/src/collab/sheet-charts.ts` was 96.98% statements, 91.17% branches, 100% functions, and 100% lines. The spreadsheet was not opened. The chart was not drawn. This is not Univer recalculation. Completion stays blocked on WP-002.

2026-11-03: a comment anchor update moves the note to the new cell. The note `Water the beds` moves from its first cell to `A3`, stored row 2 and column 0. `Fees!B4:C5` is stored row 3 and column 1. A cell past the sheet, `A1048577`, leaves the note on `Fees!B4:C5`. A ref that breaks across a line leaves `A3`, and `secret-value` is not stored. `npx vitest run tests/sheet-comments.test.ts` passed (1 test). Coverage for `apps/web/src/collab/sheet-comments.ts` was 94.02% statements, 93.38% branches, 100% functions, and 100% lines. The spreadsheet was not opened. The comment was not shown on the grid. This is not Univer recalculation. Completion stays blocked on WP-002.

2026-11-03: a conditional formatting rule is shared and moves with a row insert. The Fees rule formula `=A2` becomes `=A3`, and its stored rows 1 through 2 become 2 through 3. A rule on Beds keeps its row and its formula becomes `=Fees!A3`. A commenter cannot add a rule. A rule id that breaks across a line is not stored, and `secret-value` is not a rule id. Deleting the Fees sheet removes its rule and leaves the Beds rule. `npx vitest run tests/sheet-conditional.test.ts` passed (1 test). Coverage for `apps/web/src/collab/sheet-conditional.ts` was 96.89% statements, 91.15% branches, 100% functions, and 100% lines. The spreadsheet was not opened. The formatting was not painted. Rule order is not stored. This is not Univer recalculation. Completion stays blocked on WP-002.

2026-11-03: a sheet filter is shared. Fees keeps the value `North` and hides stored row 2. A value that breaks across a line is left out, and `secret-value` is not stored. Inserting a row before that hidden row moves the filter's last row from 3 to 4 and the hidden row from 2 to 3. Deleting the hidden row drops it. A commenter cannot remove the filter. `npx vitest run tests/sheet-filter.test.ts` passed (1 test). Coverage for `apps/web/src/collab/sheet-filter.ts` was 93.7% statements, 90.62% branches, 100% functions, and 100% lines. The spreadsheet was not opened. The filter menu was not opened. This is not Univer recalculation. Completion stays blocked on WP-002.

2026-11-04: WP-002 was accepted as done, so this package is no longer blocked. It was blocked on WP-002 from 2026-10-29 until then; that dependency is still listed under Dependencies.
