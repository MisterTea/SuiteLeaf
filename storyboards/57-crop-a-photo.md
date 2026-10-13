# 57 · Crop a photo

**Mode:** single-node · **App:** Docs · **Video:** [videos/57-crop-a-photo.mp4](videos/57-crop-a-photo.mp4) · **Script:** [scenes/57-crop-a-photo.spec.ts](scenes/57-crop-a-photo.spec.ts)

## Who and why

Lena dropped a photo of the seed swap into the sign-up sheet. The photo includes the parking lot on the right. She can drag a corner to resize the whole picture, which she already does in storyboard 05. She cannot cut the parking lot out of the frame. In Google Docs, Crop does that without deleting the pixels, so she can change her mind later.

## Inspired by

- [Crop and adjust images](https://support.google.com/docs/answer/97447): select the image, Crop, drag an edge, and press Enter. Reset restores the full picture.
- Storyboard [05](05-tables-images-and-links.md): corner handles resize and keep proportions. Crop is a different operation.
- People on the Docs help forum ask why cropping in Docs throws away the rest of the picture, or why the crop handles are hard to tell from the resize handles.

## Scenes

1. **The photo.** Lena opens the sign-up note. The photo shows the stall and the parking lot.
2. **Crop, not resize.** She selects the photo. A Crop control is separate from the corner resize handles. She drags the right edge in until the parking lot is gone. The stall stays the same size.
3. **The pixels stay.** She opens Crop again and drags the edge back. The parking lot returns. Resize would have scaled the whole picture. Crop did not.
4. **Save.** She downloads the SuiteLeaf file and opens the copy. The crop is still the stall, and choosing Reset crop shows the parking lot again.
5. **Word.** She exports .docx. The picture in Word is cropped the same way, and the full image is still in the file so Word's own crop reset can show it.

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

The note shows the stall and not the parking lot. Lena can bring the parking lot back without inserting the photo again.

## Gaps and notes

- Docs can resize an image from the corners. It cannot crop.
- Do not change the resize behavior from storyboard 05.
- Do not rebuild equations, citations, or spelling.
