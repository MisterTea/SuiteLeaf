# 97 · See the letterhead move before you apply

**Mode:** single-node · **App:** Docs · **Video:** [videos/97-see-the-letterhead-move.mp4](videos/97-see-the-letterhead-move.mp4) · **Script:** [scenes/97-see-the-letterhead-move.spec.ts](scenes/97-see-the-letterhead-move.spec.ts)

## Who and why

Sam sets Footer from edge to 1.5 inches. The dialog says the notes will move up, but the page behind it still shows the old footer. She has to apply before she can tell whether "Hearing notes" clears the last line.

## Inspired by

- [Change page margins](https://support.google.com/docs/answer/10296618): File › Page setup changes nothing until OK. A bad margin is a second trip back into the dialog.
- Storyboard [94](94-see-the-margin-and-the-reason.md) keeps the explanation beside the margin. The paper still waits for Apply.
- The distance rules stay as they are. This story is the live page.

## Scenes

1. **Still the old place.** Sam opens Page setup on "Minutes". The footer "Hearing notes" is 1 inch from the bottom.
2. **It moves.** She sets Footer from edge to 1.5 inches. Before she clicks Apply, the footer on the page moves up and the last line sits above it. Bottom still reads 1 inch.
3. **Cancel.** She cancels. "Hearing notes" returns to 1 inch.
4. **Keep it.** She sets it to 1.5 inches again, sees the page move, and applies. The footer stays there.
5. **The header.** She sets Header from edge to 0.5 inches. "Town council" moves up before Apply, and "Minutes" stays at the 1 inch margin.

## Google Workspace benchmark

Google Docs waits for OK ([Docs Help](https://support.google.com/docs/answer/10296618)). You close the dialog to see the letterhead, then open it again if the gap is wrong.

## Better than Google Workspace when

1. While Page setup is open, changing Footer from edge moves the footer on the page before Apply.
2. The body clears that footer on the page, and the Bottom field stays 1 inch.
3. Cancel restores the footer to the distance from before the dialog opened.
4. Apply keeps the new distance through save and reopen.
5. Changing Header from edge to 0.5 inches moves only the header, before Apply. The first paragraph stays at the margin.
6. On an 800-pixel-tall window, the footer distance, its explanation, Bottom, and Apply stay visible together. The explanation is not removed.

## Success looks like

Sam watches "Hearing notes" move up while the dialog is still open. Cancel puts it back. Apply keeps the move she just saw.

## Gaps and notes

- Header and footer distances update the page while Page setup is open. Paper size, margins, and the header and footer text still wait for Apply.
- There is no ruler, centimeter unit, or a separate distance for the first page or for odd and even pages.
- The explanation stays under the distance, beside the margin. On a laptop the dialog sits on the right so the page stays visible. It does not cover Bottom.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. While Page setup is open, changing Footer from edge moves the footer before Apply | Met | Video 0:17, Hearing notes is at 1 inch with the dialog open. Video 0:20, it has moved up and Footer from edge reads 1.5. Browser test `the letterhead moves before apply, and cancel puts it back`. |
| 2. The body clears that footer, and Bottom stays 1 inch | Met | Video 0:20, note 34 sits above Hearing notes, Bottom reads 1, and the explanation is on screen. The test checks the gap, the padding, and the Bottom field. |
| 3. Cancel restores the distance from before the dialog opened | Met | Video 0:26, Hearing notes is 1 inch from the bottom again. The test measures the page and the saved file after Cancel. |
| 4. Apply keeps the new distance through save and reopen | Met | Video 0:31, Apply. Video 0:35, the reopened file still shows Hearing notes up. The test reads the saved file and reopens it. |
| 5. Header from edge at 0.5 inches moves only the header, before Apply | Met | Video 0:39, Town council is lower and the field reads 0.75. Video 0:43, it has moved up, Minutes has not, and Apply is still there. The test measures the header at 0.5 inches and the title at 1 inch. |
| 6. On an 800-pixel-tall window the footer distance, its explanation, Bottom, and Apply stay visible. The explanation is not removed | Met | Video 0:20, all four are on screen and the note sits under the distance. The test checks they are in view, the dialog does not scroll, and a click still hits Bottom. |
