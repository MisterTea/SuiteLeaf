# 70 · Put a picture beside the text

**Mode:** single-node · **App:** Docs · **Video:** [videos/70-put-a-picture-beside-the-text.mp4](videos/70-put-a-picture-beside-the-text.mp4) · **Script:** [scenes/70-put-a-picture-beside-the-text.spec.ts](scenes/70-put-a-picture-beside-the-text.spec.ts)

## Who and why

Lena's letter has a small logo that should sit at the left of the first paragraph, with the greeting wrapping beside it. Word does that. SuiteLeaf turns every picture into a block, so the logo takes a whole line and the greeting starts underneath. The import note even says floating placement may differ.

## Inspired by

- [Wrap text around a picture](https://support.google.com/docs/answer/10274561): select the image, choose Wrap text, and the paragraph runs beside it.
- Word import warning in `packages/core/src/word.ts`: "floating placement and font styling may differ."
- Storyboard [69](69-open-a-picture-at-its-page-size.md): the logo opens at the right size and still sits on its own line.

## Scenes

1. **The letter.** Lena opens a document where the logo is a block. "Dear friend," starts on the next line.
2. **Beside the text.** She selects the logo and chooses Wrap text › Left. The greeting moves up and runs to the right of the logo.
3. **The other side.** Wrap text › Right puts the logo on the right and the greeting on the left.
4. **Back to a line.** Wrap text › Break text puts the logo on its own line again, and the greeting returns underneath.
5. **From Word.** She opens a .docx whose picture is already wrapped square on the left. It opens beside the paragraph, not as a full-width block, and the import note no longer says floating placement may differ for that picture.
6. **Save.** She downloads the SuiteLeaf file and opens the copy. The logo is still beside the greeting.

## Google Workspace benchmark

In Google Docs, Wrap text is an image menu with Inline, Wrap text, and Break text ([Docs Help](https://support.google.com/docs/answer/10274561)). Inline is the default and is what people get when they paste. Wrap text is easy to miss, and a wrapped image from Word often becomes inline on import, which is the same jump Lena sees.

## Better than Google Workspace when

1. Wrap text › Left, Right, and Break text are on the selected picture. They are not the corner resize handles.
2. Left puts the picture on the left and the paragraph beside it, on the same lines.
3. Right mirrors that. Break text puts the picture on its own line.
4. A Word picture that is wrapped square opens beside the text, and the import note does not warn that floating placement was dropped for it.
5. The choice survives save and reopen in a SuiteLeaf file.
6. A picture with no wrap still opens on its own line.

## Success looks like

The logo sits at the left of "Dear friend,". Lena can move it to the right or back onto its own line without deleting it.

## Gaps and notes

- Every imported picture becomes a block image.
- The import warning still mentions floating placement.
- Do not rebuild page size, crop, or corner resize except to keep them working on a wrapped picture.
