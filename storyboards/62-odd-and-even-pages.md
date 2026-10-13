# 62 · Odd and even pages

**Mode:** single-node · **App:** Docs · **Video:** [videos/62-odd-and-even-pages.mp4](videos/62-odd-and-even-pages.mp4) · **Script:** [scenes/62-odd-and-even-pages.spec.ts](scenes/62-odd-and-even-pages.spec.ts)

## Who and why

Ben is printing the minutes double-sided. The inner margin should carry the page number, and the outer margin should carry the title, so the title sits on the right on odd pages and on the left on even pages. Different first page already exists. There is still one header for every page after the first, so a double-sided copy has the title in the gutter on the back of each sheet.

## Inspired by

- [Use different headers and footers](https://support.google.com/docs/answer/86629): "Different odd and even" is a second checkbox next to different first page.
- Storyboard [61](61-different-first-page.md): the first page can differ. This story is about pages 2 and 3, not page 1.
- People printing booklets find the header colliding with the binding because odd and even are the same.

## Scenes

1. **Three pages.** Ben opens "Minutes". Different first page is on, so page 1 is letterhead. Pages 2 and 3 both show "Garden club minutes" on the left.
2. **Odd and even.** In Page setup he ticks "Different odd and even pages". Page 2 (even) keeps a header box on the left. Page 3 (odd) gets its own header box on the right.
3. **The title.** He types "Minutes" in the even header and "Garden club" in the odd header. Page 2 does not show "Garden club". Page 3 does not show "Minutes".
4. **Numbers.** The even footer shows the number on the left. The odd footer shows it on the right. Page 1 still has no number.
5. **Save.** He reopens the file. Page 2 and page 3 still have their own headers.

## Google Workspace benchmark

In Google Docs the control is Insert › Headers & footers › Different odd & even ([Docs Help](https://support.google.com/docs/answer/86629)). It is a separate menu from page numbers, so the number stays in one corner on both sides until you move it by hand.

## Better than Google Workspace when

1. Page setup has one "Different odd and even pages" checkbox beside Different first page.
2. Ticking it gives page 2 and page 3 different headers without changing page 1's letterhead.
3. Text in the even header does not appear on an odd page, and the reverse.
4. Page numbers sit on the left on even pages and on the right on odd pages. Page 1 still has none.
5. The choice and both headers survive save and reopen.
6. Unticking restores one shared header on pages 2 and 3 in one step.

## Success looks like

A double-sided copy has the title on the outside edge and the page number on the inside edge. The letterhead on page 1 is unchanged.

## Gaps and notes

- After storyboard 61, only the first page can differ. Later pages share one header.
- Do not remove Different first page.
- A Word round trip of odd and even is a bonus, not required.
