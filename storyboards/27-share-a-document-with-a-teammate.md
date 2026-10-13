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

1. **Open the rota.** Rosa is signed in to the club's server and opens "Watering rota". A **Share** button sits in the header next to the server name.
2. **Open Share.** She clicks Share. A dialog titled "Share "Watering rota"" shows an "Add people" box and the list of people with access: "Rosa Diaz (you) · Owner". A line under the list says "Only the people listed here can open this file."
3. **Find Sam.** She types "sa". Suggestions from the server's accounts appear with name and email: "Sam Okafor · sam@gardenclub.org". She picks him.
4. **Choose a role.** A role menu next to his name defaults to Editor and lists Viewer ("Can read"), Commenter ("Can read and comment"), and Editor ("Can change anything"). She leaves Editor and clicks **Share**. Sam appears in the list as Editor.
5. **Add Priya as a commenter.** She types "priya", picks "Priya Shah", chooses Commenter, and clicks Share.
6. **Someone without an account.** She types "lee@example.com". The dialog says "No account on this server uses lee@example.com. Ask them to sign up first," and the Share button stays disabled.
7. **Change and remove access.** Sam's menu changes to Viewer and saves straight away ("Sam can now view"). From Priya's menu she chooses **Remove access**; Priya disappears from the list and an "Undo" link appears for a few seconds.
8. **Folder access.** Rosa shares the "Garden club" folder with Sam as Editor. Reopening Share on the rota shows "Sam Okafor · Editor · from Garden club".
9. **Sam's side.** Sam signs in. SuiteDrive's "Shared with me" lists "Watering rota" with owner "Rosa Diaz" and "Can edit". He opens it and edits.
10. **A viewer's side.** Signed in as a viewer, the rota opens with a "View only" label beside the title. Typing does nothing, and the editing toolbar is disabled.

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
- Sam finds the rota in "Shared with me" and edits it. A viewer can read it but can't change it.

## Gaps and notes

- **No Share button or dialog exists.** Nothing in `App.tsx` or `DriveBrowser.tsx` opens a share UI, and `node-client.ts` has no ACL calls.
- The server has `GET`/`PUT /api/drive/items/{id}/acl`, but `PUT` takes `principalType` (`user` or `org`) and a raw `principalId`. There is no endpoint for finding accounts by name or email (only `/api/me`), so a people picker needs a new user-search endpoint, and the list needs names for user IDs.
- **Roles are Viewer, Editor and Owner** (`suitedrive::Role`). There is no Commenter, and only an Owner can change sharing.
- "Shared with me" exists and lists direct user and org grants (`drive.shared()`), but rows don't show the owner or your role. `DriveBrowser` uses `item.role` only to hide Rename and Move to trash for viewers.
- **No view-only mode in the editors.** A viewer can open a file and type; the edits are kept on that device and the upload fails with SuiteDrive's "you do not have access to this item" error.
- SuiteDrive has no link sharing ("anyone with the link"). That's fine for a private team server, but the dialog should say so ("Only the people listed here can open this file").
