# 79 · Insert a picture on a blank line

**Mode:** single-node · **App:** Docs · **Video:** [videos/79-insert-a-picture-on-a-blank-line.mp4](videos/79-insert-a-picture-on-a-blank-line.mp4) · **Script:** [scenes/79-insert-a-picture-on-a-blank-line.spec.ts](scenes/79-insert-a-picture-on-a-blank-line.spec.ts)

## Who and why

Lena presses Enter to start a new line, then Insert › Image. Storyboard 76 puts a picture into a sentence at the caret, about as tall as the text. On a blank line the same command still drops a full-width picture. In Google Docs a new picture is in line with the text even when the paragraph was empty.

## Inspired by

- [Insert an image](https://support.google.com/docs/answer/97447): the picture is inserted at the cursor, in line, including at the start of an empty paragraph.
- Storyboard [76](76-insert-a-picture-at-the-caret.md): the further-gaps note says an empty paragraph still gets a full-size block picture.
- A pasted screenshot on a blank line has the same jump.

## Scenes

1. **A blank line.** Lena opens a note, presses Enter under the title, and the caret is in an empty paragraph.
2. **Insert.** Insert › Image. The stall photo appears on that line, about as tall as the title's text, not the width of the page.
3. **She keeps typing.** She presses End and types "Saturday market". Those words sit on the same line as the photo, after it.
4. **Paste.** She presses Enter again and pastes a second picture onto the new empty line. It is also text height, in the line.
5. **Wrap still works.** She selects the first photo. Break text puts it on its own line at that small size. In line puts the words back beside it.
6. **Save.** She downloads the SuiteLeaf file and opens the copy. Both pictures are still small and in the line.

## Google Workspace benchmark

Google Docs uses the same inline insert on an empty paragraph as in the middle of a sentence ([Docs Help](https://support.google.com/docs/answer/97447)). The picture is not page-width unless the file's pixels and the cursor size make it so. People still resize afterward. SuiteLeaf currently reserves the huge block for the empty-paragraph case only.

## Better than Google Workspace when

1. Insert › Image in an empty paragraph puts the picture in that paragraph, in line.
2. The picture is about the height of the surrounding text, not the width of the page.
3. Typing after it continues on the same line.
4. Pasting an image into an empty paragraph does the same.
5. Break text and In line still work on that picture.
6. The size and the line survive save and reopen.

## Success looks like

Lena's blank line gets a small photo, and "Saturday market" sits beside it. She does not resize it before she can see the rest of the note.

## Gaps and notes

- Storyboard 76 handles a caret inside a sentence. An empty paragraph is still a full-size block.
- Do not remove In line, Left, Right, or Break text.
- Do not rebuild crop or page size.
