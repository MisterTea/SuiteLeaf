# Zoom the deck

Who: Nia is lining up the title boxes on a slide. She wants the canvas at 150% so the edges are easier to see. When she comes back, that deck should still be at 150%. A new presentation, her minutes, and her budget should keep the zooms she already set.

Inspired by: Google Slides' zoom slider. The last zoom sticks to the browser. Opening another deck, a document, or a spreadsheet inherits it.

## Scenes

1. Nia opens a deck with the title "Market". The zoom control says 100%. She chooses 150%. The slide on the canvas is larger. The word Market is the same, and its box has not moved in the file.
2. She saves, returns home, and reopens the deck. The zoom control says 150%, and the slide is still large.
3. She creates a new presentation. Its zoom is 100%.
4. She opens the minutes, left at 100%, and the grocery budget, left at 150%. The minutes stay at 100%. The budget stays at 150%.
5. She returns to the deck. It is still at 150%. She presents. The show is the normal full slide, not stuck at 150%.

## Google Workspace benchmark

- Slides has a zoom control, and the last zoom sticks to the browser rather than to the deck.
- Opening a different deck, a document, or a spreadsheet keeps that leftover zoom.
- Presenting sometimes starts from the editing zoom instead of the full slide.

## Better than Google Workspace when

1. The deck has a zoom control with the same percentages as a spreadsheet: 50% through 200%. Choosing 150% enlarges the editing canvas. The words and box positions stored on the slide do not change.
2. Save and reopen of that deck restores 150%.
3. A new presentation opens at 100%.
4. A document's zoom and a spreadsheet's zoom stay what they were. 150% on the deck does not change them.
5. Returning to the deck shows 150% again.
6. The zoom is not written into the slide text.
7. Presenting shows the slide at the show size, not cropped to the 150% editing view.

## Success

- Nia edits the deck at 150%, comes back to 150%, and the show is still the full slide.

## Gaps

- `Slides.tsx` has no zoom control. A search for zoom in the slides editor finds no match.
- Document zoom and spreadsheet zoom are stored per file. Nothing stores a zoom per presentation.
