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
2. **New folder.** In SuiteDrive she clicks "New folder". A small SuiteLeaf dialog asks for the name, with "Untitled folder" selected. She types "Garden club" and clicks Create. It appears in My Drive.
3. **Open the folder.** She clicks it. The path reads "My Drive › Garden club" and the folder is empty. The New document, New spreadsheet, and New presentation buttons now read "In Garden club".
4. **New document.** She clicks "New document". A blank document opens, and she types the rota.
5. **Saved to SuiteDrive.** The status next to the title changes to "Saved to SuiteDrive". There's no Save button.
6. **Rename.** She types "Watering rota" in the title box. The status returns to "Saved to SuiteDrive".
7. **Find it again.** "Back to files" returns her to the Garden club folder, where "Watering rota.sldoc" is waiting.

## Success looks like

- SuiteDrive has a "Garden club" folder containing "Watering rota.sldoc".
- The document autosaved to the server, and renaming the title renamed the file.

## Gaps and notes

- "New folder", the Rename pencil, and Move to trash now use in-app dialogs in SuiteLeaf's dialog style instead of the browser's prompt and confirm pop-ups. Rename selects the title but not the extension, so typing a new name keeps `.sldoc`.
- The home screen remembers the open folder for the signed-in account for the rest of the browser session, so "Back to files" (and reloading) returns to it. If that folder is gone, SuiteDrive starts at My Drive.
- SuiteDrive shows file extensions (`.sldoc`, `.slslides`). Google Drive shows document titles only. Hiding them changes the names tests and other storyboards look for, so it's left for a separate change.
- Inside the editor, nothing shows which folder the document is in. Google Docs shows the folder next to the title and lets you move the file from there.
- Move to trash has no Trash view to restore from, and no "Undo" notice like Google Drive's. That's why SuiteLeaf still asks before trashing.
- In the editor's File menu, New and Make a copy put the new file at the top of My Drive, and Open and Save as start browsing there. Google Docs uses the current file's folder.
