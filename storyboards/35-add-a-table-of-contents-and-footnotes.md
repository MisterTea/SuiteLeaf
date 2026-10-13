# 35 · Add a table of contents and footnotes

**Mode:** single-node · **App:** Docs · **Video:** [videos/35-add-a-table-of-contents-and-footnotes.mp4](videos/35-add-a-table-of-contents-and-footnotes.mp4) · **Script:** [scenes/35-add-a-table-of-contents-and-footnotes.spec.ts](scenes/35-add-a-table-of-contents-and-footnotes.spec.ts)

## Who and why

Kwame is writing a 20-page grant report for a youth football charity. The funder wants a table of contents on page 2, sources cited in footnotes, and the report as a Word file. Kwame keeps moving sections around until the last minute, so the contents page has to keep up without him remembering to refresh it, and the footnotes have to arrive in Word as real footnotes.

## Inspired by

- WF-A1-12 and the Word import notes in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): imports keep "footnote/endnote text", and headings and the outline are supported.
- [Docs Editors Help: Add a title, heading, or table of contents](https://support.google.com/docs/answer/116338): Insert › Table of contents, then Refresh after adding headings. In pageless mode the table can't be formatted.
- [Automateed: Google Docs table of contents](https://www.automateed.com/google-docs-table-of-contents): "Google Docs won't automatically update your TOC the moment you move things around", and "page numbers were off by several pages because sections were moved".
- [Glimmer: making bookmarked PDFs from Google Docs](https://glimmer.gwizlabs.net/blog/2020/05/25/making-bookmarked-pdfs-from-google-docs/): PDF downloads have no bookmarks, and ODT export "does not export a proper Table of Contents".
- [Freedom251: footnotes in Google Docs](https://freedom251.com/how-to-insert-footnotes-in-google-docs/): Word footnotes "can come across imperfectly" on import.
- [Docs Editors Community: convert footnotes into endnotes](https://support.google.com/docs/thread/223655381/how-do-i-convert-footnotes-into-endnotes-in-google-docs?hl=en): Docs turned a client's endnotes into footnotes, and there's no way back.
- Storyboard [04](04-long-report-with-outline.md): SuiteLeaf's outline and heading links.

## Scenes

1. **Open the report.** Kwame opens "Grant report 2026" from his files. It has a title page, a page break, and 8 Heading 1 and Heading 2 sections. The outline lists them on the left.
2. **Insert the contents.** On page 2 he chooses Insert › Table of contents › **With page numbers** (two clicks). A table appears listing every heading, indented by level, with dotted leaders and page numbers.
3. **It follows the document.** He renames "Results" to "What we achieved", adds a Heading 2 "Coaching hours", and cuts the "Budget" section and pastes it above "What we achieved". Within a second the table shows the new names, the new entry, and the new order and page numbers. There's no Refresh button.
4. **Use it as links.** Clicking "Budget" in the table scrolls to that heading. **Options** on the table switches between page numbers and plain links, and between Heading 1 only and levels 1 to 3.
5. **Add a footnote.** After "attendance rose 40%" he presses Cmd/Ctrl+Alt+F. A superscript appears at the cursor, and he types the source in the note.
6. **More footnotes.** He adds two more later in the report, then inserts one earlier. The numbers update to 1 to 4 in reading order. Clicking a number in the text jumps to its note, and clicking the note's number jumps back.
7. **Print layout.** The notes that belong on a page sit together at the bottom, under a short rule. A note taller than that band continues on the next page.
8. **Export for the funder.** File › Export DOCX. The file Word opens has a real table-of-contents field (References › Update Table) and real footnotes (`footnotes.xml`, `w:footnoteReference`).
9. **Back from Word.** The funder's officer adds an endnote and returns the file. Kwame opens it: the contents, the four footnotes, and the endnote are linked to their markers. The import summary reads "4 footnotes, 1 endnote, 1 table of contents". Endnotes stay endnotes.

## Google Workspace benchmark

In Google Docs, a table of contents is 3 clicks: Insert › Table of contents › a style. It doesn't update by itself: after every heading change you click the table and then Refresh (2 clicks). A footnote is 2 clicks (Insert › Footnote) or Cmd/Ctrl+Alt+F. Download as Word is 3 clicks ([Docs Help](https://support.google.com/docs/answer/116338)).

Known pain points:

- The contents go stale until someone refreshes them, so exported PDFs ship with wrong page numbers ([Automateed](https://www.automateed.com/google-docs-table-of-contents)).
- PDF downloads have no bookmarks, and ODT export loses the table structure ([Glimmer](https://glimmer.gwizlabs.net/blog/2020/05/25/making-bookmarked-pdfs-from-google-docs/)).
- There are no endnotes: Word endnotes become footnotes on import and can't be converted back ([Docs Community](https://support.google.com/docs/thread/223655381/how-do-i-convert-footnotes-into-endnotes-in-google-docs?hl=en)).
- Imported Word footnotes need checking one by one ([Freedom251](https://freedom251.com/how-to-insert-footnotes-in-google-docs/)).
- In pageless mode the table of contents can't be formatted ([Docs Help](https://support.google.com/docs/answer/116338)).

## Better than Google Workspace when

1. Insert › Table of contents adds a table built from the headings in at most 2 clicks, with page numbers or links.
2. Renaming, adding, deleting, or moving a heading updates the table within 1 second with no refresh, and page numbers in print layout match the pages the headings are on.
3. Every entry links to its heading in the editor, and the table's options (page numbers or links, heading levels) are 1 click away on the table itself.
4. Cmd/Ctrl+Alt+F and Insert › Footnote insert a numbered marker and move the cursor into the note in one action. Notes renumber in reading order whenever one is added, deleted, or moved.
5. In print layout and Print / Save as PDF, each footnote is at the bottom of the page that holds its marker.
6. Export DOCX writes a Word table-of-contents field and real Word footnotes (`footnotes.xml` and `w:footnoteReference`). Word can update the table, and its footnote navigation finds every note.
7. Opening a .docx keeps footnotes and endnotes as notes linked to their markers (not plain superscript numbers), keeps endnotes as endnotes, and the import summary counts them.
8. Exporting a document with 4 footnotes and 1 endnote to DOCX and re-importing it gives the same notes, in the same places, with the same text.

## Success looks like

- Page 2 lists every heading with page numbers after the late changes, and Budget sits above What we achieved.
- The report has four linked footnotes. The returned Word file opens with those footnotes, an endnote that stayed an endnote, and a live contents table. The import summary counts them.

## Gaps and notes

- A footnote taller than the band at the bottom of its page continues on the next page. The notes in this recording fit, so that split is not on screen.
- Print / Save as PDF uses this same page layout. The recording exports DOCX and does not open the print dialog.
- SuiteLeaf's page numbers follow its own pagination, so they can differ from the pages Word would have used before Update Table.
- The contents options are page numbers or plain links, and Heading 1 only or levels 1 to 3.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| Insert › Table of contents adds a table from the headings in at most 2 clicks, with page numbers or links | Met | Video ~8s (Insert, then With page numbers). Options also offers With links. |
| Renaming, adding, or moving a heading updates the table within 1 second with no refresh, and page numbers match print layout | Met | Video ~12–18s. No Refresh control. `tests/browser/doc-notes.spec.ts` |
| Every entry links to its heading, and options are 1 click away on the table | Met | Video ~20s (Budget jumps; Options opens in one click). |
| Cmd/Ctrl+Alt+F and Insert › Footnote insert a marker and move into the note. Notes renumber in reading order | Met | Video ~28–34s, numbers 1–4. Shortcut is Cmd/Ctrl+Alt+F; Insert › Footnote is the same command. |
| In print layout, each footnote is at the bottom of the page that holds its marker | Met | Video ~36s, notes under a short rule at the foot of the page. Print uses this layout. |
| Export DOCX writes a Word TOC field and real footnotes | Met | `tests/doc-notes.test.ts` ("exports a Word table-of-contents field…"): `word/footnotes.xml`, `w:footnoteReference`, a TOC `instrText`. The recording's Export DOCX checks the same bytes. |
| Opening a .docx keeps footnotes and endnotes linked, keeps endnotes as endnotes, and the import summary counts them | Met | Video ~48s: "4 footnotes, 1 endnote, 1 table of contents", endnote under Endnotes. `tests/doc-notes.test.ts` ("keeps Word's own endnotes…"). |
| Exporting 4 footnotes and 1 endnote and re-importing returns the same notes | Met | `tests/doc-notes.test.ts` round trip: same four footnote texts, the endnote text, and a live table of contents. |
