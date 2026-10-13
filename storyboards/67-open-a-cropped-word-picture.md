# 67 · Open a cropped Word picture

**Mode:** single-node · **App:** Docs · **Video:** [videos/67-open-a-cropped-word-picture.mp4](videos/67-open-a-cropped-word-picture.mp4) · **Script:** [scenes/67-open-a-cropped-word-picture.spec.ts](scenes/67-open-a-cropped-word-picture.spec.ts)

## Who and why

Lena cropped the parking lot out of a photo in SuiteLeaf, exported a Word file, and sent it to the printer. The Word file shows only the stall, and the full photo is still inside the file. When she opens that same .docx back in SuiteLeaf, the crop is gone and the parking lot is on the page again. Storyboard 57 crops and exports. This story is the return trip.

## Inspired by

- Storyboard [57](57-crop-a-photo.md): a .docx export writes the crop and keeps the full image. The further-gaps note says opening that file does not read the crop back.
- [Crop an image in Word](https://support.microsoft.com/office/crop-a-picture-in-word): Word stores a crop rectangle on the picture and can reset it.
- `packages/core/src/word.ts` did not read `a:srcRect`. `packages/core/src/image-crop.ts` already knew how to store a crop in a SuiteLeaf file.

## Scenes

1. **The Word file.** Lena opens Seed swap sign-up.docx from the file list. The page shows the striped stall, not the parking lot. The one compatibility note is about page layout. It does not say the crop was dropped.
2. **The hidden part is still there.** She selects the photo, chooses Crop, and drags the right edge out. The parking lot comes back and the stall stays the same size. The pixels were not thrown away on import.
3. **Reset.** Reset crop shows the whole picture in one click, the same control as a photo cropped inside SuiteLeaf.
4. **Round trip.** She crops the parking lot out again and chooses File → Export DOCX. She opens that file. The stall is still the frame, and the full photo is still in the package.

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

## Result

| Criterion | Met? | Evidence |
| --- | --- | --- |
| 1. Opening a .docx with `a:srcRect` shows the cropped frame, not the full picture | Met | Video 0:03. The stall fills the frame and the parking lot is outside it. `tests/word-image-crop.test.ts` ("shows a srcRect crop") and `tests/browser/word-image-crop.spec.ts`. |
| 2. The import does not add a note that says the crop was dropped | Met | Video 0:07. The only note is the page-layout sentence. The same unit test expects that single warning. |
| 3. Crop can be dragged back to reveal the hidden part. The full image is still in the file | Met | Video 0:10. The parking lot returns and the stall does not grow. The browser test checks the image source is unchanged. |
| 4. Reset crop restores the whole picture in one action | Met | Video 0:13. One Reset crop click shows the parking lot. |
| 5. Exporting and opening the .docx again keeps the same crop | Met | Video 0:17 File → Export DOCX, 0:21 the reopened file is the stall again. `tests/word-image-crop.test.ts` ("keeps the crop through a second export") checks `a:srcRect` and the original PNG bytes. |
| 6. A picture with no crop still opens at its full size | Met | `tests/word-image-crop.test.ts` ("leaves an uncropped picture full size") and `tests/browser/word-image-crop.spec.ts` ("a Word picture with no crop opens at full size"). |

## Gaps and notes

- Import reads `a:srcRect` as the same hidden-edge percentages storyboard 57 writes. The full image stays in the file. Corner resize was not rebuilt.
- Word's on-page size is the cropped drawing extent. SuiteLeaf opens the photo at its pixel size, so a picture Word had scaled down can open larger. The crop percentages still match.
- Pictures in headers and footers are not given this crop.
- A negative source rectangle, which Word uses to pad a picture, is treated as no crop on that edge.
- The usual Word layout note still appears. It does not mention the crop.
- Equations, citations, and spelling were not rebuilt.
