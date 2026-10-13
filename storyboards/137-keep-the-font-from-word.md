# Keep the font from Word

Who: Nia receives minutes as a Word file. The word "urgent" is Georgia and bold. The words beside it are the body font. She opens the file in SuiteLeaf and expects "urgent" to stay in Georgia.

Inspired by: Google Docs imports Word's `w:rFonts w:ascii="Georgia"`. The font menu often goes blank when the selection touches two fonts, so the imported face is easy to miss.

## Scenes

1. Nia opens a Word file. The sentence is "The vote is urgent today." Only "urgent" has `<w:rFonts w:ascii="Georgia"/>` and bold. On the page, "urgent" is Georgia and bold. "vote" and "today" stay the body font.
2. She puts the caret in "urgent". The font menu shows Georgia. She moves the caret to "today". The menu shows the body font, not Georgia.
3. A second sentence has "budget" in dark red, from `<w:color w:val="C00000"/>`, with no `w:rFonts`. "budget" is red in the body font. The font import does not turn it into Georgia.
4. She saves, returns home, and reopens. "urgent" is still Georgia and bold. "budget" is still dark red in the body font.
5. She downloads Word. "urgent" still has `w:rFonts` `w:ascii="Georgia"` and bold. "today" has no `w:rFonts`. "budget" is still color `C00000`.

## Google Workspace benchmark

- Docs keeps a Word font, but a selection that touches Georgia and the body font clears the font menu.
- The menu does not say that only one word arrived in Georgia.
- Importing the face can drop a neighboring word's color or size when the run is rewritten as a whole.

## Better than Google Workspace when

1. Opening the file shows Georgia on "urgent" only. "vote" and "today" stay the body font.
2. "urgent" is still bold. The font import does not remove the bold.
3. With the caret in "urgent", the font menu shows Georgia. With the caret in "today", it shows the body font.
4. "budget" stays dark red and the body font. It does not become Georgia.
5. Save and reopen keep Georgia, the bold, and the dark red.
6. The downloaded file writes `w:ascii="Georgia"` and bold on "urgent", no `w:rFonts` on "today", and `w:color` `C00000` on "budget".
7. An 18 pt size, a yellow highlight, and a first-line indent on the same file are still imported. This story does not remove size, color, highlight, indent, line spacing, or space before and after.

## Success

- Nia opens the minutes and "urgent" is Georgia, and the font menu says Georgia.

## Gaps

- Mammoth reads `w:rFonts` onto the run and never writes it into the HTML. `packages/core/src/word.ts` never copies that face onto the text-style mark.
- Font size, color, and highlight already have their own importers. The face is not one of them.
