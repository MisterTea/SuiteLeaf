# 65 · Choose a page number

**Mode:** single-node · **App:** Docs · **Video:** [videos/65-choose-a-page-number.mp4](videos/65-choose-a-page-number.mp4) · **Script:** [scenes/65-choose-a-page-number.spec.ts](scenes/65-choose-a-page-number.spec.ts)

## Who and why

Ben's minutes always print "1 / 3" in the bottom right. The committee wants "Page 2" at the bottom center, and the first page should start at 1 even when there is a cover. Page setup only offers a checkbox, and the hint says the number is always "1 / 3" at the bottom right.

## Inspired by

- [Add page numbers](https://support.google.com/docs/answer/86629): choose a position and whether to show the count. Google hides the position choices inside the header editor.
- `apps/web/src/editors/Docs.tsx` draws `{i + 1} / {pageCount}` in the footer. The Page setup hint says "Bottom right of every page, as 1 / 3".
- People cannot find where to put the number in the center, or how to hide the total.

## Scenes

1. **The default.** Ben opens "Minutes". Each page ends with "1 / 2" at the bottom right.
2. **The choice.** In Page setup, with page numbers on, he picks "Page 1" instead of "1 / 2", and Bottom center instead of Bottom right.
3. **The page.** Page 1 shows "Page 1" in the center of the footer. Page 2 shows "Page 2". Neither shows a total.
4. **Top right.** He switches the position to Top right. The footer number is gone. "Page 1" sits in the header area on the right.
5. **Save.** He reopens the file. The position and the "Page N" wording are unchanged.

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

The minutes show "Page 1" and "Page 2" at the bottom center. The total is gone. Reopening the file keeps that choice.

## Gaps and notes

- Numbers are always "n / total" at the bottom right.
- Do not rebuild on-page header editing or odd/even layouts. If those exist on this base, the chosen position must still be used.
- Roman numerals and a custom start number are out of scope.
