# 40 · Trash, star, and restore files

**Mode:** single-node · **App:** Files · **Video:** [videos/40-trash-star-and-restore.mp4](videos/40-trash-star-and-restore.mp4) · **Script:** [scenes/40-trash-star-and-restore.spec.ts](scenes/40-trash-star-and-restore.spec.ts)

## Who and why

Grace keeps the family's paperwork in SuiteLeaf on her laptop: a "Grandkids' birthdays" spreadsheet, recipe documents, and last year's holiday slideshow. Tidying up one evening, she deletes the birthdays sheet by mistake. She wants it back, exactly as it was. She'd also like the three files she opens every week at the top of the list instead of scrolling for them.

## Inspired by

- WF-A4-07 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): delete to trash and delete permanently ("remove is a plain delete (no trash/restore in v1 spec) → partial").
- Storyboard [02](02-find-and-organize-files.md): finding and organizing files on Home.
- [Google Drive Help: Recover a deleted file](https://support.google.com/drive/answer/1716222): Trash on the left, right-click › Restore. "Files remain in Trash for 30 days, then they're deleted forever."
- [Google Drive Help: Find lost files](https://support.google.com/drive/answer/15701190): files whose folder disappears become "unorganized" and need an `is:unorganized` search.
- [Google Workspace Admin Help: Recover deleted files](https://support.google.com/a/answer/6052340): after Trash is emptied, only an admin can restore, by date range, within 25 days.
- [r/googledocs: "File is gone? Never deleted, not in trash"](https://www.reddit.com/r/googledocs/comments/1vbo3u2/file_is_gone_never_deleted_not_in_trash/): years of writing that seemed to vanish, and the panic that follows.
- [Alice Keeler: Star your documents](https://alicekeeler.com/2017/10/19/google-drive-star-documents/): "I have too much starred stuff to make this filter useful", and the `is:starred` search.

## Scenes

1. **Home.** Grace opens SuiteLeaf. The sidebar lists All files, Starred, Documents, Spreadsheets, Presentations, and Trash.
2. **Delete by mistake.** She clicks the bin on "Grandkids' birthdays". It disappears from the list right away, with no browser pop-up. A notice at the bottom reads "Moved "Grandkids' birthdays" to Trash · Undo".
3. **Undo.** She clicks Undo. The sheet is back in the same place with the same "Last edited" date.
4. **Delete, then find it later.** She deletes an old recipe on purpose and lets the notice disappear. A week later she wants it after all, opens **Trash**, and sees it with "Deleted 7 days ago · deleted forever in 23 days".
5. **Restore.** She clicks **Restore** on the recipe. It returns to All files and opens with its content, title, and star unchanged.
6. **Search finds trashed files.** She types "lasagne" in "Search your files". The recipe she'd binned shows up under "In Trash", with Restore beside it.
7. **Empty the trash.** In Trash she clicks **Empty trash**. An in-app dialog says "Delete 3 files forever? This can't be undone," and she confirms.
8. **Star favourites.** She clicks the star on the rows for "Weekly shopping", "Grandkids' birthdays", and "Medication times". In an open document, the star next to the title shows filled.
9. **Starred view.** **Starred** in the sidebar lists the three, most recently edited first. After closing the browser (or quitting the desktop app) and reopening, they're still starred.

## Google Workspace benchmark

In Google Drive, deleting is 2 clicks (right-click › Move to trash) or the Delete key, followed by a short-lived "Undo" notice (1 click). Restoring later takes 3 clicks: Trash (1), right-click the file (1), Restore (1). Starring is 1 click in the editor or 2 in Drive (right-click › Add to starred), and the Starred view is 1 click ([Drive Help](https://support.google.com/drive/answer/1716222)).

Known pain points:

- The Undo notice disappears after a few seconds.
- Once Trash is emptied, or after 30 days, recovery needs an admin and restores everything in a date range, not one file ([Admin Help](https://support.google.com/a/answer/6052340)).
- Files can seem to vanish without being in Trash ("unorganized" files), and search doesn't make it obvious where they went ([Find lost files](https://support.google.com/drive/answer/15701190), [r/googledocs](https://www.reddit.com/r/googledocs/comments/1vbo3u2/file_is_gone_never_deleted_not_in_trash/)).
- Starred becomes too crowded to be useful without search operators ([Alice Keeler](https://alicekeeler.com/2017/10/19/google-drive-star-documents/)).

## Better than Google Workspace when

1. Deleting a file from Home takes 1 click, moves it to Trash without a browser pop-up, and shows a notice with Undo that stays for at least 8 seconds or until dismissed. Undo restores the file in 1 click.
2. Trash is 1 click from the sidebar. It shows each file's deletion date and the days left before permanent deletion, and restoring a file takes 1 click there (2 from Home).
3. A restored file is identical to the one deleted: same content, title, last-edited date, and starred state (the native file is byte for byte the same).
4. Files stay in Trash for 30 days. They're only removed sooner by "Delete forever" or "Empty trash", each confirmed in an in-app dialog that names how many files will go.
5. "Search your files" also finds files in Trash, labelled "In Trash" with Restore beside them.
6. The star on Home rows and in the editor toggles in 1 click, is saved, and survives reloading the browser and restarting the desktop app. Starred is 1 click from the sidebar and sorted by last edited.
7. In the desktop app, the bin and Trash say what happens to the file on disk, and no file on disk is deleted without an explicit confirmation that names it.

## Success looks like

- "Grandkids' birthdays" is back, unchanged, and starred along with two other weekly files.
- The recipe was found in Trash a week later and restored, and emptying Trash asked first.

## Gaps and notes

- **Deleting is permanent and uses a browser pop-up.** The bin on a Home row ("Remove from library") calls `window.confirm("Delete this file from this browser?")` and then `storage.remove`, which deletes the record. There's no Trash, no Undo, and no recovery.
- In the desktop app the same button removes the library entry and its recovery draft, and the confirmation says the file stays on disk.
- **The star isn't saved.** The editor's Star button toggles React state (`useState(false)`) and resets every time a file is opened. Home rows have no star, and the sidebar has no Starred or Trash view (only All files, Documents, Spreadsheets, and Presentations).
- Neither the library (`browser-library.ts`) nor the file records have a trashed, deleted-at, or starred field.
- **Cluster mode has half a trash.** SuiteDrive's "Move to trash" sets `trashed: true` (`PATCH /api/drive/items/{id}`), and listing hides trashed items. But nothing lists the trash (no `?trashed=1`), the UI can't restore, and there's no permanent delete. A restore would be `PATCH` with `trashed: false`. The same criteria should apply there in a later storyboard.
