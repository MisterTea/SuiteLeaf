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

1. **Home.** Grace opens SuiteLeaf. The sidebar lists All files, Starred, Documents, Spreadsheets, Presentations, and Trash. Her paperwork is already here: Lasagne, Weekly shopping, Grandkids' birthdays, Medication times, a holiday slideshow, and three old files.
2. **Star the recipe.** She clicks the star on Lasagne. It fills in one click.
3. **Delete by mistake.** She clicks the bin on Grandkids' birthdays. It leaves the list immediately, with no dialog. A notice at the bottom reads Moved “Grandkids' birthdays” to Trash, with Undo.
4. **Undo.** She clicks Undo. The sheet is back in the same place, still showing 8:47 PM.
5. **Delete, then find it later.** She deletes Lasagne on purpose and lets the notice disappear. A week later she opens Trash and sees “Deleted 7 days ago · deleted forever in 23 days”, with Restore beside it.
6. **Search finds trashed files.** From All files she types lasagne. The recipe shows up under Results for “lasagne”, labelled In Trash, with Restore beside it.
7. **Restore.** Back in Trash she clicks Restore. Lasagne returns to All files and opens with “Sunday lunch: pasta, ragu, and bechamel.”, the same title, and the star still filled.
8. **Star favourites.** She clicks the star on Weekly shopping, Grandkids' birthdays, and Medication times.
9. **Starred view.** Starred lists Medication times, Grandkids' birthdays, Weekly shopping, then Lasagne: most recently edited first. After a reload, the same four are still starred.
10. **Empty the trash.** She moves Old grocery list, 2024 holiday cards, and Expired coupons to Trash and clicks Empty trash. The dialog says “Delete 3 files forever?” and “This can't be undone.”, and names the three. She confirms, and Trash is empty.

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

- Grandkids' birthdays is back, unchanged, and starred along with Weekly shopping and Medication times.
- Lasagne was found in Trash a week later, restored with its text and star, and emptying Trash named the three old files and asked first.

## Gaps and notes

- The week-later shot sets the recipe's deletion time to seven days ago, then reloads. A file left in Trash is removed on the next visit once it is 30 days old. Nothing deletes it while the app is closed in between.
- The recording is the browser. On the desktop app the bin, the Trash note, and Delete forever say the saved file stays on disk, and removing a library entry does not delete that file. Covered by `tests/library-trash.test.ts` and `tests/store.test.ts`.
- SuiteDrive trash, restore, and delete forever are storyboard [139](139-get-a-shared-file-back.md). This story is the library on this computer, which still removes a file from Trash after 30 days.
- Search from All files, Documents, Spreadsheets, and Presentations includes Trash. There is no `is:starred` operator; Starred is the sidebar view, and the search box filters that view.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. One click to Trash, no browser dialog, Undo stays at least 8 seconds | Met | Video 0:16–0:32, notice then Undo. `tests/browser/trash-star.spec.ts` waits 8 seconds and the notice is still there. |
| 2. Trash is one sidebar click, shows days left, Restore is one click | Met | Video 0:35 “Deleted 7 days ago · deleted forever in 23 days” and Restore; 0:40 restores it. |
| 3. Restored file matches: content, title, last edited, star | Met | Video 0:43 title Lasagne, the recipe text, filled star. `tests/library-trash.test.ts`, `tests/browser-library.test.ts`. |
| 4. 30 days, and Delete forever / Empty trash name the count | Met | Video 0:57 “Delete 3 files forever?” names the three files. Expiry in `tests/library-trash.test.ts`. |
| 5. Search labels Trash and offers Restore | Met | Video 0:38 Results for “lasagne”, In Trash, Restore. |
| 6. Star is one click, saved, Starred is newest first | Met | Video 0:14, 0:45, 0:48, and 0:51 after reload. `tests/browser/trash-star.spec.ts`, `tests/store.test.ts`. |
| 7. Desktop bin and Trash say what happens on disk | Met | Not in this browser recording. `moveToTrashTitle`, `trashViewNote`, and `deleteForeverCopy` in `tests/library-trash.test.ts`; `tests/store.test.ts` checks the file is still on disk after remove. |
