# 66 · Describe a photo

**Mode:** single-node · **App:** Docs · **Video:** [videos/66-describe-a-photo.mp4](videos/66-describe-a-photo.mp4) · **Script:** [scenes/66-describe-a-photo.spec.ts](scenes/66-describe-a-photo.spec.ts)

## Who and why

Lena's sign-up note has a photo of the seed-swap stall. A member who uses a screen reader hears nothing useful about that picture. Google Docs lets her write alt text that stays with the image. SuiteLeaf exports an alt field, but there is no way to type it.

## Inspired by

- [Add alt text to an image](https://support.google.com/docs/answer/6199477): right-click the image, Alt text, write a short description.
- People complain that Google's alt-text box is easy to miss, and that a filename such as "IMG_2044" is offered as the description.
- Word export in `packages/core/src/docx-export.ts` already writes `n.attrs.alt`. The document editor never sets that attribute.

## Scenes

1. **The photo.** Lena starts the sign-up note and adds the stall photo. The file on her camera is named IMG_2044. The photo has no description.
2. **Write it.** She selects the photo. Alt text sits beside it, clear of the corner handles, and the field starts empty. She types "Neighbors trading seed packets at the spring stall." and clicks Apply.
3. **See it.** She clicks away and selects the photo again. The same sentence is there, not the file name.
4. **A blank description.** She clears the text and applies. The photo stays. The description is empty, not a leftover filename.
5. **Keep it.** She writes the sentence back. That is the description she wants to keep.
6. **Save and Word.** She leaves and opens the note again. The sentence is still on the photo. File › Export DOCX writes that sentence as the image's alt text.

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

The seed-swap photo has the sentence Lena wrote. Selecting it shows that sentence. A screen reader, and Word, get that sentence instead of a file name.

## Result

| Criterion | Met? | Evidence |
| --- | --- | --- |
| Alt text is a control on the selected image, separate from crop and resize | Met | Video 0:08: the Alt text card sits to the right of the photo; the corner handles stay on the photo. `tests/browser/image-alt.spec.ts` checks the card does not overlap the image or the four handles. |
| The field starts empty for a new photo, not with the file name | Met | Video 0:11: the description box is empty and the hint says the file name is not used. The inserted file is `IMG_2044.jpg`. The same browser test expects `alt=""`. |
| Apply stores the sentence. Opening the control again shows that sentence | Met | Video 0:15 Apply, 0:19 the field shows the sentence again. Browser test reads the description textbox after reopening the control. |
| Clearing it and applying leaves the image in place with an empty description | Met | Video 0:22: the photo is still there and the card says "No description". Browser test expects the image to stay and `alt=""`. |
| The description survives save and reopen in a SuiteLeaf file | Met | Video 0:30–0:32: back to files, open "Seed swap sign-up", the sentence is on the photo. Browser test downloads the `.sldoc` and reopens the library copy. |
| The exported .docx uses that sentence as the image alt text, not the file name and not "Image" | Met | Video 0:33 File › Export DOCX. `tests/doc-image-alt.test.ts` and the scene assert `descr` and `name` are the sentence, and that `name="Image"` and `IMG_2044` are absent. |

## Gaps and notes

- An empty description exports `descr=""`. Word still requires a drawing name, so that name is "photo" rather than the file name or "Image". A description someone wrote is used for both the description and the name.
- The recording checks the .docx XML. It does not open Microsoft Word.
- Crop, resize, headers, spelling, and equations are unchanged. Selecting the photo does not change the word count, because the photo is not a text selection.
