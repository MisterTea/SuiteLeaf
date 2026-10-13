# 61 · A different first page

**Mode:** single-node · **App:** Docs · **Video:** [videos/61-different-first-page.mp4](videos/61-different-first-page.mp4) · **Script:** [scenes/61-different-first-page.spec.ts](scenes/61-different-first-page.spec.ts)

## Who and why

Ben is sending the club minutes on letterhead. Page 1 should show the club logo line and no page number. Page 2 should show "Garden club minutes" and "2". Page setup already sets one header and one footer for every page. There is no way to make the first page different, so the letterhead repeats on page 2 and the number "1" sits on the letterhead.

## Inspired by

- [Use different headers and footers](https://support.google.com/docs/answer/86629): Format or Insert, then "Different first page". Page 1 can be blank in the header while later pages carry the title and a number.
- Storyboard [07](07-page-setup-and-export.md): page setup, headers, and page numbers already exist, and they apply to every page.
- People complain that turning on page numbers puts "1" on a cover page, and that Google's control is easy to miss.

## Scenes

1. **Two pages.** Ben opens "Minutes". Page setup already has the header "Garden club minutes" and page numbers on. Page 1 shows that header and "1 / 2". Page 2 repeats the header, and its footer says "2 / 2".
2. **Different first page.** **Page setup** on the toolbar opens the dialog. He ticks "Different first page". The dialog says page 1 gets no number and page 2 shows 2. He clicks Apply. Page 1's header is empty. Page 2 still says "Garden club minutes" and "2 / 2".
3. **One step back.** He unticks the box and clicks Apply. Page 1 shows "Garden club minutes" and "1 / 2" again.
4. **The letterhead.** He ticks the box again and types "Riverside Garden Club" into the first-page header only. Page 2 does not gain that line.
5. **No number on the cover.** The first-page footer has no number. Page 2 still shows "2 / 2".
6. **Save.** He reopens the file. Page 1 is still the letterhead, with no number. Page 2 still has the running header and "2 / 2".

## Google Workspace benchmark

In Google Docs, Insert › Headers & footers, then "Different first page" ([Docs Help](https://support.google.com/docs/answer/86629)). The checkbox is at the end of a menu, and page numbers still start at 1 on the cover unless you also change the number setting. People print a cover that says "1" because those two controls are separate.

## Better than Google Workspace when

1. Page setup has one "Different first page" checkbox. It is in the dialog, not a second menu.
2. Ticking it clears the first-page header and footer without changing page 2.
3. Text typed in the first-page header does not appear on page 2.
4. With page numbers on, page 1 shows no number and page 2 shows "2".
5. The choice and both headers survive save and reopen.
6. Unticking the box restores the shared header on page 1 in one step.

## Success looks like

The first page is letterhead with no page number. The second page says "Garden club minutes" and "2".

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| One checkbox, in the Page setup dialog | Met | Video 0:09–0:12; the dialog hint says page 1 has no number and page 2 shows 2 |
| Ticking clears page 1 and leaves page 2 | Met | Video 0:13–0:17; page 1's header is empty and page 2 still says "Garden club minutes" and "2 / 2" |
| First-page header text stays off page 2 | Met | Video 0:28–0:31; page 1 says "Riverside Garden Club", page 2 still says "Garden club minutes" |
| Page 1 has no number and page 2 shows 2 | Met | Video 0:33–0:35 and 0:42–0:43; page 2's footer reads "2 / 2" and page 1's footer is blank |
| The choice and both headers survive reopen | Met | Video 0:39–0:43; `different-first-page.spec.ts` checks the saved file and the reopened pages |
| Unticking restores the shared header in one step | Met | Video 0:19–0:23; unchecking and Apply puts "Garden club minutes" and "1 / 2" back on page 1 |

## Gaps and notes

- Headers and footers are still plain text. The letterhead here is a line of text, not a logo image.
- Page numbers keep the existing "2 / 2" style. Page 1 omits its number, and page 2 does not restart at 1.
- **File → Export DOCX** writes a Word title page: the first header and footer are separate, and the first footer has no page number. Importing a Word file still keeps one header and footer for the whole document.
- HTML export still shows the shared header once, above the text, as in storyboard 07.
- Different odd and even pages are not part of this story.
