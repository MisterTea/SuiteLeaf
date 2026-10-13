# 106 · See the header text before you apply

**Mode:** single-node · **App:** Docs · **Video:** [videos/106-see-the-header-text.mp4](videos/106-see-the-header-text.mp4) · **Script:** [scenes/106-see-the-header-text.spec.ts](scenes/106-see-the-header-text.spec.ts)

## Who and why

Sam types "Town council" into the header while Page setup is open. She needs to see those words on the page, above the title, before she clicks Apply. Paper size, landscape, the margin, and the header distance already update the page. The words do too.

## Inspired by

- [Change page margins](https://support.google.com/docs/answer/10296618): File › Page setup holds the header text until OK.
- Storyboard [105](105-see-landscape.md) turns the page before Apply. Header and footer wording used to wait.
- This story is those words. Do not add more paper sizes.

## Scenes

1. **The old words.** Sam opens Page setup on "Minutes". The page header is empty. She sets a 1 inch margin and puts the header an inch from the top. Still no words.
2. **It appears.** She types "Town council" in the header. Before Apply, those words show on the page, an inch from the top, above the title.
3. **Cancel.** She cancels. The header on the page is empty again.
4. **Keep it.** She types "Town council" again, sees it on the page, and applies. She reopens the file. The header is still there.
5. **The footer.** She types "Hearing notes" in the footer. Those words show at the bottom of the page before Apply.
6. **Landscape.** She turns on Landscape. Before Apply, the page is wider than it is tall. The header field, the footer field, and Apply stay on screen together.
7. **Cancel the footer.** She cancels. The footer is empty again. "Town council" stays, because she already applied it.

## Google Workspace benchmark

Google Docs waits for OK ([Docs Help](https://support.google.com/docs/answer/10296618)). You close the dialog to see the header, then open it again if it collides with the title.

## Better than Google Workspace when

1. While Page setup is open, typing a header shows that text on the page before Apply.
2. Cancel restores the header from before the dialog opened.
3. Apply keeps the header through save and reopen.
4. Typing a footer shows that text on the page before Apply, and Cancel restores the old footer.
5. Turning on Landscape still makes the page wider than it is tall before Apply.
6. On an 800-pixel-tall window, the header field, the footer field, and Apply stay visible together.

## Success looks like

Sam watches "Town council" appear above the title while the dialog is still open. Cancel clears it. Apply keeps it after she reopens the file. "Hearing notes" appears at the bottom before Apply, and Cancel puts the old footer back.

## Gaps and notes

- While Page setup is open, header and footer wording show on the page before Apply. Cancel restores the words from when the dialog opened. The page is scaled to fit beside the dialog, so those words are smaller than they are after Apply.
- Do not add Legal, Tabloid, a custom paper size, a ruler, or centimeter margins.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. While Page setup is open, typing a header shows that text on the page before Apply | Met | Video 0:16, "Town council" is on the page above "Minutes" while Page setup is still open. Browser test `header and footer words show before apply, and cancel restores them`. |
| 2. Cancel restores the header from before the dialog opened | Met | Video 0:21, the dialog is gone and the page header is empty again. The test reads the saved file and still finds the old header. |
| 3. Apply keeps the header through save and reopen | Met | Video 0:27, Apply leaves "Town council" on the page. Video 0:31, the reopened file still shows it above the title. The test reopens the file. |
| 4. Typing a footer shows that text on the page before Apply, and Cancel restores the old footer | Met | Video 0:37, "Hearing notes" is at the bottom while the dialog is open. Video 0:43, Cancel removes it and "Town council" stays. The test checks both the page and the saved file. |
| 5. Turning on Landscape still makes the page wider than it is tall before Apply | Met | Video 0:40, the sheet says Letter, 11 × 8.5 in, Landscape is selected, and Apply is still there. The test measures 1056 by 816 pixels. |
| 6. On an 800-pixel-tall window, the header field, the footer field, and Apply stay visible together | Met | Video 0:16 and 0:40, the header field, the footer field, and Apply are on screen together, with the page beside the dialog. The test checks they are in view on an 800-pixel-tall window. |
