# Find the shape

Who: Nia typed "pears" inside a rectangle on the Welcome slide, not in a text box and not in the speaker notes. She is looking at Prices and wants Find to select that rectangle.

Inspired by: Google Slides' Find, which can hit text inside a shape without saying the match is a shape. The shape can look unselected, so the match seems to have failed.

## Scenes

1. Nia is on Prices. She finds pears. The deck shows Welcome, the rectangle that says pears is selected, and the find bar does not cover the word. The bar says 1 of 1 in the shape on Welcome.
2. The text box on that slide still says Market. The speaker notes are unchanged. The rectangle's words stay pears.
3. She finds Market. That match is the text box, and the bar says it is on the slide, not in a shape. If the same slide also has Market in a shape, the text box comes first and Next selects the shape.
4. She searches for zzzz. The bar says no matches. No shape text changes.
5. She replaces pears with apples. The rectangle says apples. Market stays Market. The notes stay as they were.

## Google Workspace benchmark

- Slides can find text in a shape, but the result does not say it is a shape.
- The shape may not look selected, so the match is easy to miss.
- The find bar can cover the word inside the shape.

## Better than Google Workspace when

1. A word that exists only in a shape is found. The bar says it is in the shape and names the slide. The shape is selected, and the bar does not cover the word.
2. The text box and the speaker notes are unchanged.
3. On the same slide, a text-box match comes first, then a shape match, then a notes match. Next walks that order.
4. "pears" finds "Pears". A search with no matches says there are none and does not change any text.
5. Replace changes the text inside the shape and leaves the text box alone.
6. Zoom, slide numbers, and the shape's position do not change.
7. A skipped slide's shape text is found while editing. Presenting still skips that slide.

## Success

- Nia finds the word inside the rectangle, sees that it is a shape, and can replace it without touching Market.

## Gaps

- `textBoxText` in `slide-find.ts` returns nothing unless the element type is `text`. A shape's `content` is skipped.
- The find bar cannot say a match is in a shape, and it does not select that shape.
