# Keep the turn from Word

Who: Nia receives a Word file. The market photo was already turned 90 degrees to the right. It has the description "Fruit on a table." and a caption "Saturday stall." She opens it in SuiteLeaf and expects the photo to arrive sideways, with the card saying 90 degrees.

Inspired by: Google Docs shows a rotated Word image, but it does not tell you the angle. The rotate handle sits at whatever the file stored, including a value that is not a quarter turn.

## Scenes

1. Nia opens the Word file. The photo is sideways. "Saturday stall" is under it. "Fruit on a table." is not printed under the photo. "We arrived at noon." is still the next sentence.
2. She selects the photo. The card says 90 degrees. Caption is "Saturday stall." The description is "Fruit on a table."
3. A second photo in the file has no rotation. Its card says 0 degrees, and its box is the original width and height.
4. She clicks Turn left. The first photo is upright and the card says 0. The caption stays under it.
5. She turns it right again, saves, returns home, and reopens. The card says 90 degrees. The caption and the description are still there.
6. She downloads Word. The image has `rot="5400000"`. The caption follows the image. The description is the alternative text.

## Google Workspace benchmark

- Docs keeps a Word rotation, but nothing says the angle until you start dragging the handle.
- A 90 degree turn and an 87 degree turn look almost the same.
- The caption is a loose paragraph, so the turned photo and the caption can separate.

## Better than Google Workspace when

1. Opening the file shows the photo turned, with "Saturday stall" under it and the description not printed there.
2. The card says 90 degrees. Caption and description are the two fields already on that card.
3. A photo with no `rot` stays at 0 degrees and keeps its width and height.
4. Turn left from the imported 90 degrees returns to 0 and restores the original box. The caption stays under the photo.
5. "We arrived at noon." stays a paragraph after the caption.
6. Save and reopen keep 90 degrees, the caption, and the description.
7. The downloaded file writes `rot="5400000"` for that photo, the caption after the image, and the description as alternative text. An angle that is not 0, 90, 180, or 270 is stored as 0.

## Success

- Nia opens the file and the card already says the photo is at 90 degrees.

## Gaps

- Export writes `a:xfrm rot` from `packages/core/src/image-rotation.ts`. `packages/core/src/word.ts` never reads `rot` back onto the image.
- A search for rot in `word.ts` finds no image rotation.
