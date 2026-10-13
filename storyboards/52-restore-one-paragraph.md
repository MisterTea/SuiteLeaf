# 52 · Restore one paragraph

**Mode:** cluster · **App:** Docs · **Video:** [videos/52-restore-one-paragraph.mp4](videos/52-restore-one-paragraph.mp4) · **Script:** [scenes/52-restore-one-paragraph.spec.ts](scenes/52-restore-one-paragraph.spec.ts)

## Who and why

Sam's Tuesday rewrite of the "Watering rota" replaced Monday's agreed times, and it also added a useful line, "Thursday: ask Alex to cover." Rosa wants Monday's watering times back and wants to keep that Thursday line. Storyboard 28 can restore the whole of Monday, which would drop the Thursday line, or she can make a copy and paste. She wants the one paragraph from the history, in the file she already has open.

## Inspired by

- WF-A4-19 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): restore an earlier version. Restoring part of it is the case the whole-file restore does not cover.
- Storyboard [28](28-restore-an-earlier-version.md): the clock, a read-only compare with green and red marks, and Restore this version, which replaces the file and keeps the current version in the history.
- [Find what's changed in a file](https://support.google.com/docs/answer/190843): Restore this version replaces the document.
- [Live2Tech: restore part of a file](https://www.live2tech.com/how-to-restore-a-version-from-version-history-in-google-sheets/): open the old version, make a copy, then copy the piece you want and paste it into the current file.
- [r/googledocs: restore clicked by mistake](https://www.reddit.com/r/googledocs/comments/1pbmbh1/help_me_fix_my_grade/): a whole-file restore is hard to aim.

## Scenes

1. **Two paragraphs differ.** Rosa opens "Watering rota". Monday's version, "Agreed rota", has "North bed: 6am". The current file has Sam's "North bed: 8am" and, lower down, "Thursday: ask Alex to cover.", which Monday did not have.
2. **See the one change.** The clock, then "Agreed rota", Compare with current. "North bed: 6am" is on the page in the compare colors, and the Thursday line is marked as added later. The page is read-only. Typing does nothing.
3. **Restore that paragraph.** The north-bed paragraph offers **Restore this paragraph**, and the note is already on screen: `Restore the north-bed paragraph from "Agreed rota"? It becomes "North bed: 6am". The rest of the document stays as it is.` She clicks it. From the editor that is the clock, the version, and that button.
4. **The mix.** The panel closes. The rota says "North bed: 6am" and still has "Thursday: ask Alex to cover." The status is "Saved to SuiteDrive".
5. **History kept both.** She opens the clock again. The top entry is "Restored the north-bed paragraph", signed with her name. "Agreed rota" and Sam's full Tuesday version, "Yesterday 21:14 · Sam Okafor", are still in the list. The open rota still reads "North bed: 6am" and "Thursday: ask Alex to cover."
6. **The other paragraphs.** "South bed: 7am" stays exactly as it was in the current file, including its bold. She did not restore that paragraph, so the compare view never offered a button on it.
7. **Another server.** On the club's other server the rota shows 6am, the bold south bed, and the Thursday line. "Agreed rota" is still named, and "Restored the north-bed paragraph" is the current version. Garden club still has only the one rota file.

On a single-node computer the same control works on a snapshot kept with the file in the browser.

## Google Workspace benchmark

Restore this version in Google Docs replaces the whole document: File › Version history › See version history, the version, Restore this version, and Restore, 6 clicks, or fewer from "Last edit" ([Docs Help](https://support.google.com/docs/answer/190843)). Taking one paragraph is a workaround: restore is the wrong tool, so you make a copy of the old version and copy the paragraph across ([Live2Tech](https://www.live2tech.com/how-to-restore-a-version-from-version-history-in-google-sheets/)). That copy is a second file to clean up.

Known pain points:

- The restore button always means the whole file, so a useful edit made later is lost with the mistake.
- The copy-and-paste path is easy to aim at the wrong paragraph, and the old version's copy remains in Drive.
- After a mistaken full restore, reconstructing the mix means another restore plus another paste ([r/googledocs](https://www.reddit.com/r/googledocs/comments/1pbmbh1/help_me_fix_my_grade/)).

## Better than Google Workspace when

1. In the compare view, each changed paragraph offers Restore this paragraph. Paragraphs that match the current document do not.
2. From the editor, restoring one paragraph takes at most 3 clicks (the clock, the version, Restore this paragraph), and the confirmation names that paragraph and says the rest of the document stays.
3. After it, that paragraph's text matches the chosen version, and every other paragraph matches the current document from before the restore, including formatting.
4. The restore adds a new version. The previous current version stays in the list. Restoring that version returns content identical to the document from before the paragraph restore.
5. Make a copy is not required, and no second file is created.
6. The preview stays read-only. The current document changes only after Restore this paragraph is confirmed.
7. The partial restore is stored on the server and appears on another server in the cluster, with the named version still named.

## Success looks like

- The rota has Monday's "North bed: 6am" and Sam's Thursday line.
- "South bed: 7am" is unchanged, including its bold. Sam's Tuesday version is still in the history and can be restored whole. Restoring it returns the document from before the paragraph restore.

## Gaps and notes

- Sheets and slides still restore the whole file. This story is documents, where the compare is already paragraphs. A cell or a slide object is a later story.
- Storyboard 28's whole-file restore, names, and Make a copy stay available. Restore this paragraph is an extra control on a changed paragraph in the compare with the current version. "Changes in this version" stays a read-only look at that version alone.
- A paragraph that was added later can be restored too: the note says it is removed, because Monday did not have it. A paragraph that matches the current text has no button, even when its bold differs. The compare page draws unchanged blocks from the older version, so South bed looks plain there and bold again in the editor.
- The partial restore is stored under the name "Restored the north-bed paragraph", so "Named versions only" includes it.
- On the club's other server the names and the mixed document arrive, and the original times do not. Every version there is stamped with the sync time. That is how version rows replicate today; this story does not change it.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. In the compare view, each changed paragraph offers Restore this paragraph. Paragraphs that match the current document do not. | Met | Video 9s: a card under North bed and under Thursday, none under South bed. `tests/doc-paragraph-restore.test.ts` |
| 2. From the editor, restoring one paragraph takes at most 3 clicks, and the confirmation names that paragraph and says the rest of the document stays. | Met | Video 11s: clock, Agreed rota, and the note `Restore the north-bed paragraph from "Agreed rota"? It becomes "North bed: 6am". The rest of the document stays as it is.` The click on Restore this paragraph is the confirmation. |
| 3. After it, that paragraph matches the chosen version, and every other paragraph matches the current document, including formatting. | Met | Video 16s: "North bed: 6am", bold "South bed: 7am", and the Thursday line. Browser test `restoring one paragraph keeps the rest of a local document` |
| 4. The restore adds a new version. The previous current version stays. Restoring it returns the document from before the paragraph restore. | Met | Video 18s: "Restored the north-bed paragraph", "Yesterday 21:14 · Sam Okafor", and "Agreed rota". The scene asserts Sam's saved bytes are unchanged. The browser test restores that version and gets 8am, the Thursday line, and the bold back. |
| 5. Make a copy is not required, and no second file is created. | Met | Video 21s: Garden club still lists only "Watering rota.sldoc". The scene asserts the folder has that one file. |
| 6. The preview stays read-only. The current document changes only after Restore this paragraph is confirmed. | Met | Video 9s: typing does not land. The document still says 8am until the button. Browser test focuses the button and types into the preview first. |
| 7. The partial restore is stored on the server and appears on another server, with the named version still named. | Met | Video 22s: 6am, the Thursday line, "Agreed rota", and "Restored the north-bed paragraph" on the other server. |
