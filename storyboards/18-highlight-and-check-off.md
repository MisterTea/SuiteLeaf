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
