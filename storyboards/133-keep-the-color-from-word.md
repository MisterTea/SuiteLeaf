# Keep the color from Word

Who: Nia receives minutes as a Word file. The word "urgent" is dark red and bold. The words beside it are the normal black. She opens the file in SuiteLeaf and expects "urgent" to stay dark red.

Inspired by: Google Docs imports Word's run color (`w:color w:val="C00000"`), then leaves the toolbar text-color swatch on the last color you picked rather than the color under the caret.

## Scenes

1. Nia opens a Word file. The sentence is "The vote is urgent today." Only "urgent" has `<w:color w:val="C00000"/>` and bold. On the page, "urgent" is dark red and bold. "vote" and "today" are the normal text color.
2. She puts the caret in "urgent". The text-color swatch shows that dark red. She moves the caret to "today". The swatch returns to the normal text color, and "today" is not red.
3. A second sentence has "budget" highlighted yellow, from `<w:highlight w:val="yellow"/>`, with no font color. "budget" is yellow highlight on normal-colored text. The font color import does not turn it red.
4. She saves, returns home, and reopens. "urgent" is still dark red and bold. "budget" is still highlighted yellow.
5. She downloads Word. "urgent" is still color `C00000` and bold. "today" has no font color. "budget" still has the yellow highlight.

## Google Workspace benchmark

- Docs keeps a Word font color, but the toolbar swatch does not follow the caret. It stays on the last color chosen, so a red word can sit under a black swatch.
- Seeing the imported color means opening the text color menu.
- A highlight and a font color can arrive together, and Docs does not show which one is under the caret until a menu opens.

## Better than Google Workspace when

1. Opening the file shows dark red on "urgent" only. "vote" and "today" stay the normal text color.
2. "urgent" is still bold. The color import does not remove the bold.
3. With the caret in "urgent", the text-color swatch shows `#C00000`. With the caret in "today", the swatch shows the normal text color.
4. "budget" keeps its yellow highlight and does not become dark red.
5. Save and reopen keep the dark red, the bold, and the yellow highlight.
6. The downloaded file writes `w:color` `C00000` and bold on "urgent", no font color on "today", and the yellow highlight on "budget".
7. A first-line indent on the same paragraph is still imported. This story does not remove indent, line spacing, or space before and after.

## Success

- Nia opens the minutes and "urgent" is dark red, and the text-color swatch agrees.

## Gaps

- Mammoth's reader does not map `w:color`. `packages/core/src/word.ts` never copies a run color onto the text-style mark. Highlight import in `word-highlight.ts` reads `w:highlight` and `w:shd` only.
- The text-color swatch in `Docs.tsx` is React state that starts at `#202124`. It does not follow the color under the caret.
