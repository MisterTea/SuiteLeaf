# Bring the line spacing from Word

Who: Nia opens a Word file of a short story. The body is spaced at 1.5 lines, and a quoted verse is double spaced. She expects those choices on the page and on the line-spacing control.

Inspired by: Google Docs imports Word line spacing, then hides the current choice in Format › Line & paragraph spacing. Microsoft Word stores a multiple as `w:line` with `w:lineRule="auto"`: 240 is single, 276 is 1.15, 360 is 1.5, and 480 is double.

## Scenes

1. Nia opens a Word file. The first paragraph has `<w:spacing w:line="360" w:lineRule="auto"/>`. Its lines are 1.5. The next paragraph has no `w:line`, and it stays single. A verse has `<w:spacing w:line="480" w:lineRule="auto"/>`, and it is double spaced.
2. The caret in the first paragraph shows 1.5 on the line-spacing control. The plain paragraph shows Single. The verse shows Double. There is no second dialog.
3. She sets the first paragraph back to Single. The verse stays Double.
4. The first paragraph also has a first-line indent of half an inch (`w:ind w:firstLine="720"`). That indent is still there after the spacing is read.
5. She saves, returns home, and reopens. The verse is still double spaced. She downloads Word again. The verse has `w:line="480"` and `w:lineRule="auto"`. The paragraph she set back to single has `w:line="240"`.

## Google Workspace benchmark

- Docs keeps a Word multiple, but the toolbar does not show whether the paragraph arrived as single, 1.15, 1.5, or double until the spacing menu is open.
- An exact line height (`w:lineRule="exact"`) and a multiple look the same until that menu is open.
- Docs does not keep the first-line indent beside the spacing choice in the same control.

## Better than Google Workspace when

1. Opening the Word file shows 1.5 on the body paragraph and double on the verse. The paragraph with no `w:line` stays single.
2. The line-spacing control shows 1.5, Single, or Double for the caret's paragraph. There is no second dialog.
3. Setting the body back to Single does not change the verse.
4. The first-line indent on the body survives the spacing import.
5. Save and reopen keep the verse at double.
6. Downloading Word writes `w:line="480"` `w:lineRule="auto"` on the verse and `w:line="240"` `w:lineRule="auto"` on the paragraph set back to single.
7. A `w:line` that is not one of 240, 276, 360, or 480, or a `w:lineRule` other than `auto`, leaves that paragraph single. The paragraph's text still imports.

## Success

- Nia opens the file and the body is 1.5, the verse is double, and the indent is still on the first line.

## Gaps

- `packages/core/src/line-spacing.ts` already exports `w:line` and `w:lineRule="auto"` from the paragraph's `lineSpacing` attribute. `packages/core/src/word.ts` never reads `w:line` back onto that attribute.
- Space before and after (`w:before`, `w:after`) are a separate story. This story does not add them.
