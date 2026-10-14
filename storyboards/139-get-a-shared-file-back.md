# 139 · Get a shared file back

**Mode:** cluster · **App:** Files · **Video:** [videos/139-get-a-shared-file-back.mp4](videos/139-get-a-shared-file-back.mp4) · **Script:** [scenes/139-get-a-shared-file-back.spec.ts](scenes/139-get-a-shared-file-back.spec.ts)

## Who and why

Rosa is cleaning up the garden club folder on the team's server. She throws away the watering rota, then remembers Thursday's shift is only written there. On this computer, Trash can bring a file back (storyboard 40). On SuiteDrive, Move to trash asks first and then the file is gone. In Google Drive the file would sit in Trash, but the Undo banner disappears in a few seconds, and after 30 days the file is deleted whether she meant that or not. Restore also sometimes forgets which folder the file came from.

## Inspired by

- Storyboard [23](23-start-a-document-in-suitedrive.md): Move to trash has no Trash view and no Undo, so the app still asks before trashing.
- Storyboard [40](40-trash-star-and-restore.md): the library on this computer already has Trash, Undo, and Restore.
- [Delete or restore files in Google Drive](https://support.google.com/drive/answer/2375102): Trash is a separate place, and files are removed after 30 days.
- [r/gsuite: Is Google Drive sync conflict resolution really this bad?](https://www.reddit.com/r/gsuite/comments/1rqlwk8/is_google_drive_sync_conflict_resolution_really/): people lose a file and cannot see where it went.

## Scenes

1. **The folder.** Rosa is signed in. SuiteDrive is open on the Garden club folder, which contains "Watering rota".
2. **Move it.** She clicks the trash icon. There is no dialog. The rota leaves the folder. A banner stays on the page: Watering rota is in Trash, with **Undo**. It does not vanish on its own.
3. **Undo.** She clicks **Undo**. The rota is back in Garden club, and the banner is gone.
4. **Trash.** She moves it again. **Trash** in the SuiteDrive sidebar lists "Watering rota" and says it was in Garden club. The folder does not list it.
5. **Restore.** She clicks **Restore**. Trash is empty. Garden club shows the rota again, not the top of My Drive.
6. **Delete forever.** She moves it to Trash once more and clicks **Delete forever**. A dialog names "Watering rota" and offers **Cancel** and **Delete forever**. She confirms. The rota is gone from Trash and from Garden club.

## Success looks like

- The first click moves the file and can be undone from a banner that stays.
- Trash lists it and names the folder it came from.
- Restore puts it back in that folder.
- Delete forever is a second step, in the app's own dialog, and only then is the file removed.
- Nothing is purged on a timer.

## Better than Google Drive

- Undo stays until she uses it or dismisses it. Google's banner disappears on a timer.
- Restore returns the file to Garden club. She does not have to hunt for it at the top of My Drive.
- The file stays in Trash until she chooses Delete forever. Google removes it after 30 days.

## Gaps and notes

- Recorded. Rosa signs in, opens Garden club, and moves Watering rota with one click. No browser dialog. The banner names the file and Trash, with Undo and Dismiss, and it is still there after about 3 seconds. Undo puts the file back in Garden club. Trash lists Watering rota and Garden club. Restore returns it there, not to the top of My Drive. Delete forever names the file; Cancel leaves it; confirming removes it from Trash and from Garden club.
- Nothing on the server deletes a trashed file because of its age. The library on this computer still does, after 30 days (storyboard 40). This story is SuiteDrive only.
- Trash lists items the signed-in person owns. Someone with edit access can move a file they do not own, and the owner is who sees it in Trash.
- Delete forever on a folder that still has something in it is refused, so those files are not left with a missing parent. Restore the folder and move them first. The recording is a file, not a folder.
