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
8. **Remove.** The trash icon on "Welcome to SuiteLeaf" moves it to Trash, with Undo if that was a mistake. The sample leaves the list.

## Success looks like

- Four garden club files, with search (names and contents) and type filters narrowing the list in place.
- Search results are visible without scrolling at 1280×800.
- A title typed right after **New spreadsheet** is kept in full.
- The duplicate is an independent file with its own name, and the original newsletter is unchanged.
- The removed sample no longer appears.

## Gaps and notes

- Fixed: typing a title straight after **New spreadsheet** lost keystrokes while the grid was loading ("Garden club budget" was saved as "Garden cl"). The grid took focus as it started. It now gives focus back to the title (or any other text box outside the grid) during start-up, unless you've clicked into the grid. Covered by `tests/browser/library.spec.ts`.
- Fixed: the sample buttons only appeared while the library was empty. **Explore a sample** now sits under the file list.
- Fixed: search results sat below the welcome banner and New cards, off-screen at 1280×800. While searching, the banner and cards are hidden and the results heading says what was searched. A search with no matches now says "No files match …" and offers **Clear search**.
- Fixed: search matched file names only. It now also looks at document text, spreadsheet cells and sheet names, and slide text and speaker notes, and quotes the first match. Very large files are searched only in their first 200,000 characters.
- Fixed: files could only be renamed by opening them. The pencil icon renames from the list. If the file is open in another tab, SuiteLeaf asks you to rename it there instead, so the open editor can't save the old name over the new one.
- Fixed: the list was always newest first. The Name and Last edited headers sort the list.
- Fixed: the remove confirmation was the browser's own dialog, which didn't appear in the recording. It is now an in-app dialog. In the desktop app it says "Remove from library?" and keeps the saved file on disk.
- Remove now moves a file to Trash, with Undo (storyboard 40). Delete forever is the permanent step, and it still names the file. The recording above still shows the earlier confirm-and-delete dialog.
- The star on a file is saved, and Starred is in the sidebar (storyboard 40). This recording doesn't show that.
- There are no folders in single-node mode. The list is flat, which matches how the people quoted above actually work.
