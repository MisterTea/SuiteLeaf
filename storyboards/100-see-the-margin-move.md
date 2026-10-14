# 100 · See the margin move before you apply

**Mode:** single-node · **App:** Docs · **Video:** [videos/100-see-the-margin-move.mp4](videos/100-see-the-margin-move.mp4) · **Script:** [scenes/100-see-the-margin-move.spec.ts](scenes/100-see-the-margin-move.spec.ts)

## Who and why

Sam widens the margin from 1 inch to 1.5 inches. The letterhead distance already moves the page while Page setup is open, but the notes stay put until she clicks Apply. She cannot tell whether the title still clears "Town council" until the dialog closes.

## Inspired by

- [Change page margins](https://support.google.com/docs/answer/10296618): File › Page setup changes nothing until OK. A margin that is too wide is a second trip into the dialog.
- Storyboard [97](97-see-the-letterhead-move.md) updates Header from edge and Footer from edge immediately. The margin, the paper size, and the header text still wait for Apply.
- This story is the margin. Paper size and header text can keep waiting.

## Scenes

1. **One inch.** Sam opens Page setup on "Minutes". The title starts 1 inch in. "Town council" is 0.5 inches from the top.
2. **It moves.** She sets the margin to 1.5 inches. Before Apply, the title moves in. "Town council" stays at 0.5 inches. The dialog still shows 1.5.
3. **Cancel.** She cancels. The title returns to 1 inch.
4. **Keep it.** She sets 1.5 inches again, sees the title move, and applies. She reopens the file. The margin is still 1.5 inches.
5. **The letterhead still moves.** She sets Footer from edge to 1.5 inches. "Hearing notes" rises before Apply, and Bottom stays 1.5 inches if that is the margin she just applied, or shows the margin she is editing.

## Google Workspace benchmark

Google Docs waits for OK ([Docs Help](https://support.google.com/docs/answer/10296618)). You close the dialog to see the text jump, then open it again if the gap is wrong.

## Better than Google Workspace when

1. While Page setup is open, changing the margin from 1 inch to 1.5 inches moves the body inset on the page before Apply.
2. A header distance of 0.5 inches does not change when the margin changes. Only the body moves.
3. Cancel restores the margin from before the dialog opened, on the page.
4. Apply keeps 1.5 inches through save and reopen.
5. Footer from edge still moves the footer on the page before Apply.
6. On an 800-pixel-tall window, the margin, Footer from edge, its explanation, and Apply stay visible together.

## Success looks like

Sam watches the title move in to 1.5 inches while the dialog is still open. "Town council" stays put. Cancel puts the title back. Apply keeps the wider margin.

## Gaps and notes

- While Page setup is open, a margin inside 0.25–3 inches moves the body on the page. A margin outside that range stays on the saved page, and Apply stays off. Header and footer distances still update live. Paper size and the header and footer text still wait for Apply.
- There is no ruler, centimeter unit, or a separate distance for the first page or for odd and even pages.
- On a laptop the dialog sits on the right, so the page stays visible. The margin, Footer from edge, its explanation, and Apply fit an 800-pixel-tall window together.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. While Page setup is open, changing the margin from 1 inch to 1.5 inches moves the body inset before Apply | Met | Video 0:14, Minutes starts 1 inch in with the dialog not yet open. Video 0:21, the title has dropped, every margin field reads 1.5, and Apply is still there. Browser test `the margin moves before apply, and cancel puts it back`. |
| 2. A 0.5 inch header distance does not change when the margin changes. Only the body moves | Met | Video 0:14 and 0:21, Town council stays at the same height while Minutes moves down. The test measures the header at 0.5 inches and the title at 1.5. |
| 3. Cancel restores the margin from before the dialog opened | Met | Video 0:26, the title is 1 inch in again and Town council has not moved. The test measures the page and the saved file after Cancel. |
| 4. Apply keeps 1.5 inches through save and reopen | Met | Video 0:36, the wider margin is on the page after Apply. Video 0:40, the reopened file still shows it. The test reads the saved file and reopens it. |
| 5. Footer from edge still moves the footer before Apply | Met | Video 0:44, Hearing notes sits near the bottom of the page and Footer from edge reads 1. Video 0:50, it has risen, the field reads 1.5, and Bottom is still 1.5. The test measures the footer at 1.5 inches. |
| 6. On an 800-pixel-tall window the margin, Footer from edge, its explanation, and Apply stay visible together | Met | Video 0:50, Bottom, Footer from edge, the blue note, and Apply are on screen together. The test checks they are in view, the note does not cover Bottom, and the dialog body does not scroll. |
