# 127 · Draw the number on the preview page

**Mode:** single-node · **App:** Docs · **Video:** [videos/127-draw-the-number-on-the-preview.mp4](videos/127-draw-the-number-on-the-preview.mp4) · **Script:** [scenes/127-draw-the-number-on-the-preview.spec.ts](scenes/127-draw-the-number-on-the-preview.spec.ts)

## Who and why

Sam looks at the page preview in Page setup. She needs to see the number sitting on a small page, in the corner she picked, before she applies. The chip already names the right pages. The miniature should show where the number goes.

## Inspired by

- [Add page numbers](https://support.google.com/docs/answer/9378647): the position choices are words. There is no small page with the number drawn on it.
- Storyboard [124](124-preview-the-roman-ends.md) shows the first and last numbers. They are now drawn on a page, in the selected corner.
- The miniature should look like the corner of the real page.

## Scenes

1. **Five pages.** Sam opens a five-page Preface that starts at 4. The first page says iv. The last page says viii.
2. **On the page.** She opens Page setup, before Apply. Each sheet is a small page. iv sits in the top-right corner of the first sheet. viii sits in the top-right corner of the last sheet. The roman chip says "iv … viii". The fraction chip says "4 / 8". The pages between are marked "Pages v–vii skipped".
3. **Bottom center.** She moves the number to the bottom center. Before Apply, both preview numbers sit at the bottom center of their sheets.
4. **Top right again.** She puts the number back at the top right. iv and viii return to that corner.
5. **Two pages.** She shortens the file to two pages. There are exactly two small pages, with iv and v in the top-right corner. The chip says "iv, v". The count is "4 / 5". There is no third sheet.
6. **Keep it.** Three more pages bring the preface back to five. Before Apply, the preview draws iv and viii in the top right again. She applies, closes the file, and opens it. The preview still draws them there, and the count is still "4 / 8".

## Google Workspace benchmark

Google Docs describes the position in words ([Docs Help](https://support.google.com/docs/answer/9378647)). You do not see a small page with the number already in that corner.

## Better than Google Workspace when

1. Each preview sheet is a small page, and the number is drawn on it in the selected position, before Apply.
2. Top right puts the number in the top-right corner of that small page. Bottom center puts it at the bottom center.
3. On a five-page file starting at 4, the first sheet shows iv and the last shows viii, in that corner.
4. A two-page file previews exactly two small pages.
5. Apply and reopen keep the number drawn in the chosen corner.
6. The roman chip still matches those ends, and the fraction chip still shows the real count.

## Success looks like

Sam sees iv in the top-right corner of a small page, and viii in the top-right corner of the last one. Moving the number to the bottom center moves it on those small pages before she applies. A two-page file shows exactly two small pages.

## Gaps and notes

- A file longer than three pages previews the first sheet and the last sheet. The pages between are marked skipped, for example "Pages v–vii skipped".
- A two-page file previews two sheets. Odd and even pages still sample the first three faces. This story is the corner of the sheet, not the last odd or even page.
- No live cover, no live watermark, and no section break that restarts at arabic 1.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| Each preview sheet is a small page, and the number is drawn on it in the selected position, before Apply | Met | Video 0:06: two page-shaped sheets, Apply still on screen, iv and viii drawn on the pages. Vitest `draws iv and viii in the selected corner`. Browser `the preview draws iv and viii in the chosen corner before apply and after reopen`. |
| Top right puts the number in the top-right corner. Bottom center puts it at the bottom center | Met | Video 0:06: iv and viii in the top-right corner. Video 0:11: both numbers sit at the bottom center while Apply is still showing. Video 0:13: they return to the top right. The browser test measures the numeral inside the sheet at each corner. |
| On a five-page file starting at 4, the first sheet shows iv and the last shows viii, in that corner | Met | Video 0:06 and 0:36: first sheet iv, last sheet viii, skip label "Pages v–vii skipped". Vitest compares those numerals with the chip ends. |
| A two-page file previews exactly two small pages | Met | Video 0:24: status says 2 pages, the chip says iv, v, and the preview is two sheets, iv and v, with no skip mark. Browser `a two-page file previews exactly two small pages`. |
| Apply and reopen keep the number drawn in the chosen corner | Met | Video 0:36: before Apply, iv and viii in the top right. Video 0:42: after save and reopen, Top right is still selected and the sheets still draw iv and viii there. The browser test applies, reopens Preface, and checks the corner. |
| The roman chip still matches those ends, and the fraction chip still shows the real count | Met | Video 0:06 and 0:42: roman chip "iv … viii", fraction chip "4 / 8". Video 0:24: "iv, v" and "4 / 5". Vitest checks `pageNumberFormatChips`. |
