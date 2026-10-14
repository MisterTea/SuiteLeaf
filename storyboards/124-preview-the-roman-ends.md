# 124 · Preview the first and last roman pages

**Mode:** single-node · **App:** Docs · **Video:** [videos/124-preview-the-roman-ends.mp4](videos/124-preview-the-roman-ends.mp4) · **Script:** [scenes/124-preview-the-roman-ends.spec.ts](scenes/124-preview-the-roman-ends.spec.ts)

## Who and why

Sam's preface is five pages and starts at iv. The roman chip says "iv … viii". The little page preview beside it still draws only the first three file pages, so she sees iv, v, and vi and never the last page. The chip and the preview disagree.

## Inspired by

- [Add page numbers](https://support.google.com/docs/answer/9378647): there is no preview of the last page at all.
- Storyboard [122](122-list-the-roman-pages-you-have.md) made the chip show the real ends. The miniature preview still stops at three file pages.
- The preview should name the same pages the chip names.

## Scenes

1. **Five pages.** Sam opens a five-page Preface that starts at 4. The first page says iv. The last page says viii.
2. **The ends.** She opens Page setup, before Apply. The chip says "iv … viii" and the fraction chip says "4 / 8". The preview shows iv on the first sheet, "Pages v–vii skipped", and viii on the last sheet.
3. **Two pages.** She shortens the file to two pages. The preview is exactly two sheets, iv and v. The chip says "iv, v". There is no third sheet.
4. **Three pages.** She adds a page. The preview lists iv, v, and vi, the same list as the chip. The fraction chip says "4 / 6".
5. **Keep it.** Two more pages bring the preface back to five. Before Apply, the preview is iv and viii again. She applies, closes the file, and opens it. The preview still shows iv and viii, and the count is still "4 / 8".

## Google Workspace benchmark

Google Docs has no miniature of the numbered pages ([Docs Help](https://support.google.com/docs/answer/9378647)). You scroll the document to see the last number.

## Better than Google Workspace when

1. On a file longer than three pages, the preview shows the first page's number and the last page's number before Apply.
2. Those two numbers match the first and last numbers on the roman chip.
3. A two-page file previews exactly two sheets. There is no third.
4. A three-page file previews iv, v, and vi, the same list as the chip.
5. Apply and reopen keep that preview for the five-page file.
6. The fraction chip still shows the real count, such as "4 / 8" for five pages starting at 4.

## Success looks like

Sam's five-page preface shows iv at one end of the preview and viii at the other, with the pages between marked skipped, and the chip says the same. A two-page file does not grow a blank third sheet.

## Gaps and notes

- A file longer than three pages previews the first sheet and the last sheet. The pages between are marked skipped, for example "Pages v–vii skipped". They do not get their own sheet.
- A two-page file previews two sheets. A three-page file previews all three. Odd and even pages still sample the first three faces, so a left number and a right number both appear.
- No live cover, no live watermark, and no section break that restarts at arabic 1.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| On a file longer than three pages, the preview shows the first page's number and the last page's number before Apply | Met | Video 0:08 and 0:11: five pages, Apply still on screen, the sheets say iv and viii, and the gap says Pages v–vii skipped. Video 0:40: the same preview before Apply. Vitest `shows the first and last roman pages of a long file`. Browser `the page preview shows the roman ends and keeps them after reopen`. |
| Those two numbers match the first and last numbers on the roman chip | Met | Video 0:08: the chip says iv … viii beside the sheets iv and viii. Video 0:48: the same pair after reopen. Vitest compares the preview numbers with the chip ends. |
| A two-page file previews exactly two sheets. There is no third | Met | Video 0:24: status says 2 pages, the chip says iv, v, and the preview is iv and v with no skip mark. Browser `a two-page file previews two sheets and a three-page file previews the chip`. |
| A three-page file previews iv, v, and vi, the same list as the chip | Met | Video 0:31: the chip says iv, v, vi, the fraction says 4 / 6, and the three sheets say iv, v, and vi. Vitest `previews a two-page file as two sheets and a three-page file as the whole chip`. |
| Apply and reopen keep that preview for the five-page file | Met | Video 0:40: before Apply, iv and viii. Video 0:48: after save and reopen, the chip is still iv … viii and the sheets are still iv and viii. Browser test applies, reopens Preface, and checks the preview. |
| The fraction chip still shows the real count, such as "4 / 8" for five pages starting at 4 | Met | Video 0:08 and 0:48: 4 / 8. Video 0:24: 4 / 5. Video 0:31: 4 / 6. Vitest checks `pageNumberFormatChips`. |
