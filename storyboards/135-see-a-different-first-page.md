# 135 · See a different first page before you apply

**Mode:** single-node · **App:** Docs · **Video:** [videos/135-see-a-different-first-page.mp4](videos/135-see-a-different-first-page.mp4) · **Script:** [scenes/135-see-a-different-first-page.spec.ts](scenes/135-see-a-different-first-page.spec.ts)

## Who and why

Sam is sending the club minutes. Page 1 should be a letterhead with no page number. Page 2 should keep "Garden club minutes" and Page 2. She ticks "Different first page" and the first page still shows the shared header and Page 1 until she clicks Apply. She cannot tell, before she commits, that the letterhead stays off the second page.

## Inspired by

- [Use different headers and footers](https://support.google.com/docs/answer/86629): Insert or Format, then "Different first page". The page does not change until the dialog closes.
- Storyboard [61](61-different-first-page.md) already clears the first page after Apply, and page 2 keeps showing 2. That switch still waits.
- Storyboard [134](134-see-the-cover.md) drops a cover's number before Apply and restarts the next page at Page 1. A different first page is not a restart.
- Storyboard [106](106-see-the-header-text.md) draws header wording before Apply. The first page still uses the shared header until the switch is applied.

## Scenes

1. **Two pages, one header.** Sam opens Page setup on a two-page "Minutes". The header is "Garden club minutes". Page numbers are on, in the form Page N, at the top right. Different odd and even pages is off. Cover has no number is off. Page 1 shows the header and Page 1. Page 2 shows the header and Page 2.
2. **A different first page.** She ticks Different first page. Before Apply, page 1's header is empty and page 1 has no number. Page 2 still says "Garden club minutes" and Page 2 at the top right. Numbering does not restart.
3. **The preview.** The preview shows two sheets while Apply is still visible. The first sheet has no header and says "No number". The second sheet shows "Garden club minutes" and Page 2.
4. **The letterhead.** She types "Riverside Garden Club" into the first-page header. Before Apply, that line appears only on page 1. Page 2 does not gain it. The preview's first sheet shows that line, and its second sheet still shows "Garden club minutes".
5. **Cancel.** She cancels. Page 1 shows "Garden club minutes" and Page 1 again.
6. **Keep it.** She turns Different first page on again, types the letterhead, sees it only on page 1, and applies. She reopens the file. Page 1 is still the letterhead, with no number. Page 2 still says "Garden club minutes" and Page 2.

## Google Workspace benchmark

Google Docs puts "Different first page" under Insert › Headers & footers ([Docs Help](https://support.google.com/docs/answer/86629)). The checkbox is at the end of a menu, and the page updates when you leave that menu. Page numbers still start at 1 on the cover unless a second control is changed, so people print a letterhead that says 1.

## Better than Google Workspace when

1. While Page setup is open, ticking Different first page clears the first page's header and number before Apply.
2. The second page still shows "Garden club minutes" and Page 2 before Apply. It does not become Page 1.
3. The preview shows a first sheet with no header and no numeral, and a second sheet with "Garden club minutes" and Page 2, before Apply.
4. Text typed in the first-page header appears only on page 1 before Apply, including on the preview's first sheet.
5. Cancel restores "Garden club minutes" and Page 1 on the first page.
6. Apply and reopen keep the first-page letterhead with no number, and keep Page 2 with the running header.

## Success looks like

Sam ticks Different first page and the first page's header and number disappear while the dialog is still open. She types a letterhead and sees it only on page 1. Page 2 still says "Garden club minutes" and Page 2. Cancel puts the shared header back. Apply keeps the letterhead.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| While Page setup is open, ticking Different first page clears the first page's header and number before Apply. | Met | Video 0:08. `see-a-different-first-page.spec.ts` |
| The second page still shows "Garden club minutes" and Page 2 before Apply. It does not become Page 1. | Met | Video 0:12. `clears the first page before apply and keeps Page 2` |
| The preview shows a first sheet with no header and no numeral, and a second sheet with "Garden club minutes" and Page 2, before Apply. | Met | Video 0:15, Apply still on screen |
| Text typed in the first-page header appears only on page 1 before Apply, including on the preview's first sheet. | Met | Video 0:21 and 0:25 |
| Cancel restores "Garden club minutes" and Page 1 on the first page. | Met | Video 0:28 |
| Apply and reopen keep the first-page letterhead with no number, and keep Page 2 with the running header. | Met | Video 0:36 and 0:42 |

## Gaps and notes

- Different first page now changes the pages before Apply. Page 2 stays Page 2. Cover has no number, from storyboard 134, is still what restarts the next page at Page 1, and it stays off here.
- No live watermark, no section break, and no control for the numeral's font or size.
- Different odd and even pages stays off. Outside-edge numbers from storyboard 132 are unchanged.
- The outline no longer offers "Start Arabic numbers here." That restart is separate from a different first page, and this story does not use it. A heading already saved with the restart still begins at 1.
- A long running header wraps onto a second line on the miniature sheet so it stays clear of Page 2.
