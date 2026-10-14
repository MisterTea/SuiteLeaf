# 150 · Use the roster on the server

**Mode:** cluster · **App:** Docs · **Video:** [videos/150-use-the-roster-on-the-server.mp4](videos/150-use-the-roster-on-the-server.mp4) · **Script:** [scenes/150-use-the-roster-on-the-server.spec.ts](scenes/150-use-the-roster-on-the-server.spec.ts)

## Who and why

Maya's member list lives in Garden club on the team's server. She has never opened it on this computer. The letter merge only lists spreadsheets already in this browser, so the roster is missing and she would have to download it first. Google's mail merge can see a Sheet in Drive, but the picker is slow and a bad column still sends. She wants the server file in the same list, with its folder named, and the same stop when a placeholder is not a column.

## Inspired by

- Storyboard [149](149-write-each-member-the-same-letter.md): merge fills one letter per row and refuses an unknown placeholder. SuiteDrive spreadsheets are not in that list.
- [Mail merge in Google Docs](https://support.google.com/docs/answer/12644452): the source is a Google Sheet in Drive.

## Scenes

1. **The roster is only on the server.** Rosa is signed in. Garden members is in the Garden club folder. She has not opened it, so it is not in the browser library.
2. **The letter.** She opens Plot letter, which says "Hello {{Name}}, your plot is {{Plot}}."
3. **The list names the folder.** Merge from a spreadsheet shows Garden members and says it is in Garden club.
4. **The letters.** She merges. A new document opens with Rosa's letter and Leo's letter, each on its own page. Nothing is emailed.
5. **Still refused.** She points the letter at {{Bed}} and merges again. The dialog says Bed is not a column, and no extra document is created.

## Success looks like

- A spreadsheet that exists only on SuiteDrive can be chosen.
- The row shows the folder name.
- The letters match the server sheet.
- An unknown placeholder still stops the merge.
- A spreadsheet already on this computer is still listed.

## Better than Google Docs mail merge

- The folder is on the row, so two files named Garden members are not a guess.
- She still reads every letter before anything is sent.
- A bad placeholder is named, including when the sheet is on the server.

## Gaps and notes

- Recorded. Rosa signs in. My Drive shows Garden club and not Garden members, because she has not opened the roster. Plot letter says "Hello {{Name}}, your plot is {{Plot}}." Merge from a spreadsheet lists Garden members with Garden club under it, and Plot notes with "On this computer". Merging the roster opens "Plot letter merged" with "Hello Rosa, your plot is Sunny." and "Hello Leo, your plot is Shade." A page break sits between them, and the status says 2 pages. The dialog says nothing is emailed.
- Changing the letter to {{Bed}} and merging the same roster shows "Bed is not a column." My Drive still has one "Plot letter merged.sldoc". The roster is only read. It is not copied into the library.
- Signed-in spreadsheets come from SuiteDrive, including files inside folders and files that are not on this computer. Each row is the title and the parent folder name, or "My Drive" at the top, so two files named Garden members can be told apart. A spreadsheet only in the local library stays in the list, labeled "On this computer". A SuiteDrive copy already cached here is not listed twice.
- The list is every `.slsheet` she can read. Trashed files, and files inside a trashed folder, are left out. A file she cannot open is left out too. The folder on the row is the immediate parent, not the whole path.
- Placeholders, empty rows, page breaks, and the Bed error are unchanged. A placeholder has to sit inside one run of text. The letter is the tab on screen. Other tabs are not copied into the merged document. Nothing is emailed.
