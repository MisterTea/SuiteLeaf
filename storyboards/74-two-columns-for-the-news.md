# 74 · Two columns for the news

**Mode:** single-node · **App:** Docs · **Video:** [videos/74-two-columns-for-the-news.mp4](videos/74-two-columns-for-the-news.mp4) · **Script:** [scenes/74-two-columns-for-the-news.spec.ts](scenes/74-two-columns-for-the-news.spec.ts)

## Who and why

Nia writes the garden-club newsletter. The title should span the page. The three short items under it should sit in two columns, so the page does not look like a single skinny paragraph. Google Docs makes her insert a section break before the columns, then open Format, Columns, and More options.

## Inspired by

- [Add columns](https://support.google.com/docs/answer/1213664): Format › Columns, then a flyout. More options is a second dialog for the gap.
- People column the title by accident because columns apply to the whole section, and a section break is easy to miss.
- SuiteLeaf paragraphs had no column layout. The page was one stream of text.

## Scenes

1. **The newsletter.** Nia opens "Garden club news". The heading "Garden club news for the March plant sale" sits above three short items, all in one column.
2. **The body only.** She selects the three items, not the heading, and chooses Format › Two columns. One column and Two columns are both in that menu. The choice applies immediately. No section-break step and no second dialog.
3. **The page.** The heading still spans the page. Plant sale and the compost workshop fill the left column; the new officers continue in the right, with a gap between them. She changes "Saturday" to "Sunday" in the left column and "Sam" to "Samir" in the right.
4. **Back to one.** She selects the items and chooses Format › One column. The heading and the items are one stream again.
5. **Save and Word.** She sets Two columns again. SuiteLeaf saves on this computer. She closes the news and opens it again: the heading is still full width and the items are still in two columns, including "Sunday" and "Samir". File › Export DOCX keeps that split.

## Google Workspace benchmark

In Google Docs the path is a section break, then Format, Columns, then More options if the gap matters ([Docs Help](https://support.google.com/docs/answer/1213664)). The title often falls into the columns with the body.

## Better than Google Workspace when

1. Two columns is one control on the selection. No section-break step and no second dialog.
2. A heading outside the selection stays full width.
3. The selected paragraphs flow into a left column and then a right column, with a visible gap.
4. Choosing One column puts those paragraphs back into a single stream and leaves the heading full width.
5. The split survives save and reopen.
6. The exported .docx keeps the heading full width and the selected paragraphs in two columns.

## Success looks like

The newsletter title spans the page. The three items sit in two columns under it. Reopening the file, and the Word file, keep that split.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| Two columns is one control on the selection. No section-break step and no second dialog. | Met | Video ~7s: Format menu shows One column and Two columns; choosing Two columns applies it. No dialog. `tests/browser/doc-columns.spec.ts` |
| A heading outside the selection stays full width. | Met | Video ~10s: the title spans above both columns. Scene asserts the heading is wider than a column and is not inside `.doc-columns`. |
| The selected paragraphs flow down the left column, then the right, with a visible gap. | Met | Video ~10s: plant sale and compost on the left, officers on the right, half-inch gap. Scene asserts the right column starts after the left column's width plus 16px. |
| One column puts those paragraphs back into a single stream and leaves the heading full width. | Met | Video ~18s. Scene asserts `.doc-columns` is gone and the paragraphs share one left edge. |
| The split survives save and reopen. | Met | Video ~22–25s: back to files, open again, Sunday and Samir still in two columns. Browser test reloads and still finds the column group. |
| The exported .docx keeps the heading full width and those paragraphs in two columns. | Met | Video ~26s File › Export DOCX. `tests/doc-columns.test.ts` ("exports the heading full width…"): heading section has no `w:num="2"`; the following section is continuous, `w:num="2"`, `w:space="720"`. |

## Gaps and notes

- Three columns and a custom gap are out of scope. One and two are enough, and the gap is Word's half inch.
- Columns apply to the selected blocks. A heading that is not selected stays full width. Importing an existing Word file's section columns is not part of this storyboard.
- "Sunday" and "Samir" pick up the spellcheck underline. That is the spelling checker, not the column layout.
- The suggestion switch already sits on a second toolbar row at 1280px. This storyboard does not add a toolbar button, so it does not make that wrap worse.
