# 84 · Set how far the header sits from the edge

**Mode:** single-node · **App:** Docs · **Video:** [videos/84-header-from-the-edge.mp4](videos/84-header-from-the-edge.mp4) · **Script:** [scenes/84-header-from-the-edge.spec.ts](scenes/84-header-from-the-edge.spec.ts)

## Who and why

Priya's thesis needs "Town council" close to the top of the page, and the notes two inches in. Page setup has a header line, but it sits in the same inset as the body. Moving the header up means shrinking the margin, and then the notes land on the text.

## Inspired by

- [Change page margins](https://support.google.com/docs/answer/10296618): File › Page setup has a Header distance and a Footer distance, separate from the margins. People mix them up, and a header that reaches into the text just overlaps with no explanation.
- This base stores `header` and `footer` as strings. They are drawn inside the page margin. There is no distance from the edge of the paper.
- Storyboard [82](82-use-a-two-inch-margin.md) is the body margin. This story does not change that control.

## Scenes

1. **Same inset.** Priya opens "Thesis notes" and gives the page a 1 inch margin. The header "Town council" starts on that same line as the notes.
2. **Closer to the edge.** The margin stays 1 inch. She sets Header from edge to 0.5 in. "Town council" moves up. The first line of the notes stays where it was.
3. **Into the text.** She sets Header from edge to 1.5 in, past the 1 inch margin. A note says the header is inside the text area, so the text moves down, and the top margin does not change. Apply commits it. The notes start below the header. Every margin field still says 1 inch.
4. **Too close.** She tries 0. The field says the header must be at least 0.25 inches from the edge, and Apply stays off.
5. **The footer.** Footer from edge works the same way. 0.5 in moves only the footer toward the edge. 1.5 in says the footer is inside the text, so the text moves up, and the bottom margin stays 1 inch.
6. **Save.** She puts both distances back to 0.5 in and reopens the file. The header and the footer are still 0.5 inches from the edge, and the margin is still 1 inch.

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

- The four body margins were already on this branch. This story does not change those fields.
- There is no ruler, Narrow or Wide preset, centimeter unit, or binding gutter.
- Different first page and odd/even headers use this one header distance and one footer distance.
- Word export writes the distances on `w:pgMar`. Opening a Word file does not read `w:header` or `w:footer` yet.
- A short page does not show the footer push until the notes reach the bottom margin. The inset still grows.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. Page setup has Header from edge and Footer from edge, separate from the margin | Met | Video 0:08, the distance group sits under the four margins and says it does not move the notes. Browser test `header and footer distances stay separate from the margin`. |
| 2. Header from edge at 0.5 inches moves only the header | Met | Video 0:20, “Town council” sits above the notes. The test measures the header at 0.5 in and the first line at 1 in. |
| 3. A distance past the margin pushes the body and says why. The margin does not change | Met | Video 0:24, the blue note and Top still 1. Video 0:27, the notes start below the header. The test checks the top inset grew and `marginTop` stayed 96. |
| 4. Under 0.25 inches is refused, and Apply does not commit it | Met | Video 0:34, “The header must be at least 0.25 inches from the edge.” and Apply is gray. Enter leaves the dialog open. The test also refuses 0 for the footer. |
| 5. Footer from edge works the same way | Met | Video 0:44, the footer moves to 0.5 in while the notes stay an inch in. Video 0:48, the footer note names the bottom margin. The test measures the footer at 1.5 in and a larger bottom inset. |
| 6. Both distances and the margin survive save and reopen | Met | Video 0:57, Header 0.5, Footer 0.5, and every margin 1. The test reads `headerFromEdge: 48` and `footerFromEdge: 48` from the saved file and measures them again after reopen. |
