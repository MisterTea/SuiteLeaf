# 61 · A different first page

**Mode:** single-node · **App:** Docs · **Video:** [videos/61-different-first-page.mp4](videos/61-different-first-page.mp4) · **Script:** [scenes/61-different-first-page.spec.ts](scenes/61-different-first-page.spec.ts)

## Who and why

Ben is sending the club minutes on letterhead. Page 1 should show the club logo line and no page number. Page 2 should show "Garden club minutes" and "2". Page setup already sets one header and one footer for every page. There is no way to make the first page different, so the letterhead repeats on page 2 and the number "1" sits on the letterhead.

## Inspired by

- [Use different headers and footers](https://support.google.com/docs/answer/86629): Format or Insert, then "Different first page". Page 1 can be blank in the header while later pages carry the title and a number.
- Storyboard [07](07-page-setup-and-export.md): page setup, headers, and page numbers already exist, and they apply to every page.
- People complain that turning on page numbers puts "1" on a cover page, and that Google's control is easy to miss.

## Scenes

1. **Two pages.** Ben opens "Minutes". Page setup has the header "Garden club minutes" and page numbers on. Both pages show that header and a number.
2. **Different first page.** In Page setup he ticks "Different first page". Page 1's header becomes empty. Page 2 still says "Garden club minutes" and "2".
3. **The letterhead.** He types "Riverside Garden Club" into the first-page header only. Page 2 does not gain that line.
4. **No number on the cover.** The first-page footer has no number. Page 2 still shows "2".
5. **Save.** He reopens the file. Page 1 is the letterhead without a number. Page 2 still has the running header and "2".

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

## Gaps and notes

- Page setup applies one header, one footer, and one page-number choice to every page.
- Do not rebuild page breaks, footnotes, or equations.
- A Word round trip of the different-first-page flag is a bonus, not required for this story.
