# 67 · Open a cropped Word picture

**Mode:** single-node · **App:** Docs · **Video:** [videos/67-open-a-cropped-word-picture.mp4](videos/67-open-a-cropped-word-picture.mp4) · **Script:** [scenes/67-open-a-cropped-word-picture.spec.ts](scenes/67-open-a-cropped-word-picture.spec.ts)

## Who and why

Lena cropped the parking lot out of a photo in SuiteLeaf, exported a Word file, and sent it to the printer. The Word file shows only the stall, and the full photo is still inside the file. When she opens that same .docx back in SuiteLeaf, the crop is gone and the parking lot is on the page again. Storyboard 57 crops and exports. This story is the return trip.

## Inspired by

- Storyboard [57](57-crop-a-photo.md): a .docx export writes the crop and keeps the full image. The further-gaps note says opening that file does not read the crop back.
- [Crop an image in Word](https://support.microsoft.com/office/crop-a-picture-in-word): Word stores a crop rectangle on the picture and can reset it.
- `packages/core/src/word.ts` does not read `a:srcRect`. `packages/core/src/image-crop.ts` already knows how to store a crop in a SuiteLeaf file.

## Scenes

1. **The Word file.** Lena opens a .docx whose picture is cropped to the stall. The page shows the stall, not the parking lot. No compatibility note says the crop was dropped.
2. **The hidden part is still there.** She selects the photo, chooses Crop, and drags the edge back. The parking lot returns. The pixels were not thrown away on import.
3. **Reset.** Reset crop shows the full picture in one action, the same control as a photo cropped inside SuiteLeaf.
4. **Round trip.** She crops the parking lot out again, exports .docx, and opens that file. The stall is still the frame she cropped.

## Google Workspace benchmark

Google Docs opens a cropped Word picture as the cropped view, and the full image is often gone, so Reset cannot bring the parking lot back. People on the Word and Docs forums lose the rest of a photo when they move a cropped picture through Docs. Word itself keeps the hidden pixels until someone compresses the picture.

## Better than Google Workspace when

1. Opening a .docx with `a:srcRect` shows the cropped frame, not the full picture.
2. The import does not add a note that says the crop was dropped.
3. Crop can be dragged back to reveal the hidden part. The full image is still in the file.
4. Reset crop restores the whole picture in one action.
5. Exporting and opening the .docx again keeps the same crop.
6. A picture with no crop still opens at its full size.

## Success looks like

Lena opens the printer's Word file and sees the stall. She can still uncover the parking lot, and a second export keeps the crop.

## Gaps and notes

- Export already writes the crop. Import ignores it.
- Reuse the crop model from storyboard 57. Do not rebuild corner resize.
- Do not rebuild equations, citations, or spelling.
