# Keep the highlight from Word

Who: Nia receives minutes as a Word file. The word "urgent" is highlighted yellow, and it is also bold. The word beside it is plain. She opens the file in SuiteLeaf and expects the yellow to still be on "urgent" only.

Inspired by: Google Docs imports Word's highlighter (`w:highlight w:val="yellow"`) and shading (`w:shd w:fill`), then leaves the toolbar swatch on the last color you picked rather than the color under the caret.

## Scenes

1. Nia opens a Word file. The sentence is "The vote is urgent today." Only "urgent" has `<w:highlight w:val="yellow"/>` and bold. On the page, "urgent" is yellow and bold. "vote" and "today" are not highlighted.
2. She puts the caret in "urgent". The highlight swatch on the toolbar shows yellow. She moves the caret to "today". The swatch is no longer showing a highlight on that word, and "today" stays plain.
3. A second sentence has "budget" with `<w:shd w:fill="1A73E8"/>` and no highlight tag. "budget" is that blue, not yellow.
4. She saves, returns home, and reopens. "urgent" is still yellow and bold. "budget" is still blue.
5. She downloads Word. "urgent" still has a yellow highlight, and it is still bold. "today" has neither. "budget" still has the blue fill.

## Google Workspace benchmark

- Docs keeps a Word highlight, but the toolbar swatch does not follow the caret. It stays on the last color chosen, so a yellow word can sit under a blue swatch.
- Seeing the imported color means opening the highlight menu.
- A shading fill and a highlighter can arrive as two different marks, and Docs does not say which one is under the caret.

## Better than Google Workspace when

1. Opening the file shows yellow on "urgent" only. "vote" and "today" are not highlighted.
2. "urgent" is still bold. The highlight import does not remove the bold.
3. With the caret in "urgent", the highlight swatch shows yellow. With the caret in "today", the swatch does not claim that word is highlighted.
4. "budget" arrives as the blue from `w:shd`, not as yellow.
5. Save and reopen keep both highlights and the bold.
6. The downloaded file writes yellow on "urgent" and the blue fill on "budget", and writes bold on "urgent".
7. A paragraph indent, line spacing, or space before that the same file already stores is still imported. This story does not remove those.

## Success

- Nia opens the minutes and "urgent" is yellow, and the toolbar swatch agrees.

## Gaps

- `packages/core/src/docx-export.ts` writes a highlight mark as `w:shd` fill. `packages/core/src/word.ts` never reads `w:highlight` or `w:shd` back onto the highlight mark.
- The highlight swatch in `Docs.tsx` is a piece of React state that starts at yellow. It does not follow the highlight under the caret.
