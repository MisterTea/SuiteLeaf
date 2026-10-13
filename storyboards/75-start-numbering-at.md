# 75 · Start numbering at

**Mode:** single-node · **App:** Docs · **Video:** [videos/75-start-numbering-at.mp4](videos/75-start-numbering-at.mp4) · **Script:** [scenes/75-start-numbering-at.spec.ts](scenes/75-start-numbering-at.spec.ts)

## Who and why

Ben's minutes are pages 4 and 5 of a packet that already has a cover and two letters. Page setup can say "Page N" and put it in the center (storyboard 65), but the first page of the file is always page 1. He needs the minutes to start at 4. He also has a cover page of his own: that page should have no number, and the next page should be page 1, not page 2.

## Inspired by

- [Add page numbers](https://support.google.com/docs/answer/86629): Google can start at a number, but the control is inside the header options and easy to miss. A cover that is "different first page" often still counts as page 1, so the second page says 2.
- `packages/core/src/document-layout.ts` has format and position. It has no start number.
- Storyboard [65](65-choose-a-page-number.md): format and position already exist. This story adds where the count begins.

## Scenes

1. **The minutes.** Ben opens a two-page file. Page numbers are "Page 1" and "Page 2" at the bottom center.
2. **Start at 4.** In Page setup he sets Start at to 4. Page 1 of the file shows "Page 4". Page 2 shows "Page 5".
3. **The footer stays.** "Committee draft" is still in the footer. The number is not part of that text.
4. **A cover.** He turns on "Cover has no number". The first page has no number. The second page shows "Page 1", not "Page 2".
5. **Save.** He reopens the file. The cover is still blank and the next page is still "Page 1".
6. **Word.** The exported .docx starts numbering at 1 after the cover, not at 2.

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

- Format and position exist. A start number does not.
- Do not rebuild the format and position controls from storyboard 65.
- Roman numerals are out of scope.
