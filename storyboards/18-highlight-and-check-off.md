# 18 · Highlight and check off tasks

**Mode:** single-node · **App:** Sheets · **Video:** [videos/18-highlight-and-check-off.mp4](videos/18-highlight-and-check-off.mp4) · **Script:** [scenes/sheets.spec.ts](scenes/sheets.spec.ts)

## Who and why

Sofia is organizing the school bake sale with two other parents. She wants a to-do list where each task has a checkbox, and ticking it shades the whole row and crosses it out, so what's left stands out.

## Inspired by

- README "What works": Sheet tools adds data validation (including checkboxes) and conditional formatting; [tests/browser/features.spec.ts](../tests/browser/features.spec.ts) uses Insert › Checkbox.
- [Google Docs Editors Help: Use conditional formatting rules](https://support.google.com/docs/answer/78413): to format a whole row from one cell, use "Custom formula is" with a locked column such as `=$B1="Yes"`.
- [r/googlesheets: Check box / conditional formatting](https://www.reddit.com/r/googlesheets/comments/14sd1rn/check_box_conditional_formatting/): "I've managed to get the checkbox cell highlighted but I can't seem to get it right for the rows" — solved with `=$column row=TRUE`.

## Scenes

1. **Open the list.** "Bake sale prep" has Done (empty), Task, Owner and Due for five tasks.
2. **Checkboxes.** Sofia selects A2:A6 and chooses Insert › Checkbox. Each row gets an unticked checkbox, and, as in Google Sheets, each cell holds FALSE (the formula bar shows FALSE).
3. **Open conditional formatting.** She selects A2:D6 and chooses Format › Conditional formatting. The side panel opens with "Manage: Entire Sheet" and an empty rule list. She clicks + to add a rule.
4. **Custom formula.** Apply Range is already A2:D6. She sets Style Type to Custom Formula and types the usual Sheets recipe `$A2=TRUE` (the panel supplies the leading `=`).
5. **Style.** The preview starts like Sheets' default: a light green fill that keeps the cells' own text colour. She turns on strikethrough, picks a softer green fill, and clicks Submit. The rule is listed as "Custom Formula, A2:D6".
6. **Tick tasks.** She closes the panel and ticks "Book the school hall"; the formula bar now shows TRUE. She ticks "Order paper bags" too. Both rows turn green and are crossed out, with their text still black; the other three stay plain.

## Success looks like

- Column A holds checkbox validation that stores TRUE when ticked and FALSE when not (boolean cells, as in Google Sheets and Excel).
- One conditional-formatting rule on A2:D6 (`=$A2=TRUE`, strikethrough with a green fill and no font colour) styles exactly the ticked rows, and both survive in the downloaded file.
- Exported to XLSX, the ticked cells are Excel TRUE/FALSE values with a `TRUE,FALSE` list validation.

## AI version

**Videos:** [web](videos/18-highlight-and-check-off-ai.mp4) · [desktop](videos/electron/18-highlight-and-check-off-ai.mp4) · **Script:** [scenes/ai/18-highlight-and-check-off-ai.spec.ts](scenes/ai/18-highlight-and-check-off-ai.spec.ts)

Sofia opens the same "Bake sale prep" list, with the Done column empty, and asks the on-device assistant (Gemma 4 E4B) once:

*Can you put tick boxes in the Done column, and set it up so that when I tick a task its whole row turns green and gets crossed out?*

Gemma sets things up. Sofia then ticks "Book the school hall" and "Order paper bags" herself, the way the original storyboard does.

**Tools Gemma used:** `insert_checkboxes` on A2:A6, then `highlight_rule` on A2:D6 with the formula `=$A2=TRUE`, `strikethrough: true` and a light green fill (`#d9ead3`, the green the tool description suggests). It made no reads and no extra calls, then replied in one sentence ("I put tick boxes in the "Done" column (A2:A6), and set up a rule so that when a box is ticked, the entire row turns green and gets crossed out.").

**What the recording shows:** Gemma's pointer lands on the Done cells and five unticked boxes appear. It then moves into the table, and A2:D6 is selected while the rule is added. Nothing changes colour yet, since no box is ticked, and the tool result says so. Sofia closes the panel and ticks two boxes. Those two rows turn light green and are crossed out, and the other three stay plain. The test checks this on screen by sampling the fill colour of every row. It then downloads the workbook (Save As on desktop) and checks:
- A2 and A3 hold TRUE and A4:A6 hold FALSE (boolean cells), and "Done" is still the header.
- There is one checkbox validation on A2:A6 with TRUE/FALSE.
- There is exactly one rule, on A2:D6, with `=$A2=TRUE`, strikethrough, a green fill and no font colour.

Last, Sofia exports to XLSX for the other parents. The test checks that the Excel file has TRUE/FALSE cells, a `"TRUE,FALSE"` list validation on A2:A6, the `$A2=TRUE` rule on A2:D6, and a rule style with `<strike/>` and a green fill. On the web each request takes 17–25 seconds after the model loads (about 9–15 seconds); on desktop it takes about 8 seconds.

**How Gemma did:** With the final code, the web recording passed 3 of 3 runs and desktop (llama.cpp) passed 1 of 1. Across all 10 web recordings made along the way, Gemma's setup met the success criteria 8 times. The other recordings failed for test bugs that were then fixed. Model mistakes seen:
- Once, Gemma wrote the formula as `$=A2=TRUE`, which treats "put $ before the column" as text to put first. The tool used to accept it and report success, so the rule never matched. `highlight_rule` now repairs that slip and rejects formulas that give an error (see below).
- Once, it added `text_color: #999999` and `bold: true` to the rule, which nobody asked for. The grey text fails the "no font colour" check. The tool description and parameter notes now say to set only the styles the user asked for. Even so, in 2 of the 6 later runs (one of them the final web video) it still added `bold: true`, so ticked rows are also bold. The success criteria don't cover bold, so those runs pass.
- It often sends `bold: false`, and once sent a made-up `range_formula` argument. Neither has any visible effect.

Fixed while making it:
- **Broken formulas accepted silently.** `highlight_rule` now evaluates the formula on each row of the range before adding the rule. If it gives an error (for example `#NAME?`), the tool refuses and shows the right form for the range's first row (`=$A2=TRUE`). The common `$=A2` slip is repaired to `=$A2`.
- **Results that didn't say what would happen.** The `highlight_rule` result now shows how the formula moves down the rows ("=$A3=TRUE on row 3, and so on") and which rows it styles right now ("not true on any row, so nothing is styled yet"). `insert_checkboxes` now says the boxes hold FALSE, that ticking makes them TRUE, and what formula a rule can test. It also names any cells that kept their text instead of a box.
- **No visible feedback.** `highlight_rule` now selects the cells the rule covers, as a person would. Before, nothing on screen changed while the rule was added.
- **Black fill in Excel.** Univer stores a colour set by a rule as `rgb(217,234,211)`. XLSX export only understood `#rrggbb`, so the rule's green fill was exported as black. Export now converts `rgb(…)` colours too.

## Gaps and notes

- Fixed: checkboxes used to store 1 and 0, so `=$A2=TRUE` silently matched nothing and only `=$A2=1` worked. Insert › Checkbox now creates TRUE/FALSE checkboxes and fills the empty cells with FALSE. Files saved before this change keep their 1/0 checkboxes, and their `=$A2=1` rules keep working.
- Fixed: rule text used to turn blue, because Univer's style editor starts every rule with blue text on a lavender fill. New rules now keep the cell's text colour and start with Sheets' light green fill; editing an existing rule no longer adds a colour it didn't have.
- Fixed: Univer writes ticked boxes as boolean cells with the value 1, which XLSX export used to save as the number 1. They are now saved as Excel TRUE/FALSE.
- Undo after Insert › Checkbox takes two steps: one removes the FALSE values, the next removes the checkboxes. Sheets does both in one step.
- Excel has no checkbox validation, so a downloaded XLSX shows a TRUE/FALSE dropdown. Importing that file back gives the dropdown, not checkboxes.
- Pressing Escape inside the rule editor closes the whole sidebar and throws away the unsaved rule.
- The fill-colour popover stays open over the Submit button until you click somewhere else in the panel (the script clicks the "Style Type" label).
- The panel and its labels ("Style Type", "Style Rule", "Highlight Cell") are Univer's and differ from Sheets' "Format cells if… / Formatting style".
- Not owned here: the green corner markers on the Due dates ("Oct 14" typed as text) come from the grid's number-format checks.
