# 28 · Restore an earlier version

**Mode:** cluster · **App:** Docs · **Video:** [videos/28-restore-an-earlier-version.mp4](videos/28-restore-an-earlier-version.mp4) · **Script:** [scenes/28-restore-an-earlier-version.spec.ts](scenes/28-restore-an-earlier-version.spec.ts)

## Who and why

On Tuesday morning Sam rewrote the "Watering rota" for a new schedule the committee hadn't agreed. Rosa wants Monday evening's version back, but she also wants to see what Sam changed first, and she doesn't want to lose his work in case the committee changes its mind.

## Inspired by

- WF-A4-19 and WF-A2-11 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): open the history, see past revisions, restore one, and revert to an earlier version.
- [Docs Editors Help: Find what's changed in a file](https://support.google.com/docs/answer/190843): Last edit or File › Version history, pick a version, Restore this version. Versions "may occasionally be merged", and you need edit access to see history.
- [Zapier: How to use Google Docs version history](https://zapier.com/blog/google-docs-revision-history/): history "shows changes made only between the selected version and its previous version". To compare with anything else, make a copy and run Tools › Compare documents.
- [Workspace Updates: Compare Documents](https://workspaceupdates.googleblog.com/2019/06/compare-docs.html): the comparison is produced as a third document full of suggestions.
- [r/googledocs: "I accidentally hit restore this version two times"](https://www.reddit.com/r/googledocs/comments/1pbmbh1/help_me_fix_my_grade/): restore is easy to click by mistake and hard to understand afterwards.
- [Live2Tech: restore a version in Google Sheets](https://www.live2tech.com/how-to-restore-a-version-from-version-history-in-google-sheets/): to get back part of a file you open the old version, make a copy, then copy and paste.

## Scenes

1. **Open the rota.** Rosa signs in and opens "Watering rota" in Garden club. The page is Sam's rewrite. The header shows a clock labelled "Version history".
2. **Open the history.** File › Version history shows the shortcut Cmd+Alt+Shift+H. She clicks the clock. A panel opens on the right: "Current version", "Today 09:14 · Sam Okafor", and "Yesterday 18:02 · Rosa Diaz". Sam's 09:10 and 09:06 autosaves are folded under an arrow on the 09:14 entry.
3. **Preview with changes.** She clicks yesterday. The page is read-only. Compared with the current version, Sam's additions are underlined in green and his deletions struck through in red. The note says 4 paragraphs change. "Changes in this version" shows Monday's text on its own, because nothing is earlier.
4. **Name it.** From the version's ⋯ menu she chooses "Name this version" and types "Agreed rota". "Named versions only" leaves just that entry. After a reload the name is still there.
5. **Restore.** From the editor that is three clicks: the clock, "Agreed rota", and **Restore this version**. The note already says `Restore "Agreed rota"? 4 paragraphs change. The current version stays in history.`
6. **Back to editing.** The panel closes, the page is Monday's rota, and the status reads "Saved to SuiteDrive". Opening the history again, the top entry is `Restored "Agreed rota" · Rosa Diaz`. Yesterday's named version and Sam's 09:14 entry are still in the list.
7. **Keep Sam's draft.** She opens Sam's 09:14 version and chooses "Make a copy". In Garden club, next to the rota, is "Watering rota (Sam's draft, 12 Oct 09:14).sldoc". The date is the version's local date, so a recording on another day uses that day.
8. **Change her mind.** Restoring the 09:14 version puts Sam's text back. The saved file is the same bytes as his 09:14 upload.
9. **Another server.** Rosa signs in on the club's other server, opens the rota, and "Agreed rota" is still the name.

On a single-node computer the same button shows snapshots kept with the file in this browser: one when the file is saved, and another every few minutes of editing, each signed "You". Naming, preview, compare, and restore work the same way.

## Google Workspace benchmark

In Google Docs a restore takes 6 clicks: File › Version history › See version history (3), the version (1), **Restore this version** (1), and **Restore** in the confirmation (1). Cmd/Ctrl+Alt+Shift+H, or clicking "Last edit", replaces the first three clicks with one. Naming a version takes another 3 clicks.

Known pain points:

- The preview highlights changes against the *previous* version only. Comparing an old version with the current one means Make a copy, then Tools › Compare documents, which creates a third document ([Zapier](https://zapier.com/blog/google-docs-revision-history/), [Workspace Updates](https://workspaceupdates.googleblog.com/2019/06/compare-docs.html)).
- Old revisions are merged, so small edits disappear from the list ([Docs Help](https://support.google.com/docs/answer/190843)).
- Viewers and commenters can't see history at all ([Docs Help](https://support.google.com/docs/answer/190843)).
- Restore replaces the whole file. Recovering one paragraph or one range means making a copy and pasting ([Live2Tech](https://www.live2tech.com/how-to-restore-a-version-from-version-history-in-google-sheets/)).
- Restoring is easy to do by accident, and what happened afterwards is hard to read ([r/googledocs](https://www.reddit.com/r/googledocs/comments/1pbmbh1/help_me_fix_my_grade/)).

## Better than Google Workspace when

1. Version history opens in 1 click from the editor (the clock button) and is also in File › Version history with the shortcut Cmd/Ctrl+Alt+Shift+H shown.
2. Every entry shows the author's display name, not an ID, and a local date and time. Consecutive autosaves by one person within 10 minutes collapse into one expandable entry.
3. Selecting any version can show its differences from the **current** version, with insertions and deletions marked, without creating a copy or another file.
4. Restoring takes at most 3 clicks from the editor (clock, version, Restore and confirm), and the confirmation says how much will change.
5. Restoring adds a new version. Restoring the version from just before the restore gives back content identical to the original, byte for byte in the saved file.
6. A version name is saved on the server, survives a reload and a sign-in on another server in the cluster, and "Named versions only" filters the list to it.
7. The preview is read-only: typing or pasting while previewing changes nothing in the current document.
8. "Make a copy" of a version creates a new file in the same folder in at most 2 clicks, named after the original with the version's date.

## Success looks like

- The rota is Sam's text again, because Rosa restored 09:14 after trying Monday.
- Garden club also has "Watering rota (Sam's draft, 12 Oct 09:14).sldoc".
- The history still lists "Agreed rota", Sam's morning autosaves, and both restores.

## AI version

**Video:** [web](videos/28-restore-an-earlier-version-ai.mp4) · **Script:** [scenes/ai/28-restore-an-earlier-version-ai.spec.ts](scenes/ai/28-restore-an-earlier-version-ai.spec.ts)

Web only: this is a cluster storyboard. Rosa signs in herself; the assistant never types a password. Sam's morning versions are already on the server, the same way the original scene uploads them. The watering rota is open on Sam's rewrite. Rosa asks the on-device assistant (FrogNano 4B) once:

"Sam rewrote this watering rota this morning. Restore Rosa Diaz's version from yesterday evening, 18:02, so the document is the agreed rota again. Keep Sam's rewrite in the history."

The assistant calls `list_versions`, then `restore_version` with Rosa's version. The page becomes Monday evening's rota (Rosa on Monday, Priya on Wednesday, no Friday seed-library line) and the status reads "Saved to SuiteDrive". Sam's 09:14 rewrite stays in the version history. The test checks the document text and the saved file against that rota, and that Sam's four lines are still in a saved version or a copy. It does not require the green-and-red preview, the folded autosaves, or the keyboard shortcut.

## Gaps and notes

- Restoring replaces the whole file. Taking one paragraph from an old version is still "Make a copy", then copy that paragraph.
- Sheets and slides use the same panel to name, copy, and restore, without the green-and-red page compare. That compare is for documents.
- The server still stores every autosave. The panel folds a person's saves from the same ten minutes into one row; expanding a long afternoon is still a long list.
- On this computer, snapshots live in the browser next to the file, not inside the downloaded `.sldoc`. Carrying the file to another computer does not carry that history. SuiteDrive history does travel, because the version rows replicate.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. History opens in one click from the clock, and File › Version history shows Cmd/Ctrl+Alt+Shift+H | Met | Video 8s (menu and shortcut), 11s (clock). Test `28-restore-an-earlier-version` |
| 2. Display name and local time; one person's autosaves within 10 minutes collapse | Met | Video 13s: Sam Okafor, Rosa Diaz, 09:14 with 09:10 and 09:06 underneath. `groupVersions` in `tests/version-history-model.test.ts` |
| 3. Any version can be compared with the current one, additions and deletions marked, no extra file | Met | Video 15s: green underline, red strikethrough, "4 paragraphs change". `tests/doc-diff.test.ts` |
| 4. Restore is at most 3 clicks, and the confirmation says how much changes | Met | Video 15s and 24s: clock, version, Restore this version, with the paragraph count already on screen |
| 5. Restore adds a version; restoring the previous head returns the original bytes | Met | Video 27s Monday's text, 36s Sam's text back. The scene asserts the saved bytes equal the uploaded version |
| 6. A name is kept on the server, after reload, and on another server; the named filter shows it | Met | Video 22s reload, 33s filter, 43s the other server. Rust test `naming_restore_and_copy_keep_every_version_byte_for_byte` |
| 7. The preview is read-only | Met | Video 18s. Browser test types into the preview and the current document is unchanged |
| 8. Make a copy is at most 2 clicks and lands in the same folder, named with the version's date | Met | Video 33s: `Watering rota (Sam's draft, 12 Oct 09:14).sldoc` in Garden club |
