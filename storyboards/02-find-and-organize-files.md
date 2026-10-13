# 02 · Find and organize your files

**Mode:** single-node · **App:** Files · **Video:** [videos/02-find-and-organize-files.mp4](videos/02-find-and-organize-files.mp4) · **Script:** [scenes/docs.spec.ts](scenes/docs.spec.ts)

## Who and why

Maya runs the garden club's paperwork. She has a budget, a talk and a monthly newsletter. She wants to find any of them quickly, start next month's newsletter from this month's, and clear out what she no longer needs. She is used to Google Drive's search box and type filters.

## Inspired by

- [Google Drive Help: search for files](https://support.google.com/drive/answer/2375114): search by name or by the words inside a file, then narrow by Type (Documents, Spreadsheets, Presentations) with filter chips.
- [r/googleworkspace: how to organize Drive without a giant folder maze](https://www.reddit.com/r/googleworkspace/comments/1tcbtc4/how_to_organize_google_drive_without_creating_a/): "a few weeks later i'm using search for everything anyway". People want a flat list, consistent names and fast search more than deep folders.
- W3 (file library management) and WF-A4-05/A4-07 (search, filter, delete) in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md).

## Scenes

1. **Empty library.** The home screen says "A workspace waiting for you" and offers sample files. Maya opens **Sample document**, and it opens ready to edit.
2. **Add the club's files.** Back on the home screen she uses **New spreadsheet** ("Garden club budget"), **New presentation** ("Garden club talk") and **New document** ("Garden club newsletter"). She types each name in the title box straight away, even while the spreadsheet grid is still loading, and every letter stays in the title. Each file saves automatically.
3. **Samples stay on offer.** With four files listed (newest first, with today's edits showing the time), **Explore a sample** under the list still offers the sample document, budget and presentation.
4. **Search.** Typing "garden" in **Search your files** replaces the welcome banner and New cards with **Results for "garden"**: the three club files, right under the search box. Typing "harvest" finds the newsletter even though the word is only in its text, and quotes the matching line under its name. Escape clears the search and brings the home screen back.
5. **Filter by type.** The sidebar's **Documents** shows the two documents and the heading changes to "Documents". **Spreadsheets** and **Presentations** each show one file. **All files** brings back all four.
6. **Sort.** Clicking the **Name** column header sorts A to Z (an arrow shows the direction). Clicking **Last edited** goes back to newest first.
7. **Duplicate and rename.** The copy icon on "Garden club newsletter" adds "Garden club newsletter copy". The pencil icon on the copy opens a **Rename** dialog, and Maya names it "Garden club newsletter - November" without opening it. Both newsletters are listed.
8. **Remove.** The trash icon on "Welcome to SuiteLeaf" opens an in-app **Delete this file?** dialog that names the file and says it can't be undone. After she clicks **Delete**, the sample is gone.

## Success looks like

- Four garden club files, with search (names and contents) and type filters narrowing the list in place.
- Search results are visible without scrolling at 1280×800.
- A title typed right after **New spreadsheet** is kept in full.
- The duplicate is an independent file with its own name, and the original newsletter is unchanged.
- The removed sample no longer appears.

## AI version

**Videos:** [web](videos/02-find-and-organize-files-ai.mp4) · [desktop app](videos/electron/02-find-and-organize-files-ai.mp4) · **Script:** [scenes/ai/02-find-and-organize-files-ai.spec.ts](scenes/ai/02-find-and-organize-files-ai.spec.ts)

Maya opens the sample document herself, as in scene 1, then asks SuiteLeaf's on-device assistant (Gemma 4 E4B) three things in a row:

1. "I look after the garden club's paperwork. Please make a spreadsheet called Garden club budget, a presentation called Garden club talk, and a document called Garden club newsletter that says: Harvest supper on Saturday. Bring a dish to share."
2. "Which of my files mention the harvest?"
3. "Make a copy of the newsletter for November called Garden club newsletter - November. Then delete the Welcome to SuiteLeaf sample, I don't need it anymore. Then show me just my documents, A to Z."

**Tools Gemma used:** `create_file` (from the home screen, then from inside each new file through File > New), `write_text`, `search_files`, `duplicate_file`, `rename_file`, `remove_file` and `show_files`. That's 18 calls in total, with no errors in the final runs.

**What the recording shows:** the purple "Gemma" pointer opens a new spreadsheet, then goes to the File menu for the presentation and again for the newsletter, and types the newsletter text. For the second request it types "harvest" into the search box, and the newsletter appears with its matching line quoted under the name. For the third it clicks the copy icon on the newsletter, then the pencil on the copy. Because the "harvest" search hides the sample, it clears the search so the sample's row is visible, scrolls to it, clicks its trash icon and then **Delete** in the dialog that names the file. Finally it picks **Documents** and sorts by name. The script then checks the end state: four garden club files with the budget's title in full, the search showing only the newsletter with its line quoted and fully on screen, the "Documents" heading with no search still applied, the list sorted A to Z with both newsletters under their own names, no "Garden club newsletter copy" and no sample. It also reopens the original newsletter to check its title and text are unchanged.

**How Gemma did:** on the final code the web version passed 3 of 3 runs, and each request took about 27–37, 4–6 and 10–14 seconds. The desktop app (llama.cpp, Q4_0) passed 2 of the 3 recordings, at about 13, 3 and 8 seconds per request. The failed one was recorded before the desktop draft-status fix described below. Model mistakes seen:

- It nearly always typed "Harvest supper on Saturday. Bring a dish to share." as two paragraphs, one per sentence (5 of 6 web runs). The words are right, so the script checks each sentence rather than a single paragraph.
- In the desktop app it sometimes ends its turn with an empty reply. In one run this happened three times in a row right after it created the newsletter, so the text was never typed. In another, all the work was done but there was no closing summary. The assistant asks again after an empty reply (at most twice), which wasn't always enough. This was not seen in the web version.
- Small slips: one summary quoted the text with a literal `\n`. Before the fixes below, it tried to call `create_file` from inside an editor, where that tool didn't exist yet.

App fixes made while recording this, which help any similar request:

- A tool that belongs to another screen now explains where it works and how to get there ("call back_to_files, then create_file again"). Before, Gemma got a bare "Tool create_file not found", spent its whole output budget thinking about it, and stopped. A reply that runs out of room without saying anything is now retried like an empty one.
- Open files offer `create_file` (the same as File > New), so "make three files" no longer has to go back to the file list between them.
- Tools now run against the screen as it is, so a copy made earlier in the same turn can be renamed. Before, the rename could have matched the original newsletter instead.
- `duplicate_file` gives the copy's name. `search_files` and `show_files` list the file names and matching lines; before, the text ran together, as in "Garden club newsletterHarvest supper…10:19 PM". `show_files` also says when an earlier search is still narrowing the list.
- Rename, copy, remove and open clear a search or type filter that hides the file, and scroll it into view before the pointer moves. The remove pointer then goes to the dialog's **Delete** button.
- Desktop app: a new file that hasn't been saved to disk is shown as "Draft saved · choose Save As", not "Recovered draft · review and save". Removing a file that was never saved now says it will be deleted, not that "your saved file remains on disk". Electron recordings now fill the video frame.

## Gaps and notes

- Fixed: typing a title straight after **New spreadsheet** lost keystrokes while the grid was loading ("Garden club budget" was saved as "Garden cl"). The grid took focus as it started. It now gives focus back to the title (or any other text box outside the grid) during start-up, unless you've clicked into the grid. Covered by `tests/browser/library.spec.ts`.
- Fixed: the sample buttons only appeared while the library was empty. **Explore a sample** now sits under the file list.
- Fixed: search results sat below the welcome banner and New cards, off-screen at 1280×800. While searching, the banner and cards are hidden and the results heading says what was searched. A search with no matches now says "No files match …" and offers **Clear search**.
- Fixed: search matched file names only. It now also looks at document text, spreadsheet cells and sheet names, and slide text and speaker notes, and quotes the first match. Very large files are searched only in their first 200,000 characters.
- Fixed: files could only be renamed by opening them. The pencil icon renames from the list. If the file is open in another tab, SuiteLeaf asks you to rename it there instead, so the open editor can't save the old name over the new one.
- Fixed: the list was always newest first. The Name and Last edited headers sort the list.
- Fixed: the remove confirmation was the browser's own dialog, which didn't appear in the recording. It is now an in-app dialog. In the desktop app it says "Remove from library?" and keeps the saved file on disk.
- Remove is still permanent, with no Trash or undo (SuiteDrive in cluster mode has a Trash). A local Trash needs its own storage and a Trash view.
- The editor's Star button isn't saved anywhere, so there is no Starred filter. Saving stars needs a field in the file record (core, browser and desktop storage).
- There are no folders in single-node mode. The list is flat, which matches how the people quoted above actually work.
