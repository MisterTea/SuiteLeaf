# 75 · Start numbering at

**Mode:** single-node · **App:** Docs · **Video:** [videos/75-start-numbering-at.mp4](videos/75-start-numbering-at.mp4) · **Script:** [scenes/75-start-numbering-at.spec.ts](scenes/75-start-numbering-at.spec.ts)

## Who and why

Ben's minutes are pages 4 and 5 of a packet that already has a cover and two letters. Page setup can say "Page N" and put it in the center (storyboard 65), but the first page of the file is always page 1. He needs the minutes to start at 4. He also has a cover page of his own: that page should have no number, and the next page should be page 1, not page 2.

## Inspired by

- [Add page numbers](https://support.google.com/docs/answer/86629): Google can start at a number, but the control is inside the header options and easy to miss. A cover that is "different first page" often still counts as page 1, so the second page says 2.
- `packages/core/src/document-layout.ts` has format and position. It has no start number.
- Storyboard [65](65-choose-a-page-number.md): format and position already exist. This story adds where the count begins.

## Scenes

1. **The minutes.** Ben opens a two-page file. Page numbers are "Page 1" and "Page 2" at the bottom center, beside the footer "Committee draft".
2. **Start at 4.** In the same Page setup dialog as the format and the position, he sets Start at to 4. The preview says Page 4 and Page 5. On the file, page 1 shows "Page 4" and page 2 shows "Page 5".
3. **The footer stays.** "Committee draft" is still in the footer. The number is not part of that text.
4. **A cover.** He turns on "Cover has no number". Start at stays 4 for later. The first page has no number. The second page shows "Page 1", not "Page 2".
5. **Off and on.** Turning page numbers off clears every page and leaves the footer. Turning them on brings back Start at 4 and the cover.
6. **Save.** He reopens the file. The cover is still blank and the next page is still "Page 1".
7. **Word.** The exported .docx starts numbering at 1 after the cover, not at 2.

## Google Workspace benchmark

In Google Docs you open the header, Options, Page numbers, and then find "Start at" ([Docs Help](https://support.google.com/docs/answer/86629)). It is several clicks past the page itself. A different first page hides the number on page 1 and still numbers the next page as 2, which is the usual surprise.

## Better than Google Workspace when

1. Start at is in the same Page setup dialog as the format and position. No second dialog.
2. Start at 4 makes the file's first page "Page 4" and the next page "Page 5".
3. "Cover has no number" hides the number on the first page and numbers the second page "Page 1".
4. Footer text is unchanged. The number is not editable footer text.
5. Start at and the cover choice survive save and reopen.
6. Turning page numbers off still clears every page. Turning them on restores the start and the cover choice.
7. The .docx export uses that start, so Word's second page is 1 when the cover has no number.

## Success looks like

The packet minutes begin at page 4. With a cover, the cover is blank and the next page is page 1.

## Gaps and notes

- Format and position already existed. This story adds Start at and "Cover has no number" in that same dialog.
- While the cover is on, the next page is page 1. Start at is kept and shown, and it applies again when the cover is turned off. A cover that then starts at 4 is a later story.
- Roman numerals are out of scope.
- In Word, a fraction such as "4 / 5" still uses the page count for the total. "Page N" follows the start.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| Start at is in the same Page setup dialog as the format and the position | Met | Video ~7s: Format "Page 1", Position "Bottom center", and Start at are one dialog. |
| Start at 4 makes the file's first page "Page 4" and the next page "Page 5" | Met | Video ~9s "Page 4", ~10s "Page 5". Vitest `starts numbering at a chosen page`. |
| "Cover has no number" hides the number on the first page and numbers the second page "Page 1" | Met | Video ~14s preview, ~16s blank cover, ~18s "Page 1". |
| Footer text is unchanged. The number is not editable footer text | Met | "Committee draft" stays beside the number at ~9s, ~16s, and ~32s. |
| Start at and the cover choice survive save and reopen | Met | Video ~28s blank cover after reopen, ~32s "Page 1". Scene asserts `pageNumberStart: 4` and `coverHasNoNumber: true`. |
| Turning page numbers off clears every page. Turning them on restores the start and the cover | Met | Video ~20s: numbers off, Start at still 4, cover still checked. Browser test `start at and an unnumbered cover survive the page setup dialog`. |
| The .docx export uses that start, so Word's second page is 1 when the cover has no number | Met | Vitest `starts Word at the chosen page, and at 1 after an unnumbered cover`: `w:start="4"` without a cover, `w:start="0"` and a title page with the cover. |
