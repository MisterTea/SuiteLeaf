# 23 · Start a document in SuiteDrive

**Mode:** cluster · **App:** Docs · **Video:** [videos/23-start-a-document-in-suitedrive.mp4](videos/23-start-a-document-in-suitedrive.mp4) · **Script:** [scenes/slides-cluster.spec.ts](scenes/slides-cluster.spec.ts)

## Who and why

Rosa coordinates the garden club's watering rota. She opens the team's SuiteLeaf server in her browser, wants a folder for club paperwork, and wants to write the rota there so everyone can find it. She works the way she does in Google Drive: make a folder, open it, click New.

## Inspired by

- Architecture, "Nodes, SuiteDB, auth, and SuiteDrive": in cluster mode every route is behind sign-in, and New, Open, and Save as work in SuiteDrive ([docs/architecture.md](../docs/architecture.md#nodes-suitedb-auth-and-suitedrive)).
- [How to use Google Drive](https://support.google.com/drive/answer/2424384): New → New folder, or New → a document type, then Rename from More actions.
- [Organize your files in Google Drive](https://support.google.com/drive/answer/2375091): create folders, then work inside them.

## Scenes

1. **Open the server.** Rosa goes to the server's address. Because the server serves the app, it opens straight to sign-in, with no "work on this computer" option. She creates her account.
2. **New folder.** In SuiteDrive she clicks "New folder" and names it "Garden club". It appears in My Drive.
3. **Open the folder.** She clicks it. The path reads "My Drive › Garden club" and the folder is empty.
4. **New document.** She clicks "New document". A blank document opens, and she types the rota.
5. **Saved to SuiteDrive.** The status next to the title changes to "Saved to SuiteDrive". There's no Save button.
6. **Rename.** She types "Watering rota" in the title box. The status returns to "Saved to SuiteDrive".
7. **Find it again.** Back to files, she opens "Garden club" and sees "Watering rota.sldoc".

## Success looks like

- SuiteDrive has a "Garden club" folder containing "Watering rota.sldoc".
- The document autosaved to the server, and renaming the title renamed the file.

## Gaps and notes

- "New folder", the Rename pencil, and Move to trash use the browser's own prompt and confirm pop-ups rather than in-app dialogs. They look out of place, and they don't show in the recordings, which is why the video only captions the folder name.
- After "Back to files", SuiteDrive returns to the top of My Drive instead of the folder Rosa came from, so she has to open "Garden club" again.
- SuiteDrive shows file extensions (`.sldoc`, `.slslides`). Google Drive shows document titles only.
