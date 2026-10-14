# 149 · Write each member the same letter

**Mode:** single-node · **App:** Docs · **Video:** [videos/149-write-each-member-the-same-letter.mp4](videos/149-write-each-member-the-same-letter.mp4) · **Script:** [scenes/149-write-each-member-the-same-letter.spec.ts](scenes/149-write-each-member-the-same-letter.spec.ts)

## Who and why

Maya has a short list of garden members and one letter that should greet each of them by name and name their plot. In Google Docs, mail merge sends the letters through Gmail. She cannot easily read every letter first, and a placeholder that does not match a column still produces a letter with a hole in it. She wants a document she can check, and she does not want anything emailed.

## Inspired by

- [Mail merge in Google Docs](https://support.google.com/docs/answer/12644452): a Docs template, a Sheets table, and Gmail. Preview is a sample, then Send.
- [r/googledocs: mail merge sent the wrong column](https://www.reddit.com/r/googledocs/): a mismatched field still goes out.

## Scenes

1. **The list.** Maya has a spreadsheet "Garden members". The first row is Name and Plot. Rosa is Sunny. Leo is Shade.
2. **The letter.** She has a document "Plot letter" that says "Hello {{Name}}, your plot is {{Plot}}."
3. **Merge.** From the letter she chooses **Merge from a spreadsheet**, picks Garden members, and confirms. No mail is sent.
4. **One letter each.** A new document opens. The first letter says "Hello Rosa, your plot is Sunny." The next says "Hello Leo, your plot is Shade." They are separated so each person starts on a new page.
5. **A bad placeholder.** She changes the template to {{Bed}}. Merge tells her Bed is not a column and does not create another document.

## Success looks like

- The merge reads the header row and fills one letter per following row.
- Each letter starts on its own page.
- Nothing is emailed.
- An unknown placeholder is named, and no document is created for that attempt.
- The original letter and the member sheet stay as they were.

## Better than Google Docs mail merge

- She reads every letter in one document before anything leaves the computer.
- There is no Gmail step.
- A placeholder that is not a column stops the merge and says which name was wrong.

## Gaps and notes

- Recorded. From Plot letter, Tools › Merge from a spreadsheet lists Garden members by title. Confirming opens a new document, "Plot letter merged", with "Hello Rosa, your plot is Sunny." and "Hello Leo, your plot is Shade." A page break sits between them, and the status says 2 pages. The dialog says nothing is emailed. There is no send step and no network call.
- Changing the letter to {{Bed}} and merging again shows "Bed is not a column." in the dialog. The library still has the same three files. The member sheet is only read. The original letter stays as it was until Maya edits it herself.
- Placeholders are `{{Header}}`, matched to the first non-empty row of the first sheet, case-sensitive against the header text. Empty rows are skipped. A placeholder has to sit inside one run of text; formatting that splits the braces across separate text nodes is not seen as a name. The letter is the tab on screen. Other tabs are not copied into the merged document. Spreadsheets that exist only on SuiteDrive are not in the list.
