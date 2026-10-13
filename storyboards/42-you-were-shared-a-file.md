# 42 · Hear that a file was shared, and keep a copy

**Mode:** cluster · **App:** Files · **Video:** [videos/42-notice-when-a-file-is-shared.mp4](videos/42-notice-when-a-file-is-shared.mp4) · **Script:** [scenes/42-notice-when-a-file-is-shared.spec.ts](scenes/42-notice-when-a-file-is-shared.spec.ts)

## Who and why

Rosa shares the "Watering rota" with Sam, as she did in storyboard 27. Sam is already signed in on the club's server, in My Drive, and he will not think to open Shared with me. He wants a notice in the app, and he wants a copy in his own drive that is still there if Rosa later removes him. The club has no email server, and SuiteLeaf should not need one.

## Inspired by

- WF-A4-08 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): the person a file is shared with can open it.
- Storyboard [27](27-share-a-document-with-a-teammate.md): Shared with me already lists the file, the owner, and the role, and updates without a reload.
- [Share files from Google Drive](https://support.google.com/drive/answer/2494822): sharing sends each address an email unless "Notify people" is unchecked.
- [Tips to share your files](https://support.google.com/a/users/answer/13004062): browser notifications are a second setting, on top of email.
- [Add a shortcut to a file](https://support.google.com/drive/answer/2375057) and [r/google: "Add to My Drive" became "Add shortcut"](https://www.reddit.com/r/google/comments/ftrwbg/google_drive_add_to_my_drive_changed_to_add/): a shortcut disappears when access to the original is removed.
- [r/gsuite: files in "Shared with me" not showing](https://www.reddit.com/r/gsuite/comments/1g5oc9a/files_in_shared_with_me_not_showing_in_google/): people lose files that only live in that list.

## Scenes

1. **Sam is elsewhere.** Sam is signed in, looking at My Drive. The folder is empty. He has not opened Shared with me.
2. **Rosa shares.** Rosa opens Share on "Watering rota", picks Sam as Editor, and clicks Share. The dialog still says "Sam can now edit". There is no "Notify people" checkbox and nothing asks her to send email.
3. **Sam's notice.** Sam signs back in on My Drive. Within a few seconds, without a reload: "Rosa Diaz shared “Watering rota” with you · Can edit", with **Open** and Dismiss.
4. **Open from the notice.** Open takes him straight into the rota. Back on My Drive, a second notice appears for "Plot assignments" as Viewer. Dismiss clears it. Shared with me still lists the sheet, "Rosa Diaz · Can view".
5. **Keep a copy.** **Keep a copy** on "Plot assignments.slsheet" says the copy is his. Shared with me still lists Rosa's file. My Drive shows "Plot assignments.slsheet" at the top.
6. **The copy is his.** Sam opens his copy, changes B2 from "Water Monday" to "Sam's notes", and it saves. Share on that file says "Sam Okafor (you)" and Owner. Rosa's original still has "Water Monday".
7. **Access removed.** Rosa removes Sam from both files. While he is looking at Shared with me, both disappear, without a reload. Opening the rota by the address he used earlier says "You no longer have access to this file." His copy remains in My Drive.

## Google Workspace benchmark

Sharing with a notice is the default email: Share, pick a person, leave "Notify people" checked, Send. Unchecking it means the recipient is told nothing ([Drive Help](https://support.google.com/drive/answer/2494822)). Finding the file is then Shared with me. Keeping it is "Add shortcut to Drive", which is a pointer, not a copy ([Drive Help](https://support.google.com/drive/answer/2375057)). A real copy is File › Make a copy, and the copy's sharing starts over.

Known pain points:

- The email is easy to miss, and turning it off leaves the person unwarned.
- "Add to My Drive" became a shortcut, so tidying Shared with me does not keep the file ([r/google](https://www.reddit.com/r/google/comments/ftrwbg/google_drive_add_to_my_drive_changed_to_add/)).
- When the owner removes access, the shortcut breaks and the work done only in the original is gone ([r/gsuite](https://www.reddit.com/r/gsuite/comments/1g5oc9a/files_in_shared_with_me_not_showing_in_google/)).

## Better than Google Workspace when

1. After a file is shared, the recipient sees an in-app notice within 5 seconds, without reloading, naming the file, the sharer, and the role. No email is sent, and the server has no mail step.
2. Open on that notice opens the file in 1 click. Dismissing the notice leaves the file in Shared with me.
3. Shared with me offers Keep a copy. One click puts a new file in My Drive with the same bytes and the same name.
4. The recipient is Owner of the copy and can edit it when their role on the original is Viewer.
5. The original stays in Shared with me with the same role until access is removed.
6. Removing access drops the original from Shared with me and refuses it. The copy in My Drive remains, including edits made only there.
7. The sharer's Share dialog is unchanged: still no "Notify people" checkbox and no request to send mail.

## Success looks like

- Sam saw both shares without leaving the app and without email.
- His copy of the plot sheet is in My Drive with his note, after Rosa removed his access. The rota is not.

## Gaps and notes

- Sharing with an organization does not notify each member. A notice needs one recipient, and an organization grant has none until membership is expanded.
- The recording removes Sam's access through the drive API while he watches Shared with me update. Rosa's Remove access control is the one from storyboard 27; this video does not click it.
- Rosa's original B2 is checked in the test (`Water Monday` remains, `Sam's notes` does not). The video shows Sam's cell, not hers.
- Sign out still deletes this computer's cached SuiteDrive files. The refused address is the file he opened in this session, before that cache is cleared.
- There is no email and no browser notification permission. The notice is in the app, on purpose.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. In-app notice within 5 seconds, naming the file, sharer, and role. No email and no mail step. | Met | Video 0:08 share dialog has no Notify checkbox; 0:14 "Rosa Diaz shared “Watering rota” with you · Can edit". `sharing_notifies_in_the_app_and_keep_copy_is_owned`. Browser test waits at most 5 seconds and records no mail request. |
| 2. Open is one click. Dismiss leaves the file in Shared with me. | Met | Video 0:16 Open opens the rota. 0:22 Dismiss, then Shared with me still lists the plot sheet. |
| 3. Keep a copy, one click, same name and bytes in My Drive. | Met | Video 0:26 the button, 0:28 "Plot assignments.slsheet" in My Drive. Rust test compares the bytes. |
| 4. He is Owner of the copy and can edit it while Viewer on the original. | Met | Video 0:35 B2 is "Sam's notes" and Saved; 0:36 Share says Owner. Rust test: viewer cannot create in Rosa's folder, and the copy's role is Owner. |
| 5. The original stays in Shared with me with the same role until access is removed. | Met | Video 0:26 "Rosa Diaz · Can view" after the copy. Browser test: Rosa's body still contains "Water Monday" and not "Sam's notes". |
| 6. Removing access drops the original, refuses the old address, and keeps the copy. | Met | Video 0:43 Shared with me is empty; 0:45 "You no longer have access to this file."; 0:48 the copy is in My Drive. API status 403 in the scene. |
| 7. Share dialog has no "Notify people" checkbox and does not ask to send mail. | Met | Video 0:10 "Sam can now edit" and no checkbox. Browser test expects no Notify text, no checkbox, and no Send button. |
