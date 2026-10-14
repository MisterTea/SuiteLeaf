# 114 · See the starting number before you apply

**Mode:** single-node · **App:** Docs · **Video:** [videos/114-see-the-starting-number.mp4](videos/114-see-the-starting-number.mp4) · **Script:** [scenes/114-see-the-starting-number.spec.ts](scenes/114-see-the-starting-number.spec.ts)

## Who and why

Sam's chapter follows a 11-page front matter, so the first page of the minutes must be page 12. She sets Start at to 12, but the page still says "Page 1" until she clicks Apply. She cannot tell whether page 2 will say 13. The format and the position already update while Page setup is open. The starting number does not.

## Inspired by

- [Add page numbers](https://support.google.com/docs/answer/9378647): start numbering at a chosen number. The page does not show it until you confirm.
- Storyboard [113](113-see-where-the-number-goes.md) shows "Page 1" at the top right before Apply. Start at still waits.
- Storyboard [75](75-start-numbering-at.md) set the start. This story is seeing that number on the page first.

## Scenes

1. **Page 1.** Sam opens Page setup on a two-page "Minutes". Numbers are "Page 1" and "Page 2" at the top right.
2. **Start at 12.** She sets Start at to 12. Before Apply, the first page says "Page 12" and the second says "Page 13".
3. **A bad start.** She tries 0. The field explains that numbering starts at 1 or later, and the page stays on 12.
4. **Cancel.** She cancels. The pages say "Page 1" and "Page 2" again.
5. **Keep it.** She sets 12 again, sees "Page 12", and applies. She reopens the file. It still starts at 12.

## Google Workspace benchmark

Google Docs applies the start number when you leave the dialog ([Docs Help](https://support.google.com/docs/answer/9378647)). A start of 0 is accepted and then looks broken on the page.

## Better than Google Workspace when

1. While Page setup is open, setting Start at to 12 changes "Page 1" to "Page 12" before Apply.
2. The second page shows "Page 13" in the same place before Apply.
3. A start below 1 is refused, and the page keeps the last valid number.
4. Cancel restores the starting number from before the dialog opened.
5. Apply keeps 12 through save and reopen.
6. On an 800-pixel-tall window, Start at, the format control, and Apply stay visible together.

## Success looks like

Sam watches "Page 1" become "Page 12" while the dialog is still open, and the next page says "Page 13". Cancel puts "Page 1" back. Apply keeps 12 after she reopens the file.

## Gaps and notes

- Start at is drawn on the page while Page setup is open. Cancel drops that draft and puts the saved number back.
- A start below 1 stays in the field, in red, with the line "Numbering starts at 1 or later." The page keeps the last valid number.
- The cover, a different first page, and the watermark still wait for Apply.
- No ruler or centimeter margins.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| While Page setup is open, setting Start at to 12 changes "Page 1" to "Page 12" before Apply | Met | Video ~13s: Start at is 12, the page says Page 12, and Apply is still on screen. Vitest `shows Page 12 and Page 13 before apply and leaves the cover until apply`. Browser `starting number shows before apply`. |
| The second page shows "Page 13" in the same place before Apply | Met | Video ~16s: page 2 says Page 13 at the top right while the dialog is open. The scene and the browser test compare the top-right inset of both pages. |
| A start below 1 is refused, and the page keeps the last valid number | Met | Video ~19–21s: the field shows 0, the line says numbering starts at 1 or later, and the page still says Page 12. Vitest `refuses a start below 1 and keeps the last valid number`. |
| Cancel restores the starting number from before the dialog opened | Met | Video ~23s Page 1, ~25s Page 2. The browser test downloads after cancel and expects a start of 1. |
| Apply keeps 12 through save and reopen | Met | Video ~33s after Apply, ~40s after reopen, ~43s Page 13. The browser test checks the saved file and the reopened pages. |
| On an 800-pixel-tall window, Start at, the format control, and Apply stay visible together | Met | Video ~10s, ~13s, and ~19s, viewport 1280×800. The scene and the browser test measure Start at, Format, and Apply inside the dialog. |
