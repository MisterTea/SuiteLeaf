# 51 · Hand over a file, and let a share expire

**Mode:** cluster · **App:** Docs · **Video:** [videos/51-transfer-ownership-and-expire-a-share.mp4](videos/51-transfer-ownership-and-expire-a-share.mp4) · **Script:** [scenes/51-transfer-ownership-and-expire-a-share.spec.ts](scenes/51-transfer-ownership-and-expire-a-share.spec.ts)

## Who and why

Rosa is leaving the garden club committee. Sam should own the "Watering rota", and he should not have to accept an email before that is true. Priya is helping through Friday and should lose access on Saturday without Rosa remembering to remove her. The club still has no email server.

## Inspired by

- WF-A2-11 and WF-A4-25 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): change ownership so the new owner has the owner's permissions.
- Storyboard [27](27-share-a-document-with-a-teammate.md): the owner shares Viewer, Commenter, or Editor. The owner row is fixed, and a role change is immediate.
- [Make someone else the owner of your file](https://support.google.com/drive/answer/2494892): Transfer ownership emails the person, and you stay the owner until they accept.
- [Stop, limit, or change sharing](https://support.google.com/drive/answer/2494893): Add expiration, pick a date within one year, then Save.
- [Share files from Google Drive](https://support.google.com/drive/answer/2494822): expiration dates are limited to eligible work or school accounts.

## Scenes

1. **Today's access.** Rosa opens Share on "Watering rota". The list is Rosa Diaz, Owner; Sam Okafor, Editor; Priya Shah, Commenter.
2. **Until Saturday.** From Priya's role menu Rosa chooses **Access expires** and picks Saturday. The row reads "Commenter · until Saturday". There is no Save button.
3. **Hand it to Sam.** From Sam's role menu she chooses **Make owner**. A line asks "Make Sam Okafor the owner? You will become an editor." She confirms. Sam's row says Owner, Rosa's says Editor, and Priya's row still says "Commenter · until Saturday". There is no acceptance step and no email.
4. **Sam can share.** Sam opens the rota. Share lets him change roles, and Priya's date is still there. Rosa's Share dialog says she can edit, and it does not offer Make owner.
5. **Before the date.** On Friday, Priya opens the rota and can comment. She cannot edit the text.
6. **After the date.** The recording moves the clock to Saturday. Priya's Shared with me no longer lists the rota. Opening it is refused. Sam's Share list no longer offers her a role; the row says access ended Saturday, with **Remove**.
7. **Another server.** Sam signs in on the club's other server. He is Owner. Priya's expiry is the same date. Rosa is Editor and can still edit the rota.

## Google Workspace benchmark

Transfer ownership is Share, the person's role menu, Transfer ownership, and Yes: 4 clicks, then an email the person must accept. Until they accept, you remain the owner ([Drive Help](https://support.google.com/drive/answer/2494892)). An expiration is Share, the role menu, Add expiration, a date, and Save: 4 clicks plus the date. The date has to fall within a year, and the control exists for eligible work or school accounts ([Drive Help](https://support.google.com/drive/answer/2494893), [Share files](https://support.google.com/drive/answer/2494822)).

Known pain points:

- The transfer sits pending until someone reads the email. If they decline, or the accounts are the wrong kind, you are still the owner and may not notice.
- Personal accounts have no expiration, so a temporary share becomes a share you must remember to undo.
- Expiration needs its own Save, separate from the role change.

## Better than Google Workspace when

1. With the Share dialog open, the owner makes another person the owner in at most 3 clicks (the role menu, Make owner, confirm). The new owner is Owner immediately. No email is sent and nobody has to accept.
2. The previous owner remains on the list as Editor and can still edit the file.
3. An editor cannot make someone the owner. Their Share dialog has no Make owner.
4. The owner sets an end date on a viewer, commenter, or editor in at most 2 clicks plus picking the date, with no Save. The row shows the date. The owner's own access has no expiry control.
5. Before that moment the person can still open the file with their role. After it, the file is absent from their Shared with me and opening it is refused.
6. The new owner and the expiry are stored on the server. A sign-in on another server in the cluster shows the same owner and the same date.
7. Viewer, commenter, and editor can each expire. Role changes from storyboard 27 still apply with no Save.

## Success looks like

- Sam owns the rota, Rosa is an editor, and both can edit.
- Priya can comment on Friday and cannot open the file on Saturday, on either server.

## Gaps and notes

- The owner is `drive_item.ownerId`, set when the file is created. `share()` only upserts `drive_acl` for `user` or `org`, and the dialog's `GRANT_ROLES` are viewer, commenter, and editor. The owner row is a label, not a role you can hand over.
- `drive_acl` has no expiry column. `share()` takes a role or `None` and nothing else.
- Storyboard 27's role changes, remove, and Undo stay as they are. Make owner is a different action: it changes `ownerId` and leaves the previous owner as an editor grant.
- The Saturday check can set the stored expiry in the past, the same way storyboard 40 sets a trash date. The recording does not wait overnight.
