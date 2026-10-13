# 119 · Show the starting number on the roman chip

**Mode:** single-node · **App:** Docs · **Video:** [videos/119-show-the-start-in-roman.mp4](videos/119-show-the-start-in-roman.mp4) · **Script:** [scenes/119-show-the-start-in-roman.spec.ts](scenes/119-show-the-start-in-roman.spec.ts)

## Who and why

Sam sets Start at to 4 and looks at the roman chip. It still says "i, ii, iii". The page, if she picks roman, should start at iv. The fraction and "Page N" chips already follow Start at. The roman chip does not.

## Inspired by

- [Add page numbers](https://support.google.com/docs/answer/9378647): roman samples stay "i, ii, iii" no matter the start.
- Storyboard [117](117-show-the-start-on-the-chips.md) made "12 / 13" and "Page 12" follow Start at. The roman chip was left behind.
- The chip should list the numbers the pages will actually show.

## Scenes

1. **Still i, ii, iii.** Sam opens Page setup on a two-page "Minutes". Start at is 1. The roman chip says "i, ii, iii". The page says "Page 1".
2. **It follows.** She sets Start at to 4. Before Apply, the roman chip says "iv, v, vi". The fraction chip says "4 / 5" and the page chip says "Page 4".
3. **On the page.** She selects the roman chip. Before Apply, the first page says "iv" and the second says "v".
4. **Further on.** She sets Start at to 12. The chip says "xii, xiii, xiv" before Apply, and the page says "xii".
5. **Not zero.** She types 0. The chip stays on "xii, xiii, xiv". The page stays on "xii".
6. **Keep it.** She sets Start at back to 4 and applies with roman selected. She reopens the file. The chip still says "iv, v, vi", and the page still says "iv". The other chips still start at 4.

## Google Workspace benchmark

Google's roman sample stays "i, ii, iii" ([Docs Help](https://support.google.com/docs/answer/9378647)). A preface that should start at iv looks like i until you check the page.

## Better than Google Workspace when

1. With Start at at 4, the roman chip reads "iv, v, vi" before Apply.
2. Selecting it shows "iv" on the first page and "v" on the second before Apply.
3. Start at 12 changes the chip to "xii, xiii, xiv" before Apply.
4. A start below 1 does not change the roman chip. It keeps the last valid sequence.
5. Apply keeps roman starting at 4 through save and reopen.
6. The fraction chip and the "Page N" chip still follow Start at. They do not go back to 1.

## Success looks like

Sam sets 4 and the roman chip says "iv, v, vi" before Apply. She selects it and the pages say iv and v. After she applies and reopens the file, both still do. Zero does not rewrite the chip.

## Gaps and notes

- The roman chip follows Start at before Apply, including through save and reopen.
- The chip lists three numbers from the start, the same length as "i, ii, iii", so a two-page file starting at iv also shows vi on the chip.
- A saved cover still numbers the next page as i. The roman chip follows Start at, so it can disagree with that page until the cover is off.
- The cover, a different first page, and the watermark still wait for Apply.
- No ruler or centimeter margins.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| With Start at at 4, the roman chip reads "iv, v, vi" before Apply | Met | Video ~10–12s: Start at is 4, the chip says iv, v, vi, and Apply is still on screen. Vitest `lists three roman pages from the start`. Browser `the roman chip follows the starting number before apply`. |
| Selecting it shows "iv" on the first page and "v" on the second before Apply | Met | Video ~13–16s: the chip is selected, the first page says iv, and the second says v, with Apply still on screen. The scene and the browser test compare both pages before Apply. |
| Start at 12 changes the chip to "xii, xiii, xiv" before Apply | Met | Video ~19–21s: the chip says xii, xiii, xiv and the page says xii, with Apply still on screen. |
| A start below 1 does not change the roman chip. It keeps the last valid sequence | Met | Video ~23–25s: the field shows 0, the chip stays on xii, xiii, xiv, and the page stays on xii. Vitest `labels the roman chip from the live start and keeps it below 1`. |
| Apply keeps roman starting at 4 through save and reopen | Met | Video ~31s after Apply, ~35s after reopen, ~38–40s with the dialog open again. The browser test checks the saved format and start, then the reopened chip and pages. |
| The fraction chip and the "Page N" chip still follow Start at. They do not go back to 1 | Met | Video ~10s: 4 / 5 and Page 4. Video ~20s: 12 / 13 and Page 12. Video ~39s, after reopen: 4 / 5 and Page 4. Vitest `follows a start of 12, then 3, on a two-page file`. |
