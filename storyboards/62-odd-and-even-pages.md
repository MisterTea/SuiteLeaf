# 62 · Odd and even pages

**Mode:** single-node · **App:** Docs · **Video:** [videos/62-odd-and-even-pages.mp4](videos/62-odd-and-even-pages.mp4) · **Script:** [scenes/62-odd-and-even-pages.spec.ts](scenes/62-odd-and-even-pages.spec.ts)

## Who and why

Ben is printing the minutes double-sided. The title and the page number should sit on the outside edge: on the left on even pages and on the right on odd pages, so neither falls in the gutter. Different first page already exists, and page 1 is the letterhead. Later pages still share one header on the left, so the back of each sheet has the title in the binding.

## Inspired by

- [Use different headers and footers](https://support.google.com/docs/answer/86629): "Different odd and even" is a second checkbox next to different first page.
- Storyboard [61](61-different-first-page.md): the first page can differ. This story is about pages 2 and 3, not page 1.
- People printing booklets find the header colliding with the binding because odd and even are the same.

## Scenes

1. **The pages.** Ben opens "Minutes". Different first page is on, so page 1 is the letterhead "Riverside Garden Club" with no number. Pages 2 and 3 both show "Garden club minutes" on the left, and the number on the right.
2. **Odd and even.** In Page setup, beside Different first page, he ticks "Different odd and even pages". The even and odd fields start from the shared header. The preview puts page 2's title and number on the left and page 3's on the right. Page 1 stays the letterhead.
3. **The title.** He types "Minutes" in the even header and "Garden club" in the odd header. Page 2 does not show "Garden club". Page 3 does not show "Minutes".
4. **Numbers.** The even page shows "2 / 4" on the left. The odd page shows "3 / 4" on the right. Page 1 still has no number.
5. **Save.** He reopens the file. Page 2 and page 3 still have their own headers, and page 1 is still the letterhead.
6. **One header again.** He unticks the box. Pages 2 and 3 show "Garden club minutes" on the left, and the numbers sit on the right. Page 1 is unchanged.

## Google Workspace benchmark

In Google Docs the control is Insert › Headers & footers › Different odd & even ([Docs Help](https://support.google.com/docs/answer/86629)). It is a separate menu from page numbers, so the number stays in one corner on both sides until you move it by hand. You also have to scroll to an even page to edit that header, and turning the option off does not show which header will return.

## Better than Google Workspace when

1. Page setup has one "Different odd and even pages" checkbox beside Different first page.
2. Ticking it gives page 2 and page 3 different headers without changing page 1's letterhead.
3. Text in the even header does not appear on an odd page, and the reverse.
4. Page numbers sit on the left on even pages and on the right on odd pages. Page 1 still has none.
5. The choice and both headers survive save and reopen.
6. Unticking restores one shared header on pages 2 and 3 in one step.

## Success looks like

Page 2 shows "Minutes" and "2 / 4" on the left. Page 3 shows "Garden club" and "3 / 4" on the right. The letterhead on page 1 is unchanged. Unticking puts one header back on pages 2 and 3.

## Gaps and notes

- A Word export writes the first, even, and odd headers and Word's even-and-odd and different-first-page flags. Opening that Word file back into SuiteLeaf still does not restore page setup.
- The web-page export is one page, so it keeps the shared header.
- Headers and footers are plain text. The title and the page number share the outside edge (title at the top, number at the bottom) rather than putting the number in the gutter.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. One checkbox beside Different first page | Met | Video 0:14, both checked in Page setup. `tests/browser/odd-even-pages.spec.ts` |
| 2. Page 2 and page 3 get different headers; page 1's letterhead stays | Met | Video 0:16 preview, 0:40 letterhead still "Riverside Garden Club" |
| 3. Even-header text stays off odd pages, and the reverse | Met | Video 0:24 "Minutes" on the even page, 0:28 "Garden club" on the odd page. Browser test |
| 4. Numbers on the left on even pages and the right on odd pages; page 1 has none | Met | Video 0:08 "2 / 4" on the right before the change, 0:24 "2 / 4" on the left, 0:30 "3 / 4" on the right, 0:40 no number on the cover |
| 5. The choice and both headers survive save and reopen | Met | Video 0:34, "2 / 4" still on the left after reopen. Browser test downloads the file and reopens it |
| 6. Unticking restores one shared header on pages 2 and 3 | Met | Video 0:47, "Garden club minutes" and "2 / 4" on the right. Browser test |
