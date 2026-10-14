# Indent the first line

**Mode:** single-node · **App:** Docs · **Video:** [videos/98-indent-the-first-line.mp4](videos/98-indent-the-first-line.mp4) · **Script:** [scenes/98-indent-the-first-line.spec.ts](scenes/98-indent-the-first-line.spec.ts)

Who: Nia is formatting a short story and a works-cited line. She wants the first line of each body paragraph to start half an inch in, and she wants a citation whose wrapped lines sit under the text rather than under the author's name.

Inspired by: Google Docs' Format › Align & indent › Indentation options, which offers a special indent of First line or Hanging. Microsoft Word's paragraph dialog does the same with First line and Hanging.

## Scenes

1. Nia opens a new document and types two paragraphs. She puts the caret in the first and chooses a first-line indent of 0.5 inches. Only the first line of that paragraph moves in. The second line, and the other paragraph, stay at the left margin.
2. She selects both paragraphs and sets the same first-line indent. Both first lines move. She sets the first paragraph back to none, and only that paragraph returns to the margin.
3. She types a works-cited entry long enough to wrap and chooses a hanging indent of 0.5 inches. The first line stays at the margin and the wrapped line starts half an inch in.
4. She saves, returns home, and reopens. The first-line and hanging indents are still there.
5. She downloads a Word file. The first-line paragraph has a first-line indent and the citation has a hanging indent.

## Google Workspace benchmark

- Docs hides first line and hanging behind Format › Align & indent › Indentation options, a separate dialog from the toolbar's increase and decrease indent buttons.
- The toolbar buttons shift the whole paragraph. They do not offer a first line or a hanging line.
- A custom amount is a number with a unit menu, easy to leave on the wrong unit.

## Better than Google Workspace when

1. First line and hanging live on the same paragraph control as line spacing and space before and after. There is no second dialog and no trip through the Format menu.
2. A first-line indent of 0.5 inches moves only the first line. The lines after it stay at the left margin.
3. A hanging indent of 0.5 inches leaves the first line at the margin and moves the wrapped lines in.
4. The choice applies only to the selected paragraphs. The increase and decrease indent buttons still shift a whole list item.
5. Changing the indent leaves line spacing and space before and after as they were.
6. Save and reopen keep both kinds of indent.
7. The downloaded Word file uses a first-line indent on the story paragraph and a hanging indent on the citation.

## Success

- Nia indents a story paragraph and a citation without opening a dialog, and Word keeps both.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| First line and hanging live on the same paragraph control as line spacing and space before and after. No second dialog and no Format menu. | Met | Video ~0:16. The line spacing menu shows 1.5, Space after 12 pt, and Special indent (None, First line, Hanging, By 0.5 in). |
| A first-line indent of 0.5 inches moves only the first line. | Met | Video ~0:22. The story's first line sits in and the next line stays at the margin. `tests/doc-paragraph-indent.test.ts` |
| A hanging indent of 0.5 inches leaves the first line at the margin and moves the wrapped lines in. | Met | Video ~0:36. Okada stays at the margin and the wrapped line sits in. |
| The choice applies only to the selected paragraphs. Increase and decrease indent still shift a whole list item. | Met | Video ~0:28 she clears only the first paragraph. Video ~0:42 Pears nests under Apples, then comes back. The citation's hanging indent stays. |
| Changing the indent leaves line spacing and space before and after as they were. | Met | The story stays at 1.5 with 12 pt after. `tests/doc-paragraph-indent.test.ts` |
| Save and reopen keep both kinds of indent. | Met | Video ~0:48. She returns home and the reopened page still shows both indents. |
| The Word file uses a first-line indent on the story paragraph and a hanging indent on the citation. | Met | Video ~0:52 File, Export DOCX. The market paragraph is `w:firstLine="720"`. The citation is `w:left="720"` and `w:hanging="720"`. The cleared paragraph has neither. |

## Gaps and notes

- The amount is inches only. There is no unit menu.
- A hanging indent exports `w:left` and `w:hanging` together, which is how Word keeps the first line on the margin. A first-line indent exports only `w:firstLine`. A paragraph with neither omits `w:ind`.
- Opening a Word file still does not read `w:ind` back in. Export writes it.
- Increase indent and decrease indent still sink and lift a list item. They are separate from this special indent.
