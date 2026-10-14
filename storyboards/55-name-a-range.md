# 55 · Name a range

**Mode:** single-node · **App:** Sheets · **Video:** [videos/55-name-a-range.mp4](videos/55-name-a-range.mp4) · **Script:** [scenes/55-name-a-range.spec.ts](scenes/55-name-a-range.spec.ts)

## Who and why

Rosa's budget sheet uses `=SUM(C2:C13)` in three places. She wants that range to be called `Rent`, so the formula reads `=SUM(Rent)` and she can jump back to those cells by name. SuiteLeaf imports Excel's defined names into the workbook, but there is no command to create one, see the list, or jump to it.

## Inspired by

- [Name a range of cells](https://support.google.com/docs/answer/63175): select the cells, Data › Named ranges, type a name, Done.
- Excel import in `packages/core/src/excel.ts` stores defined names for Univer, and `apps/web/src` never mentions them.
- Storyboard [09](09-household-budget-with-formulas.md): formulas already calculate. This story is about naming the range, not about SUM itself.

## Scenes

1. **The budget.** Rosa opens "Rent budget". C2:C13 are twelve months at 1,200. C14 is `=SUM(C2:C13)` and shows 14,400.
2. **Name it.** She selects C2:C13 and chooses Data › Named ranges. The panel says the selection is C2:C13. She types `Rent` and clicks Add. The list shows Rent, and the name box says Rent while those cells stay selected. The panel stays open until she closes it.
3. **Use it.** She replaces C14 with `=SUM(Rent)`. The formula bar shows that formula and the total is still 14,400.
4. **Jump.** She clicks A1. The name box shows A1. She opens Data › Named ranges and chooses Rent. The selection returns to C2:C13 and the name box says Rent.
5. **A bad name.** She tries `C14`, then `Rent payments`. Each refusal is a sentence: C14 is a cell reference, and "Rent payments" includes a space (try RentPayments). Add stays disabled. Rent is still in the list.
6. **Rename.** She renames Rent to MonthlyRent. C14 becomes `=SUM(MonthlyRent)` and the total stays 14,400. One undo restores the name Rent and the formula `=SUM(Rent)` together.
7. **From Excel.** She opens a workbook that already defines Rent over B2:B13. `=SUM(Rent)` is 1,200. The name is in the list, choosing it selects those cells, and downloading the sheet keeps the name.

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

Rosa's total says `=SUM(Rent)` and still reads 14,400. Choosing Rent from the list jumps back to the months. A space or a cell reference is refused in a sentence, and Rent stays. Renaming to MonthlyRent updates the formula, and one undo puts both back.

## Result

| Criterion | Met? | Evidence |
| --- | --- | --- |
| 1. Data › Named ranges creates a name for the selection, and the name box shows it | Met | Video 0:16: name box `Rent` while C2:C13 is selected. `tests/browser/named-ranges.spec.ts` |
| 2. Choosing the name from a list selects that range after clicking elsewhere | Met | Video 0:32: A1, then Rent jumps back to C2:C13. Same browser test |
| 3. `=SUM(Rent)` matches the sum of those cells | Met | Video 0:25: formula bar `=SUM(Rent)`, total 14,400. Same browser test |
| 4. A space or a cell reference is refused with a reason, and the existing name is kept | Met | Video 0:36 and 0:40: sentences for `C14` and `Rent payments`; Rent stays in the list. `tests/named-ranges.test.ts` |
| 5. An Excel file's defined names work in a formula, and a download keeps them | Met | Video 1:02: imported `=SUM(Rent)` is 1,200 and the list shows Rent. Browser test checks the download and the xlsx export |
| 6. Renaming updates a formula that used the name, in one undo step | Met | Video 0:46 `=SUM(MonthlyRent)`, video 0:48 undo restores `=SUM(Rent)` and the list. Same browser test |

## Gaps and notes

- The panel lists workbook names and renames them. It does not change which cells a name points at, and it does not offer a sheet-only scope.
- Excel names that are formulas rather than ranges still calculate, but there is no range to jump to.
- Function help, dropdowns, cell links, and spelling are other storyboards and were left alone.
