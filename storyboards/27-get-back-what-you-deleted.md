# 27 · Get back what you deleted

**Mode:** single-node · **App:** Docs · **Video:** [videos/27-get-back-what-you-deleted.mp4](videos/27-get-back-what-you-deleted.mp4) · **Script:** [scenes/docs.spec.ts](scenes/docs.spec.ts)

## Who and why

Maya is finishing the garden club newsletter on her laptop. She deletes the plant-sale paragraph by mistake and only notices after she has kept typing. In Google Docs she would open File, then Version history, then See version history, and click through timestamps that never say what changed. The history would also stay in Google's cloud, so a downloaded copy would not have it. She wants the missing paragraph back, and she wants that history to leave with the file.

## Inspired by

- [See changes to your Google Docs, Sheets, and Slides files](https://support.google.com/docs/answer/190843): version history is three menu levels deep, versions are grouped by time, and a restore replaces the current document.
- [r/gsuite: Is Google Drive sync conflict resolution really this bad?](https://www.reddit.com/r/gsuite/comments/1rqlwk8/is_google_drive_sync_conflict_resolution_really/): people lose the version they were just looking at, and the only copy of it is buried in history.
- Local version history is in the support matrix in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md) (H2). Cloud sync and shared editing are still out of v1. Storyboard [25](25-when-someone-else-saved-first.md) is the case where two people save.

## Scenes

1. **Write the newsletter.** Maya creates "Garden club newsletter" and types "The plant sale is Saturday in the library hall." She pauses. She adds a second paragraph, "Bring seedlings and a bag for the basil." She pauses again. Each pause keeps a version.
2. **Open history in one click.** A **History** button sits in the header, next to the title. She clicks it. A panel lists the versions, newest first. Each row has a time and a sentence about what changed ("Added a paragraph"), not only a clock time. The newest row is the document she is editing.
3. **Delete the second paragraph.** She deletes "Bring seedlings and a bag for the basil." and pauses. The panel gains a row whose sentence is "Removed a paragraph."
4. **Preview the earlier version.** She clicks the row from when both paragraphs were there. The document shows both sentences again. A banner says she is viewing an earlier version and offers **Restore this version** and **Back to latest**. The live newsletter is not overwritten yet.
5. **Name it.** On that row she types the name "Before the library meeting" and saves the name. The row shows the name as well as the sentence about the change.
6. **Restore, and keep the shorter copy.** She clicks **Restore this version**. Both paragraphs are back in the editor and she can type. The shorter newsletter stays in the list, so the restore itself can be undone from the same panel.
7. **Take the history with the file.** She downloads the SuiteLeaf file. The named version and the deleted-paragraph version are inside that file, so opening it on another computer still shows the timeline.

## Success looks like

- History opens from one button in the header. It is not under File.
- Every automatic version says what changed, in a sentence a person can scan.
- Previewing an earlier version does not replace the newsletter. Restore does, and the version she left is still in the list.
- A name she types stays on that version.
- The downloaded file contains the named version and the text of both paragraphs.

## Better than Google Docs

- One click from the header, instead of File › Version history › See version history.
- A sentence for each version ("Removed a paragraph"), instead of a stack of times such as "October 13, 2:14 PM".
- Restore keeps the version you just left, so a restore is undoable from the same panel.
- The timeline is inside the downloaded file. Google's history stays on Google's servers.

## Gaps and notes

- Recorded. History is a button in the title row. After each pause the panel shows a sentence and a time: "Renamed to \"Garden club newsletter\" and added a paragraph", then "Added a paragraph", then "Removed a paragraph". The first sentence is long and wraps to two lines.
- Preview puts both sentences back on the page under a banner. Back to latest returns to the shorter newsletter, so the live file is not replaced until Restore. Restore puts both paragraphs back, and "Removed a paragraph" stays in the list. The name "Before the library meeting" stays on that row. The downloaded file contains the label and both sentences.
- The outline hides while the panel is open so the page and the history list fit side by side. The same History button writes sheet and slide summaries too; this recording is only the newsletter.
- The first history sentence wraps to two lines because naming the file and adding the first paragraph land in one version ("Renamed to … and added a paragraph"). The other rows are a single scannable sentence.
