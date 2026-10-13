# 105 · See landscape before you apply

**Mode:** single-node · **App:** Docs · **Video:** [videos/105-see-landscape.mp4](videos/105-see-landscape.mp4) · **Script:** [scenes/105-see-landscape.spec.ts](scenes/105-see-landscape.spec.ts)

## Who and why

Sam is laying out a wide table. Page setup has Landscape, but the page stays tall until she clicks Apply. She cannot tell whether the title still fits the wide sheet before she commits. Paper size already changes while the dialog is open. Orientation does not.

## Inspired by

- [Change page margins](https://support.google.com/docs/answer/10296618): File › Page setup has orientation, and nothing changes until OK.
- Storyboard [103](103-see-the-paper-size.md) updates Letter and A4 on the page before Apply, including the size label. Landscape still waits.
- This story is orientation. Header and footer wording can keep waiting.

## Scenes

1. **Portrait.** Sam opens Page setup on "Minutes". The page is Letter, taller than it is wide. The label says Letter, 8.5 × 11 in.
2. **It turns.** She turns on Landscape. Before Apply, the page is wider than it is tall. The label says Letter, 11 × 8.5 in. The paper size menu and the margin diagram turn with it.
3. **Cancel.** She cancels. The page is portrait Letter again.
4. **Keep it.** She turns Landscape on again, sees the page turn, and applies. At 50% zoom the whole wide sheet is on screen. She reopens the file. It is still landscape.
5. **A4 still moves.** With the dialog open she chooses A4. The page changes size before Apply, landscape stays on, and the label says A4, 11.7 × 8.27 in.
6. **The margin still moves.** She sets the margin from 1 inch to 1.5 inches. The title moves in before Apply. Town council stays put. Paper size, Landscape, the margin, and Apply stay on screen together.

## Google Workspace benchmark

Google Docs waits for OK ([Docs Help](https://support.google.com/docs/answer/10296618)). You close the dialog to see the page turn, then open it again if the table still overflows.

## Better than Google Workspace when

1. While Page setup is open, turning on Landscape makes the page wider than it is tall before Apply.
2. Cancel restores portrait on the page.
3. Apply keeps landscape through save and reopen.
4. Choosing A4 still changes the page width and height before Apply.
5. Changing the margin from 1 inch to 1.5 inches still moves the body before Apply.
6. On an 800-pixel-tall window, paper size, Landscape, the margin, and Apply stay visible together.

## Success looks like

Sam watches the page turn wide while the dialog is still open. Cancel puts the tall page back. Apply keeps the wide page after she reopens the file. A4 and the margin still move before Apply.

## Gaps and notes

- While Page setup is open, Landscape turns the page and updates the size label before Apply. The paper size menu and the small margin diagram use the wide size too. Cancel restores portrait. Header and footer wording still wait for Apply.
- There is no Legal, Tabloid, or custom size, no ruler, and no centimeter margins.
- At 100% a landscape Letter page is wider and taller than the window, so the recording zooms to 50% after Apply and after reopen to show the whole sheet. While the dialog is open the page is scaled to fit beside it.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. While Page setup is open, turning on Landscape makes the page wider than it is tall before Apply | Met | Video 0:15, the sheet says Letter, 11 × 8.5 in, Landscape is selected, and the page beside the dialog is wider than it is tall. Apply is still there. Browser test `landscape turns before apply, and cancel restores portrait`. |
| 2. Cancel restores portrait on the page | Met | Video 0:19, the dialog is gone and the page is the tall Letter sheet again. The test measures 816 by 1056 pixels and the saved file is not landscape. |
| 3. Apply keeps landscape through save and reopen | Met | Video 0:27, Apply leaves the whole wide page on screen. Video 0:31, the reopened file is still landscape. The test reads the saved file and reopens it. |
| 4. Choosing A4 still changes the page width and height before Apply | Met | Video 0:34, the sheet says A4, 11.7 × 8.27 in, Landscape stays on, and Apply is still there. The test measures 1123 by 794 pixels. |
| 5. Changing the margin from 1 inch to 1.5 inches still moves the body before Apply | Met | Video 0:44, every margin reads 1.5, the title has moved in, and Town council has not. The test measures the title at 1.5 inches and the header at 0.75. |
| 6. On an 800-pixel-tall window, paper size, Landscape, the margin, and Apply stay visible together | Met | Video 0:15 and 0:44, the paper size menu, Landscape, the margin fields, and Apply are on screen together, with the page beside the dialog. The test checks they are in view and the dialog body does not scroll. |
