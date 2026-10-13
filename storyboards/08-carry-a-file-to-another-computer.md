# 08 · Carry a file to another computer

**Mode:** single-node · **App:** Docs · **Video:** [videos/08-carry-a-file-to-another-computer.mp4](videos/08-carry-a-file-to-another-computer.mp4) · **Script:** [scenes/docs.spec.ts](scenes/docs.spec.ts)

## Who and why

Sofia writes a packing list in SuiteLeaf on her laptop's browser and wants to keep working on it at the office. There's no account or cloud sync in single-node mode, so she needs one file she can email to herself or put on a USB stick, and to be sure that file holds everything.

## Inspired by

- [web.dev: offline data](https://web.dev/learn/pwa/offline-data): browser storage stays on that device, and "users are always in charge, and they can delete the storage at any time".
- [r/chromeos: help me retrieve data deleted from local storage](https://www.reddit.com/r/chromeos/comments/1askfza/help_me_retrieve_data_deleted_from_local_storage/): someone cleared their browser data and lost work they had only saved in a site, with no way back.
- W4 and W14 (save, portability and round-trip) in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md), and "Saving and portability" in the [README](../README.md).

## Scenes

1. **Write.** Sofia makes "Lisbon trip packing list" with a Heading 1 and four bullet points. It autosaves in the browser.
2. **Download.** **Download** in the header (its tooltip names the file) saves "Lisbon trip packing list.sldoc", a single SuiteLeaf file. The save status then reads *Downloaded "Lisbon trip packing list.sldoc"*, so she knows what she got even if the browser saves it quietly.
3. **Remove it here.** Back on the home screen, she removes the list from the library. SuiteLeaf's **Delete this file?** dialog says: *"Lisbon trip packing list" will be deleted from this browser. This can't be undone. A copy you downloaded isn't affected: open it again with Open / import.* She clicks **Delete**, and the library is empty, like a computer that has never seen it.
4. **Open on the other computer.** **Open / import** with the .sldoc file opens it straight away, with the same title, the heading and all four items. The status says *Opened "Lisbon trip packing list.sldoc" · Saved on this device*.
5. **Keep going.** She adds "Sunglasses" to the list, and it saves on this computer.
6. **Open it again by mistake.** Later she opens the emailed file a second time. The list is already in this browser with newer changes, so instead of quietly making a copy SuiteLeaf asks: *"Lisbon trip packing list" is already in this browser*, shows when each was saved, warns that replacing discards the newer changes, and offers **Cancel**, **Replace** and **Keep both** (the safe choice is the main button). She cancels, and the list still ends with Sunglasses.

## Success looks like

- A single .sldoc file carries the whole document: title, heading and list.
- It's clear what Download made (name and type) and that removing from the browser leaves the downloaded copy as the only one.
- After import it's a normal editable file in the library again.
- Opening a file that's already in the library never silently duplicates or overwrites it: an identical file just opens the copy that's there, and a different version asks first, like Google Drive's "Replace existing file / Keep both".

## AI version

**Videos:** [web](videos/08-carry-a-file-to-another-computer-ai.mp4) · [desktop](videos/electron/08-carry-a-file-to-another-computer-ai.mp4) · **Script:** [scenes/ai/08-carry-a-file-to-another-computer-ai.spec.ts](scenes/ai/08-carry-a-file-to-another-computer-ai.spec.ts)

Sofia asks the on-device assistant (Gemma 4 E4B) three times, one request for each moment of the story:

1. *Make a document called Lisbon trip packing list. Put the heading "Lisbon, 3 to 7 November", then a bulleted list: Passport and boarding pass, Plug adapter, Walking shoes, Rain jacket. Then download it so I can take it to my work computer.*
2. *Now remove the packing list from SuiteLeaf here. I'll only keep the downloaded file.*
3. (On the other computer) *Open the packing list I downloaded and add Sunglasses to the end of the list.* Gemma asks for the file in the panel and she picks the .sldoc.

Scene 6 stays a person's step. Opening the emailed file a second time is her mistake, and choosing between Replace and Keep both is her decision. She clicks Open / import herself, SuiteLeaf asks, and she cancels. The assistant never makes that choice. If it opens a file that is already in the library, `open_from_computer` reports the question and says only the user can answer it.

**Tools Gemma used:** `create_file`, `write_text` (the heading, then the four items as "- " lines), `download_file` (labelled Save As on desktop), `back_to_files`, `remove_file`, `open_from_computer`, then `write_text` again for "- Sunglasses", usually with `after: "Rain jacket"`. Sometimes it also called `set_list` on a list that was already bulleted. That changed nothing, and the result says so.

**What the recording shows:** Gemma creates the list, and the header confirms *Downloaded "Lisbon trip packing list.sldoc"*. The test checks that the .sldoc holds the title, the heading and all four items. Gemma goes back to the file list and removes the list. The **Delete this file?** dialog appears with the pointer on Delete, and the library ends empty. For the third request, Gemma asks for the file in the panel, Sofia picks it, and it opens whole: *Opened "Lisbon trip packing list.sldoc" · Saved on this device*. Sunglasses becomes the fifth bullet, and the test checks it appears only once. Then she reopens the file by mistake, the "already in this browser" dialog warns that the one here has newer changes, and Cancel leaves Sunglasses in place. On desktop the same story uses Save As to a file. Removing it from the library says the saved file stays on disk, and the reopen asks *"…" is already on this computer*.

**How Gemma did:** On the final code the web recording passed 3 of 3 runs, and desktop (llama.cpp) passed 2 of 2. Each request takes about 5–20 seconds. Model mistakes seen while making it:
- When scene 6 was a request ("Open the packing list from my email"), Gemma opened the library copy instead of the emailed file. That's one reason scene 6 is now the person's step.
- In 3 of 8 web runs before the system prompt said it could open files from the user's computer, Gemma answered "I cannot access files downloaded to your local computer, please upload it" instead of calling `open_from_computer`. After that line, 3 of 3 runs opened the file.
- On desktop, Gemma made the title a Heading 1 and the date a Heading 2. Once it typed "3 to 7 November" without "Lisbon,", and once it turned the heading into a bullet with `set_list`. The heading is now quoted in the prompt, because its comma made the request ambiguous.
- On desktop, Gemma once used `export_document` (Word) for "download it". `export_document` now says it is only for Word, HTML or text copies.
- Gemma often made `set_list` calls after `write_text` had already made the list, even though the result said so. These calls were harmless.

Fixed while making it: `write_text` after a list item made a plain paragraph outside the list, so Gemma added Sunglasses twice. It now continues the list, as Enter does. `download_file` said only "Downloading", and now names the file and where it went. `remove_file` and `download_file` used to tell the model the person's next step ("open it again with Open / import"), and Gemma repeated it to the user. They now point to `open_from_computer`. `open_from_computer` waited two minutes when the Replace / Keep both dialog appeared, and now reports it at once. `set_list` now names what it changed. On desktop, opening a saved file again silently replaced a newer copy in the library, and now asks first, as on the web.

## Gaps and notes

- Fixed while making this storyboard: Download gave no feedback in the app; the browser File menu listed the same download twice ("Download SuiteLeaf file" and "Export native copy"); it now says "Download SuiteLeaf file (.sldoc)" (or .slsheet / .slslides) and "Export native copy" only appears on desktop, where it differs from Save As. Re-importing a file still in the library made a "… copy" even when it was identical. The removal prompt didn't say what is lost or how to get it back, and the home screen's browser note now says "Download a file to back it up or move it."
- Removing is still permanent in the browser (no trash); that belongs with the library work in storyboard 02.
- **Replace** is refused while the file is open in another tab, so that tab can't save over it.
- On desktop, **Replace** puts the file's content into the library copy, but that copy stays a draft. It isn't linked to the file that was opened; use Save As to link it.
