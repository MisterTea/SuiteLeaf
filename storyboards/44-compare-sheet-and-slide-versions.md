# 44 · Compare a spreadsheet or a slide version in color

**Mode:** single-node · **App:** Sheets, Slides · **Video:** [videos/44-compare-sheet-and-slide-versions.mp4](videos/44-compare-sheet-and-slide-versions.mp4) · **Script:** [scenes/44-compare-sheet-and-slide-versions.spec.ts](scenes/44-compare-sheet-and-slide-versions.spec.ts)

## Who and why

Lena saved "Volunteer roster" yesterday with 40 people, then this morning changed six statuses and bolded the header. Dev saved "Fundraiser pitch", then rewrote the title slide and deleted a slide. Each of them wants to see what changed against the current file, in color, before deciding whether to restore. They already can for a document (storyboard 28). A spreadsheet and a deck still open the history and then show nothing on the page.

## Inspired by

- WF-A4-19 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): open the history and see what a past revision changed.
- Storyboard [28](28-restore-an-earlier-version.md): documents already compare any version with the current one, green underline and red strikethrough, and say how many paragraphs change.
- [Find what's changed in a file](https://support.google.com/docs/answer/190843): Sheets highlights edits and hides unmodified rows; a cell's own edit history skips formatting, inserted rows, and formula results. Slides colors edits by person.
- [Docs Editors Community: "Highlights ready"](https://support.google.com/docs/thread/4514956/what-tf-does-highlights-ready-update-mean-and-why-isn-t-there-any-realated-information-anywhere): choosing an older slide version can keep showing the current deck.
- [Zapier: Google Docs version history](https://zapier.com/blog/google-docs-revision-history/): the highlight is against the previous version, not an arbitrary one.

## Scenes

1. **Two versions of the roster.** Lena opens "Volunteer roster". Yesterday's snapshot and this morning's save are in the history. The morning save is current: six Status cells differ, and row 1 is bold.
2. **Compare the sheet.** She clicks the clock, then yesterday. Changed cells are marked on the grid against the current roster: the six old statuses in red, the new ones in green, and the header's bold marked as a format change. The panel says "7 cells change". Unchanged rows stay visible. The grid is read-only.
3. **Just this version.** "Changes in this version" compares yesterday with the version before it and says what that step itself changed. Switching back to "Compare with current" returns the 7-cell view.
4. **She does not restore.** She closes the panel. The live roster is still this morning's, including the bold header.
5. **Two versions of the deck.** Dev opens "Fundraiser pitch". The older snapshot has the original title and a "Thank you" slide. The current deck says "Spring fair" and has no thank-you slide.
6. **Compare the slides.** The clock, then the older version. The title slide shows the old title struck in red and "Spring fair" in green. The deleted thank-you slide appears ghosted in red, and the panel says "2 slides change". The filmstrip is read-only.
7. **A document is unchanged.** Opening version history on "Quarterly Report" still shows the green and red paragraph compare from storyboard 28, with a paragraph count.

On a server, the same panel reads SuiteDrive versions. The colors and the counts are the same.

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

- Yesterday's roster shows 7 marked cells against this morning, and closing the panel leaves the morning file in place.
- The older deck shows the old title and the deleted thank-you slide in color, and the live deck is still "Spring fair".

## Gaps and notes

- `version-history.tsx` loads both versions, then returns immediately when either file is not a document: the preview is cleared and the change count stays empty. The restore line for a sheet or a deck does not say how much would change.
- `diffDocuments` is the only compare. There is no cell diff and no slide diff.
- Naming, Make a copy, and Restore this version already work for sheets and slides (storyboard 28). This story adds the color preview. Restoring still replaces the whole file; one paragraph is storyboard 52, and this story does not restore.
