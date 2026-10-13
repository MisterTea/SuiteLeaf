# 39 · Insert a function with help

**Mode:** single-node · **App:** Sheets · **Video:** [videos/39-insert-a-function-with-help.mp4](videos/39-insert-a-function-with-help.mp4) · **Script:** [scenes/39-insert-a-function-with-help.spec.ts](scenes/39-insert-a-function-with-help.spec.ts)

## Who and why

Ben teaches PE and keeps fitness-test results for his class in a sheet: name, 12-minute run in metres, sit-ups, and whether each student passed. He knows he wants "the average", "how many passed", and "a pass if they ran over 2,000 m", but not the function names or the order their arguments go in. He wants SuiteLeaf to help him write each formula without leaving the sheet, and to answer quick questions without writing a formula at all.

## Inspired by

- WF-B2-08 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): functions and formulas.
- Storyboard [09](09-household-budget-with-formulas.md): writing SUM formulas in SuiteLeaf.
- [Docs Editors Help: Add formulas & functions](https://support.google.com/docs/answer/46977): "A function help box will be visible throughout the editing process", with the definition, syntax, and an example.
- [Ben Collins: 18 Google Sheets formula tips](https://www.benlcollins.com/spreadsheets/google-sheets-formulas-techniques/): the function helper highlights the current argument, Tab completes a name, and the quick-aggregation box "unfortunately… there's no way to customize".
- [Web Applications Stack Exchange: "Why does Google Sheets have a pop up formula box…"](https://webapps.stackexchange.com/questions/166462/why-does-google-sheets-have-a-pop-up-formula-box-does-any-one-actually-use-this): the help box covers the cells you need to see, and "there is no way to disable" it.
- [MrExcel: turning the formula pop-up off](https://www.mrexcel.com/board/threads/an-easy-one-hopefully-how-do-i-turn-the-formula-pop-up-off.1249891/): "this thing often is directly over the cells I need to select". The suggestion is to dock it.
- [Gist: suppress the Google Sheets F1 help pop-up](https://gist.github.com/f-steff/83be141ea8ce81a526e1b76a8be4a9bc): pressing F1 by accident opens help in a way that's hard to dismiss.

## Scenes

1. **Open the results.** Ben opens "Year 9 fitness". B2:B29 is metres, C2:C29 is sit-ups, and D is an empty "Pass?" column.
2. **Quick answers.** He selects B2:B29. The status bar shows "Sum 58,940 · Average 2,105 · Min 1,520 · Max 2,710 · Count 28". Hovering Average offers **Insert below**, and one click puts `=AVERAGE(B2:B29)` in B30 (2,105).
3. **Browse functions.** He clicks D2 and opens Insert › Function. The menu shows a short "Common" list (SUM, AVERAGE, COUNT, COUNTIF, IF, MIN, MAX, ROUND, VLOOKUP, XLOOKUP), then categories (Math, Statistical, Logical, Text, Date, Lookup) and "Search functions…".
4. **Find by meaning.** In Search he types "if a condition". IF is the top result, described as "Returns one value if a condition is true and another if it's false". He picks it.
5. **Write with help.** D2 enters edit mode with `=IF(`. A help panel docks in the formula bar, beside the formula, and the grid starts below it. It shows `IF(logical_expression, value_if_true, value_if_false)` with the current argument in bold, a one-line description of it, and an example. As he types `B2>2000,` the bold moves to `value_if_true`.
6. **Finish and fill.** He completes `=IF(B2>2000,"Pass","Not yet")`, presses Enter, and drags the fill handle down the class. The panel closes when he leaves the cell. Rows that ran over 2,000 m say Pass.
7. **Count the passes.** In D30 he types `=COUNTIF(`. The panel explains `range` and `criterion`, with the example `COUNTIF(A1:A10, ">20")`. He finishes `=COUNTIF(D2:D29,"Pass")` and gets 19.
8. **Use the toolbar.** He selects C2:C29 and clicks Σ in the toolbar. `=SUM(C2:C29)` goes into C30 (698), below the selection, and the sit-up counts stay put.
9. **Make room.** On a later formula he collapses the help panel with its chevron. The next formula stays collapsed. Shift+F1 toggles it, and F1 opens the same panel instead of another page.

## Google Workspace benchmark

In Google Sheets, Insert › Function opens a menu of categories and an "All" list (3 or more clicks to reach a function). Typing `=` and a few letters shows suggestions, with Tab to complete. A help box with syntax, the current argument highlighted, and an example appears while editing. Shift+F1 toggles it and F1 switches between full and compact help ([Sheets shortcuts](https://support.google.com/docs/answer/181110)). Selecting a range shows a quick-aggregation box at the bottom right, and Explore suggests formulas ([Ben Collins](https://www.benlcollins.com/spreadsheets/google-sheets-formulas-techniques/)).

Known pain points:

- The help box floats over the cells you're trying to reference, and its state doesn't stick ([Stack Exchange](https://webapps.stackexchange.com/questions/166462/why-does-google-sheets-have-a-pop-up-formula-box-does-any-one-actually-use-this), [MrExcel](https://www.mrexcel.com/board/threads/an-easy-one-hopefully-how-do-i-turn-the-formula-pop-up-off.1249891/)).
- F1 opens a help page that interrupts work ([Gist](https://gist.github.com/f-steff/83be141ea8ce81a526e1b76a8be4a9bc)).
- The quick aggregation can't be customized and can't be turned into a formula in one click ([Ben Collins](https://www.benlcollins.com/spreadsheets/google-sheets-formulas-techniques/)).
- Insert › Function lists functions by name and category, so you need to know what you're looking for.

## Better than Google Workspace when

1. Insert › Function opens a list of the common functions plus categories and a search box, and choosing one puts the active cell into edit mode with `=NAME(` typed, in at most 3 clicks.
2. Function search matches descriptions as well as names: "if a condition", "count matching", and "look up a value" return IF, COUNTIF, and XLOOKUP or VLOOKUP in the top 3.
3. While a formula is being edited, a help panel shows syntax, the current argument highlighted, a description of that argument, and an example, and it updates within 100 ms of typing a comma.
4. The help panel never covers the cells the formula refers to: it's docked beside the formula bar or follows the cell without overlapping referenced ranges. Collapsing it is remembered across formulas and reloads.
5. Selecting a numeric range shows Sum, Average, Min, Max, and Count in the status bar, and one click on any of them inserts that formula below the selection (or to its right for a row).
6. The toolbar Σ button inserts `=SUM(` with the range above or to the left of the active cell already filled in (or the selected range, placed below it), and never replaces a non-empty cell.
7. Every function in Insert › Function and in the suggestions has a description and an example. There are no blank help entries.
8. Pressing F1 while editing a formula expands the help panel in place instead of opening a new page.

## Success looks like

- "Year 9 fitness" has a Pass? column from one IF formula filled down, an average (2,105) from the status bar, a COUNTIF of 19 passes, and a sum of the sit-ups below the list.
- Ben wrote every formula without leaving the sheet or looking up syntax elsewhere.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. Insert › Function lists common functions, categories, and search, and choosing one types `=NAME(` in at most 3 clicks | Met | Video 0:12 (Insert › Function › SUM is three clicks in `function help, summaries, and sum stay out of the way`) |
| 2. Search matches descriptions: "if a condition", "count matching", and "look up a value" | Met | Video 0:13, IF's description on screen; same browser test checks all three queries |
| 3. Help shows syntax, the current argument, its description, and an example, within 100 ms of a comma | Met | Video 0:16–0:18; browser test measures the comma update under 100 ms |
| 4. Help never covers referenced cells; collapsed state sticks across formulas and reloads | Met | Video 0:16, panel sits in the formula bar and the grid starts below it; browser test reloads and the panel stays collapsed |
| 5. A numeric selection shows Sum, Average, Min, Max, and Count, and one click inserts that formula | Met | Video 0:09, "Sum 58,940 · Average 2,105 · … · Count 28" and Insert below; B30 is 2,105 |
| 6. Σ inserts `=SUM` with the range filled in and never replaces a non-empty cell | Met | Video 0:32, C30 is `=SUM(C2:C29)` and the sit-ups are unchanged; browser test checks a filled cell is left alone |
| 7. Every listed function and suggestion has a description and an example | Met | `function search` unit test walks the catalog; browser test checks suggestion rows are not blank |
| 8. F1 while editing expands help in place | Met | Video 0:37, F1 opens the MAX panel in the formula bar; browser test records no popup |

## Gaps and notes

- There is still no Explore-style panel that writes a formula from a sentence.
- Insert › Function lists a curated set (common functions plus Math, Statistical, Logical, Text, Date, and Lookup). Typing `=` still searches Univer's full function list, with SuiteLeaf's ranking and the guard that a stale suggestion is not accepted.
- Filled formulas share one formula id, so only the anchor cell stores the formula string; the other cells store the calculated Pass / Not yet.
- The status-bar summaries are always those five. They can't be turned off or swapped for another statistic.
