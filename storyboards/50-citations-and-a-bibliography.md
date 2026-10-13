# 50 · Add a citation and a bibliography

**Mode:** single-node · **App:** Docs · **Video:** [videos/50-cite-a-source.mp4](videos/50-cite-a-source.mp4) · **Script:** [scenes/50-cite-a-source.spec.ts](scenes/50-cite-a-source.spec.ts)

## Who and why

Kwame's "Grant report 2026" already has a table of contents and footnotes (storyboard 35). The funder also wants two sources cited in the text and a bibliography at the end, in APA, and the Word file they already use has to come back with real citations. Kwame keeps fixing the year on one report until the last afternoon, so every citation and the bibliography have to follow that edit.

## Inspired by

- WF-A4-27 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): a citation renders in the text, and a bibliography appears at the end.
- Storyboard [35](35-add-a-table-of-contents-and-footnotes.md): footnotes and a contents table already round-trip through Word. A citation is a different object.
- [Add citations and a bibliography](https://support.google.com/docs/answer/10090962): Tools › Citations, MLA, APA, or Chicago, then Cite and Insert bibliography.
- [Add citations and sources](https://support.google.com/a/users/answer/10993081): the bibliography is inserted once, a "#" stands in for a page number, and deleting a source in the sidebar leaves the in-text citation in the document.
- [Docs Editors Community: footnotes and endnotes](https://support.google.com/docs/thread/223655381/how-do-i-convert-footnotes-into-endnotes-in-google-docs): Docs and Word do not share one model of notes, and a bibliography is not a substitute that Word's citation manager understands.

## Scenes

1. **Open the report.** Kwame opens "Grant report 2026". The contents are at the top. Footnote 1, "League register, 2025.", sits at the bottom of the page.
2. **Add two sources.** Tools › Citations opens a panel set to APA, with MLA and Chicago beside it. Add citation source asks for a book: author "Mensah", title "Youth football in Accra", year "2024". The page field stays blank. A second source is the article "Coaching hours", author "Boateng", year "2023".
3. **Cite them.** After "attendance rose 40%" he clicks Cite on Mensah. The text gains "(Mensah, 2024)". After the coaching paragraph he cites Boateng. Each citation is part of the sentence, and clicking Mensah's citation selects that source in the panel.
4. **Bibliography.** He adds a third source, "Unused notes", and never cites it. The card says "Not cited". **Insert bibliography** adds a References list in APA, alphabetical: Boateng, then Mensah. Unused notes stays out. No "#" appears.
5. **It keeps up.** He changes Mensah's year to 2022. Within a second both the in-text citation and the bibliography say 2022. There is no refresh control.
6. **Export.** File › Export DOCX. The file has a citation field for Mensah and for Boateng, a bibliography field, and the sources Word's citation manager reads. The footnote and the table of contents are still in the file.
7. **Back from Word.** The funder's officer does not edit the citations. Kwame opens the returned file. The import summary includes "2 citations, 1 bibliography", and the footnote and contents came back too. Both citations are still citations linked to Mensah 2022 and Boateng 2023, not plain parentheses. Changing Boateng's year to 2021 updates the citation and the bibliography again.

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

- The report cites Mensah (2022) and Boateng (2021), and the bibliography lists those two, alphabetically, and not the unused source.
- The Word file comes back with both citations still linked, and a later year change updates the citation and the bibliography together.

## Gaps and notes

- The recording uses APA. MLA renders `(Mensah)` and a Works Cited heading; Chicago author-date renders `(Mensah 2022)`. `tests/citations.test.ts` and `tests/browser/citations.spec.ts` check those forms. A blank page never becomes "#"; a filled page becomes "p. 12" in APA.
- Removing a source also removes its in-text citations, so a deleted source does not leave a stranded parenthesis. The recording does not show that step.
- The exported docx was not opened in Microsoft Word. The package contains `CITATION` fields, a `BIBLIOGRAPHY` field, and a bibliography custom XML part (`http://schemas.openxmlformats.org/officeDocument/2006/bibliography`). SuiteLeaf's own import reads that package back into linked citations.
- The source form is author, title, year, and an optional page. It does not ask for a publisher, a URL, or a second author.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. Tools › Citations adds a book and Cite is one click | Met | Video 0:08–0:20; `tests/browser/citations.spec.ts` |
| 2. Bibliography lists cited sources in the selected style and omits an uncited source; MLA and Chicago are in the same control | Met | Video 0:28, References is Boateng then Mensah, Unused notes absent; style radios at 0:08; MLA/Chicago in `tests/citations.test.ts` and the browser spec |
| 3. Editing the year updates the citation and the bibliography within 1 second, with no refresh | Met | Video 0:32, Mensah becomes 2022 in the sentence and in References; `expect.poll` timeout 1000ms in the scene and the browser spec |
| 4. Export DOCX writes citation fields, a bibliography field, and Word's sources; footnote and contents remain | Met | Video 0:34; scene assertions on `CITATION Men24`, `CITATION Boa23`, `BIBLIOGRAPHY`, `footnoteReference`, `TOC`, and the bibliography custom XML; `tests/citations.test.ts` round trip |
| 5. Opening the docx restores linked citations, and the import summary counts them | Met | Video 0:38, banner "2 citations, 1 bibliography" plus the footnote and contents; citations are still buttons, not plain text |
| 6. Round trip keeps authors, titles, years, and the same two places | Met | Video 0:42, Mensah 2022 after "Attendance rose 40%" and Boateng 2021 after the coaching sentence; `tests/citations.test.ts` |
| 7. Clicking a citation selects its source | Met | Video 0:22, Mensah's card is outlined; browser spec |
