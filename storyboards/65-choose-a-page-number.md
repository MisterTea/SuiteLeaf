# 65 · Choose a page number

**Mode:** single-node · **App:** Docs · **Video:** [videos/65-choose-a-page-number.mp4](videos/65-choose-a-page-number.mp4) · **Script:** [scenes/65-choose-a-page-number.spec.ts](scenes/65-choose-a-page-number.spec.ts)

## Who and why

Ben's minutes always print "1 / 3" in the bottom right. The committee wants "Page 2" at the bottom center, and the first page should start at 1 even when there is a cover. Page setup only offers a checkbox, and the hint says the number is always "1 / 3" at the bottom right.

## Inspired by

- [Add page numbers](https://support.google.com/docs/answer/86629): choose a position and whether to show the count. Google hides the position choices inside the header editor.
- `apps/web/src/editors/Docs.tsx` draws `{i + 1} / {pageCount}` in the footer. The Page setup hint says "Bottom right of every page, as 1 / 3".
- People cannot find where to put the number in the center, or how to hide the total.

## Scenes

1. **The default.** Ben opens "Minutes". Page 1 ends with "1 / 2" at the bottom right, and page 2 ends with "2 / 2" there too.
2. **The choice.** Page setup, one dialog, shows the format and the position next to the page-numbers checkbox. He picks "Page 1" and Bottom center. The hint and the little page preview follow.
3. **The page.** Page 1 shows "Page 1" in the center of the footer. Page 2 shows "Page 2". Neither shows a total.
4. **The footer.** He types "Committee draft" in the footer. That text sits on the left. The "Page 1" pill stays in the center.
5. **Top right.** He switches the position to Top right. The footer number is gone. "Page 1" and "Page 2" sit in the header area on the right. "Committee draft" is still in the footer.
6. **Save.** He reopens the file. The position and the "Page N" wording are unchanged.
7. **Off, then on.** Turning page numbers off removes the pills and leaves the footer text. Turning them on again restores "Page 1" at the top right.

## Google Workspace benchmark

In Google Docs you open the header, then Options, then Page numbers ([Docs Help](https://support.google.com/docs/answer/86629)). Position and "show count" are easy to miss. The number is ordinary text, so deleting it by accident removes it from every page.

## Better than Google Workspace when

1. Page setup shows the format and the position next to the page-numbers checkbox. No second dialog is required.
2. "1 / 2" and "Page 1" are both available. Choosing "Page 1" hides the total.
3. Bottom center, bottom right, and top right each place the number there and remove it from the other spot.
4. The number is not ordinary text. Editing the footer does not delete it.
5. The format and position survive save and reopen.
6. Turning page numbers off removes them from every page in one step.

## Success looks like

The minutes show "Page 1" at the top right, with "Committee draft" still in the footer. Reopening the file keeps that wording and place. Turning numbers off clears the pills, and turning them on brings the same choice back.

## Gaps and notes

- Roman numerals and a custom start number are out of scope.
- A different first page still hides the number on page 1. Odd and even pages still put the number on the outside edge until a position is chosen. Bottom right, Bottom center, and Top right then apply to every numbered page.
- Word and HTML export follow the format and position. Opening a Word file does not read a number format back in.
- The page preview still marks pages as even and odd when that option is off, so the sample can show a left-hand page.

## Result

| Criterion | Met? | Evidence |
| --- | --- | --- |
| Page setup shows the format and the position next to the page-numbers checkbox. No second dialog. | Met | Video ~0:07. One Page setup dialog; Format and Position sit under the checkbox. `tests/browser/page-numbers.spec.ts` |
| "1 / 2" and "Page 1" are both available. Choosing "Page 1" hides the total. | Met | Video ~0:11–0:13. The pills read "Page 1" and "Page 2". |
| Bottom center, bottom right, and top right each place the number there and remove it from the other spot. | Met | Video ~0:03 bottom right, ~0:12 bottom center, ~0:20 top right (the footer no longer has the number). |
| The number is not ordinary text. Editing the footer does not delete it. | Met | Video ~0:17. "Committee draft" is on the left and the "Page 1" pill stays in the center. |
| The format and position survive save and reopen. | Met | Video ~0:25. The browser test downloads the file and opens it again. |
| Turning page numbers off removes them from every page in one step. | Met | Video ~0:28. The footer text remains. ~0:32 turns them on again and "Page 1" returns at the top right. |
