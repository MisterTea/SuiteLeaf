# Keep the size from Word

Who: Nia receives minutes as a Word file. The word "urgent" is 18 pt and bold. The words beside it are the normal body size. She opens the file in SuiteLeaf and expects "urgent" to stay large.

Inspired by: Google Docs imports Word's `w:sz` (half-points, so `36` is 18 pt). The size field often goes blank on a mixed selection, and the imported size is easy to miss until you click the word.

## Scenes

1. Nia opens a Word file. The sentence is "The vote is urgent today." Only "urgent" has `<w:sz w:val="36"/>` and bold. On the page, "urgent" is 18 pt and bold. "vote" and "today" stay the body size.
2. She puts the caret in "urgent". The font-size control shows 18. She moves the caret to "today". The control shows 11, the body size.
3. A second sentence has "budget" in dark red, from `<w:color w:val="C00000"/>`, at the body size. "budget" is red and 11 pt. The size import does not make it 18 pt.
4. She saves, returns home, and reopens. "urgent" is still 18 pt and bold. "budget" is still dark red and body size.
5. She downloads Word. "urgent" is still `w:sz` `36` and bold. "today" has no `w:sz`. "budget" is still color `C00000` and body size.

## Google Workspace benchmark

- Docs keeps a Word font size, but a selection that touches both the large word and the body text clears the size field.
- The size is a number in the toolbar with no unit, so 18 can mean 18 pt or 18 px until you export.
- A font color on a neighboring word can be lost when a size import rewrites the whole run.

## Better than Google Workspace when

1. Opening the file shows 18 pt on "urgent" only. "vote" and "today" stay the body size.
2. "urgent" is still bold. The size import does not remove the bold.
3. With the caret in "urgent", the font-size control shows 18. With the caret in "today", it shows 11.
4. "budget" stays dark red and body size. It does not become 18 pt.
5. Save and reopen keep 18 pt, the bold, and the dark red.
6. The downloaded file writes `w:sz` `36` and bold on "urgent", no `w:sz` on "today", and `w:color` `C00000` on "budget".
7. A yellow highlight and a first-line indent on the same file are still imported. This story does not remove highlight, color, indent, line spacing, or space before and after.

## Success

- Nia opens the minutes and "urgent" is 18 pt, and the size control says 18.

## Gaps

- Mammoth reads `w:sz` onto the run and never writes it into the HTML. `packages/core/src/word.ts` never copies that size onto the text-style mark.
- Font color and highlight already have their own importers. Size is not one of them.
