# 134 · See the cover before you apply

**Mode:** single-node · **App:** Docs · **Video:** [videos/134-see-the-cover.mp4](videos/134-see-the-cover.mp4) · **Script:** [scenes/134-see-the-cover.spec.ts](scenes/134-see-the-cover.spec.ts)

## Who and why

Sam's first page is a cover. She turns on "Cover has no number" so the second page can be page 1. The first page still shows a number until she clicks Apply, and the preview still draws that number on the cover sheet. She cannot tell, before she commits, that the cover is blank and that the outside-edge numbers on the later pages still line up.

## Inspired by

- [Add page numbers](https://support.google.com/docs/answer/9378647): a different first page can omit the number. The document does not update until you confirm.
- Storyboard [132](132-numbers-on-the-outside.md) moves even numbers to the outside edge before Apply. A cover still waits, so a cover and those outside numbers are not on screen together.
- The cover should drop its number as soon as the switch is on.

## Scenes

1. **A numbered first page.** Sam opens Page setup on a three-page "Preface". Numbers are on. Page 1 shows Page 1 at the top right. Different odd and even is already on, so page 2 shows Page 2 at the top left. The preview shows those last even and odd pages.
2. **The cover.** She turns on Cover has no number. Before Apply, the first page goes blank. Page 2 says Page 1, with the number on the right. Page 3 says Page 2, with the number on the left.
3. **The preview.** The preview shows a cover sheet with no numeral, then the next sheet with Page 1 in the outside corner. Apply is still on screen.
4. **Cancel.** She cancels. Page 1 has its number again, and page 2 is back on the left.
5. **Keep it.** She turns the cover on again, sees the blank first page, and applies. The cover stays blank, the next page is Page 1 on the right, and page 3 is Page 2 on the left. She reopens the file. The cover is still blank and the next page is still Page 1.

## Google Workspace benchmark

Google Docs applies a different first page when you leave the dialog ([Docs Help](https://support.google.com/docs/answer/9378647)). You close it to see whether the cover lost its number and whether the next page became page 1.

## Better than Google Workspace when

1. While Page setup is open, turning on Cover has no number removes the number from the first page before Apply.
2. The second page shows Page 1 before Apply, when numbering starts at 1.
3. The third page shows Page 2 before Apply, on the left, because odd and even pages are on.
4. The preview shows a cover sheet with no numeral and the next sheet with its number in the outside corner, before Apply.
5. Cancel restores the number on the first page.
6. Apply and reopen keep the blank cover and Page 1 on the second page.

## Success looks like

Sam turns the cover on and the first page's number disappears while the dialog is still open. The next page says Page 1 on the right. Cancel puts the first number back. Apply keeps the blank cover.

## Gaps and notes

- A different first page and the watermark still wait until Apply.
- No section break, and no control for the numeral's font or size.
- The outside-edge behavior from storyboard 132 stays. With the cover on, page 1 of the numbering sits on the right and page 2 sits on the left.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| While Page setup is open, turning on Cover has no number removes the number from the first page before Apply | Met | Video 0:08: the switch is on, Apply is still on screen, and the preface page has no numeral. Vitest `drops the cover number and puts Page 1 on the outside right before apply`. Browser `a cover drops its number before apply and stays blank after reopen`. |
| The second page shows Page 1 before Apply, when numbering starts at 1 | Met | Video 0:08 and 0:11: the page that says “Notes on the second page” shows Page 1 while Apply is still available. |
| The third page shows Page 2 before Apply, on the left, because odd and even pages are on | Met | Video 0:11: the third page shows Page 2 at the top left, and Different odd and even pages is still on. |
| The preview shows a cover sheet with no numeral and the next sheet with its number in the outside corner, before Apply | Met | Video 0:11: sheets labeled Cover and Next page. The cover says “No number”. Next page shows Page 1 at the top right. |
| Cancel restores the number on the first page | Met | Video 0:15: the dialog is closed and Page 1 is back at the top right of the preface. Video 0:17: page 2 is back on the left. |
| Apply and reopen keep the blank cover and Page 1 on the second page | Met | Video 0:23: after Apply, the preface has no numeral. Video 0:26: the next page is Page 1 on the right. Video 0:32: after reopen, the cover switch is still on, the preface is blank, and the next page is Page 1 on the right. |
