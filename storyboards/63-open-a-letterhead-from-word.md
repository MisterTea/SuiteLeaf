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
2. **Page 1.** The first page shows "Town Council" and no page number.
3. **The back of the sheet.** Page 2 shows "Minutes" and "2 / 3" on the left.
4. **The next face.** Page 3 shows "Council" and "3 / 3" on the right.
5. **Page setup.** The dialog has Different first page and Different odd and even pages both ticked, and the three header fields match the pages.
6. **Save.** He closes the file and opens it from the library. Page setup still shows the three headers.

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

Ben opens the council file and sees the letterhead, then "Minutes" on the left of page 2 and "Council" on the right of page 3. Page setup already matches the file.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| Importing does not add a note that headers were dropped or merged | Met | Video 0:04. The note only mentions page layout. `tests/word-headers.test.ts` |
| Page 1 shows only the first-page header and no page number | Met | Video 0:08. "Town Council", no number. `tests/browser/word-letterhead.spec.ts` |
| Even and odd pages show their own header text, on the left and the right | Met | Video 0:11 "Minutes" and "2 / 3" on the left. Video 0:14 "Council" and "3 / 3" on the right |
| Page setup shows both checkboxes ticked and the three header strings | Met | Video 0:18. First header Town Council, even header Minutes, odd header Council |
| Saving and reopening keeps all three | Met | Video 0:23. The same dialog after opening the file from the library |
| A header that is only a page number stays a page number | Met | `tests/word-headers.test.ts`, both the complex PAGE field and `fldSimple` |

## Gaps and notes

- A logo image in a header is still placed in the document body, not in the page header.
- Odd and even page numbers sit beside the header so the title and the number are on the same edge. Other documents still number at the bottom right.
- The headers are edited in Page setup. They are not clicked directly on the page.
