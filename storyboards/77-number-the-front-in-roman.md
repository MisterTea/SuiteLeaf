# 77 · Number the front in roman

**Mode:** single-node · **App:** Docs · **Video:** [videos/77-number-the-front-in-roman.mp4](videos/77-number-the-front-in-roman.mp4) · **Script:** [scenes/77-number-the-front-in-roman.spec.ts](scenes/77-number-the-front-in-roman.spec.ts)

## Who and why

Amara's report has two front pages and then the chapters. She wants the front pages numbered i and ii, and the first chapter numbered 1, not 3. Page setup can start at a number and hide a cover (storyboard 75). It cannot switch the numerals.

## Inspired by

- [Add page numbers](https://support.google.com/docs/answer/86629): the number format (1, a, i) is inside header options. People set roman numerals and then cannot make the body start at 1 without the front pages becoming 1 and 2.
- `packages/core/src/document-layout.ts` formats are `fraction` ("1 / 2") and `page` ("Page N"). There is no roman format.
- Storyboard [75](75-start-numbering-at.md): start-at and a cover already exist. This story adds the numeral style and a body that restarts.

## Scenes

1. **The report.** Amara opens a four-page file. Numbers are "Page 1" through "Page 4" at the bottom center.
2. **Roman for the front.** In the same Page setup dialog she chooses lowercase roman. The first two pages show "i" and "ii". She does not open a second dialog.
3. **The body restarts.** She marks a heading, "Chapter 1", as where Arabic numbers begin. That page shows "1". The next page shows "2". The front pages stay "i" and "ii".
4. **The footer stays.** "Draft" remains in the footer. The numerals are not part of that text.
5. **Save.** She reopens the file. The front is still roman and Chapter 1 is still "1".
6. **Word.** The exported .docx uses roman numerals before Chapter 1 and Arabic numerals from Chapter 1, starting at 1.

## Google Workspace benchmark

In Google Docs the format is several clicks into the header ([Docs Help](https://support.google.com/docs/answer/86629)). Restarting the body at 1 is a section break plus another page-number dialog. People either number the whole file in roman, or the chapter starts at 3.

## Better than Google Workspace when

1. Lowercase roman is a choice in the same Page setup dialog as "Page N" and Start at. No second dialog for the format.
2. Choosing roman changes the front pages to i, ii, and so on. "Page" is not stuck in front of the numeral.
3. A heading marked "Start Arabic numbers here" makes that page "1" and the following pages 2, 3, without renumbering the front.
4. Footer text is unchanged.
5. The roman front and the Arabic restart survive save and reopen.
6. The .docx export writes both formats, and the body starts at 1.

## Success looks like

The contents pages say i and ii. Chapter 1 says 1. "Draft" is still in the footer.

## Gaps and notes

- Number format is only "1 / 2" and "Page N". Roman is not a format.
- A restart at a heading does not exist. Do not require a Word section-break UI. Marking one heading is enough.
- Do not rebuild Start at or the cover checkbox from storyboard 75.
