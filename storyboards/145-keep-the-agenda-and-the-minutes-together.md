# 145 · Keep the agenda and the minutes together

**Mode:** single-node · **App:** Docs · **Video:** [videos/145-keep-the-agenda-and-the-minutes-together.mp4](videos/145-keep-the-agenda-and-the-minutes-together.mp4) · **Script:** [scenes/145-keep-the-agenda-and-the-minutes-together.spec.ts](scenes/145-keep-the-agenda-and-the-minutes-together.spec.ts)

## Who and why

Maya is writing up the October garden club meeting. The agenda and the minutes are one piece of work, but today they are either two files or one long scroll. Google Docs can put them in tabs, but the tab list is a side panel that stays hidden until she finds it, and a tab she does not notice can hold the only copy of a decision.

## Inspired by

- [Use tabs in Google Docs](https://support.google.com/docs/answer/15644032): tabs are a document outline in a side panel, not a row you always see.
- [r/googleworkspace: Docs tabs are hard to find](https://www.reddit.com/r/googledocs/comments/1h8tabs/): people miss that a document has more than one tab.
- The document file is one ProseMirror tree (`packages/core/src/index.ts`). An old file has to keep opening as that tree.

## Scenes

1. **One document.** Maya creates "October meeting". A tab row sits along the bottom, like the sheet tabs. The only tab is named Document. She renames it **Agenda**.
2. **The agenda.** She types "Call to order. Treasurer's report."
3. **A second tab.** She clicks **Add tab**. A blank tab appears on the row. She names it **Minutes**. The page is empty. She types "Voted to buy compost."
4. **Back to the agenda.** She clicks **Agenda**. "Call to order. Treasurer's report." is there. "compost" is not on that page.
5. **Both leave with the file.** She downloads the SuiteLeaf file. It contains both names and both sentences.

## Success looks like

- The tab row is visible without opening a side panel.
- Each tab has its own text.
- Switching tabs does not mix or lose the other tab.
- An existing document with no tabs still opens as one tab named Document.
- The downloaded file has both tabs.

## Better than Google Docs

- The tabs are always on screen, in the same place as spreadsheet tabs.
- Adding one is a button on that row, not a menu inside a hidden panel.
- The tab she is reading is the one that is selected. She does not discover a second tab by accident later.

## Gaps and notes

- Recorded. The tab row is on screen under the page. Renaming Document to Agenda, adding Minutes, and switching between them keeps each sentence on its own tab. The downloaded file has `tabTitle` Agenda, a Minutes tab, and both sentences. `version` stays 1.
- A document saved before tabs existed still opens as one tab named Document. Its text stays in `content`.
- Word, web page, and plain text export include every tab, each introduced by its name (see storyboard 147). Version compare counts a change on a later tab and names that tab (see storyboard 148). Find, the library search, and SuiteDrive search read every tab (see storyboard 146).
- There is no way to delete or reorder tabs. The assistant edits whichever tab is open.
