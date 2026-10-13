# Bring the line spacing from Word

**Mode:** single-node · **App:** Docs · **Video:** [videos/104-bring-the-line-spacing-from-word.mp4](videos/104-bring-the-line-spacing-from-word.mp4) · **Script:** [scenes/104-bring-the-line-spacing-from-word.spec.ts](scenes/104-bring-the-line-spacing-from-word.spec.ts)

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

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| Opening the Word file shows 1.5 on the body, double on the verse, and single where `w:line` is missing. | Met | Video ~0:02. The story is open, the market paragraph is tighter, and the verse lines sit far apart. The button reads 1.5. `tests/word-line-spacing-import.test.ts` |
| The line-spacing control shows 1.5, Single, or Double for the caret's paragraph. No second dialog. | Met | Video ~0:06 the menu checks 1.5. ~0:10 the button reads Single. ~0:14 the button reads Double. The menu is the same control. |
| Setting the body back to Single does not change the verse. | Met | Video ~0:22 the story tightens and the button reads Single. ~0:24 the verse is still open and the button reads Double. |
| The first-line indent on the body survives the spacing import. | Met | Video ~0:06. First line is checked and By is 0.5 in, next to 1.5. Re-export still has `w:firstLine="720"`. |
| Save and reopen keep the verse at double. | Met | Video ~0:28. Home, then the reopened page still shows Double on the verse. |
| Downloading Word writes `w:line="480"` `w:lineRule="auto"` on the verse and `w:line="240"` `w:lineRule="auto"` on the paragraph set back to single. | Met | Video ~0:32 File, Export DOCX. The scene and `tests/word-line-spacing-import.test.ts` check those attributes. |
| A `w:line` that is not 240, 276, 360, or 480, or a `w:lineRule` other than `auto`, leaves that paragraph single. The text still imports. | Met | Video ~0:18. The exact-height paragraph stays single and its sentence is on the page. The unit test also keeps line 400 single and keeps its first-line indent. |

## Gaps

- Import reads `w:line` on the paragraph's own `w:pPr` when `w:lineRule` is `auto` and the value is 240, 276, 360, or 480. That becomes `lineSpacing`. Anything else stays the single default.
- Export already wrote `w:line` and `w:lineRule="auto"`. Re-export uses that same path.
- Space before and after (`w:before`, `w:after`) are a separate story. This story does not read them, and it does not clear `firstLineIndent` or `hangingIndent` while setting `lineSpacing`.
