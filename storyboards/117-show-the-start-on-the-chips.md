# 117 · Show the starting number on the format chips

**Mode:** single-node · **App:** Docs · **Video:** [videos/117-show-the-start-on-the-chips.mp4](videos/117-show-the-start-on-the-chips.mp4) · **Script:** [scenes/117-show-the-start-on-the-chips.spec.ts](scenes/117-show-the-start-on-the-chips.spec.ts)

## Who and why

Sam sets Start at to 12. The page says "Page 12", but the format chips still read "1 / 2" and "Page 1". She is not sure which chip matches the page, because both still talk about page 1.

## Inspired by

- [Add page numbers](https://support.google.com/docs/answer/9378647): the samples in the menu stay "1" even after you choose a different start.
- Storyboard [114](114-see-the-starting-number.md) puts 12 on the page before Apply. The chips do not follow.
- The chips should use the same number the page is about to show.

## Scenes

1. **Page 1 on the chips.** Sam opens Page setup on a two-page "Minutes". Start at is 1. One chip says "1 / 2". The other says "Page 1".
2. **They follow.** She sets Start at to 12. Before Apply, the chips say "12 / 13" and "Page 12". The page says "Page 12".
3. **Back a step.** She sets Start at to 3. The chips say "3 / 4" and "Page 3" before Apply.
4. **Not zero.** She types 0. The chips stay on 3. The page stays on "Page 3".
5. **Keep it.** She sets 12 again, applies, and reopens the file. The chips still say "12 / 13" and "Page 12".

## Google Workspace benchmark

Google's page-number samples stay on 1 ([Docs Help](https://support.google.com/docs/answer/9378647)). After a start of 12 you have to look at the page, not the menu, to see what you chose.

## Better than Google Workspace when

1. With Start at at 12 on a two-page file, the fraction chip reads "12 / 13" and the page chip reads "Page 12", before Apply.
2. The selected chip matches the number on the page.
3. Changing Start at to 3 updates both chips before Apply.
4. A start below 1 does not change the chips. They keep the last valid number.
5. Apply keeps 12, and reopening the file still shows "12 / 13" and "Page 12" on the chips.
6. On an 800-pixel-tall window, both chips, Start at, and Apply stay visible together.

## Success looks like

Sam sets 12 and the chips say "12 / 13" and "Page 12" while the dialog is open. The page agrees. Zero does not rewrite the chips.

## Gaps and notes

- The fraction and "Page N" chips follow Start at before Apply. The roman chip still reads "i, ii, iii".
- A saved cover still numbers the next page as 1. The chips follow Start at, so they can disagree with that page until the cover is off.
- The cover, a different first page, and the watermark still wait for Apply.
- No ruler or centimeter margins.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| With Start at at 12 on a two-page file, the fraction chip reads "12 / 13" and the page chip reads "Page 12", before Apply | Met | Video ~12–14s: Start at is 12, the chips say 12 / 13 and Page 12, and Apply is still on screen. Vitest `follows a start of 12, then 3, on a two-page file`. Browser `format chips follow the starting number before apply`. |
| The selected chip matches the number on the page | Met | Video ~13s: Page 12 is the selected chip and the page says Page 12. The scene and the browser test compare the checked chip with the page. |
| Changing Start at to 3 updates both chips before Apply | Met | Video ~17–19s: the chips say 3 / 4 and Page 3, and the page says Page 3, with Apply still on screen. |
| A start below 1 does not change the chips. They keep the last valid number | Met | Video ~22–24s: the field shows 0, the chips stay on 3 / 4 and Page 3, and the page stays on Page 3. Vitest `labels both format chips from the live start`. |
| Apply keeps 12, and reopening the file still shows "12 / 13" and "Page 12" on the chips | Met | Video ~28s after Apply, ~36s after reopen. The browser test checks the saved start and the reopened chips. |
| On an 800-pixel-tall window, both chips, Start at, and Apply stay visible together | Met | Video ~8s, ~13s, ~19s, ~23s, and ~36s, viewport 1280×800. The scene and the browser test measure both chips, Start at, and Apply inside the dialog. |
