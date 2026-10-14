# Number the slides

Who: Nia has three slides: Welcome, Prices, and Thanks. She wants a small number in the bottom-right corner of each slide so the audience can tell where they are. Prices is a draft she will skip. Thanks should stay number 3, not become 2.

Inspired by: Google Slides' Insert › Slide numbers. The number is only the position, with no "of" count, and a skipped slide can make the next number jump without saying why.

## Scenes

1. Nia opens the deck. No slide has a number. She turns slide numbers on. Welcome shows 1 of 3, Prices shows 2 of 3, and Thanks shows 3 of 3, in the bottom-right corner, clear of the title.
2. She skips Prices. In the editor, Prices is labeled Skipped and still shows 2 of 3. Welcome still shows 1 of 3. Thanks still shows 3 of 3.
3. She presents from the start. Welcome shows 1 of 3. The next advance is Thanks, still showing 3 of 3. Prices never appears.
4. She turns slide numbers off. The corners are empty in the editor and in the show. Prices stays skipped.
5. She turns them on again, saves, returns home, and reopens. The numbers are back, Prices is still skipped, and a show still goes from Welcome (1 of 3) to Thanks (3 of 3).

## Google Workspace benchmark

- Slides can number slides, but the number is only "2", not "2 of 3".
- Insert › Slide numbers is a separate dialog from the skip control.
- Skipping a slide does not say, on the remaining slides, that a number was left out.

## Better than Google Workspace when

1. Slide numbers are one control, not a dialog. Turning them on shows "1 of 3", "2 of 3", and "3 of 3" in the bottom-right of the three slides, clear of the titles.
2. The number is the place in the deck. Skipping Prices does not renumber Thanks to 2.
3. A show from the start is Welcome, then Thanks. Welcome's corner says 1 of 3. Thanks' corner says 3 of 3. Prices does not appear.
4. In the editor, the skipped slide still shows 2 of 3 and the Skipped label.
5. Turning numbers off removes the corners and does not unskip Prices.
6. Save and reopen keep the numbers, the skip, and the show order Welcome then Thanks.
7. The numbers are not part of the slide's text boxes. Grouping, align, and the words on the slides do not change.

## Success

- Nia numbers the deck, skips the draft, and Thanks still says 3 of 3.

## Gaps

- The presentation schema has a skipped flag on a slide. Nothing stores that slide numbers are on.
- The slide canvas and the show draw the slide's own boxes. They do not draw a deck number in the corner.
