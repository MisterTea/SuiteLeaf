# 69 · Open a picture at its page size

**Mode:** single-node · **App:** Docs · **Video:** [videos/69-open-a-picture-at-its-page-size.mp4](videos/69-open-a-picture-at-its-page-size.mp4) · **Script:** [scenes/69-open-a-picture-at-its-page-size.spec.ts](scenes/69-open-a-picture-at-its-page-size.spec.ts)

## Who and why

The printer sent Lena a Word letter. The logo is a wide photo that Word shows about two inches across, in the first paragraph. SuiteLeaf opens the same file with the photo at its full pixel size, so the logo fills the page and pushes the letter down. She has to resize it by hand every time.

## Inspired by

- [Resize a picture in Word](https://support.microsoft.com/office/resize-a-picture-shape-text-box-or-wordart-0a196b43-b0a6-4c17-8b62-5d5d0b326d1d): Word stores the size on the page separately from the file's pixels.
- Word import in `packages/core/src/word.ts` turns a picture into an image with a `src` and no width or height. The browser then uses the pixel size.
- Storyboard [67](67-open-a-cropped-word-picture.md): a crop is kept. This story is the size on the page, even when the picture is not cropped.

## Scenes

1. **The letter.** Lena opens `Letter.docx`. The logo is a small mark at the top, about two inches wide, with the page showing beside it.
2. **The text stays put.** "Dear friend," is on the first page, directly under the logo.
3. **She can still resize.** She clicks the logo and drags a corner. The logo gets smaller, keeps its proportions, and stays that size after the document saves.
4. **A full-width photo.** The shop photo fills the text column, the width Word stored, and the whole picture is on screen.
5. **Round trip.** File, Export DOCX, then Open / import of that file. The logo is still the size she dragged, and the shop photo is still the width of the text.

## Google Workspace benchmark

Google Docs opens a Word picture at a size close to the page, then often changes it again on the next edit. People complain that a logo becomes huge or tiny, and that Docs forgets the size when the file goes back to Word. Word itself shows the stored extent, not the pixel dimensions.

## Better than Google Workspace when

1. A picture whose Word extent is about two inches wide opens within a quarter inch of that width.
2. The following paragraph stays on the same page it occupied in Word when the only difference was the picture size.
3. Corner resize still works and does not jump back to the pixel size on save.
4. A picture Word set to the text width opens at the text width.
5. Exporting to .docx and opening that file again keeps both sizes.
6. A picture with no stored extent still opens, using its pixel size only as a fallback.

## Success looks like

Lena's logo is a small mark at the top of the letter. The greeting is on the first page. She does not have to resize the logo before she can read the letter. The shop photo lines up with the text, and both sizes survive a trip back to Word.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| A picture whose Word extent is about two inches wide opens within a quarter inch of that width. | Met | Video 0:05. The logo is 192px (2 inches). `opens a two-inch picture at that size` in `tests/image-extent.test.ts`. |
| The following paragraph stays on the same page it occupied in Word when the only difference was the picture size. | Met | Video 0:06. "Dear friend," is on page 1, under the logo. |
| Corner resize still works and does not jump back to the pixel size on save. | Met | Video 0:08–0:11. The corner drag shrinks the logo and the saved size stays small. `a Word picture opens at its page size and corner resize does not snap back` in `tests/browser/doc-picture-size.spec.ts`. |
| A picture Word set to the text width opens at the text width. | Met | Video 0:14. The shop photo is 672px, the text column. |
| Exporting to .docx and opening that file again keeps both sizes. | Met | Video 0:17 (Export DOCX) and 0:22 (the reopened letter). `keeps a text-width picture through export and a second import` in `tests/image-extent.test.ts`. |
| A picture with no stored extent still opens, using its pixel size only as a fallback. | Met | `opens a two-inch picture at that size and leaves a picture with no extent unsized` in `tests/image-extent.test.ts`. |

## Gaps and notes

- A picture's on-page size now comes from the drawing extent (`wp:extent`), in CSS pixels at 96 per inch. A picture with no extent still opens at its pixel size.
- Header and footer pictures are still imported without a page size.
- A stored size is written back to Word as that size. A picture with no stored size is still capped on export so a multi-megapixel photo does not become a huge drawing.
- Crop import is a separate story. The extent is the box on the page. A crop percentage applied on top of that box would shrink the picture again.
- Word files with one-inch margins store a text width of 6.5 inches. SuiteLeaf's page margin is 0.75 inch, so that picture sits a quarter inch inside SuiteLeaf's column. The letter in the video uses 0.75 inch margins, and the photo lines up with the text.
