# 84 · Set how far the header sits from the edge

**Mode:** single-node · **App:** Docs · **Video:** [videos/84-header-from-the-edge.mp4](videos/84-header-from-the-edge.mp4) · **Script:** [scenes/84-header-from-the-edge.spec.ts](scenes/84-header-from-the-edge.spec.ts)

## Who and why

Priya's thesis needs "Town council" close to the top of the page, and the notes two inches in. Page setup has a header line, but it sits in the same inset as the body. Moving the header up means shrinking the margin, and then the notes land on the text.

## Inspired by

- [Change page margins](https://support.google.com/docs/answer/10296618): File › Page setup has a Header distance and a Footer distance, separate from the margins. People mix them up, and a header that reaches into the text just overlaps with no explanation.
- This base stores `header` and `footer` as strings. They are drawn inside the page margin. There is no distance from the edge of the paper.
- Storyboard [82](82-use-a-two-inch-margin.md) is the body margin. This story does not change that control.

## Scenes

1. **Same inset.** Priya opens "Thesis notes" with the header "Town council". The header and the first line start the same distance from the top.
2. **Closer to the edge.** The page margin stays 1 inch. She sets Header from edge to 0.5 in. "Town council" moves up. The first line of the notes stays where it was.
3. **Into the text.** She sets Header from edge to 1.5 in, past the 1 inch margin. The header moves down, the notes start below it, and a note says the header is inside the text area so the text moved down. The margin field still says 1 inch.
4. **Too close.** She tries 0. The field says the header must be at least 0.25 inches from the edge, and Apply stays off.
5. **Save.** She reopens the file. The header is still 0.5 inches from the edge, and the margin is still 1 inch.

## Google Workspace benchmark

Google Docs puts Header and Footer next to the margins ([Docs Help](https://support.google.com/docs/answer/10296618)). Nothing says which number moved the letterhead and which number moved the essay. A header that collides with the body overlaps it.

## Better than Google Workspace when

1. Page setup has Header from edge and Footer from edge, in inches, separate from the page margin.
2. Setting Header from edge to 0.5 inches moves only the header. The body inset stays at the page margin.
3. A header distance larger than the margin pushes the body below the header, and the dialog says why. The margin value does not change.
4. A distance under 0.25 inches is refused, and Apply does not commit it.
5. Footer from edge works the same way for the footer.
6. Both distances and the margin survive save and reopen.

## Success looks like

"Town council" sits half an inch from the top. The notes stay an inch in. Reopening the file keeps both.

## Gaps and notes

- The header is currently just a string inside the body margin.
- Do not add separate Top, Bottom, Left, and Right body margins, a ruler, Narrow or Wide presets, a centimeter unit, or a binding gutter.
- Different first page and odd/even headers, if present on this base, keep using this one distance.
