# 122 · List only the roman pages you have

**Mode:** single-node · **App:** Docs · **Video:** [videos/122-list-the-roman-pages-you-have.mp4](videos/122-list-the-roman-pages-you-have.mp4) · **Script:** [scenes/122-list-the-roman-pages-you-have.spec.ts](scenes/122-list-the-roman-pages-you-have.spec.ts)

## Who and why

Sam's preface is two pages and starts at iv. She needs the roman chip to list the pages she will print, and to stop when the file stops. A chip that adds vi makes her look for a third page that is not there.

## Inspired by

- [Add page numbers](https://support.google.com/docs/answer/9378647): samples are a fixed "i, ii, iii" and never match the document's length.
- Storyboard [119](119-show-the-start-in-roman.md) starts the list at the right number, then always adds two more.
- A two-page file should not advertise a third number.

## Scenes

1. **Two pages, no vi.** Sam opens Page setup on a two-page Preface. Start at is 4. The pages say Page 4 and Page 5. The roman chip says "iv, v". The fraction chip says "4 / 5".
2. **On the page.** She selects that chip. Before Apply, the first page says iv and the last says v.
3. **Keep it.** She applies. She reopens the file. The first page still says iv, and the chip still says "iv, v".
4. **One page.** She deletes the second page. The page says iv. The chip says "iv" only.
5. **Three pages.** She adds two pages. The chip says "iv, v, vi", and the last page says vi.
6. **The long preface.** Two more pages, five in all. The chip says "iv … viii". The first page says iv and the last says viii. The fraction chip says "4 / 8".

## Google Workspace benchmark

Google's roman sample is always three numerals ([Docs Help](https://support.google.com/docs/answer/9378647)). A one-page preface and a ten-page preface get the same chip.

## Better than Google Workspace when

1. On a two-page file starting at 4, the roman chip reads "iv, v" before Apply. It does not include vi.
2. On a one-page file starting at 4, the chip reads "iv" only.
3. On a three-page file starting at 4, the chip reads "iv, v, vi".
4. The first and last numbers on the chip match the first and last pages before Apply.
5. Apply on the two-page file keeps "iv, v" on the chip after save and reopen.
6. The fraction chip still shows the real count, such as "4 / 5" for those two pages.

## Success looks like

Sam's two-page preface shows a chip that says "iv, v" and nothing after it. Removing the second page leaves "iv". Adding pages grows the chip to "iv, v, vi", and a longer file shows "iv … viii".

## Gaps and notes

- The roman chip lists only the pages that exist. One page is a single numeral, two or three pages are listed, and a longer file shows the first numeral, an ellipsis, and the last.
- The miniature preview in Page setup still shows at most three file pages. On a five-page file it shows iv, v, and vi, while the chip says "iv … viii" and the last page of the document says viii.
- A one-page file's hint names that page only. It does not invent a next page.
- No live cover, no live watermark, and no section break that restarts at arabic 1.
- Storyboards 77 and 119 still describe a chip that always lists three numerals. Re-recording them would show the shorter chip: a four-page file reads "i … iv", and a two-page file starting at 4 reads "iv, v".

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| On a two-page file starting at 4, the roman chip reads "iv, v" before Apply. It does not include vi | Met | Video ~5s: Start at is 4, the chip says iv, v, the pages say Page 4 and Page 5, and Apply is still on screen. Video ~11s: the chip is selected and the last page says v. Vitest `lists only the roman pages that exist`. Browser `the roman chip lists only the pages that exist`. |
| On a one-page file starting at 4, the chip reads "iv" only | Met | Video ~27s: one page remains and it says iv. Video ~31s: the chip says iv, the fraction says 4 / 4, and the hint names only that page. Browser test after deleting the second page. |
| On a three-page file starting at 4, the chip reads "iv, v, vi" | Met | Video ~43s: the chip says iv, v, vi, the last page says vi, the fraction says 4 / 6, and Apply is still on screen. |
| The first and last numbers on the chip match the first and last pages before Apply | Met | Video ~11s: chip iv, v and the last page v, before Apply. Video ~43s: chip ends at vi and the last page says vi. Video ~51s and ~57s: chip iv … viii, first page iv, last page viii, before Apply. Vitest compares the chip ends with `pageFace`. |
| Apply on the two-page file keeps "iv, v" on the chip after save and reopen | Met | Video ~19s: reopened, the first page says iv. The scene opens Page setup again and the chip is still iv, v with fraction 4 / 5. Browser test saves, reopens, and checks the chip. |
| The fraction chip still shows the real count, such as "4 / 5" for those two pages | Met | Video ~5s: 4 / 5 beside iv, v. Video ~43s: 4 / 6. Video ~57s: 4 / 8. Vitest `lists only the roman pages that exist`. |
