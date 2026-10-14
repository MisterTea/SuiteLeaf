# 29 · Get a deleted file back

**Mode:** single-node · **App:** Files · **Video:** [videos/29-get-a-deleted-file-back.mp4](videos/29-get-a-deleted-file-back.mp4) · **Script:** [scenes/docs.spec.ts](scenes/docs.spec.ts)

## Who and why

Maya is cleaning up the garden club's files. She throws away the October newsletter, then realizes November still quotes it. In Google Drive, Trash sits in a side list, an Undo banner disappears after a few seconds, and anything left in Trash is deleted after 30 days whether she meant that or not. She wants the newsletter back, and she wants it to stay deleted only when she says so.

## Inspired by

- Storyboard [02](02-find-and-organize-files.md): clearing a file used to be permanent, and the confirmation was the browser's own dialog, which the recording never showed.
- [Delete or restore files in Google Drive](https://support.google.com/drive/answer/2375102): Trash is a separate place, restore is possible, and files are removed automatically after 30 days.
- [r/googleworkspace: how to organize Drive without a giant folder maze](https://www.reddit.com/r/googleworkspace/comments/1tcbtc4/how_to_organize_google_drive_without_creating_a/): people lose track of where a file went. A file that vanished should be one click away, not gone.

## Scenes

1. **The newsletter is in the library.** Maya creates "Garden club newsletter" and returns to the home screen. It is listed under Your files.
2. **Move it to Trash.** She clicks the trash icon on that row. There is no browser dialog. The newsletter leaves Your files. A banner stays on the page: the newsletter is in Trash, with **Undo**. The banner does not vanish on its own.
3. **Undo.** She clicks **Undo**. The newsletter is back under Your files, and the banner is gone.
4. **Trash in the sidebar.** She moves it to Trash again. **Trash** in the sidebar lists "Garden club newsletter". Your files does not.
5. **Restore.** She clicks **Restore**. Trash is empty. All files shows the newsletter again.
6. **Delete forever, on purpose.** She moves it to Trash once more, opens Trash, and clicks **Delete forever**. A dialog in the page names the file and offers **Cancel** and **Delete forever**. She confirms. The newsletter is gone from Trash and from the library.

## Success looks like

- The trash icon moves a file out of Your files without a browser confirm.
- Undo brings that file back, and the banner stays until she uses it or dismisses it.
- Trash in the sidebar lists what she moved, and Restore puts a file back on the main list.
- Delete forever is a second step, in a dialog the page draws, and only then is the file removed from this browser.
- Nothing is purged on a timer.

## Better than Google Drive

- The first click is reversible, with no confirm standing in the way.
- Undo stays on the page. Google's banner disappears on a timer.
- Files stay in Trash until she chooses Delete forever. Google removes them after 30 days.
- The last step names the file in the app's own dialog.

## Gaps and notes

- Recorded. The trash icon moves "Garden club newsletter" out of Your files with no browser dialog. The banner "Garden club newsletter is in Trash." (Undo and Dismiss) is still on screen a few seconds later. Undo puts the file back and the banner goes away.
- Trash in the sidebar matches the other sidebar buttons. It lists the newsletter, with Restore and Delete forever. Your files does not. Searching "newsletter" on Your files finds nothing while the file is in Trash; that shot is brief.
- Delete forever is a dialog the page draws: dimmed background, white card titled "Delete forever", the file name in the sentence, Cancel, and a red Delete forever button. Cancel leaves it in Trash. Confirming removes it from Trash and from the library, and "A workspace waiting for you" returns.
- Nothing is removed on a timer.
- While this is the only file, Your files shows that empty heading under the banner. The file stays in Trash on this browser until Delete forever.
- Opening a trashed file at its address still loads it, with a short note and Restore. This recording stays on the home screen.
- SuiteDrive can mark a file trashed, and there is still no Trash screen for the server. This storyboard is the library on this computer.
