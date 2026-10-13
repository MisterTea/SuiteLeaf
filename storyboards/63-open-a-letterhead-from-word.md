# 63 · Open a letterhead from Word

**Mode:** single-node · **App:** Docs · **Video:** [videos/63-open-a-letterhead-from-word.mp4](videos/63-open-a-letterhead-from-word.mp4) · **Script:** [scenes/63-open-a-letterhead-from-word.spec.ts](scenes/63-open-a-letterhead-from-word.spec.ts)

## Who and why

Ben receives the town council's minutes as a Word file. Page 1 is their letterhead, even pages say "Minutes" on the left, and odd pages say "Council" on the right. SuiteLeaf can set those layouts itself, but opening the Word file keeps one header for every page, so the letterhead disappears and every page looks the same.

## Inspired by

- [Use different headers and footers](https://support.google.com/docs/answer/86629): Word's different first page and different odd and even survive when you upload the file to Google Docs.
- Storyboards [61](61-different-first-page.md) and [62](62-odd-and-even-pages.md): SuiteLeaf can create these layouts. Word import still keeps one header and one footer.
- People lose a cover page's letterhead when a converter flattens every header into the first one.

## Scenes

1. **The file.** Ben uses Open / import on `council-minutes.docx`. The compatibility note does not say the headers were flattened.
2. **Page 1.** The first page shows "Town Council" and no page number.
3. **The back of the sheet.** Page 2 shows "Minutes" on the left and the number on the left.
4. **The next face.** Page 3 shows "Council" on the right and the number on the right.
5. **Page setup.** The dialog has Different first page and Different odd and even pages both ticked, and the three header fields match the pages.
6. **Save.** He reopens the SuiteLeaf file. The three headers are unchanged.

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

## Gaps and notes

- Word import currently keeps one header and one footer.
- Different first page and odd/even already exist when you set them in SuiteLeaf. This story is the import.
- A logo image inside a header can stay as text for this story.
