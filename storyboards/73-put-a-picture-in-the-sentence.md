# 73 · Put a picture in the sentence

**Mode:** single-node · **App:** Docs · **Video:** [videos/73-put-a-picture-in-the-sentence.mp4](videos/73-put-a-picture-in-the-sentence.mp4) · **Script:** [scenes/73-put-a-picture-in-the-sentence.spec.ts](scenes/73-put-a-picture-in-the-sentence.spec.ts)

## Who and why

Lena writes "Meet at the stall" and wants a tiny photo of the stall between "the" and "stall", on the same line, the way an emoji sits in a sentence. Storyboard 70 can put a logo beside a paragraph or on its own line. It cannot put a picture in the middle of the words.

## Inspired by

- [Wrap text around a picture](https://support.google.com/docs/answer/10274561): Inline is the default in Google Docs. The picture sits in the line and the words continue after it.
- Storyboard [70](70-put-a-picture-beside-the-text.md): Left, Right, and Break text exist. A picture with no wrap still takes its own line.
- People paste a screenshot into a sentence and are surprised when it jumps to the next line and becomes huge.

## Scenes

1. **The sentence.** Lena opens a note that reads "Meet at the stall on Saturday." The photo is on the line below.
2. **Into the line.** She selects the photo and chooses In line. It sits between "the" and "stall", and "on Saturday" continues on the same line if it fits.
3. **It stays small.** The photo is about the height of the words, not the width of the page. She can drag a corner to make it a little taller, and the line grows with it.
4. **Move it.** She cuts the photo and pastes it after "Saturday". The words close up where it was, and the photo is at the end of the sentence.
5. **From Word.** She opens a .docx with an inline picture in the middle of a sentence. It opens in the sentence, not on its own line.
6. **Save.** She downloads the SuiteLeaf file and opens the copy. The photo is still between the words.

## Google Workspace benchmark

In Google Docs, Insert › Image puts the picture inline by default, in the line at the caret ([Docs Help](https://support.google.com/docs/answer/10274561)). Wrap text is a separate choice. The complaint is the opposite of SuiteLeaf's: Docs makes inline easy and wrap easy to miss. SuiteLeaf currently has wrap and no inline.

## Better than Google Workspace when

1. In line is a choice on the selected picture, next to Left, Right, and Break text.
2. The picture sits in the sentence. The words before and after it stay on that line when they fit.
3. A newly in-line picture is about the height of the surrounding text, not the full page width.
4. Corner resize changes that height and the line grows or shrinks with it.
5. Cut and paste moves the picture to a new place in the text without leaving an empty line behind.
6. A Word inline picture opens in the sentence.
7. The choice survives save and reopen.

## Success looks like

"Meet at the" photo "stall on Saturday" reads as one sentence. The photo is not on a line by itself.

## Gaps and notes

- Storyboard 70's picture with no wrap is still a block on its own line.
- Do not remove Left, Right, or Break text.
- Do not rebuild crop or page size.
