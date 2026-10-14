# 132 · Put odd and even numbers on the outside

**Mode:** single-node · **App:** Docs · **Video:** [videos/132-numbers-on-the-outside.mp4](videos/132-numbers-on-the-outside.mp4) · **Script:** [scenes/132-numbers-on-the-outside.spec.ts](scenes/132-numbers-on-the-outside.spec.ts)

## Who and why

Sam already put the page number at the top right. She then turns on different odd and even pages so a bound copy can be thumb-indexed from the outside. Both pages keep the number on the right. The even page's number is on the inside, against the binding, where a thumb cannot find it.

## Inspired by

- [Add page numbers](https://support.google.com/docs/answer/9378647): mirroring headers does not by itself move a number you already placed. You set the even page by hand.
- Storyboard [128](128-preview-the-last-odd-and-even.md) shows the last odd and even pages. If a corner was already chosen, both pages keep that corner.
- The outside edge is the point of odd and even pages. The number should go there when the switch turns on.

## Scenes

1. **Top right.** Sam opens Page setup on a five-page "Preface". The number is at the top right on every page. The preview shows page 1 and page 5 that way.
2. **The switch.** She turns on different odd and even pages. Before Apply, page 5 still has its number on the right. Page 4's number moves to the left. The preview shows the same.
3. **The pages.** She looks at the document. Page 4's number is on the left. Page 5's number is on the right. Apply is still available.
4. **Off.** She turns the switch off. Every preview page puts the number back at the top right, including the last page.
5. **Keep it.** She turns the switch on again, sees the outside edges, and applies. She reopens the file. Page 4 is still on the left and page 5 is still on the right.

## Google Workspace benchmark

Google Docs keeps a number where you placed it when you mirror pages ([Docs Help](https://support.google.com/docs/answer/9378647)). Moving the even page to the outside is another choice, easy to miss.

## Better than Google Workspace when

1. With the number already at the top right, turning on different odd and even pages moves the even page's number to the left before Apply.
2. The odd page's number stays on the right.
3. The preview shows the last even page with the number on the left and the last odd page with the number on the right, before Apply.
4. The document pages match that preview before Apply.
5. Turning the switch off puts the number back at the top right on every preview page.
6. Apply and reopen keep the even number on the left and the odd number on the right.

## Success looks like

Sam turns the switch on and page 4's number slides to the left while page 5 stays on the right, on the preview and on the pages, before she applies.

## Gaps and notes

- No live cover, no live watermark, no section break, and no control for the numeral's font or size.
- The position control stays on the corner Sam already chose. Turning on different odd and even pages moves that corner to the outside edge: top right becomes top left on even pages, and bottom center becomes the outside bottom edge. Turning the switch off puts the chosen corner back on every page.
- The preview still shows the last even page and the last odd page, from storyboard 128.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| With the number already at the top right, turning on different odd and even pages moves the even page's number to the left before Apply | Met | Video 0:09: the switch is on, Apply is still on screen, and page 4's number is on the left of the page and of the preview. Vitest `moves a top-right number to the left on even pages and keeps odd pages on the right`. Browser `a top-right number moves to the outside edge before apply and stays after reopen`. |
| The odd page's number stays on the right | Met | Video 0:09: page 5 stays at the top right on the page and on the preview. The same browser test checks page 5. |
| The preview shows the last even page with the number on the left and the last odd page with the number on the right, before Apply | Met | Video 0:09: sheets labeled Page 4 · last even and Page 5 · last odd, with the numerals on the outside edges, before Apply. |
| The document pages match that preview before Apply | Met | Video 0:09: the document shows page 4 on the left and page 5 on the right while Apply is still available. |
| Turning the switch off puts the number back at the top right on every preview page | Met | Video 0:13: the switch is off, the preview is page 1 and page 5, and both numerals are at the top right. The document pages match. |
| Apply and reopen keep the even number on the left and the odd number on the right | Met | Video 0:20: after Apply, page 4 is at the top left. Video 0:22: page 5 is at the top right. Video 0:26: after reopen, the switch is still on and the pages are still on the outside edges. |
