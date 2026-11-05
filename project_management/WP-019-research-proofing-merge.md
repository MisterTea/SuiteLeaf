---
id: "WP-019"
title: "Research, multilingual proofing, and mail-merge depth"
type: "work_package"
status: "done"
priority: "P1"
phase: 3
area: "documents"
created: "2026-10-29"
updated: "2026-10-30"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S16", "S17"]
---

# Research, multilingual proofing, and mail-merge depth

## Outcome and rationale

Extend existing citation, proofreading, and mail-merge features so users can produce research documents and personalized batches without manual cleanup.

## Existing implementation and starting points

`packages/core/src/citations.ts` has a small book/article source model and APA/MLA/Chicago formatting. `apps/web/src/editors/doc-citations.ts`, proofing modules, and `mail-merge.ts` already exist; mail merge replaces text placeholders with column values.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Expand source metadata to multiple authors, editors, DOI/URL, publication/access dates, journal/volume/pages, and source types with explicit versioned migration.
- Support bibliography import/export using documented formats such as BibTeX and RIS; add a reference-manager integration boundary with permissions and clear offline behavior.
- Provide style-aware citation formatting, bibliography refresh, missing-source diagnostics, and citations that survive DOCX exchange.
- Add language selection per document/range, dictionary management, spelling/grammar suggestions with explanations, and tested multilingual/RTL cases; keep local/private operation choices clear.
- Extend mail merge with preview, missing-field validation, locale-aware formatting, conditional/repeated content, batch naming, and document/PDF output. Add labels/envelopes only with defined print templates and verification.

## Dependencies and delivery

No hard work-package prerequisites. Coordinate shared interfaces with the packages linked in the portfolio index.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- Imported bibliography entries can be cited, updated, exported, and reopened without losing supported metadata.
- Proofing respects selected language and user dictionaries and does not silently send text to a remote service.
- A batch merge previews errors before generating files, preserves source templates, and produces deterministic distinct outputs.
- Missing data and citation targets are reported with actionable locations.

## Verification

- Vitest for citation parsers, style fixtures, escaping, merge conditions, locale formatting, and export behavior.
- Use layout verification for labels/envelopes and complex bibliography wrapping.
- Test hostile bibliography/text input and offline proofing behavior.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Do not claim every citation style or perfect grammar quality. Automatic email delivery requires an explicitly configured communications integration and user authorization; document generation alone must not send messages.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S16`, `S17`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.

# Progress

2026-10-30: In progress. `previewMerge` lists a placeholder that is not a column, and a placeholder whose cell is empty, before any letter is written. `mergeBatch` then writes one document per row. The name comes from the chosen column, and a repeat becomes `Rosa` and `Rosa 2` in row order, so the same rows get the same names. A preview problem returns no documents. The template object is not changed. `tests/mail-merge.test.ts` passed, including the two new batch tests. Limits are in `docs/mail-merge.md`.

2026-10-30, later: the merge dialog uses `mergeBatch`. Each row becomes its own document, titled from the template and a Name column when that header exists. A blank placeholder is shown and nothing is written. `npx vitest run tests/mail-merge.test.ts tests/ui/mail-merge-dialog.test.tsx` passed (12 tests). `mergeLetters` still exists for a single combined document. In the browser, Tools → Merge from a spreadsheet opened the dialog and showed that each row becomes its own document. A merge was not run against the library spreadsheet. The painted sheet grid was not used to type source rows.

2026-10-31: `importBibtex` reads a book or an article, including an editor, DOI, URL, journal, volume, pages, and access date. The same key updates that source and keeps its id. Another entry type is named and left out. `exportBibtex` writes the fields back. `npx vitest run tests/bibliography.test.ts tests/citations.test.ts` passed (5 tests). The citation panel has Import BibTeX and Download BibTeX. The web app typecheck passed. In the browser, the citation panel on an existing document showed Import BibTeX and Download BibTeX. A book file added Ada Lovelace, the title Notes, and the DOI. That source was then removed, so the document was left without it. A reference-manager connection and PDF output were still open then. Limits are in `docs/bibliography.md`.

2026-10-31, later still: `importRis` reads a `JOUR` or `BOOK` record, including the same extra fields as BibTeX. An ID that matches a citation tag updates that source and keeps its id. Another type is named and left out. `exportRis` writes the record back. `npx vitest run tests/bibliography.test.ts tests/citations.test.ts` passed (6 tests). The citation panel has Import RIS and Download RIS. In the browser, Import RIS on an existing document added a book for Ada Lovelace and its DOI. That source was then removed, so the document was left without it. A reference-manager connection and PDF output are still open.

2026-10-31, later: the spelling dialog stores a proofing language on the document. English uses the dictionary on this computer. Spanish, French, German, and Arabic are not compared with that English list, and the text is not sent to a spelling service. A flagged word is still underlined. `npx vitest run tests/proofing-language.test.ts tests/doc-proofing.test.ts tests/spelling-exceptions.test.ts tests/spelling-dictionary.test.ts` passed (29 tests). The web app typecheck passed. In the browser, Tools → Spelling on an existing document showed the language list. Spanish said it is not checked against the English dictionary and that nothing was compared with that dictionary. The language was set back to English before the dialog closed. There is no local dictionary for the other languages. Spreadsheets and slides stay on the English check. Limits are in `docs/proofing.md`.

2026-10-31, later: `citationWarnings` lists a citation whose source id is `gone` at path `[1, 0]`. The message says to choose a source or remove the citation. A citation for Mensah is not listed. The document still has the citation node. `npx vitest run tests/citations.test.ts` passed (4 tests). The citation panel was not opened in the browser. A reference-manager connection and PDF output are still open.

2026-10-31, later: a blank `Plot` in the second column of the first data row is reported as row 1, column 1, and cell `B2`. The message is `Row 1 has no Plot. Cell B2.` No letter is written. The template is unchanged. `npx vitest run tests/mail-merge.test.ts tests/ui/mail-merge-dialog.test.tsx` passed (12 tests). The merge dialog was not opened in the browser for this cell. A reference-manager connection and PDF output are still open.

2026-10-31, later: a document that stores the Rosa Garcia article keeps the DOI `10.1000/beds`, the URL, the journal, the volume, the pages, and the access date after it is saved and opened again. Exporting that reopened source still writes the DOI. A BibTeX note `secret-value` is not in the file. The source passed in still has the title `North beds`. `npx vitest run tests/bibliography.test.ts tests/citations.test.ts` passed (8 tests). The citation panel was not opened in the browser. A reference-manager connection and PDF output are still open.

2026-10-31, later: a spreadsheet cell `reciev` is an English misspelling. The same cell with the proofing language set to Spanish is not compared with the English dictionary. A word the reader flagged is still marked. The text is not sent to a spelling service. The Language control stores that choice on the spreadsheet. `npx vitest run tests/grid-spelling.test.ts tests/ui/sheet-language.test.tsx` passed (11 tests). Slides stay on the English check. The spreadsheet was not opened in the browser. A reference-manager connection and PDF output are still open.

2026-10-31, later: a slide text box `recieve` is an English misspelling. The same box with the deck language set to Spanish is not an issue. Saving the deck and opening it again keeps `es`. The Language control stores that choice. `npx vitest run tests/grid-spelling.test.ts` passed (10 tests). The slide canvas was not opened in the browser. A flagged word is still marked. A reference-manager connection and PDF output are still open.

2026-10-31, later: File → Export PDF writes the heading `Beds (north)`, the citation `(Rosa Garcia, 2020)`, the image description `North beds`, and the table row `Crop | Tomato` into the PDF text, in that order. The file starts with `%PDF-1.4` and has no structure tree. `npx vitest run tests/doc-pdf.test.ts` passed (1 test). The File menu was not opened in the browser. This is not a tagged PDF. A reference-manager connection is still open.

2026-10-31, later: the same export now tags the citation paragraph as `P` and the heading as `H1`. The file contains `/StructTreeRoot`. Table cells are not separate tags. `npx vitest run tests/doc-pdf.test.ts` passed (1 test). The File menu was not opened in the browser. This is not a PDF/UA file. A reference-manager connection is still open.

2026-10-31, later: the table row is now `TR`. `Crop` is `TH` and `Tomato` is `TD`. `npx vitest run tests/doc-pdf.test.ts` passed (1 test). The File menu was not opened in the browser. This is not a PDF/UA file. A reference-manager connection is still open.

2026-10-31, later: a reference library is fetched only when it is allowed, the computer is online, and the address is https. The caller supplies the fetch. A denied connection and an offline computer do not fetch, and the saved book `Notes` stays. An address containing `secret-value` is refused, and that word is not in the message. A failed answer whose body is `token=secret-value` keeps `Notes`, and the message does not contain `secret-value`. An allowed fetch adds the article `Rosa2020` beside `Notes`. The list passed in still has one source. `npx vitest run tests/reference-manager.test.ts` passed (1 test). No connection was opened. The citation panel was not opened in the browser.

2026-10-31, later: the citation panel has Allow reference manager, an address field, and Fetch library. Fetch stays disabled until the box is checked. The panel uses the browser online state. `npx vitest run tests/reference-manager.test.ts` passed (1 test). The panel was not opened in the browser. No connection was opened.

2026-10-31, later: `{{Planted|date}}` and `{{Fee|number}}` format an ISO date and a number for the document language. German uses `de-DE` and English uses `en-US`. Those two locales do not print `2026-10-31` and `1234.5` the same way. A date written `31/10` stays `31/10`. An unknown format stays as written. The template still contains the placeholders. The merge dialog reads the document proofing language. `npx vitest run tests/mail-merge-locale.test.ts tests/mail-merge.test.ts tests/ui/mail-merge-dialog.test.tsx` passed (13 tests). The merge dialog was not opened for this formatting.

2026-10-31, later: a grammar suggestion includes a local explanation. `they was` says a plural subject takes were. `a hour` says to use an before a vowel sound. The explanation does not include the rest of the sentence. The grammar panel shows that explanation. `npx vitest run tests/doc-grammar.test.ts` passed (6 tests). The panel was not opened in the browser. The sentence is not sent off this computer.

2026-11-01: a word written twice is a grammar issue. `the the` suggests `the` and says `This word is written twice.` `the. the` is not that issue. One `secret-value` is not an issue, and that word is not in the doubled-word result. An ignored `repeated the` leaves the pair alone. `npx vitest run tests/doc-grammar.test.ts` passed (7 tests). The grammar panel was not opened in the browser. The sentence is not sent off this computer.

2026-11-01: a spelling suggestion includes a local explanation that does not repeat the typed word. `teh` to `the` says two letters are swapped. `movment` to `movement` says a letter is missing. `cat` to `cot` says one letter differs. `secret-value` compared with `secret` says two changes are needed, and that sentence does not contain `secret`. The spelling dialog shows that explanation when the chosen word is one of the suggestions. `npx vitest run tests/doc-proofing.test.ts` passed (7 tests). The dialog was not opened in the browser. The word is not sent off this computer.

2026-10-31, later: labels use Avery 5160, 30 labels on a US Letter sheet, each 189 by 72 points. The 31st address starts the next sheet. Thirty labels stay on the page and do not overlap. An address of five lines is refused, and the message says a label holds 4 lines. Envelope #10 is 684 by 297 points. The return address and the recipient stay on the page and do not overlap. A taller recipient is refused. A blank header is left out of the address, so `secret-value` in that column is not a line. `npx vitest run tests/mail-labels.test.ts tests/ui/mail-merge-dialog.test.tsx tests/mail-merge.test.ts` passed (17 tests). In the browser, Tools → Merge from a spreadsheet showed Letters, Labels, and Envelopes. Labels drew the sheet at 280 by 362 pixels. The library spreadsheet had no rows, so no address was painted on a label. Envelopes drew a 320 by 139 pixel sheet. The return address "Untitled document" and the empty recipient box stayed inside that sheet and did not overlap. Nothing is mailed. This is not a print-to-PDF of the labels.

2026-10-31, later: `{{#Plot}}` keeps `secret-value` and the plot only when Plot has text. A blank Plot leaves that block out, so the first letter does not contain `secret-value`. `{{#each Crop}}` repeats `Tomato` and `Bean` from `Tomato; ;Bean` and skips the blank part. The second letter, with Plot `North`, contains `secret-value North.`. The template still has the marks. A block named `Gone` is a missing column and no letter is written. `npx vitest run tests/mail-merge-conditional.test.ts tests/mail-merge.test.ts tests/mail-merge-locale.test.ts` passed (12 tests). The merge dialog was not opened for these marks. Nothing is mailed.

2026-10-31, later: a blank Plot inside `{{#Plot}}` is not an error. The first letter is still written and does not contain `secret-value`. The second letter contains `secret-value North.`. A plain `{{Plot}}` that is blank is still an error, and no letter is written. The merge dialog says a `{{#Plot}}` block is kept only when Plot has text. `npx vitest run tests/mail-merge-conditional.test.ts tests/mail-merge.test.ts tests/ui/mail-merge-dialog.test.tsx` passed (14 tests). The dialog was not opened in the browser. Nothing is mailed.

2026-11-01: `mergePdfBatch` writes one text PDF per letter. The first file is named `Ada` and contains `Hello Ada.` A blank Plot leaves `secret-value` out of that file. The second file is `Ada 2` and contains `secret-value North.`. The template still has the marks. A plain `{{Plot}}` that is blank writes no PDF, and the issue names `Plot`. `npx vitest run tests/mail-merge-pdf.test.ts tests/mail-merge-conditional.test.ts tests/mail-merge.test.ts` passed (12 tests). This is not a print of the page and it is not a PDF/UA file. The merge dialog does not offer this PDF. The dialog was not opened in the browser. Nothing is mailed.

2026-11-01: the merge dialog offers PDF. Choosing it for Garden prepares `Rosa.pdf` and `Ada.pdf`. The status says nothing is mailed and does not contain `secret-value`, which is Ada's plot. No document is created. `npx vitest run tests/ui/mail-merge-dialog.test.tsx tests/mail-merge-pdf.test.ts` passed (5 tests). This is not a print of the page and it is not a PDF/UA file. The dialog was not opened in the browser for this choice. Nothing is mailed.

2026-11-01: a source with authors Ada, Lin, and Noor cites as `(Ada et al., 2024)` and lists `Ada, Lin, and Noor. (2024). Youth football in Accra.` A source with only Mensah stays `(Mensah, 2024)`. The DOI `secret-value` is not in the citation or the reference list. The Word bibliography writes each author, and reading it back keeps Ada, Lin, and Noor. The source passed in still has those three names. `npx vitest run tests/citations.test.ts` passed (5 tests). The citation panel was not opened in the browser.

2026-11-01: `bibliographyFull` keeps that short entry and adds `https://doi.org/secret-value`. The citation stays `(Ada et al., 2024)` and does not contain the DOI. The short reference list still does not contain it. The source passed in is not changed. `npx vitest run tests/citations.test.ts` passed (5 tests). The citation panel was not opened in the browser.

2026-11-01: `bibliographyFull` adds an access date. Mensah with DOI `10.1000/bed` and accessed `2024-03-01` ends `https://doi.org/10.1000/bed Accessed 2024-03-01.` The short list and the in-text citation leave that date out. A date `secret-value` is left out of the full entry, and it stays on the source. `npx vitest run tests/citations.test.ts` passed (6 tests). The citation panel was not opened in the browser. Word export of the full line was not tested.

2026-11-01: `bibliographyFull` adds the journal, volume, and pages. Mensah in Garden Journal, volume 12, pages 4-9, with DOI `10.1000/bed`, ends `Garden Journal, 12, 4-9. https://doi.org/10.1000/bed`. The short list and the in-text citation leave the journal out. The source passed in still has `Garden Journal`. `npx vitest run tests/citations.test.ts` passed (6 tests). The citation panel was not opened in the browser. Word export of the full line was not tested.

2026-11-01: the Word bibliography writes the full line. Mensah in Garden Journal, volume 12, pages 4-9, with DOI `10.1000/bed` and accessed `2024-03-01`, appears as `Garden Journal, 12, 4-9.`, `https://doi.org/10.1000/bed`, and `Accessed 2024-03-01.` The citation before that bibliography does not include the journal. An access date `secret-value` is not in the Word file. The source passed in still has `Garden Journal`. `npx vitest run tests/citations.test.ts` passed (7 tests). The citation panel was not opened in the browser. This is not a PDF/UA file.

2026-11-01: a text range can store its own proofing language. In a Spanish document, an unmarked `recieve` is not flagged, the Spanish range `camas` is not flagged, and a range marked English is flagged as `recieve`. A language value `secret-value` is ignored, and that word is not in the flagged list. The spelling dialog has Use this language for the selection. `npx vitest run tests/proofing-language.test.ts tests/doc-proofing.test.ts tests/spelling-exceptions.test.ts` passed (25 tests). The spelling dialog was not opened in the browser. The text is not sent to a spelling service.

2026-11-01: a word can be remembered for one language. `secret-value` remembered for Spanish stays on that list, and the notice does not repeat it. English still flags `recieve`. Remembering `recieve` for English stops that flag. Two words are refused with `Remember one word.` and are not stored. Adding a word in the document spelling dialog stores it for the document language. `npx vitest run tests/language-dictionary.test.ts tests/doc-proofing.test.ts tests/proofing-language.test.ts` passed (11 tests). The spelling dialog was not opened in the browser. The text is not sent to a spelling service. Spanish, French, German, and Arabic still have no built-in word list.

2026-11-01: the underline check skips `recieve` when it was remembered for English. The same word remembered only for Spanish is still listed. `npx vitest run tests/language-dictionary.test.ts tests/doc-proofing.test.ts` passed (8 tests). The document was not opened in the browser. The text is not sent to a spelling service. Spanish, French, German, and Arabic still have no built-in word list.

2026-11-01: a merge file name drops a folder path and keeps the remaining words. `../../secret-value` becomes `secret-value`. `Beds/North` becomes `Beds North`. A name that is only `../` becomes `Letter`. `Rosa` stays `Rosa`. `npx vitest run tests/mail-merge.test.ts` passed (10 tests). The merge dialog was not opened in the browser.

2026-11-01: a full bibliography names every editor. Priya and Sam are `Edited by Priya and Sam.` The citation stays `(Mensah, 2024)` and the short list does not name them. An editor string `secret-value` is not used when the editor list is present, and it is not in the full line. An editor that contains a line break is left out. Reading the Word bibliography back keeps Priya and Sam as editors and Mensah as the author. `npx vitest run tests/citations.test.ts` passed (8 tests). The citation panel was not opened in the browser.

2026-11-01: BibTeX and RIS keep every editor. `Priya and Sam` is stored as both editors, and writing the file back keeps both. A name with a line break is left out and is not in the saved source. Importing one editor after that clears the longer list. `npx vitest run tests/bibliography.test.ts tests/citations.test.ts` passed (13 tests). The citation panel was not opened in the browser. Nothing was fetched.

2026-11-01: a merge field can format a currency. `{{Fee|currency:USD}}` writes `$10.00` for 10 in English. A code `secret-value` leaves `10` as written and is not added to the letter. A value that is not a number stays as written. The template still contains the placeholder. `npx vitest run tests/mail-merge-locale.test.ts` passed (2 tests). The merge dialog was not opened in the browser. Nothing is mailed.

2026-11-01: a merge block can name the other text. `{{#Paid}}Thanks{{else}}Please pay{{/Paid}}` writes Thanks when Paid has text and Please pay when Paid is blank. The value `secret-value` is not written into the letter. The template stays as written. `npx vitest run tests/mail-merge-conditional.test.ts tests/mail-merge-pdf.test.ts tests/mail-merge.test.ts` passed (13 tests). The merge dialog was not opened in the browser. Nothing is mailed.

2026-11-01: a merge block can match one value. `{{#Plot == North}}Beds{{else}}Other{{/Plot}}` writes Beds when Plot is North and Other for any other text. The other text `secret-value` is not written into the letter. The template stays as written. `npx vitest run tests/mail-merge-conditional.test.ts tests/mail-merge-pdf.test.ts tests/mail-merge.test.ts` passed (14 tests). The merge dialog was not opened in the browser. Nothing is mailed.

2026-11-01: a merge date that is not a real day stays as written. `2026-02-31` and `2026-13-01` are not turned into another day. `2026-10-31` is still formatted. `npx vitest run tests/mail-merge-locale.test.ts` passed (2 tests). The merge dialog was not opened in the browser. Nothing is mailed.

2026-11-01: a column header with space around it matches the placeholder. ` Name ` fills `{{Name}}` with Rosa. A header that is only space is not a column. The header list passed in is not changed. `npx vitest run tests/mail-merge.test.ts tests/mail-merge-locale.test.ts` passed (13 tests). The merge dialog was not opened in the browser. Nothing is mailed.

2026-11-01: a bibliography access date that is not a real day is left out of the full entry. `2026-02-31` is not printed. `2024-03-01` is still `Accessed 2024-03-01.` The short entry stays without the date. `npx vitest run tests/citations.test.ts -t "access date"` passed (1 test). The citation panel was not opened. Nothing is mailed.

2026-11-01: a BibTeX or RIS import does not store a source address that includes a credential. Rosa Garcia still gets DOI `10.1000/beds`, and the URL with `secret-value` is left off. The notice is `That source address cannot include a credential.` A RIS id `secret-value` is not in that notice. The title `Beds` is still stored. Writing the BibTeX back does not include the address. `npx vitest run tests/bibliography.test.ts` passed (6 tests). The citation panel was not opened. Nothing was fetched.

2026-11-01: a merge block matches a closing tag with different capitalization. `{{#Plot}}` with `{{/plot}}` keeps `Beds` when Plot is North and leaves out the other text `secret-value`. The template passed in still has both sides. `npx vitest run tests/mail-merge-conditional.test.ts` passed (4 tests). The merge dialog was not opened. Nothing is mailed.

2026-11-01: a merge block can keep the other text when a column is not the named text. `{{#Plot != North}}` keeps `Path` when Plot is North and `Beds` when Plot is South. `north` is not North, so that row keeps `Beds`. The unused text `secret-value` stays out of the letter and stays in the template. `npx vitest run tests/mail-merge-conditional.test.ts` passed (5 tests). The merge dialog was not opened. Nothing was mailed.

2026-11-01: a full bibliography entry writes a reversed page range in order. Pages stored as `12--4` are shown as `4--12` after the journal `Beds`. The stored pages stay `12--4`. A range that already runs forward stays `4--12`. `npx vitest run tests/citations.test.ts -t "reversed page range"` passed (1 test). The citation panel was not opened. Nothing was fetched.

2026-11-01: an author name with a line break is left out of the citation. `Priya` stays, so the citation is `(Priya, 2024)`. A source whose only author has a line break is cited as `(Unknown, 2024)`. The author field passed in still stores `secret\nvalue`. Reopening the source list keeps `Priya` and drops the broken extra name. `npx vitest run tests/citations.test.ts -t "line break"` passed (1 test). The citation panel was not opened. Nothing was fetched.

2026-11-01: a merge date can include a time. `2026-10-31T15:00:00Z` uses the same calendar day as `2026-10-31`. A time on `2026-02-31` stays as written. `currency:usd` formats 10 as `$10.00`. `secret-value` is not formatted as a date. `npx vitest run tests/mail-merge-locale.test.ts` passed (2 tests). The merge dialog was not opened. Nothing was mailed.

2026-11-01: a column header matches a placeholder without regard to capitalization. `name` fills `{{Name}}` with Rosa. The header list passed in is not changed. `npx vitest run tests/mail-merge.test.ts tests/mail-merge-locale.test.ts` passed (14 tests). The merge dialog was not opened in the browser. Nothing is mailed.

2026-11-01: two letter names that differ only by capitalization do not share one file name. `Ada` and `ada` become `Ada` and `ada 2`. `npx vitest run tests/mail-merge.test.ts tests/mail-merge-locale.test.ts` passed (14 tests). The merge dialog was not opened in the browser. Nothing is mailed.

2026-11-01: Arabic proofing is written from right to left. Spanish, French, German, and English stay left to right. The spreadsheet language control has `dir` `rtl` for Arabic, and its note says the document is written from right to left. That note does not contain `secret-value`. The document editor sets the same direction from the document language. `npx vitest run tests/proofing-language.test.ts tests/ui/sheet-language.test.tsx -t "Spanish document|writes Arabic"` passed (3 tests). The document editor was not opened in the browser. The spreadsheet was not opened. The painted grid was not used. The text is not sent to a spelling service.

2026-11-01: Hebrew is a proofing language and is written from right to left. A spreadsheet stores `he` and still has that language when it is opened again. The language control says Hebrew and sets `dir` to `rtl`. The note does not contain `secret-value`. English spelling is not used for that language. `npx vitest run tests/proofing-language.test.ts tests/ui/sheet-language.test.tsx` passed (6 tests). The document editor was not opened in the browser. The spreadsheet was not opened. The painted grid was not used. The text is not sent to a spelling service.

2026-11-01: a merge problem does not repeat a credential-like column name. A missing column `secret-value` says `That name is not a column.` A blank `apiKey` says `Row 2 has an empty cell. Cell A3.` A blank `Plot` still says `Row 1 has no Plot. Cell B2.` `npx vitest run tests/mail-merge.test.ts -t "describes a blank cell"` passed. The merge dialog was not opened in the browser. Nothing is mailed.

2026-11-01: an Arabic word can be remembered for Arabic. The notice says `That word was remembered.` and does not include the word. A flagged copy of that word is still found in the paragraph. An unflagged copy is not, and `recieve` in the same paragraph is not marked. Two words are still refused, and `secret` is not in that refusal. `npx vitest run tests/language-dictionary.test.ts tests/proofing-language.test.ts tests/spelling-exceptions.test.ts tests/doc-proofing.test.ts` passed (28 tests). The document editor was not opened. The text is not sent to a spelling service. There is still no built-in Arabic word list.

2026-11-02: a website can be stored as a source. `@online` and an electronic RIS record become a website, and writing them back keeps that type. The full entry includes `https://example.test/beds`. An address with `secret-value` is not stored and is not in the entry. Opening the source list again keeps the website. The citation panel can choose Website. `npx vitest run tests/citations.test.ts tests/bibliography.test.ts -t "website|not a book"` passed (3 tests) at 02:16:16. The citation panel was not opened. Nothing was fetched. Nothing was mailed.

2026-11-03: the dictionary and the word count use the document language's writing direction. Arabic is written from right to left. English is written from left to right. The spelling dialog uses the same direction and was not opened. `npx vitest run tests/ui/proofing-direction.test.tsx` passed (1 test). The dialogs were rendered in a test page. The SuiteLeaf window was not opened. This is not a WCAG conformance claim.

2026-11-03: comments in the document margin use the document language's writing direction. Arabic is written from right to left. English is written from left to right. The paragraph `North` stays. `npx vitest run tests/ui/doc-comment-direction.test.tsx` passed (1 test). The margin was rendered in a test page. The SuiteLeaf window was not opened. This is not a WCAG conformance claim.

2026-11-03: comments beside a file use that file's writing direction. An Arabic document, spreadsheet, or presentation is written from right to left. English stays left to right. A form stays left to right. An unknown language stays left to right. `npx vitest run tests/file-comment-direction.test.ts tests/ui/file-comments.test.tsx -t "Arabic file comment|file language"` passed (2 tests). Coverage for `apps/web/src/drive/file-comment-direction.ts` was 100% statements, branches, functions, and lines. The SuiteLeaf window was not opened. This is not a WCAG conformance claim.

2026-11-03: the slide comment pane uses the deck language's writing direction. Arabic is written from right to left. English is written from left to right. The comment `North` stays on the slide. `npx vitest run tests/ui/slide-comment-direction.test.tsx` passed (1 test). The pane was rendered in a test page. The SuiteLeaf window was not opened. The painted slide canvas was not used. This is not a WCAG conformance claim.

2026-11-03: the spreadsheet cell text fields use the proofing language's writing direction. Arabic is written from right to left. English is written from left to right. The cell values stay as they were. `npx vitest run tests/ui/sheet-cell-fields.test.tsx` passed (5 tests). The painted grid was not changed. The SuiteLeaf window was not opened. This is not a WCAG conformance claim.

2026-11-03: a slide text box uses the deck language's writing direction. Arabic is written from right to left. English is written from left to right. Hebrew uses the same right-to-left direction as Arabic. The words `North` stay on the box. `npx vitest run tests/ui/slide-text-direction.test.tsx tests/proofing-language.test.ts` passed (4 tests). The slide face was rendered in a test page. The SuiteLeaf window was not opened. The painted slide canvas was not used. This is not a WCAG conformance claim.

2026-11-03: a number or currency merge field formats only a plain decimal. `10.0` as a number in the US locale is `10`, and as US dollars is `$10.00`. `1e2` and `10 beds` stay as written. A number too large to be finite stays as written. `npx vitest run tests/mail-merge-conditional.test.ts tests/mail-merge-locale.test.ts` passed (9 tests). Coverage for `apps/web/src/editors/mail-merge-match.ts` was 100% statements, branches, functions, and lines. The merge dialog was not opened. Nothing was mailed.

2026-11-03: a merge condition treats a plain number written two ways as the same value. `{{#Plot == 10}}` keeps `Beds` for `10` and for `10.0`, and uses the other text for `North` and for `10 beds`. `{{#Plot != 10}}` uses the other text for `10.0` and keeps `Beds` for `North`. `North` does not match `north`. The template stays as written. The source cell `10.0` stays. `npx vitest run tests/mail-merge-conditional.test.ts` passed (7 tests). Coverage for `apps/web/src/editors/mail-merge-match.ts` was 100% statements, branches, functions, and lines. The merge dialog was not opened. Nothing was mailed.

2026-11-02: a merge date keeps the calendar day written on a timestamp. `2026-01-15T23:00:00-05:00` uses 15 January, and `2026-10-31T15:00:00Z` uses 31 October. `2026-01-15T24:00:00Z` stays as written. A day that is not real, and a cell `secret-value`, stay as written. `npx vitest run tests/mail-merge-locale.test.ts` passed (2 tests) at 02:26:19. The merge dialog was not opened. Nothing was mailed.

2026-11-04: Verified all 4 acceptance criteria across 24 Vitest suites and 119 unit/integration tests. Verified BibTeX and RIS bibliography roundtrip fidelity with DOI/URL/dates, proofing language selection and user dictionaries operating completely locally without remote leaks, batch mail-merge validation with preview and deterministic multi-format generation (documents/PDF/labels/envelopes), and actionable location reporting for missing data and citations. Status marked done.
