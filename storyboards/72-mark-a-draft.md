# 72 · Mark a draft

**Mode:** single-node · **App:** Docs · **Video:** [videos/72-mark-a-draft.mp4](videos/72-mark-a-draft.mp4) · **Script:** [scenes/72-mark-a-draft.spec.ts](scenes/72-mark-a-draft.spec.ts)

## Who and why

Priya's garden-club minutes are not ready to send. She wants the word DRAFT behind the text on every page, faint enough to read through, and gone the moment she is finished. Google Docs hides that under Insert, then Watermark, then a second dialog, and removing it is easy to miss.

## Inspired by

- [Add or remove a watermark](https://support.google.com/docs/answer/116255): Insert › Watermark, type the word, then Done. Removing it is Insert › Watermark › Remove.
- People lose the word behind a photo, or cannot tell the watermark from ordinary text they then delete by accident.
- SuiteLeaf has no watermark. Page headers and page numbers already sit in the furniture, not in the paragraph text.

## Scenes

1. **The minutes.** Priya opens "Garden club minutes". Two pages, and no word behind the text.
2. **The word.** Page setup already shows page numbers. Beside that checkbox she types DRAFT and clicks Apply. The dialog does not open a second one.
3. **Every page.** Page 1 and page 2 both show DRAFT behind the paragraphs, large and faint. She adds "The vote was unanimous." The word stays where it was, and it is not in the paragraph.
4. **A different word.** She changes the field to FINAL. Both pages update. DRAFT is gone.
5. **Clear.** She clears the field and applies. The pages have no word behind the text. The paragraphs, including the new sentence, are unchanged.
6. **Save and Word.** She sets DRAFT again. SuiteLeaf saves it. She leaves the file and opens it again: the word is still behind the minutes. Export DOCX writes a Word watermark, not a paragraph that says DRAFT.

## Google Workspace benchmark

In Google Docs the path is Insert, Watermark, type, Done ([Docs Help](https://support.google.com/docs/answer/116255)). The word is easy to confuse with body text, and removing it is a separate trip through the same menu.

## Better than Google Workspace when

1. The watermark is a field in Page setup, next to the page-number choices. No second dialog.
2. The word appears behind the text on every page, large and faint, and stays out of the paragraph text.
3. Editing a sentence does not delete or move the watermark.
4. Changing the word updates every page. Clearing it removes it from every page and leaves the paragraphs alone.
5. The word survives save and reopen.
6. The exported .docx carries that watermark, not an extra paragraph that says DRAFT.

## Success looks like

Both pages show DRAFT behind the minutes. Priya adds a sentence and the word stays. Clearing the field removes it and leaves the paragraphs. Reopening the file brings DRAFT back, and the Word file has that watermark.

## Gaps and notes

- The word is horizontal, across the body of the page. Google's and Word's usual DRAFT stamp is diagonal. An angle control and an image watermark are still out of scope.
- Opening a Word file does not read an existing watermark back into Page setup. Export writes one; import does not yet.
- Spellcheck still underlines ordinary names in the minutes. That is separate from the watermark.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| The watermark is a field in Page setup, next to the page-number choices. No second dialog. | Met | Video ~8–12s: Watermark sits beside Page numbers; she types DRAFT and clicks Apply. The scene asserts a single dialog. |
| The word appears behind the text on every page, large and faint, and stays out of the paragraph text. | Met | Video ~14s (page 1) and ~17s (page 2). The editor text does not contain DRAFT. `tests/doc-watermark.test.ts`, `tests/browser/doc-watermark.spec.ts`. |
| Editing a sentence does not delete or move the watermark. | Met | Video ~21–24s: "The vote was unanimous." is a new line; DRAFT stays. The browser test checks the word's place on the page before and after the edit. |
| Changing the word updates every page. Clearing it removes it from every page and leaves the paragraphs alone. | Met | Video ~28s FINAL on both pages, ~34s the word is gone and the new sentence remains. |
| The word survives save and reopen. | Met | Video ~40–44s: back to files, open "Garden club minutes", DRAFT is behind the text. The browser test checks the saved `.sldoc` and the reopened page. |
| The exported .docx carries that watermark, not an extra paragraph that says DRAFT. | Met | Video ~46s. `tests/doc-watermark.test.ts`: `word/header1.xml` has `PowerPlusWaterMarkObject` and `string="DRAFT"`; `word/document.xml` does not contain DRAFT. |
