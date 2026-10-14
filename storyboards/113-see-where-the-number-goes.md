# 113 · See where the page number goes

**Mode:** single-node · **App:** Docs · **Video:** [videos/113-see-where-the-number-goes.mp4](videos/113-see-where-the-number-goes.mp4) · **Script:** [scenes/113-see-where-the-number-goes.spec.ts](scenes/113-see-where-the-number-goes.spec.ts)

## Who and why

Sam turns page numbers on and they appear as "1 / 2" in the corner. She wants "Page 1" in the top right, but the page keeps "1 / 2" in the old place until she clicks Apply. She cannot tell whether the number clears the header. Turning numbers on already updates the page. The format and the position do not.

## Inspired by

- [Add page numbers](https://support.google.com/docs/answer/9378647): you pick a position, then confirm. The page does not move the number until you are done.
- Storyboard [110](110-see-the-page-number.md) shows "1 / 2" and "2 / 2" before Apply. Format and position still wait.
- Storyboard [65](65-choose-a-page-number.md) chose the format and the place. This story is seeing that choice on the page first.

## Scenes

1. **The header.** Sam opens a two-page "Minutes". The header says "Draft minutes".
2. **The fraction.** The corner of page 1 says "1 / 2".
3. **The words.** She opens Page setup and chooses "Page 1". Before Apply, that corner says "Page 1".
4. **The top.** She puts the number at the top right. Before Apply, "Page 1" sits at the top right, clear of the header, and page 2 shows "Page 2" in the same place.
5. **Cancel.** She cancels. The corner says "1 / 2" again.
6. **Keep it.** She sets "Page 1" at the top right again, sees it, and applies. She reopens the file. It is still there.

## Google Workspace benchmark

Google Docs applies the position when you leave the menu ([Docs Help](https://support.google.com/docs/answer/9378647)). A number that covers the header is a second trip.

## Better than Google Workspace when

1. While Page setup is open, choosing "Page 1" changes the number on the page from "1 / 2" to "Page 1" before Apply.
2. Choosing the top right moves that number to the top right before Apply. It does not cover the header text.
3. The second page shows "Page 2" in the same place before Apply.
4. Cancel restores the format and position from before the dialog opened.
5. Apply keeps "Page 1" at the top right through save and reopen.
6. On an 800-pixel-tall window, the format control, the position control, and Apply stay visible together.

## Success looks like

Sam watches "1 / 2" become "Page 1" at the top right while the dialog is still open. Page 2 shows "Page 2" there too. Cancel puts the corner fraction back. Apply keeps the top-right "Page 1" after she reopens the file.

## Gaps and notes

- Where numbering starts, the cover, a different first page, and the watermark still wait for Apply.
- Do not add a ruler or centimeter margins.
- While Page setup is open the sheet is scaled down beside the dialog, so the header words are smaller than the number. They stay on the same row, with a gap. After Apply the page is full size.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| While Page setup is open, choosing "Page 1" changes the number on the page from "1 / 2" to "Page 1" before Apply | Met | Video ~9s "1 / 2" with the dialog open, ~13s the corner says "Page 1" and Apply is still on screen. Vitest `changes 1 / 2 into Page 1 at the top right before apply`. Browser `page number format and position show before apply`. |
| Choosing the top right moves that number to the top right before Apply. It does not cover the header text | Met | Video ~17s: "Page 1" is on the header row, to the right of "Draft minutes", with Apply still visible. The scene and the browser test measure a gap between the header and the number. |
| The second page shows "Page 2" in the same place before Apply | Met | Video ~17–19s: page 2 shows "Page 2" at the top right while the dialog is open. The scene asserts both pages. |
| Cancel restores the format and position from before the dialog opened | Met | Video ~22s: the corner says "1 / 2" again. The browser test downloads the file after cancel and expects the fraction, not "Page 1". |
| Apply keeps "Page 1" at the top right through save and reopen | Met | Video ~28s after Apply, ~35–37s after reopen. The browser test checks the saved file and the reopened page. |
| On an 800-pixel-tall window, the format control, the position control, and Apply stay visible together | Met | Video ~9s and ~17s, viewport 1280×800. The scene and the browser test measure Format, Position, and Apply inside the dialog. |
