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
2. **Quick answers.** He selects B2:B29. The status bar shows "Sum 58,940 · Average 2,105 · Min 1,520 · Max 2,710 · Count 28". Clicking "Average" offers **Insert below**, which puts `=AVERAGE(B2:B29)` in B30.
3. **Browse functions.** He clicks D2 and opens Insert › Function. The menu shows a short "Common" list (SUM, AVERAGE, COUNT, COUNTIF, IF, MIN, MAX, ROUND, VLOOKUP, XLOOKUP), then categories (Math, Statistical, Logical, Text, Date, Lookup) and "Search functions…".
4. **Find by meaning.** In Search he types "if a condition". IF is the top result, described as "Returns one value if a condition is true and another if it's false". He picks it.
5. **Write with help.** D2 enters edit mode with `=IF(`. A help panel docks beside the formula bar, not over the grid. It shows the syntax `IF(logical_expression, value_if_true, value_if_false)` with the current argument in bold, a one-line description of it, and an example. As he types `B2>2000,` the bold moves to `value_if_true`.
6. **Finish and fill.** He completes `=IF(B2>2000,"Pass","Not yet")`, presses Enter, and fills down. The panel closes when he leaves the cell.
7. **Count the passes.** In D30 he types `=COUNTIF(`. The panel explains `range` and `criterion`, with the example `COUNTIF(A1:A10, ">20")`. He finishes `=COUNTIF(D2:D29,"Pass")` and gets 19.
8. **Use the toolbar.** He selects C2:C29 and clicks Σ in the toolbar. `=SUM(C2:C29)` goes into C30, below the selection, without replacing anything.
9. **Make room.** He collapses the help panel with its chevron, and it stays collapsed for later formulas until he opens it again (Shift+F1 toggles it).

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

- "Year 9 fitness" has a Pass? column from one IF formula filled down, an average from the status bar, and a COUNTIF of passes.
- Ben wrote every formula without leaving the sheet or looking up syntax elsewhere.

## Gaps and notes

- **Insert › Function: SUM and Function: AVERAGE are no-ops** (`onSelect={() => {}}` in `App.tsx`), and there's no function browser or search.
- **The toolbar's Functions (Σ) button replaces the active cell's contents with `=SUM()`.** It doesn't guess a range, enter edit mode, or check whether the cell is empty.
- **Typing `=` already helps.** Univer shows function suggestions, and SuiteLeaf ranks everyday functions first (`formula-suggestions.ts`), with Enter and Tab guarded so a stale suggestion isn't accepted. Univer's own argument help is the starting point for the help panel. Whether it covers referenced cells, and whether its descriptions are complete, needs checking in the recording.
- **The status bar already shows selection statistics.** It's Univer's status bar (SuiteLeaf refreshes it when a filter changes the visible rows, and the code comment mentions Sum and Average). Check in the recording which statistics it shows. Nothing turns a statistic into a formula.
- There's no Explore-style panel.
