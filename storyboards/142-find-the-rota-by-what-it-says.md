# 142 · Find the rota by what it says

**Mode:** cluster · **App:** Files · **Video:** [videos/142-find-the-rota-by-what-it-says.mp4](videos/142-find-the-rota-by-what-it-says.mp4) · **Script:** [scenes/142-find-the-rota-by-what-it-says.spec.ts](scenes/142-find-the-rota-by-what-it-says.spec.ts)

## Who and why

Rosa knows the watering note says Thursday, and she does not remember the file name or which folder she used. On this computer, search reads the words inside a file. On SuiteDrive she can only open folders until the name looks right. Google Drive can search inside files, but the result is a name, the matching words are easy to miss, and finding "only this folder" means typing a search operator.

## Inspired by

- Storyboard [02](02-find-and-organize-files.md): search on this computer matches names. The library search now also reads file text.
- [Search for files in Google Drive](https://support.google.com/drive/answer/2375114): search matches names and contents. Narrowing to a folder uses operators such as `in:`.
- [r/googleworkspace: how to organize Drive without a giant folder maze](https://www.reddit.com/r/googleworkspace/comments/1tcbtc4/how_to_organize_google_drive_without_creating_a/): people end up searching because the folders get away from them.

## Scenes

1. **The note is in a folder.** Rosa is signed in. My Drive shows the Garden club folder and does not show Watering rota. The rota is inside the folder, and its text includes "Thursday: ask Alex to cover."
2. **Search.** At the top of SuiteDrive she types "Thursday" into **Search SuiteDrive**. She does not open the folder first.
3. **The words and the place.** One result shows Watering rota, the folder name Garden club, and a snippet that contains Thursday. There is no search operator.
4. **Open it.** She clicks the result. The rota opens, and the Thursday sentence is on the page.
5. **Nothing else.** She searches for "zucchini". The page says no files match. It does not look like an empty folder.

## Success looks like

- A word from inside the file finds it without opening folders.
- The result shows the file name, the folder, and the matching words.
- Opening the result shows that sentence.
- A miss says that nothing matched.

## Better than Google Drive

- The matching words are in the result, next to the folder name.
- She does not type `in:` or any other operator.
- A miss is a sentence, not a blank file list.

## Gaps and notes

- Recorded. Rosa signs in on My Drive, which lists Garden club and not Watering rota. She types Thursday into Search SuiteDrive. The result names Watering rota, Garden club, and a snippet that contains Thursday. Opening it shows "Thursday: ask Alex to cover." A search for zucchini says "No files match." and does not say the folder is empty.
- Search is a case-insensitive substring of the file name and of the text in a document, spreadsheet, slide deck, or form. There is no query language.
- At most 20 files. Trashed files, and files inside a trashed folder, are left out. A file someone cannot open is left out too.
- The snippet is about 80 characters around the match. Comments, and files that are not SuiteLeaf documents, are not read.
