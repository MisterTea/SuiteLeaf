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

1. **Open the rota.** Rosa opens "Watering rota". The header shows a clock button labelled "Version history".
2. **Open the history.** She clicks the clock (File › Version history and Cmd/Ctrl+Alt+Shift+H do the same). A panel opens on the right listing versions newest first, grouped by day: "Current version", "Today 09:14 · Sam Okafor", and "Yesterday 18:02 · Rosa Diaz". Runs of autosaves by one person are collapsed into one entry with an expand arrow.
3. **Preview with changes.** She clicks "Yesterday 18:02". The page shows that version read-only, with differences from the current version marked: Sam's additions underlined in green, his deletions struck through in red. A toggle switches between "Compare with current" and "Changes in this version".
4. **Name it.** From the version's ⋯ menu she chooses "Name this version" and types "Agreed rota". A filter, "Named versions only", now shows just that entry.
5. **Restore.** She clicks **Restore this version**. A confirmation says "Restore "Agreed rota"? 4 paragraphs change. The current version stays in history." She confirms.
6. **Back to editing.** The panel closes, the document shows Monday's text, the status reads "Saved to SuiteDrive", and a new top entry reads "Restored "Agreed rota" · Rosa Diaz".
7. **Keep Sam's draft.** In the history she opens Sam's 09:14 version and chooses "Make a copy". "Watering rota (Sam's draft, 13 Oct 09:14)" appears in the same folder.
8. **Change her mind.** Restoring the 09:14 version brings Sam's text back exactly, which shows that nothing was lost.

On a single-node computer the same button should show local snapshots kept with the file: one each time the file is saved or every few minutes of editing, all signed "You". Naming, preview, compare, and restore should work the same way.

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

- The rota shows the agreed Monday text, Sam's draft is a separate file, and the history lists the named "Agreed rota" version and the restore.
- No version was lost: every earlier entry is still in the list.

## Gaps and notes

- **The clock button does nothing.** The "Version history" button in `App.tsx` has no `onClick`, and the File menu has no Version history item.
- **The server keeps versions, but nothing shows them.** `GET /api/drive/items/{id}/versions` returns `id`, `itemId`, `contentHash`, `size`, `authorId` and `createdAt`, and `GET …/content?version=` reads any version. `node-client.ts` uses neither.
- There is no restore endpoint. A client can restore by reading an old version and writing it back as a new one with `If-Match`.
- Versions have no name field, and authors are user IDs with no endpoint that turns them into names.
- **Every autosave is a version.** The editor saves 500 ms after typing stops and every upload adds a `drive_version` row with no pruning or grouping, so a busy afternoon produces hundreds of entries. Grouping (criterion 2) is needed before the list is usable.
- **Single-node has no history.** The browser library stores one record per file plus a recovery draft, and the desktop app saves over the file on disk.
- There is no diff view for documents. A compare view would need a document-level diff of the Tiptap JSON (`packages/core`).
