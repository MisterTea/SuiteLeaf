# 76 · Insert a picture at the caret

**Mode:** single-node · **App:** Docs · **Video:** [videos/76-insert-a-picture-at-the-caret.mp4](videos/76-insert-a-picture-at-the-caret.mp4) · **Script:** [scenes/76-insert-a-picture-at-the-caret.spec.ts](scenes/76-insert-a-picture-at-the-caret.spec.ts)

## Who and why

Lena is in the middle of the sentence "Meet at the stall on Saturday." The caret is between "the" and "stall". She chooses Insert › Image and picks the stall photo. Today the photo lands on its own line. She then has to select it and choose In line, which storyboard 73 added. In Google Docs the new picture is already in the sentence at the caret.

## Inspired by

- [Insert an image](https://support.google.com/docs/answer/97447): the picture is inserted at the cursor, in line with the text.
- Storyboard [73](73-put-a-picture-in-the-sentence.md): In line exists, and the further-gaps note says Insert image still starts on its own line.
- A pasted screenshot has the same problem. It becomes a block until someone changes the wrap.

## Scenes

1. **The caret.** Lena opens the note and clicks between "the" and "stall".
2. **Insert.** Insert › Image, and she picks the stall photo. It appears between those words, about as tall as the text. "stall on Saturday" continues on the same line if it fits.
3. **Paste.** She puts the caret after "Saturday" and pastes a second small picture. It appears there, in the line, not under the paragraph.
4. **Still a choice.** The first photo is selected. Wrap text still offers Left, Right, Break text, and In line. Choosing Break text puts it on its own line. Choosing In line puts it back.
5. **Save.** She downloads the SuiteLeaf file and opens the copy. Both pictures are still in the sentence where she put them.

## Google Workspace benchmark

Google Docs inserts at the cursor, inline, in one step ([Docs Help](https://support.google.com/docs/answer/97447)). People who want the picture on its own line have to change the wrap afterward. SuiteLeaf currently does the extra step for the common case.

## Better than Google Workspace when

1. Insert › Image with the caret in a sentence puts the picture in that sentence, at the caret.
2. The new picture is about the height of the surrounding text, not the width of the page.
3. Pasting an image with the caret in a sentence does the same.
4. Left, Right, Break text, and In line are still available and still do what storyboard 70 and 73 say.
5. Break text after an insert puts that picture on its own line. In line puts it back.
6. The positions survive save and reopen.

## Success looks like

Lena never uses the In line command for a picture she just inserted or pasted. It is already between the words.

## Gaps and notes

- Insert image and an external paste still create a block on their own line.
- Do not remove In line, Left, Right, or Break text.
- Do not rebuild crop or page size.
