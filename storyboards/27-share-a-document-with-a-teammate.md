# 27 · Share a document with a teammate

**Mode:** cluster · **App:** Docs · **Video:** [videos/27-share-a-document-with-a-teammate.mp4](videos/27-share-a-document-with-a-teammate.mp4) · **Script:** [scenes/27-share-a-document-with-a-teammate.spec.ts](scenes/27-share-a-document-with-a-teammate.spec.ts)

## Who and why

Rosa wrote the garden club's "Watering rota" in SuiteDrive (storyboard 23). Sam swaps shifts every week, so he needs to edit it. Priya only needs to read it and leave the odd question. Rosa wants to give each of them the right access from inside the document, without learning a permissions system, and to take access away again when Priya leaves the club.

## Inspired by

- WF-A1-19, WF-A2-11 and WF-A4-08 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): share a file with people, choose view/comment/edit, and have the role enforced.
- [Google Drive Help: Share files from Google Drive](https://support.google.com/drive/answer/2494822) and [Document sharing basics](https://support.google.com/a/users/answer/9305685): Share, type an address, choose Viewer, Commenter or Editor, Send; "General access" for links.
- [Learn more about access to Google files](https://support.google.com/docs/answer/16722399): what each role can do, and the "You need access" page.
- [r/techsupport: share to "anyone with the link" confusion](https://www.reddit.com/r/techsupport/comments/iuclvn/google_drive_share_to_anyone_with_the_link/): people aren't sure who can actually open a file.
- [r/gsuite: set link sharing by default](https://www.reddit.com/r/gsuite/comments/bgajp8/is_there_a_way_to_set_link_sharing_to_anyone_with/): "every time I create a new doc I need to go deep into the link share settings".
- [r/gsuite: files in "Shared with me" not showing](https://www.reddit.com/r/gsuite/comments/1g5oc9a/files_in_shared_with_me_not_showing_in_google/) and [r/google: "Add to My Drive" became "Add shortcut"](https://www.reddit.com/r/google/comments/ftrwbg/google_drive_add_to_my_drive_changed_to_add/): recipients struggle to find and keep shared files.

## Scenes

1. **Open the rota.** Rosa is signed in to the club's server and opens "Watering rota". A blue **Share** button sits in the header next to the server name.
2. **Open Share.** She clicks Share. A dialog titled Share “Watering rota” shows an "Add people" box and the list of people with access: "Rosa Diaz (you)" with her email, and Owner. A line under the list says "Only the people listed here can open this file." It also says the file is in Garden club.
3. **Find Sam.** She types "sa". A suggestion shows "Sam Okafor" and sam@gardenclub.org. She picks him.
4. **Choose a role.** A role control next to his name already reads Editor, "Can change anything", before she does anything else. She clicks **Share**. The dialog says "Sam can now edit" and lists him as Editor.
5. **Add Priya as a commenter.** She types "priya", picks "Priya Shah", opens the role menu (Viewer "Can read", Commenter "Can read and comment", Editor "Can change anything"), chooses Commenter, and clicks Share. "Priya can now comment."
6. **Someone without an account.** She types "lee@example.com". The dialog says "No account on this server uses lee@example.com. Ask them to sign up first." and the Share button stays disabled.
7. **Change and remove access.** She opens Sam's role menu and chooses Viewer. "Sam can now view" appears with no Save button. From Priya's menu she chooses **Remove access**. Priya leaves the list, and Undo stays up for several seconds.
8. **Folder access.** She clicks Share “Garden club”, adds Sam as Editor, then reopens Share on the rota. The list is Rosa and "Sam Okafor · Editor · from Garden club". Priya is gone.
9. **Sam's side.** Sam signs in. SuiteDrive's "Shared with me" lists "Watering rota.sldoc" with "Rosa Diaz · Can edit", without a reload. He opens it, adds "Thursday: ask Alex to cover.", and it saves to SuiteDrive.
10. **A viewer's side.** Alex Rivera, who can only view, signs in. Shared with me says "Rosa Diaz · Can view". The rota opens with a "View only" label beside the title. The editing toolbar is greyed out, typing does nothing, and nothing tries to save.

## Google Workspace benchmark

In Google Docs, sharing with one person takes about 4 clicks plus typing: **Share** (1), type the address, pick the suggestion (1), open the role menu and choose a role (2, if the default Editor isn't wanted), then **Send** (1). Changing a role takes 4 clicks (Share, role menu, new role, Save), and so does removing someone (Share, role menu, Remove access, Save). Making a file readable by anyone with the link takes another 3 to 4 clicks under "General access" ([Drive Help](https://support.google.com/drive/answer/2494822)).

Known pain points:

- "General access" and "Anyone with the link" confuse people about who can open a file ([r/techsupport](https://www.reddit.com/r/techsupport/comments/iuclvn/google_drive_share_to_anyone_with_the_link/)).
- Each new file needs the same settings again ([r/gsuite](https://www.reddit.com/r/gsuite/comments/bgajp8/is_there_a_way_to_set_link_sharing_to_anyone_with/)).
- Folder access is inherited, but the dialog doesn't make that obvious. Google added "limited access" folders to cut down on surprises ([Find lost files](https://support.google.com/drive/answer/15701190)).
- Recipients only find files under "Shared with me", and keeping them in My Drive needs a shortcut ([r/gsuite](https://www.reddit.com/r/gsuite/comments/1m8bgp6/google_drive_pc_version_doesnt_show_shared/), [Drive Help](https://support.google.com/drive/answer/2375057)).
- Commenters can only suggest ([Docs Help](https://support.google.com/docs/answer/16722399)), and people who expected to edit find themselves stuck in Suggesting mode without knowing their role is the reason ([how-to guide](https://teletutoriales.com/en/how-to-remove-suggestions-mode-in-google-docs/)).

## Better than Google Workspace when

1. From an open document, sharing with one person takes at most 3 clicks plus typing (Share, pick the suggestion, Share), and the role that will be granted is visible before the last click.
2. Typing 2 or more characters of a person's name, username, or email suggests matching accounts on the server, each showing name and email.
3. Each role in the menu has a one-line plain-language description, and a Commenter role exists. The server enforces it: a commenter can add comments, but writing content returns 403.
4. Changing or removing someone's access takes at most 2 clicks, takes effect without a separate Save, and removing shows Undo for at least 5 seconds.
5. The dialog always lists everyone who can open the file, including access inherited from a folder, labelled with that folder's name.
6. An address with no account shows an explicit message in the dialog. Nothing fails silently.
7. The recipient's "Shared with me" shows the file with the owner's name and the recipient's role, with no page reload needed after the owner shares.
8. A viewer sees "View only" and can't change the document: editing controls are disabled, and no save is attempted or fails.

## Success looks like

- Sam is an editor through the "Garden club" folder, Priya no longer has access, and the Share dialog lists exactly that.
- Sam finds the rota in "Shared with me" and edits it. Alex can read it but can't change it.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. Share one person in at most 3 clicks, role visible before the last click | Met | Video ~10–12s: Share, pick Sam, role already says Editor “Can change anything”, then Share |
| 2. Two or more characters suggest accounts, each with name and email | Met | Video ~9s: “sa” shows Sam Okafor and sam@gardenclub.org |
| 3. Roles have a one-line description, Commenter exists, and the server enforces it | Met | Video ~15s: menu shows “Can read”, “Can read and comment”, “Can change anything”. `a_commenter_can_comment_but_cannot_change_the_file` and `tests/browser/share.spec.ts` |
| 4. Change or remove in at most 2 clicks, no Save, Undo for at least 5 seconds | Met | Video ~22s: role menu then Viewer (“Sam can now view”, no Save). ~24–30s: Remove access, Undo still visible after 5 seconds |
| 5. Dialog lists everyone, including access inherited from a folder | Met | Video ~34s: Sam Okafor, Editor, “from Garden club”; Priya is absent |
| 6. An unknown address shows an explicit message | Met | Video ~18s: “No account on this server uses lee@example.com. Ask them to sign up first.” Share stays disabled |
| 7. “Shared with me” shows the owner and the recipient’s role, with no reload | Met | Video ~40s: “Rosa Diaz · Can edit” as soon as Sam opens the tab. `tests/browser/share.spec.ts` also checks an already-open list |
| 8. A viewer sees “View only” and cannot change the document | Met | Video ~50–56s: View only label, greyed toolbar, typed text does not appear, no save |

## Gaps and notes

- The comment composer in the document is storyboard 29. A commenter can `POST /api/drive/items/{id}/comments` and gets 403 from a content upload, but there is no comment card in the editor yet.
- Sheets and slides block the upload when the person cannot edit, and the header shows “View only” or “Can comment”. Only the Docs toolbar is disabled.
- Alex’s view access is granted before he signs in; the recording does not show that extra Share click, so the “exactly these people” frame stays Rosa and Sam.
- There is still no “anyone with the link”. The dialog says only the people listed can open the file.
- Opening Share and then changing a role is 3 clicks. With the dialog already open, which is how Rosa does it, it is 2.
