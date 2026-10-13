# 55 · Name a range

**Mode:** single-node · **App:** Sheets · **Video:** [videos/55-name-a-range.mp4](videos/55-name-a-range.mp4) · **Script:** [scenes/55-name-a-range.spec.ts](scenes/55-name-a-range.spec.ts)

## Who and why

Rosa's budget sheet uses `=SUM(C2:C13)` in three places. She wants that range to be called `Rent`, so the formula reads `=SUM(Rent)` and she can jump back to those cells by name. SuiteLeaf imports Excel's defined names into the workbook, but there is no command to create one, see the list, or jump to it.

## Inspired by

- [Name a range of cells](https://support.google.com/docs/answer/63175): select the cells, Data › Named ranges, type a name, Done.
- Excel import in `packages/core/src/excel.ts` stores defined names for Univer, and `apps/web/src` never mentions them.
- Storyboard [09](09-household-budget-with-formulas.md): formulas already calculate. This story is about naming the range, not about SUM itself.

## Scenes

1. **The budget.** Rosa opens "Rent budget". C2:C13 are the monthly amounts. C14 is `=SUM(C2:C13)`.
2. **Name it.** She selects C2:C13, chooses Data › Named ranges, types `Rent`, and saves. The name box shows `Rent` when those cells are selected.
3. **Use it.** She changes C14 to `=SUM(Rent)`. The total matches the old formula.
4. **Jump.** She clicks another cell, opens the name list, and chooses `Rent`. The selection returns to C2:C13.
5. **A bad name.** She tries `C14` and `Rent payments`. The dialog says why each name is refused, and `Rent` is unchanged.
6. **From Excel.** She opens a workbook that already defines `Rent`. The name is in the list, `=SUM(Rent)` still calculates, and downloading the sheet keeps the name.

## Google Workspace benchmark

In Google Sheets the path is select the cells, Data › Named ranges, type the name, Done: about 3 clicks plus typing ([Docs Help](https://support.google.com/docs/answer/63175)). The name box also creates a name. People lose names because the sidebar closes, a space in the name fails with a vague error, and a name that looks like a cell (`C14`) is accepted in some places and then breaks the formula.

## Better than Google Workspace when

1. Data › Named ranges creates a name for the current selection. The name box shows it when that selection is active.
2. Choosing the name from a list selects that range, even after the user has clicked somewhere else.
3. `=SUM(Rent)` calculates the same total as `=SUM` of those cells.
4. A name with a space, or a name that is a cell reference, is refused with a sentence that says why. The existing name is kept.
5. An Excel file's defined names arrive usable in a formula, and a SuiteLeaf download keeps them.
6. Renaming `Rent` to `MonthlyRent` updates a formula that used `Rent`, in one step that Undo can reverse.

## Success looks like

Rosa's total says `=SUM(Rent)`. Choosing `Rent` from the list jumps back to the monthly amounts. A bad name is refused in plain language.

## Gaps and notes

- Defined names from Excel are stored on the workbook and are not exposed in the app.
- Do not rebuild function help, dropdowns, cell links, or spelling. Those are other storyboards.
- Keep the Data menu change small. Put the dialog in a new module.
