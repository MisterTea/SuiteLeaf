# 51 · Hand over a file, and let a share expire

**Mode:** cluster · **App:** Docs · **Video:** [videos/51-hand-over-a-file-and-let-a-share-expire.mp4](videos/51-hand-over-a-file-and-let-a-share-expire.mp4) · **Script:** [scenes/51-hand-over-a-file-and-let-a-share-expire.spec.ts](scenes/51-hand-over-a-file-and-let-a-share-expire.spec.ts)

## Who and why

Rosa is leaving the garden club committee. Sam should own the "Watering rota", and he should not have to accept an email before that is true. Priya is helping through Friday and should lose access on Saturday without Rosa remembering to remove her. The club still has no email server.

## Inspired by

- WF-A2-11 and WF-A4-25 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): change ownership so the new owner has the owner's permissions.
- Storyboard [27](27-share-a-document-with-a-teammate.md): the owner shares Viewer, Commenter, or Editor. The owner row is fixed, and a role change is immediate.
- [Make someone else the owner of your file](https://support.google.com/drive/answer/2494892): Transfer ownership emails the person, and you stay the owner until they accept.
- [Stop, limit, or change sharing](https://support.google.com/drive/answer/2494893): Add expiration, pick a date within one year, then Save.
- [Share files from Google Drive](https://support.google.com/drive/answer/2494822): expiration dates are limited to eligible work or school accounts.

## Scenes

1. **Today's access.** Rosa opens Share on "Watering rota", which lives at the top of her drive. The list is Rosa Diaz, Owner; Sam Okafor, Editor; Priya Shah, Commenter.
2. **Until Saturday.** From Priya's role menu Rosa chooses **Access expires** and picks Saturday on the calendar. The row reads "Commenter · until Saturday", the role button says "until Saturday", and a note says it takes effect as soon as she picks a day. There is no Save button.
3. **Hand it to Sam.** From Sam's role menu she chooses **Make owner**. A line asks "Make Sam Okafor the owner? You will become an editor." She confirms. Sam's row says Owner, Rosa's says Editor, the dialog says she can edit, and Priya's row still says "Commenter · until Saturday". A note says Sam owns the file now. There is no acceptance step and no email. Rosa then adds "Sunday: rotate the beds." and it saves.
4. **Sam can share.** Sam signs in. The rota is already in his My Drive. Share lets him open Rosa's role menu (Viewer, Commenter, Editor, Make owner, Access expires). Priya's date is still Saturday. Rosa signs back in. Shared with me says she can edit. Her Share dialog says "You can edit this file" and does not offer Make owner.
5. **Before the date.** Priya opens the rota from Shared with me. The header says "Can comment". She writes "I can cover Wednesday morning." and it appears beside the file. Typing in the rota does nothing, and the formatting buttons stay off.
6. **After the date.** The recording sets Priya's end time to the Saturday just past. Her Shared with me no longer lists the rota. Opening the file she already had says "You no longer have access to this file." Sam's Share list no longer offers her a role; the row says "Access ended Saturday", with **Remove**.
7. **Another server.** Sam signs in on the club's other server. He is Owner. Priya's row still says access ended Saturday. Rosa is Editor. She signs in there, sees "Sunday: rotate the beds.", and adds "Bring the spare key."

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

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. Make owner in at most 3 clicks, immediate, no email and nothing to accept | Met | Video 0:12–0:16: role menu, Make owner, confirm. Sam is Owner and the note says he owns it now. `ownership_moves_immediately_and_a_share_can_expire` |
| 2. Previous owner stays as Editor and can still edit | Met | Video 0:15 Rosa is Editor and "You can edit this file." 0:20 she adds Sunday. 1:06 she adds "Bring the spare key" on the other server |
| 3. An editor has no Make owner | Met | Video 0:33 Rosa's dialog has the edit note and no Make owner. The same Rust test expects Forbidden; `tests/browser/handover.spec.ts` expects 403 |
| 4. End date in 2 clicks plus the day, no Save; the row shows it; the owner has no expiry control | Met | Video 0:07–0:10: Access expires, the calendar, "Commenter · until Saturday", "until Saturday" on the button, and "as soon as you pick a day." No Save. Rosa's owner row is a label |
| 5. Before the moment they keep their role; after it the file leaves Shared with me and opening is refused | Met | Video 0:40 Priya comments and the rota's words stay put. 0:48 the list is empty. 0:51 "You no longer have access to this file." Rust test checks viewer, commenter, and editor |
| 6. Owner and end date are on the server and match on another server | Met | Video 1:00 the other server: Sam is Owner, "Access ended Saturday", Rosa is Editor. The Rust test syncs both |
| 7. Viewer, commenter, and editor can expire, and storyboard 27's role changes still need no Save | Met | Video 0:10 commenter expiry with no Save; 0:28 Sam's role menu is the same immediate menu. Rust test expires a viewer, a commenter, and an editor, and a role change keeps the date |

## Gaps and notes

- Handing over a file that lives in a folder you own does not take away the owner powers that folder gives you. The recording uses a file at the top of My Drive, so Sam is the only owner.
- The Saturday check stores last Saturday as the end time, the same way storyboard 40 sets a trash date. The recording does not wait overnight.
- A commenter writes in the comment panel beside the file. That does not change the document. Highlighting a sentence to comment still belongs to an editor, because those comments are stored in the document.
- Nothing emails anyone. Storyboard 42 owns the notice that a file was shared.
- The end date is the start of the chosen local day. There is no time-of-day control, and there is still no "anyone with the link".
