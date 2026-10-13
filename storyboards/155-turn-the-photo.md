# Turn the photo

Who: Nia has a market photo that was taken sideways. She wants it upright, a quarter turn to the right, without losing the caption "Saturday stall" or the description "Fruit on a table."

Inspired by: Google Docs' rotate handle on a selected image. The handle is a few pixels past the corner, and a drag is easy to leave at 87 degrees instead of 90.

## Scenes

1. Nia selects the photo. The card beside the caption and the description has Turn right and Turn left. The card says the photo is at 0 degrees.
2. She clicks Turn right. The photo is sideways, the card says 90 degrees, and the box swaps width and height so the picture still fits. "Saturday stall" stays under the photo. "Fruit on a table." stays the description and is not printed under the photo. "We arrived at noon." stays after the caption.
3. She clicks Turn left. The photo is upright again, the card says 0 degrees, and the width and height are back to what they were.
4. She turns it right again, saves, returns home, and reopens. The photo is still at 90 degrees, with the caption and the description.
5. She downloads Word. The image is rotated 90 degrees. The caption still follows the image. The description is still the alternative text.

## Google Workspace benchmark

- Docs can rotate an image, but only by dragging a handle that is easy to miss.
- The handle does not snap to 90 degrees, and it does not say the angle.
- A caption under the image is a separate paragraph, so a rotation can leave the caption beside the photo instead of under it.

## Better than Google Workspace when

1. Turn right and Turn left are on the same card as the caption and the description. One click turns 90 degrees. There is no drag handle and no dialog.
2. The card says the angle: 0, then 90. Turn right from 90 says 180. Turn left from 90 returns to 0.
3. At 90 and 270 the width and height swap. At 0 and 180 they are the original pair. The picture is not stretched.
4. The caption stays under the photo. The description stays on the photo and is not printed under it. The following sentence stays after the caption.
5. Crop and wrap stay as they were.
6. Save and reopen keep the angle, the caption, and the description.
7. The downloaded Word file stores a 90 degree rotation, the caption after the image, and the description as alternative text.

## Success

- Nia turns the photo a quarter turn to the right, and the caption stays under it.

## Gaps

- The image card edits alt text, caption, crop, and wrap. Nothing stores a rotation.
- A search for rotate in `apps/web/src/editors` finds no photo rotation.
