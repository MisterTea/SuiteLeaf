# 103 · See the paper size change before you apply

**Mode:** single-node · **App:** Docs · **Video:** [videos/103-see-the-paper-size.mp4](videos/103-see-the-paper-size.mp4) · **Script:** [scenes/103-see-the-paper-size.spec.ts](scenes/103-see-the-paper-size.spec.ts)

## Who and why

Sam's printer takes A4. Page setup still shows Letter until she clicks Apply, so she cannot tell whether "Minutes" still fits before she commits. The margin and the letterhead already move while the dialog is open. The paper size does not.

## Inspired by

- [Change page margins](https://support.google.com/docs/answer/10296618): File › Page setup lists Letter and A4, and nothing changes until OK.
- Storyboard [100](100-see-the-margin-move.md) updates the margin on the page before Apply. Paper size, and the header and footer wording, still wait.
- This story is the paper size. Header and footer wording can keep waiting.

## Scenes

1. **Letter.** Sam opens Page setup on "Minutes". The page is Letter, 8.5 by 11 inches, and a label on the sheet says so.
2. **It changes.** She chooses A4. Before Apply, the label reads "A4, 8.27 × 11.7 in" and the page becomes taller and a little narrower. The title is still on the page.
3. **Cancel.** She cancels. The page is Letter again.
4. **Keep it.** She chooses A4 again, sees the page change, and applies. She reopens the file. It is still A4.
5. **The margin still moves.** With the dialog open she sets the margin from 1 inch to 1.5 inches. The title moves in before Apply. Town council stays put.
6. **The letterhead still moves.** She sets Header from edge to 0.5 inches. Only the header moves. Paper size, the margin, and Apply stay on screen together.

## Google Workspace benchmark

Google Docs waits for OK ([Docs Help](https://support.google.com/docs/answer/10296618)). You close the dialog to see Letter become A4, then open it again if the text no longer fits.

## Better than Google Workspace when

1. While Page setup is open, choosing A4 changes the page width and height before Apply.
2. Cancel restores Letter on the page.
3. Apply keeps A4 through save and reopen.
4. Changing the margin from 1 inch to 1.5 inches still moves the body before Apply.
5. Header from edge at 0.5 inches still moves only the header before Apply.
6. On an 800-pixel-tall window, the paper size, the margin, and Apply stay visible together.

## Success looks like

Sam watches the sheet switch from "Letter, 8.5 × 11 in" to "A4, 8.27 × 11.7 in" while the dialog is still open. Cancel puts Letter back. Apply keeps A4 after she reopens the file. The margin and the letterhead still move before Apply.

## Gaps and notes

- While Page setup is open, Letter and A4 update the page width and height, and a label on the sheet names the size. A size Page setup cannot choose is not drawn. Orientation still waits for Apply.
- Header and footer wording still wait for Apply. There is no ruler, centimeter unit, or a separate header distance for the first page or for odd and even pages.
- On a laptop the dialog sits on the right and the whole page fits beside it, so the size change stays in view. The paper size, the margin, and Apply fit an 800-pixel-tall window together.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. While Page setup is open, choosing A4 changes the page width and height before Apply | Met | Video 0:15, the sheet says Letter, 8.5 × 11 in and the menu says Letter. Video 0:16, the sheet says A4, 8.27 × 11.7 in, the menu says A4, and Apply is still there. Browser test `paper size changes before apply, and cancel restores letter`. |
| 2. Cancel restores Letter on the page | Met | Video 0:21, the dialog is gone and the page is Letter again. The test measures 816 by 1056 pixels and the saved file is not A4. |
| 3. Apply keeps A4 through save and reopen | Met | Video 0:26, Apply leaves the A4 page. Video 0:29, the reopened file is still A4. The test reads the saved file and reopens it. |
| 4. Changing the margin from 1 inch to 1.5 inches still moves the body before Apply | Met | Video 0:38, every margin reads 1.5, the title has moved in, and Town council has not. The test measures the title at 1.5 inches and the header at 0.75. |
| 5. Header from edge at 0.5 inches still moves only the header before Apply | Met | Video 0:42, Header from edge reads 0.5, Town council sits higher, and the title stays at the wider margin. The test measures the header at 0.5 inches and the title at 1.5. |
| 6. On an 800-pixel-tall window, the paper size, the margin, and Apply stay visible together | Met | Video 0:16 and 0:42, the paper size menu, the margin fields, and Apply are on screen together, with the page beside the dialog. The test checks they are in view and the dialog body does not scroll. |
