# Keep the caption from Word

Who: Nia receives a Word file. A photo of the market has the description "Fruit on a table." The next paragraph is styled Caption and says "Saturday stall." A later sentence says "We arrived at noon." She opens the file in SuiteLeaf and expects the caption under the photo, not as a loose paragraph, and the description still on the photo.

Inspired by: Google Docs opens a Word caption as an ordinary paragraph under the image. The caption can be edited away from the photo, and the description is hidden in alt text.

## Scenes

1. Nia opens the Word file. "Saturday stall" appears under the photo. "Fruit on a table." does not appear as a line under the photo. "We arrived at noon." is still a paragraph after the caption.
2. She selects the photo. The card shows Caption "Saturday stall" and the description "Fruit on a table."
3. She changes the caption to "Sunday stall." The line under the photo changes. "We arrived at noon." stays.
4. She saves, returns home, and reopens. The line under the photo is "Sunday stall." The description is still "Fruit on a table."
5. She downloads Word. The caption follows the image. The description is the image's alternative text. "We arrived at noon." is still its own paragraph, not a caption.

## Google Workspace benchmark

- Docs keeps the caption text, but it is a normal paragraph. Moving or restyling the photo does not keep the caption attached.
- The description is not on the same card as the caption.
- A following sentence and a caption look the same, so it is easy to treat "We arrived at noon." as part of the caption.

## Better than Google Workspace when

1. Opening the file shows "Saturday stall" under the photo, and the description is not printed there.
2. The photo card shows Caption and the description as two fields. "Saturday stall" is the caption. "Fruit on a table." is the description.
3. "We arrived at noon." stays a paragraph after the caption. A paragraph that is not the Caption style is not taken.
4. Editing the caption on the card updates the line under the photo and does not change the following sentence.
5. Save and reopen keep the caption on the photo and the description on the photo.
6. The downloaded file writes the caption after the image and the description as alternative text. "We arrived at noon." is not marked as a caption.
7. The photo itself still imports. Highlight, font color, and a first-line indent elsewhere in the file still import.

## Success

- Nia opens the file and "Saturday stall" is under the photo, on the caption field, and the noon sentence stays a sentence.

## Gaps

- Images store `caption` and `alt`, and export writes a caption paragraph after the image. `packages/core/src/word.ts` never reads a Caption-styled paragraph back onto the image.
- A search for caption in `word.ts` finds no match.
