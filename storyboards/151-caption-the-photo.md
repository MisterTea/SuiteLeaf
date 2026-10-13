# Caption the photo

Who: Nia has a photo of the Saturday market in her notes. She wants the line "Saturday stall" under the photo, and she wants the description she already stored for someone who cannot see the photo to stay a description, not a second line on the page.

Inspired by: Google Docs' right-click › Insert caption. The caption is a separate paragraph that can be left behind when the photo moves, and Docs often treats the alt text and the visible caption as the same idea.

## Scenes

1. Nia opens a document with a photo and a sentence after it, "We arrived at noon." The photo already has the description "Fruit on a table." She selects the photo. The card beside it has the description and a Caption field.
2. She types "Saturday stall" in Caption. That line appears under the photo, smaller than the body text. "Fruit on a table." does not appear under the photo. The sentence after the photo stays after the caption.
3. She clears the caption. The line under the photo disappears. The photo and its description stay.
4. She types the caption again, saves, returns home, and reopens. "Saturday stall" is still under the photo, and the description is still "Fruit on a table."
5. She downloads Word. The file has the photo, then the caption "Saturday stall." The description is still the image's alt text, not a second paragraph.

## Google Workspace benchmark

- Docs inserts a caption as an ordinary paragraph under the image. Moving the image can leave the caption behind.
- The caption command is a right-click item, not on the card where the description already lives.
- People put the description into the caption because the two fields are not side by side.

## Better than Google Workspace when

1. Caption is a field on the same card as the photo's description. One place. There is no right-click menu and no dialog.
2. Typing a caption shows that line under the photo. The description does not show under the photo.
3. Clearing the caption removes the line and leaves the photo and the description.
4. The sentence after the photo stays after the caption. The caption is not a separate paragraph the caret can wander into and detach.
5. Save and reopen keep the caption under the photo and keep the description on the photo.
6. The downloaded Word file has the caption after the image, and the description remains the image's alternative text.
7. The photo's size, wrapping, and the words of the following sentence do not change.

## Success

- Nia puts "Saturday stall" under the photo, and the description stays on the photo.

## Gaps

- Images already store `alt` and the card in `doc-image-alt.ts` edits that description. Nothing stores a visible caption.
- A search for caption in `apps/web/src/editors` finds no photo caption.
