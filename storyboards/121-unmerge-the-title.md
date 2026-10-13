# Unmerge the title

Who: Nia merged the title "October budget" across A1:C1. She needs those three cells separate again so she can put a note in B1. The title has to stay in A1.

Inspired by: Google Sheets' merge button, which always merges. Unmerge is a second item behind the chevron, and the button never changes its name. Excel keeps the top-left value and clears the merge.

## Scenes

1. Nia opens a sheet and selects A1:C1. The toolbar button reads Merge cells. She clicks it. "October budget" spans the three cells.
2. With that merged range selected, the same button reads Unmerge. There is no second menu and no dialog.
3. She clicks Unmerge. A1 still says October budget. B1 and C1 are empty. She types "draft" in B1, and it stays.
4. She selects D1:E1, which are not merged. The button reads Merge cells again, and merging them still joins those two cells.
5. She saves, returns home, and reopens. A1 is October budget, B1 is draft, and A1:C1 is not merged.
6. She downloads Excel. A1:C1 is not a merged range. A1 still contains October budget.

## Google Workspace benchmark

- Sheets can unmerge, but only from the chevron next to Merge, a second control with Merge all, Merge vertically, Merge horizontally, and Unmerge.
- The main button keeps saying it will merge even when the selection is already one merged range.
- After unmerge, Sheets does not show that the text survived until you click the top-left cell.

## Better than Google Workspace when

1. The one toolbar button reads Merge cells when the selection is not a single merged range, and Unmerge when it is. There is no chevron menu and no dialog.
2. Unmerge leaves the title in A1 and leaves B1 and C1 empty and editable.
3. Typing in B1 after the unmerge does not erase A1.
4. Merge still joins a range that is not merged, and keeps the top-left cell's text.
5. Save and reopen keep A1, B1, and the separate cells.
6. The downloaded workbook has no merge covering A1:C1, and A1 still contains the title.
7. Unmerge does not change column groups, row groups, or any cell outside the merged range.

## Success

- Nia separates the title and types in the freed cell, and Excel no longer has that merge.

## Gaps

- `mergeCells` in `apps/web/src/editors/Sheets.tsx` only calls `range.merge()`. A search for unmerge in `apps/web` finds no match.
- The toolbar button is always labeled Merge cells, including when the selection is already merged.
