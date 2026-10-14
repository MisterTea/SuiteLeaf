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

## AI version

**Video:** [web](videos/23-start-a-document-in-suitedrive-ai.mp4) · **Script:** [scenes/ai/23-start-a-document-in-suitedrive-ai.spec.ts](scenes/ai/23-start-a-document-in-suitedrive-ai.spec.ts)

Web only: this is a cluster storyboard, with the app served by the SuiteLeaf node itself (locked to that server). Rosa opens the server and creates her account herself; the assistant never signs in or types passwords. Her SuiteDrive is empty. She then asks the on-device assistant (Gemma 4 E4B) once:

"Make a Garden club folder and start a document in it called Watering rota. It should say: Mon Rosa, Tue Leo, Wed Priya, Thu Sam."

Gemma uses `new_folder`, `open_folder`, `create_file` and `write_text`, in that order, every run. In the recording, SuiteDrive scrolls up into view and the pointer goes to New folder, and "Garden club" appears in My Drive. The pointer then goes to the folder's row, and the path changes to "My Drive › Garden club" with "In Garden club" on the New buttons. It goes to New document, which opens a blank document titled "Watering rota", and the rota is typed in. The status beside the title reads "Saved to SuiteDrive". Rosa closes the panel and clicks Back to files, which returns her to Garden club with "Watering rota.sldoc" in it. My Drive holds only the Garden club folder. The test checks the title, the four names in order, the "Saved to SuiteDrive" status, the file's name in the Garden club folder (as listed by the server), and that the document isn't loose in My Drive. Because the agent names the document when it creates it, nothing gets renamed afterwards. The check that "renaming the title renamed the file" therefore becomes a check that the file on the server carries the document's title.

Fixes made along the way:

- The SuiteDrive tools now scroll the drive list into view before pointing. Before, the list sat below the New buttons and the new folder's row was at the bottom edge of the screen.
- With the AI panel open, the title box shrinks to fit its text, so the editor header shows the whole "Saved to SuiteDrive" status. Before, it was cut to "Saved to …".
- When `write_text` replaces the whole document, its result now says so instead of "at the end of the document".

**How Gemma did:** with the final tools, web passed 3 of 3 runs (4 of 5 recordings in all). The first recording failed only because the test then expected the rota word for word; it now checks the four names in order. In every run Gemma typed the rota as four lines ("Mon Rosa", "Tue Leo", …), dropping the commas and the full stop, even though the system prompt says to keep the user's text. In 3 of 5 runs it set "replace the whole document" on a document that was already empty, which did no harm. In the first run its closing message said "You created the folder…" instead of "I". It picked the right tools with the right arguments every time, never called a tool that failed, and never went back to the file list on its own. Each run took about 20 seconds after the model loaded.

## Gaps and notes

- "New folder" and the Rename pencil use in-app dialogs in SuiteLeaf's dialog style instead of the browser's prompt and confirm pop-ups. Rename selects the title but not the extension, so typing a new name keeps `.sldoc`.
- The home screen remembers the open folder for the signed-in account for the rest of the browser session, so "Back to files" (and reloading) returns to it. If that folder is gone, SuiteDrive starts at My Drive.
- SuiteDrive shows file extensions (`.sldoc`, `.slslides`). Google Drive shows document titles only. Hiding them changes the names tests and other storyboards look for, so it's left for a separate change.
- The editor shows the file's folder next to the title, and Move puts it in another folder. See storyboard [140](140-put-the-rota-in-the-club-folder.md).
- Move to trash on SuiteDrive has a Trash view, Undo, and Delete forever. See storyboard [139](139-get-a-shared-file-back.md).
- In the editor's File menu, New and Make a copy put the new file in the open file's folder. See storyboard [141](141-start-the-next-rota-in-the-same-folder.md). Open and Save as start in that same folder when the file is already in one.
