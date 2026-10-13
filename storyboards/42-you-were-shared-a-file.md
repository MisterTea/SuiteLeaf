# 42 · Hear that a file was shared, and keep a copy

**Mode:** cluster · **App:** Files · **Video:** [videos/42-you-were-shared-a-file.mp4](videos/42-you-were-shared-a-file.mp4) · **Script:** [scenes/42-you-were-shared-a-file.spec.ts](scenes/42-you-were-shared-a-file.spec.ts)

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

1. **Sam is elsewhere.** Sam is signed in, looking at My Drive. He has not opened Shared with me.
2. **Rosa shares.** Rosa opens Share on "Watering rota", picks Sam as Editor, and clicks Share. The dialog still says "Sam can now edit". Nothing asks her to send email.
3. **Sam's notice.** Within a few seconds a notice appears on Sam's screen: "Rosa Diaz shared “Watering rota” with you · Can edit", with **Open** and Dismiss. He did not reload.
4. **Open from the notice.** Open takes him straight into the rota. Dismiss, on a second share of "Plot assignments" as Viewer, clears that notice and leaves the sheet in Shared with me.
5. **Keep a copy.** In Shared with me, "Plot assignments.slsheet" shows "Rosa Diaz · Can view" and **Keep a copy**. One click adds "Plot assignments.slsheet" to the top of My Drive. Shared with me still lists Rosa's file.
6. **The copy is his.** Sam opens his copy, changes B2 to "Sam's notes", and it saves. He is Owner of that file. Rosa's original still has her B2.
7. **Access removed.** Rosa removes Sam from the rota and from the plot sheet. Both disappear from Shared with me. "Plot assignments.slsheet" remains in My Drive with his edit. The rota, which he did not copy, is gone from his lists, and opening it by its old address is refused.

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

- `share()` writes a `drive_acl` row. The only notice is the sharer's line in the dialog ("Sam can now edit"). There is no table or event for the recipient.
- Shared with me already refreshes every 2 seconds and shows `ownerName` and the role. Rows have rename and trash for owners and editors, and no Keep a copy.
- A copy has to be a new `drive_item` whose `ownerId` is Sam. Today the original's owner stays the creator, and there is no duplicate action in the drive browser.
- Storyboard 27's sharing, roles, and Shared with me list stay as they are. This story adds the notice and the owned copy.
