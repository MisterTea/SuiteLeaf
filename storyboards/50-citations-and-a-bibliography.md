# 50 · Add a citation and a bibliography

**Mode:** single-node · **App:** Docs · **Video:** [videos/50-citations-and-a-bibliography.mp4](videos/50-citations-and-a-bibliography.mp4) · **Script:** [scenes/50-citations-and-a-bibliography.spec.ts](scenes/50-citations-and-a-bibliography.spec.ts)

## Who and why

Kwame's "Grant report 2026" already has a table of contents and footnotes (storyboard 35). The funder also wants two sources cited in the text and a bibliography at the end, in APA, and the Word file they already use has to come back with real citations. Kwame keeps fixing the year on one report until the last afternoon, so every citation and the bibliography have to follow that edit.

## Inspired by

- WF-A4-27 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): a citation renders in the text, and a bibliography appears at the end.
- Storyboard [35](35-add-a-table-of-contents-and-footnotes.md): footnotes and a contents table already round-trip through Word. A citation is a different object.
- [Add citations and a bibliography](https://support.google.com/docs/answer/10090962): Tools › Citations, MLA, APA, or Chicago, then Cite and Insert bibliography.
- [Add citations and sources](https://support.google.com/a/users/answer/10993081): the bibliography is inserted once, a "#" stands in for a page number, and deleting a source in the sidebar leaves the in-text citation in the document.
- [Docs Editors Community: footnotes and endnotes](https://support.google.com/docs/thread/223655381/how-do-i-convert-footnotes-into-endnotes-in-google-docs): Docs and Word do not share one model of notes, and a bibliography is not a substitute that Word's citation manager understands.

## Scenes

1. **Open the report.** Kwame opens "Grant report 2026". The contents and footnotes from storyboard 35 are still there.
2. **Add two sources.** Tools › Citations opens a panel set to APA. Add citation source asks for a book: author "Mensah", title "Youth football in Accra", year "2024". A second source is the article "Coaching hours", author "Boateng", year "2023".
3. **Cite them.** After "attendance rose 40%" he clicks Cite on Mensah. The text gains "(Mensah, 2024)". After the coaching paragraph he cites Boateng. Each citation is part of the sentence, and clicking it selects the source in the panel.
4. **Bibliography.** At the end he clicks **Insert bibliography**. A "References" list shows Mensah, then Boateng, in APA. A third source he adds and never cites, "Unused notes", does not appear.
5. **It keeps up.** He changes Mensah's year to 2022. Within a second both the in-text citation and the bibliography say 2022. There is no refresh control.
6. **Export.** File › Export DOCX. The file Word opens has a citation field for Mensah and for Boateng, a bibliography field, and the sources Word's citation manager reads. The footnotes and the table of contents from storyboard 35 are still in the file.
7. **Back from Word.** The funder's officer does not edit the citations. Kwame opens the returned file. The import summary includes "2 citations, 1 bibliography". Both citations are still citations linked to Mensah 2022 and Boateng 2023, not plain parentheses. Changing Boateng's year to 2021 updates the citation and the bibliography again.

## Google Workspace benchmark

Google Docs citations take Tools › Citations (2 clicks), Add citation source and the fields, then Cite on the source (1 click). Insert bibliography is 1 click at the bottom of the sidebar ([Docs Help](https://support.google.com/docs/answer/10090962)). Styles are MLA 8th, APA 7th, and Chicago Author-Date 17th. Download as Word is 3 clicks.

Known pain points:

- Insert bibliography writes the list once. Later edits mean inserting it again or fixing the text.
- A page number arrives as "#", which you delete by hand ([Workspace Learning Center](https://support.google.com/a/users/answer/10993081)).
- Deleting a source in the sidebar leaves the citation in the document.
- The Word download is formatted text. Word's citation manager does not see sources it can update, so a round trip flattens the bibliography.

## Better than Google Workspace when

1. Tools › Citations adds a book source (author, title, year) and inserts an in-text citation at the cursor. Cite itself is 1 click once the source exists.
2. Insert bibliography adds every cited source in the selected style (APA in this story; MLA and Chicago are in the same menu) and omits a source that is never cited.
3. Editing a source's year updates every in-text citation of that source and the bibliography within 1 second, with no refresh control.
4. Export DOCX writes a Word citation field for each citation, a Word bibliography field, and the sources Word's citation manager reads. The footnotes and contents field from storyboard 35 are still present.
5. Opening that docx restores the citations as citations linked to those sources, not as plain parenthetical text, and the import summary counts the citations and the bibliography.
6. A round trip of Mensah and Boateng returns the same authors, titles, years, and the same two places in the text.
7. Clicking an in-text citation selects its source in the citations panel.

## Success looks like

- The report cites Mensah (2022) and Boateng, and the bibliography lists those two and not the unused source.
- The Word file comes back with both citations still linked, and a later year change updates the citation and the bibliography together.

## Gaps and notes

- Footnotes, endnotes, and a table-of-contents field already round-trip (storyboard 35, `word/footnotes.xml` and a TOC field). There is no citation object, no source list, and no bibliography node.
- `docx-export.ts` and `word.ts` do not write or read a `CITATION` field, a `BIBLIOGRAPHY` field, or a bibliography source part.
- The styles this story has to render are the three Google offers: MLA, APA, and Chicago Author-Date. The recording uses APA. The other two need the same source to produce their own in-text form and bibliography line, which a test can check without a second recording.
- Page numbers are optional on the source. This story does not insert a "#" placeholder.
