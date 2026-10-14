# 57 · Crop a photo

**Mode:** single-node · **App:** Docs · **Video:** [videos/57-crop-a-photo.mp4](videos/57-crop-a-photo.mp4) · **Script:** [scenes/57-crop-a-photo.spec.ts](scenes/57-crop-a-photo.spec.ts)

## Who and why

Lena dropped a photo of the seed swap into the sign-up sheet. The photo includes the parking lot on the right. She can drag a corner to resize the whole picture, which she already does in storyboard 05. She cannot cut the parking lot out of the frame. In Google Docs, Crop does that without deleting the pixels, so she can change her mind later.

## Inspired by

- [Crop and adjust images](https://support.google.com/docs/answer/97447): select the image, Crop, drag an edge, and press Enter. Reset restores the full picture.
- Storyboard [05](05-tables-images-and-links.md): corner handles resize and keep proportions. Crop is a different operation.
- People on the Docs help forum ask why cropping in Docs throws away the rest of the picture, or why the crop handles are hard to tell from the resize handles.

## Scenes

1. **The photo.** Lena starts the sign-up note and types a line. She inserts a photo: a striped stall on the left, a gray parking lot on the right.
2. **Crop, not resize.** She selects the photo. **Crop** is a labeled button under the picture, separate from the blue corner handles. Crop mode shows orange edge bars, hides the corners, and says the rest of the photo stays the same size. She drags the right edge in. The stall does not grow or shrink. The parking lot is gone.
3. **The pixels stay.** She clicks Done, opens Crop again, and drags the edge back. The parking lot returns.
4. **Save.** She hides the parking lot again and downloads the note. Opening that file still shows the stall. **Reset crop** brings the parking lot back in one click.
5. **Word.** She crops once more and chooses File → Export DOCX. The Word file shows the stall, and the original photo is still in the package so Word can reveal the parking lot.

## Google Workspace benchmark

In Google Docs the path is select the image, crop icon in the toolbar, drag an edge, Enter ([Docs Help](https://support.google.com/docs/answer/97447)). The crop icon is easy to miss next to the resize handles. Reset image is a separate menu item, and people often resize when they meant to crop, which scales the parking lot instead of hiding it.

## Better than Google Workspace when

1. The selected image has a Crop control that is not one of the corner resize handles.
2. Dragging a crop edge hides part of the picture and does not change the size of the part that remains.
3. Opening Crop again and dragging the edge back reveals the hidden part. The pixels were not deleted.
4. Reset crop restores the full picture in one action.
5. The crop survives save and reopen in a SuiteLeaf file.
6. A .docx export crops the same way and still contains the full image.

## Success looks like

The note shows the stall and not the parking lot. Lena brings the parking lot back with Reset crop, without inserting the photo again.

## Result

| Criterion | Met? | Evidence |
| --- | --- | --- |
| 1. The selected image has a Crop control that is not one of the corner resize handles | Met | Video 0:11. Crop is a labeled button; the blue corner squares stay put until crop mode. `tests/browser/doc-image-crop.spec.ts` checks the button does not overlap a corner handle. |
| 2. Dragging a crop edge hides part of the picture and does not change the size of the part that remains | Met | Video 0:13. The stall's left edge and height stay put while the parking lot disappears. The same browser test compares the frame with the image's full width. |
| 3. Opening Crop again and dragging the edge back reveals the hidden part | Met | Video 0:16. The parking lot returns and the image source is unchanged. |
| 4. Reset crop restores the full picture in one action | Met | Video 0:24. One Reset crop click after reopen. |
| 5. The crop survives save and reopen in a SuiteLeaf file | Met | Video 0:22. The downloaded `.sldoc` opens still cropped to the stall. The browser test checks `cropRight` in the saved file. |
| 6. A .docx export crops the same way and still contains the full image | Met | Video 0:27–0:30, File → Export DOCX. `tests/image-crop.test.ts` checks `a:srcRect` and that `word/media` is the original PNG. The scene checks the same bytes. |

## Gaps and notes

- Opening an exported .docx in SuiteLeaf does not read Word's crop back in. The export keeps the full image and the crop for Word.
- HTML export keeps the crop attributes but does not clip the picture.
- Crop is one edge at a time. There is no freeform crop or rotate.
- Corner resize from storyboard 05 is unchanged. Equations, citations, and spelling were not rebuilt.
