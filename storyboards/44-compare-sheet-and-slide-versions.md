# 44 · Compare a spreadsheet or a slide version in color

**Mode:** cluster · **App:** Sheets, Slides · **Video:** [videos/44-compare-a-sheet-or-slide-version.mp4](videos/44-compare-a-sheet-or-slide-version.mp4) · **Script:** [scenes/44-compare-a-sheet-or-slide-version.spec.ts](scenes/44-compare-a-sheet-or-slide-version.spec.ts)

## Who and why

Lena saved "Volunteer roster" yesterday with 40 people, then this morning changed six statuses and bolded the header. Dev saved "Fundraiser pitch", then rewrote the title slide and deleted a slide. Each of them wants to see what changed against the current file, in color, before deciding whether to restore. They already can for a document (storyboard 28). A spreadsheet and a deck still open the history and then show nothing on the page.

## Inspired by

- WF-A4-19 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): open the history and see what a past revision changed.
- Storyboard [28](28-restore-an-earlier-version.md): documents already compare any version with the current one, green underline and red strikethrough, and say how many paragraphs change.
- [Find what's changed in a file](https://support.google.com/docs/answer/190843): Sheets highlights edits and hides unmodified rows; a cell's own edit history skips formatting, inserted rows, and formula results. Slides colors edits by person.
- [Docs Editors Community: "Highlights ready"](https://support.google.com/docs/thread/4514956/what-tf-does-highlights-ready-update-mean-and-why-isn-t-there-any-realated-information-anywhere): choosing an older slide version can keep showing the current deck.
- [Zapier: Google Docs version history](https://zapier.com/blog/google-docs-revision-history/): the highlight is against the previous version, not an arbitrary one.

## Scenes

1. **Two versions of the roster.** Lena signs in and opens "Volunteer roster" in SuiteDrive. Yesterday's snapshot and this morning's save are in the history, and the day before that is there too. The morning save is current: six Status cells differ, the Name and Status headers are bold, and Noah's row did not change.
2. **Compare the sheet.** She clicks the clock, then yesterday. Changed cells are marked on the grid against the current roster: the six old statuses struck in red, the new ones in green, and both header cells marked Bold. The panel says "8 cells change". Noah's row stays on screen, unmarked. The grid is read-only.
3. **Just this version.** "Changes in this version" compares yesterday with the day before and says "6 cells change in this version": Invited became Maybe, Yes, or No, and the header is not marked, because it was not bold yet. Switching back to "Compare with current" returns the 8-cell view. Each switch is one click.
4. **She does not restore.** Typing in the preview changes nothing. She closes the panel. The live roster is still this morning's, including the bold header and Rosa's Confirmed status.
5. **Two versions of the deck.** She opens "Fundraiser pitch". Dev saved the current deck this morning: the title is "Spring fair" and there is no thank-you slide. Yesterday's snapshot, saved by Lena, still has "Fundraiser pitch" and a thank-you slide.
6. **Compare the slides.** The clock, then yesterday. The title slide shows "Fundraiser pitch" struck in red and "Spring fair" in green. The deleted thank-you slide stays in the filmstrip, and opening it shows the slide ghosted in red with a Deleted mark. The panel says "2 slides change". The preview is read-only. She does not restore, and the live deck is still "Spring fair" with two slides.
7. **A document is unchanged.** Opening version history on "Quarterly Report" still shows the green and red paragraph compare from storyboard 28. The panel says "2 paragraphs change". She closes without restoring.

The same colors and counts are used for a snapshot kept on this computer. The recording uses SuiteDrive versions.

## Google Workspace benchmark

Google Sheets version history highlights cells in the editor's color and, by default, hides rows that did not change. Showing them is "Show unmodified rows" at the bottom. Right-click › Show edit history on one cell skips format changes, added or deleted rows, and values that come from formulas ([Docs Help](https://support.google.com/docs/answer/190843)). Google Slides paints each person's edits in their color, and that highlight sometimes fails to replace the current deck ([Docs Community](https://support.google.com/docs/thread/4514956/what-tf-does-highlights-ready-update-mean-and-why-isn-t-there-any-realated-information-anywhere)). In all three apps the highlight is against the previous version, not against the current file ([Zapier](https://zapier.com/blog/google-docs-revision-history/)).

Known pain points:

- Hidden unmodified rows remove the context around a change.
- Format-only edits, and a deleted slide, are easy to miss.
- The highlight compares with the neighbor in the list, so "what would I lose if I restored this?" takes a copy and a second look.

## Better than Google Workspace when

1. Selecting a spreadsheet version marks changes against the current version on the grid: new values in green, removed values in red, and format-only changes marked. The panel states the cell count. No second file is created.
2. Rows that did not change stay on screen.
3. Selecting a slide version marks added text in green, removed text in red, and a deleted or added slide so it can be seen. The panel states how many slides changed.
4. "Changes in this version" compares that version with the one before it. "Compare with current" compares it with the head. Both are one click.
5. The preview is read-only: typing or pasting changes nothing in the current file.
6. A document still uses the paragraph compare from storyboard 28, including its paragraph count.
7. The same compare works for a snapshot kept on this computer and for a SuiteDrive version.

## Success looks like

- Yesterday's roster shows 8 marked cells against this morning, Noah's unchanged row stays visible, and closing the panel leaves the morning file in place, header still bold.
- The older deck shows the old title and the deleted thank-you slide in color, and the live deck is still "Spring fair".
- The quarterly report still compares paragraphs in green and red.

## Gaps and notes

- Restoring still replaces the whole file. One paragraph is storyboard 52, and this story does not restore.
- A row that was inserted is compared cell by cell, so the cells below it each count as a change. There is no single "row inserted" mark.
- While "Changes in this version" is selected, the green summary is the step count and the restore line stays the count against the current file. The two numbers are both true, and the wording has to carry the difference.
- The document compare is unchanged from storyboard 28, including putting a removed word and its replacement on the same line.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. A spreadsheet version marks new values in green, removed values in red, and format-only changes, and the panel states the cell count. No second file is created. | Met | Video ~14s: six old statuses struck in red, new ones green, Bold badges on the header, panel "8 cells change". `spreadsheet version diff` in `tests/sheet-slide-diff.test.ts`. |
| 2. Rows that did not change stay on screen. | Met | Video ~14s and ~18s: Noah's row stays, with Confirmed unmarked. |
| 3. A slide version marks added text in green, removed text in red, and a deleted or added slide so it can be seen. The panel states how many slides changed. | Met | Video ~29s: "Fundraiser pitch" struck, "Spring fair" green, panel "2 slides change". Video ~31s: thank-you slide ghosted with Deleted. |
| 4. "Changes in this version" compares that version with the one before it. "Compare with current" compares it with the head. Both are one click. | Met | Video ~18s: "6 cells change in this version" (Invited to Maybe). The next click returns "8 cells change". |
| 5. The preview is read-only: typing or pasting changes nothing in the current file. | Met | Video ~21s: typing in the sheet preview does not appear. Browser tests type and insert text into both previews. |
| 6. A document still uses the paragraph compare from storyboard 28, including its paragraph count. | Met | Video ~38s: north struck, west green, panel "2 paragraphs change". `tests/doc-diff.test.ts` and `tests/browser/version-history.spec.ts`. |
| 7. The same compare works for a snapshot kept on this computer and for a SuiteDrive version. | Met | The recording is a SuiteDrive file. `tests/browser/version-compare.spec.ts` seeds local snapshots for a sheet and a deck. Both paths call `diffSheets` / `diffSlides`. |
