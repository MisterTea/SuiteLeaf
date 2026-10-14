# Find the speaker note

Who: Nia wrote "mention the pears" in the speaker notes of the Welcome slide. The word pears is not on the slide itself. She is looking at Prices and wants Find to take her to that note.

Inspired by: Google Slides' Find, which can hit speaker notes without saying the match is in the notes. The slide looks unchanged, so the match seems to have failed.

## Scenes

1. Nia is on Prices. She finds pears. The deck shows Welcome, the notes pane is open, "mention the pears" is visible, and the find bar does not cover those words. The bar says 1 of 1 in the notes on Welcome.
2. The slide canvas still says Market, not pears. The note text is unchanged.
3. She finds Market. That match is the word on the canvas, and the bar says it is on the slide, not in the notes. If Welcome also has Market in the notes, the canvas match comes first and Next reaches the note.
4. She searches for zzzz. The bar says no matches. The notes text does not change.
5. A skipped slide's notes are still found while editing. Presenting still skips that slide.

## Google Workspace benchmark

- Slides can find text in speaker notes, but the result does not say "in the notes".
- The notes pane may stay closed, so the match is invisible.
- The find bar can cover the note.

## Better than Google Workspace when

1. A word that exists only in the notes is found. The bar says it is in the notes and names the slide. The notes pane is open and the words are not covered by the bar.
2. The canvas text is unchanged. The note text is unchanged.
3. A canvas match on the same slide is listed before a notes match. Next moves from the canvas to the notes.
4. "pears" finds "Pears". A search with no matches says there are none and does not change the notes.
5. A skipped slide's notes are included while editing. Presenting still skips that slide.
6. Zoom and slide numbers do not change.
7. Closing Find leaves the editor on that slide. The note is still "mention the pears".

## Success

- Nia finds the note, sees that it is in the notes, and the words are not hidden.

## Gaps

- `textBoxText` in `slide-find.ts` says speaker notes are not boxes. `findDeckMatches` never reads `slide.notes`.
- The find bar has no way to say a match is in the notes, and it does not open the notes pane.
