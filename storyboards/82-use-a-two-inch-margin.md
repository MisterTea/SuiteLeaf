# 82 · Use a two-inch margin

**Mode:** single-node · **App:** Docs · **Video:** [videos/82-use-a-two-inch-margin.mp4](videos/82-use-a-two-inch-margin.mp4) · **Script:** [scenes/82-use-a-two-inch-margin.spec.ts](scenes/82-use-a-two-inch-margin.spec.ts)

## Who and why

Priya is formatting her thesis the way the department requires: two inches of margin so a bound copy can be marked up. Page setup stops at 1.5 inches. She types 2, Apply stays off, and the notes would land on the text.

## Inspired by

- [Change page margins](https://support.google.com/docs/answer/10296618): custom margins are plain numbers. Google accepts a 2 inch margin. A value large enough to swallow the page is still accepted, and you only notice at print time.
- This base stores one `margin` and clamps it to 0.25–1.5 inches (`MARGIN_MAX_PX` is 144). Word export writes that one value onto every edge.
- Storyboard [78](78-keep-the-word-margins.md) reads four Word edges on another branch, then still pulls anything over 1.5 inches back in. This story is the limit, not the four fields.

## Scenes

1. **Too tight.** Priya opens "Thesis notes". The text starts at the usual inset, well under two inches.
2. **Two inches.** In Page setup she sets the margin to 2 in and applies. The text moves in. The gap on the left is two inches.
3. **Too wide.** She tries 4 in. The field says a margin cannot be more than 3 inches, and Apply stays off. The page is still at 2 inches.
4. **Too small.** She tries 0. The field says a margin must be at least 0.25 inches, and Apply stays off.
5. **Save.** She reopens the file. Page setup still says 2 inches, and the text is still inset by that much.
6. **Word.** She downloads the document. The Word file writes two inches on the top, bottom, left, and right.

## Google Workspace benchmark

Google Docs lets you type 2, or 4, and clicks OK ([Docs Help](https://support.google.com/docs/answer/10296618)). A 4 inch margin on letter paper leaves almost no line, and nothing says so until you print.

## Better than Google Workspace when

1. Page setup accepts 2 inches, and Apply commits it.
2. The body inset matches 2 inches, within a tenth of an inch, on every edge.
3. A margin over 3 inches is refused, the reason is visible, and Apply does not commit it.
4. A margin under 0.25 inches is refused the same way.
5. The 2 inch value survives save and reopen.
6. Downloading Word writes 2 inches on each edge of `w:pgMar`.

## Success looks like

Priya sets two inches, sees the text move in by that much, and the file still says 2 inches after she reopens it. Four inches never replaces it. The Word file has 2 inches on every edge.

## Gaps and notes

- One margin is still applied to every edge. There are no separate Top, Bottom, Left, and Right fields.
- There is no centimeter unit, Narrow or Wide preset, binding gutter, or header distance.
- Word import of `w:pgMar` is another branch. This story exports 2 inches. Opening that file back is not covered here.
- A short page still has empty paper below the last line. The bottom inset is the body padding, the same 2 inches as the other edges, not a line sitting on the margin.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. Page setup accepts 2 inches, and Apply commits it | Met | Video 0:11, field shows 2 and Apply is on; 0:14 the text has moved in. Browser test `page setup accepts 2 inches, refuses values outside 0.25 to 3, and exports them`. |
| 2. The body inset matches 2 inches, within a tenth of an inch, on every edge | Met | Video 0:14, the pointer sits in the left gap and the line ends further in. The same browser test measures all four edges. |
| 3. A margin over 3 inches is refused, the reason is visible, and Apply does not commit it | Met | Video 0:17, “A margin cannot be more than 3 inches.” and Apply is gray. Enter does not close the dialog. The page is still at 2 inches at 0:23. |
| 4. A margin under 0.25 inches is refused the same way | Met | Video 0:21, “A margin must be at least 0.25 inches.” and Apply is gray. The same browser test also checks that 0.25 inches enables Apply and 0 does not. |
| 5. The 2 inch value survives save and reopen | Met | Video 0:27, Page setup still shows 2. The browser test reads `margin: 192` from the saved file and measures the inset again after reopen. |
| 6. Downloading Word writes 2 inches on each edge of `w:pgMar` | Met | Video 0:31. Vitest `writes a two-inch margin as 2880 twips on every edge` and the scene both expect `w:top`, `w:right`, `w:bottom`, and `w:left` of `"2880"`. |
