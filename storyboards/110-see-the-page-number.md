# 110 · See the page number before you apply

**Mode:** single-node · **App:** Docs · **Video:** [videos/110-see-the-page-number.mp4](videos/110-see-the-page-number.mp4) · **Script:** [scenes/110-see-the-page-number.spec.ts](scenes/110-see-the-page-number.spec.ts)

## Who and why

Sam turns on page numbers for the minutes. The page stays blank in the corner until she clicks Apply, so she cannot tell whether the number sits on the footer. The header words, the margin, and the paper size already update while Page setup is open. The number does not.

## Inspired by

- [Add page numbers](https://support.google.com/docs/answer/9378647): Insert › Page numbers, then a position. Nothing appears until you confirm.
- Storyboard [106](106-see-the-header-text.md) shows header and footer words before Apply. Page numbers, the watermark, and the cover option still wait.
- This story is the number. The watermark and the cover can keep waiting.

## Scenes

1. **No number.** Sam writes "Minutes" on two pages and puts "Draft minutes" in the header. The page shows that header and no page number.
2. **It appears.** She opens Page setup and turns page numbers on. Before Apply, page 1 shows "1 / 2" and page 2 shows "2 / 2".
3. **Cancel.** She cancels. The numbers are gone. "Draft minutes" stays.
4. **Keep it.** She turns them on again, sees "1 / 2", and applies. "1 / 2" and "2 / 2" stay. She reopens the file. "1 / 2" is still in the corner.
5. **The header still types.** She types "Town council" in the header. Those words show on the page before Apply, and "1 / 2" stays. The page-number control, the header field, and Apply are on screen together.

## Google Workspace benchmark

Google Docs waits until you leave the page-number menu ([Docs Help](https://support.google.com/docs/answer/9378647)). A number that lands on the footer is a second trip back into the menu.

## Better than Google Workspace when

1. While Page setup is open, turning page numbers on shows a number on the page before Apply.
2. A document of two pages shows 1 on the first and 2 on the second, or "1 / 2" and "2 / 2", before Apply.
3. Cancel removes the numbers and restores the setting from before the dialog opened.
4. Apply keeps page numbers through save and reopen.
5. Typing a header still shows that text on the page before Apply.
6. On an 800-pixel-tall window, the page-number control, the header field, and Apply stay visible together.

## Success looks like

Sam watches "1 / 2" appear in the corner while Page setup is still open, and "2 / 2" on the next page. Cancel removes the numbers. Apply keeps them after she reopens the file. Typing "Town council" still shows on the page before Apply.

## Gaps and notes

- Format, position, where numbering starts, the cover, a different first page, and the watermark still wait for Apply.
- Do not add a live watermark, a live cover option, or a live switch for a different first page.
- Do not add a ruler, centimeter margins, or another paper size.
- The number that appears is bottom right, as "1 / 2".

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| While Page setup is open, turning page numbers on shows a number on the page before Apply | Met | Video ~17–19s: the corner shows "1 / 2" with Apply still on screen. Vitest `draws 1 / 2 and 2 / 2 before apply`. Browser `page numbers show before apply, and cancel puts them back`. |
| A document of two pages shows 1 then 2, or "1 / 2" and "2 / 2", before Apply | Met | Video ~18s "1 / 2", ~20–22s "2 / 2". The scene asserts both strings. |
| Cancel removes the numbers and restores the setting from before the dialog opened | Met | Video ~23–26s: the corner is blank and "Draft minutes" stays. The browser test downloads the file after cancel and expects `pageNumbers: false`. |
| Apply keeps page numbers through save and reopen | Met | Video ~30s "1 / 2" after Apply, ~33s "2 / 2", ~38s still there after reopen. The browser test checks the saved file and the reopened page. |
| Typing a header still shows that text on the page before Apply | Met | Video ~45s: page 2 shows "Town council" while the dialog is open and "1 / 2" is still on page 1. Vitest `still draws a header typed in the same dialog`. |
| On an 800-pixel-tall window, the page-number control, the header field, and Apply stay visible together | Met | Video ~15s and ~45s, viewport 1280×800. The scene and the browser test measure all three inside the dialog. |
