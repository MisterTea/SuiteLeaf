# 128 · Preview the last odd and even pages

**Mode:** single-node · **App:** Docs · **Video:** [videos/128-preview-the-last-odd-and-even.mp4](videos/128-preview-the-last-odd-and-even.mp4) · **Script:** [scenes/128-preview-the-last-odd-and-even.spec.ts](scenes/128-preview-the-last-odd-and-even.spec.ts)

## Who and why

Sam turns on different odd and even pages for a five-page preface. She wants the number on the outside edge: right on odd pages, left on even pages. The preview still samples the first three pages, so she never sees page 4 or page 5, which are the last even and last odd pages she will print.

## Inspired by

- [Add page numbers](https://support.google.com/docs/answer/9378647): odd and even pages can put the number on the outside. There is no preview of the last page of each kind.
- Storyboard [127](127-draw-the-number-on-the-preview.md) draws the number on a small page. Odd and even still sample the first three faces.
- Storyboard [62](62-odd-and-even-pages.md) mirrors the header. This story is the number on the last page of each parity.

## Scenes

1. **The first three.** Sam opens Page setup on a five-page "Preface" with page numbers on. Different odd and even is off. The preview shows the first and last pages.
2. **Outside edges.** She turns different odd and even on. Before Apply, the preview shows the last odd page and the last even page. The odd number sits on the right of its small page. The even number sits on the left.
3. **Those pages.** On a five-page file starting at 1, those are page 5 and page 4, drawn as "Page 5" and "Page 4", or "5" and "4" if that is the current format.
4. **Off again.** She turns the switch off. The preview returns to the first page and the last page, with the number in the selected corner on both.
5. **Keep it.** She turns the switch on again, sees page 5 on the right and page 4 on the left, and applies. She reopens the file. The preview still shows those two.

## Google Workspace benchmark

Google Docs lets you mirror headers and put numbers on the outside ([Docs Help](https://support.google.com/docs/answer/9378647)). You scroll to the last even page to check the side. The menu does not show it.

## Better than Google Workspace when

1. With different odd and even on, the preview shows one odd sheet and one even sheet before Apply, not only the first three file pages.
2. The number on the odd sheet is on the right. The number on the even sheet is on the left.
3. On a five-page file starting at 1, those sheets are the last odd page and the last even page.
4. Turning the switch off restores the first-and-last preview, with the number in the selected corner.
5. Apply and reopen keep the odd and even preview.
6. Each sheet is still a small page with the number drawn on it.

## Success looks like

Sam turns on odd and even pages and sees page 5 with the number on the right and page 4 with the number on the left, before she applies.

## Gaps and notes

- No live cover, no live watermark, and no section break that restarts at arabic 1. The outline's "Start Arabic numbers here" control was already there; this story does not drive it.
- No control for the numeral's font or size.
- With a chosen position already saved, odd and even pages keep that corner on the page, the same as before. This preview's outside edges are the default, when the position has not been set: bottom right until the switch is on, then left on the even page and right on the odd page.
- Storyboard 62's scene still looks for the old first-three preview. The browser test for that feature now expects the last odd page and the last even page.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| With different odd and even on, the preview shows one odd sheet and one even sheet before Apply, not only the first three file pages | Met | Video 0:10: the switch is on, Apply is still on screen, and there are two sheets. Vitest `previews the last even page and the last odd page, not the first three faces`. Browser `the odd and even preview shows the last pages before apply and after reopen`. |
| The number on the odd sheet is on the right. The number on the even sheet is on the left | Met | Video 0:10: Page 4 sits in the bottom-left of the left sheet, Page 5 in the bottom-right of the right sheet. The browser test measures those corners. |
| On a five-page file starting at 1, those sheets are the last odd page and the last even page | Met | Video 0:10: labels "Page 4 · last even" and "Page 5 · last odd", numerals "Page 4" and "Page 5". |
| Turning the switch off restores the first-and-last preview, with the number in the selected corner | Met | Video 0:06 and 0:13: Bottom right is selected, the sheets are Page 1 and Page 5, and "Pages 2–4 skipped" sits between them. |
| Apply and reopen keep the odd and even preview | Met | Video 0:22: after save and reopen, the switch is still on and the sheets are still Page 4 and Page 5. The browser test applies, reopens Preface, and checks both corners. |
| Each sheet is still a small page with the number drawn on it | Met | Video 0:06 and 0:10: the sheets are page-shaped, and the numerals are drawn on them. |
