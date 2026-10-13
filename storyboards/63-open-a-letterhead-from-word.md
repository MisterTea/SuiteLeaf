# 63 · Open a letterhead from Word

**Mode:** single-node · **App:** Docs · **Video:** [videos/63-open-a-letterhead-from-word.mp4](videos/63-open-a-letterhead-from-word.mp4) · **Script:** [scenes/63-open-a-letterhead-from-word.spec.ts](scenes/63-open-a-letterhead-from-word.spec.ts)

## Who and why

Ben receives the town council's minutes as a Word file. Page 1 is their letterhead, even pages say "Minutes" on the left, and odd pages say "Council" on the right. Opening the file should keep that letterhead, instead of one header on every page.

## Inspired by

- [Use different headers and footers](https://support.google.com/docs/answer/86629): Word's different first page and different odd and even survive when you upload the file to Google Docs.
- Storyboards [61](61-different-first-page.md) and [62](62-odd-and-even-pages.md): SuiteLeaf can create these layouts. This story is opening a Word file that already has them.
- People lose a cover page's letterhead when a converter flattens every header into the first one.

## Scenes

1. **The file.** Ben uses Open / import on `council-minutes.docx`. The compatibility note is about page layout. It does not say the headers were flattened or merged.
2. **Page 1.** The first page shows "Town Council" as the letterhead, with a line under the name, and no page number.
3. **The back of the sheet.** Page 2 shows "2 / 3" and "Minutes" on the left.
4. **The next face.** Page 3 shows "Council" and "3 / 3" on the right.
5. **Page setup.** Different first page and Different odd and even pages are both ticked. The fields read Town Council, Minutes, and Council. He closes the dialog. The letterhead is still on page 1.
6. **Save.** He reopens the SuiteLeaf file from the library. Page 1 still shows Town Council and no page number.

## Google Workspace benchmark

Uploading a Word file to Google Docs keeps different first, odd, and even headers ([Docs Help](https://support.google.com/docs/answer/86629)). The headers become editable in the page. People still lose images inside headers, and a header that is only a page number sometimes comes in as body text.

## Better than Google Workspace when

1. Importing the Word file does not add a note that headers were dropped or merged.
2. Page 1 shows only the first-page header and no page number.
3. Even and odd pages show their own header text, in the left and right positions.
4. Page setup shows both checkboxes ticked and the three header strings.
5. Saving and reopening the SuiteLeaf file keeps all three.
6. A header that is only a page number stays a page number, not a paragraph in the body.

## Success looks like

Ben opens the council file and sees the letterhead, then "Minutes" on the left of page 2 with its number, and "Council" on the right of page 3 with its number. Page setup already matches the file, and reopening keeps the letterhead.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| Importing the Word file does not add a note that headers were dropped or merged. | Met | Video 0:06. The note is only about SuiteLeaf's own page layout. `tests/word-headers.test.ts` |
| Page 1 shows only the first-page header and no page number. | Met | Video 0:10. "Town Council" with a line under it, and no page number. |
| Even and odd pages show their own header text, in the left and right positions. | Met | Video 0:13, "2 / 3" and "Minutes" on the left. Video 0:17, "Council" and "3 / 3" on the right. |
| Page setup shows both checkboxes ticked and the three header strings. | Met | Video 0:21. Different first page, Different odd and even pages, Town Council, Minutes, and Council. |
| Saving and reopening the SuiteLeaf file keeps all three. | Met | Video 0:28, the letterhead is still on page 1. `tests/browser/letterhead-import.spec.ts` edits the letterhead and checks all three after reopen. `tests/browser/word-letterhead.spec.ts` reopens Page setup. |
| A header that is only a page number stays a page number, not a paragraph in the body. | Met | `tests/word-headers.test.ts` (complex PAGE field and fldSimple) and `tests/browser/letterhead-import.spec.ts`. |

## Gaps and notes

- A picture inside a Word header is still placed in the document. The header text stays in the page header. This story's letterhead is text.
- HTML export shows the first-page letterhead once. It does not repeat the even and odd running heads, and printed page numbers stay at the bottom right.
- The header is edited in Page setup. Clicking the header on the page does not open it.
- Exporting DOCX writes the first, even, and odd headers back, including the page-number fields.
