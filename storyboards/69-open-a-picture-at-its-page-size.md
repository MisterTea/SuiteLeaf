# 69 · Open a picture at its page size

**Mode:** single-node · **App:** Docs · **Video:** [videos/69-open-a-picture-at-its-page-size.mp4](videos/69-open-a-picture-at-its-page-size.mp4) · **Script:** [scenes/69-open-a-picture-at-its-page-size.spec.ts](scenes/69-open-a-picture-at-its-page-size.spec.ts)

## Who and why

The printer sent Lena a Word letter. The logo is a wide photo that Word shows about two inches across, in the first paragraph. SuiteLeaf opens the same file with the photo at its full pixel size, so the logo fills the page and pushes the letter down. She has to resize it by hand every time.

## Inspired by

- [Resize a picture in Word](https://support.microsoft.com/office/resize-a-picture-shape-text-box-or-wordart-0a196b43-b0a6-4c17-8b62-5d5d0b326d1d): Word stores the size on the page separately from the file's pixels.
- Word import in `packages/core/src/word.ts` turns a picture into an image with a `src` and no width or height. The browser then uses the pixel size.
- Storyboard [67](67-open-a-cropped-word-picture.md): a crop is kept. This story is the size on the page, even when the picture is not cropped.

## Scenes

1. **The letter.** Lena opens `Letter.docx`. The logo sits in the first paragraph at about the same width Word used, not edge to edge.
2. **The text stays put.** The greeting is still on the first page, under the logo, not pushed to page two.
3. **She can still resize.** Dragging a corner changes the size and keeps the proportions. The logo does not snap back to the pixel size.
4. **A full-width photo.** A second picture that Word had set to the width of the text column opens at that width, not at a tiny thumbnail and not at thousands of pixels.
5. **Round trip.** She exports .docx and opens it again. Both pictures keep the size she had on the page.

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

Lena's logo is a small mark at the top of the letter. The greeting is on the first page. She does not have to resize the logo before she can read the letter.

## Gaps and notes

- Import sets `src` and does not set the drawing extent.
- Do not rebuild crop, equations, or corner-resize behavior except to honor a size that is already stored.
- Header and footer pictures can stay out of this story.
