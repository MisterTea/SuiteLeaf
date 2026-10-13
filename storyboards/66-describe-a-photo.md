# 66 · Describe a photo

**Mode:** single-node · **App:** Docs · **Video:** [videos/66-describe-a-photo.mp4](videos/66-describe-a-photo.mp4) · **Script:** [scenes/66-describe-a-photo.spec.ts](scenes/66-describe-a-photo.spec.ts)

## Who and why

Lena's sign-up note has a photo of the seed-swap stall. A member who uses a screen reader hears nothing useful about that picture. Google Docs lets her write alt text that stays with the image. SuiteLeaf exports an alt field, but there is no way to type it.

## Inspired by

- [Add alt text to an image](https://support.google.com/docs/answer/6199477): right-click the image, Alt text, write a short description.
- People complain that Google's alt-text box is easy to miss, and that a filename such as "IMG_2044" is offered as the description.
- Word export in `packages/core/src/docx-export.ts` already writes `n.attrs.alt`. The document editor never sets that attribute.

## Scenes

1. **The photo.** Lena opens the sign-up note. The photo has no description.
2. **Write it.** She selects the photo and chooses Alt text. She types "Neighbors trading seed packets at the spring stall." Apply.
3. **See it.** Selecting the photo again shows that same sentence, not the file name.
4. **A blank description.** She clears the text and applies. The photo stays. The description is empty, not a leftover filename.
5. **Save and Word.** She reopens the SuiteLeaf file and the description is still there. The exported .docx has that sentence as the image's alt text.

## Google Workspace benchmark

In Google Docs the path is right-click the image, Alt text, type, OK ([Docs Help](https://support.google.com/docs/answer/6199477)). That is two clicks plus typing. The box often starts with the file name, which a screen reader then announces instead of the picture.

## Better than Google Workspace when

1. Alt text is a control on the selected image, separate from crop and resize.
2. The field starts empty for a new photo, not with the file name.
3. Apply stores the sentence on the image. Opening the control again shows that sentence.
4. Clearing it and applying leaves the image in place with an empty description.
5. The description survives save and reopen in a SuiteLeaf file.
6. The exported .docx uses that sentence as the image alt text, not the file name and not "Image".

## Success looks like

The seed-swap photo has the sentence Lena wrote. A screen reader, and Word, get that sentence instead of a file name.

## Gaps and notes

- Export already reads `attrs.alt`. Nothing in the editor writes it.
- Do not change crop or resize.
- Do not rebuild headers, spelling, or equations.
