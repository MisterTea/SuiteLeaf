---
id: "WP-017"
title: "Professional document styles, fields, and structure"
type: "work_package"
status: "in_progress"
priority: "P1"
phase: 3
area: "documents"
created: "2026-10-29"
updated: "2026-10-30"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S17", "S20"]
---

# Professional document styles, fields, and structure

## Outcome and rationale

Support maintainable long reports and publications through reusable styles and automatically updated references.

## Existing implementation and starting points

Docs already has headings/outline, tables of contents, sections, columns, notes, page settings, equations, and citations. Inspect `apps/web/src/editors/Docs.tsx`, `apps/web/src/document-settings.tsx`, document layout helpers, and `packages/core/src/docx-export.ts`.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Add named paragraph/character styles, inheritance, modify-to-match, style import, and template defaults without destroying direct formatting unexpectedly.
- Implement stable numbered captions, cross-references to headings/figures/tables, lists of figures/tables, and indexes with marked entries.
- Define a field-update engine for page numbers, references, numbering, and tables of contents, including broken-target diagnostics and update-before-export behavior.
- Handle long-document pagination interactions, section numbering/restarts, keep-with-next/widow rules, and tables spanning pages.
- Integrate these features with native serialization, undo, templates, collaboration, and DOCX import/export. Use stable IDs rather than visible text as reference identity.

## Dependencies and delivery

No hard work-package prerequisites. Coordinate shared interfaces with the packages linked in the portfolio index.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- Changing a named style updates its users while respecting documented local overrides.
- Inserting/moving/deleting a figure updates numbering and references; deleted targets produce actionable warnings.
- A multi-section report updates its contents/figure lists and exports with correct supported fields.
- All metadata survives native save/reopen and undo/redo.

## Verification

- Vitest field graph, style inheritance, numbering, import/export, and page-number rules.
- Use layout browser tests for pagination/overlap and real typing tests for editing around field nodes.
- Add a long-report fixture with repeat edits and broken references.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Existing contents/notes features should be extended rather than rebuilt. Reference-manager integration is WP-019; enterprise template distribution is WP-036.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S17`, `S20`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.

# Progress

2026-10-30: In progress. `packages/core/src/doc-styles.ts` resolves a named style through its parent, then lets a direct `bold` or `fontSize` win, including `bold: false`. A parent cycle stops when an id repeats. Captions keep their own ids. Figures and tables are numbered separately in order. Removing one renumbers the rest, and a reference to a missing id returns a warning that names it. The style list and caption list round-trip as JSON. `tests/doc-styles.test.ts` passed (3 tests). Limits are in `docs/document-styles.md`.

2026-10-30, later: `applyStyleFormats` writes a named style's bold and font size onto the paragraphs that use it. Raising the style's size updates those paragraphs. A paragraph that stores its own font size keeps that size, and a paragraph with no style id is unchanged. `npx vitest run tests/doc-styles.test.ts` passed (4 tests).

2026-11-03: a figure list names a caption of only invisible characters as `Figure`. A table list names that caption as `Table`. The caption id `secret-value` is not in the list. A caption `Beds` stays `Beds`. `npx vitest run tests/figure-list-entries.test.ts` passed (4 tests). Coverage for `apps/web/src/editors/figure-list-entries.ts` was 100% statements, 92% branches, 100% functions, and 100% lines. The document was not opened.

2026-10-31: a Word export of those paragraphs writes the resolved bold and font size. A paragraph that stores 16 stays 16 points. The style name is not a Word style. `npx vitest run tests/doc-style-docx.test.ts` passed (1 test). 2026-10-31, later: a Word export reads `paragraphStyles` on the document and applies those styles itself. The editor does the same when the document opens. A document with no list is left as it was. `npx vitest run tests/doc-style-docx.test.ts tests/doc-styles.test.ts` passed (6 tests). In the browser, an existing document that has no style list still opened with its heading. 2026-10-31, later still: the same export writes the style into `word/styles.xml` as style id `heading`, name `Heading`, based on `body`, 22 points and bold. The paragraph refers to `heading`. A direct size of 16 stays 32 half-points on that paragraph. An id `Not a style` is left out of the style part and is not a paragraph style reference. `npx vitest run tests/doc-style-docx.test.ts tests/doc-styles.test.ts` passed (6 tests). Changing a style still updates paragraphs that use it when the document is opened or exported. 2026-10-31, later: `refreshCaptions` rebuilds a figure list after the Beds caption is removed. The list is `Figure 1 Paths`. A reference to Paths is `Figure 1`. A reference to the removed caption is the warning that names `fig-a`. The Word file contains `Figure 1 Paths` and that warning, and it does not contain `Figure 2`. `npx vitest run tests/doc-styles.test.ts tests/doc-style-docx.test.ts` passed (7 tests). 2026-10-31, later: a document stores author `Ada`, subject `Beds`, and keyword `north` on the file. Undoing the body removes the word `after` and leaves those properties. Redoing the body brings `after` back and still leaves them. Reading the saved JSON back through the file schema returns the same properties. The Word file's `docProps/core.xml` contains `Ada`, `Beds`, and `north`. `npx vitest run tests/doc-properties.test.ts` passed (1 test). 2026-10-31, later: `refreshContents` lists `Section 1: Beds`, then `Section 2: Paths` and `Section 2: Detail`. A level-4 heading `Skip` is left out. After Beds is removed, the list starts at section 2. The Word file contains those lines in that order and still contains a contents field. `npx vitest run tests/doc-contents.test.ts tests/doc-notes.test.ts tests/citations.test.ts` passed (8 tests). The editor's contents control was not clicked.

2026-10-31, later: `captionWarnings` names the reference to the removed caption `fig-a` at path `[4]`. The message says to update or remove that reference. The Paths reference is not listed. The document passed in still says `see Figure 1` at that path. `npx vitest run tests/doc-styles.test.ts` passed (4 tests). The document editor was not opened in the browser.

2026-11-01: a missing caption warning no longer repeats the caption id. The refreshed sentence and the warning both say `That caption is missing. Update or remove this reference.` The warning still stores the id `secret-value` and the path. That id is not in the sentence. The document passed in still says `see Figure 1`. The Word export contains the static warning and does not contain `fig-a is missing`. `npx vitest run tests/doc-styles.test.ts tests/doc-style-docx.test.ts` passed (11 tests). The document editor was not opened in the browser.

2026-11-01: Word export rebuilds captions before it writes the file. A document that still says `see Figure 9` exports `Figure 1 Paths` and `That caption is missing. Update or remove this reference.` The open document still says `see Figure 9`. `npx vitest run tests/doc-style-docx.test.ts` passed (4 tests). The document editor was not opened in the browser.

2026-10-31, later: `refreshReport` rebuilds the contents and the figure list together. The Beds figure in the first section is `Figure 1.1 Beds`, and the Paths figure after the section break is `Figure 2.1 Paths`. The contents lines are `Section 1: Beds` and `Section 2: Paths`. A reference to Beds is `Figure 1.1`. After that figure and heading are removed, the list is `Figure 2.1 Paths` and the reference names `fig-a`. The list passed in is still empty. The Word file contains those contents and figure lines in that order, and `docProps/core.xml` contains the author `Ada` and the keyword `north`. A document with no section break still uses `Figure 1`. `npx vitest run tests/doc-contents.test.ts tests/doc-styles.test.ts tests/doc-style-docx.test.ts` passed (9 tests). The document editor was not opened in the browser.

2026-10-31, later: `updateNamedStyle` stores 22 on the heading style and writes 22 points onto the Beds paragraph. The Note paragraph keeps its direct size of 16. The document passed in still has the heading at 18 and no marks on Beds. An unknown style id leaves the list at 18. Tools → Named styles sends that size from the panel. `npx vitest run tests/doc-styles.test.ts tests/ui/named-style-panel.test.tsx` passed (6 tests). The document editor was not opened in the browser.

2026-10-31, later: a document stores description `North beds` and category `Garden` with author `Ada`, subject `Beds`, and keyword `north`. Undoing the body removes `after` and leaves the description and category. Redoing the body brings `after` back and still leaves them. Reading the saved JSON back returns the same description and category. The Word file's `docProps/core.xml` contains `North beds`. `docProps/custom.xml` contains `Category` and `Garden`. `npx vitest run tests/doc-properties.test.ts` passed (1 test). The document editor was not opened in the browser.

2026-10-31, later: on a page of 4 lines, a 3-line paragraph stays on page 1. A 1-line heading marked keep-with-next moves with the following 2-line paragraph onto page 2. Without the mark, that heading stays on page 1 and the paragraph starts page 2. A heading and paragraph that already fit stay together. A section whose heading has the mark still counts as one page for the short Beds, Paths, and Detail text. A section with no mark keeps the previous page count. `npx vitest run tests/keep-with-next.test.ts tests/doc-section.test.ts` passed (7 tests). The screen still measures the open document. This is not a widow or orphan rule. The document editor was not opened in the browser.

2026-10-31, later: a paragraph marked for widow control keeps at least two lines on each side of a page break. Five lines on a 4-line page leave 3 on the first page and 2 on the next. Without the mark, 4 lines stay and 1 line goes on alone. Three lines with only one line of room start on the next page. Without the mark, one line stays behind and two go on. A section that has the mark uses this split for its page count. The screen still measures the open document. `npx vitest run tests/keep-with-next.test.ts tests/doc-section.test.ts` passed (7 tests). The document editor was not opened in the browser.

2026-10-31, later: a table splits by row. On a page of 4 lines, seven 1-line rows put the header and three body rows on the first page. The next page repeats the header and then the other three body rows. Without a repeated header, the second page starts at the fourth body row. The heights passed in stay the same. A body row of 5 lines stays on its own page after the header. A section that is only a two-row table still counts as one page. Text above a table still uses the text page count. `npx vitest run tests/table-pages.test.ts tests/doc-section.test.ts tests/keep-with-next.test.ts` passed (8 tests). The screen still measures the open document. The document editor was not opened in the browser.

2026-10-31, later: two lines of text leave two lines of room on a 4-line page. The table then puts the header and one body row on that page. The next page repeats the header and three body rows, and the last page repeats the header and the last two body rows. That section is 3 pages. A short Beds paragraph and a two-row table still count as one page. `npx vitest run tests/table-pages.test.ts tests/doc-section.test.ts tests/keep-with-next.test.ts` passed (8 tests). The screen still measures the open document. The document editor was not opened in the browser.

2026-10-31, later: `refreshIndex` lists `Paths, section 2` and `Tomato, section 1` from index marks. A second `tomato` mark is the same entry. The lines do not include `north` or `ready`. Removing both Tomato marks leaves only Paths. The document passed in still has an empty index. The Word file contains those lines, with Paths before Tomato. The section number is not a printed page number. `npx vitest run tests/doc-index.test.ts` passed (1 test). The document editor was not opened in the browser.

2026-10-31, later: with page settings that start at 5, `refreshIndex` lists `Paths, 6` and `Tomato, 5`. Paths is after a page break. The lines do not say section and do not contain `secret-value`. The Word file contains `Tomato, 5` and `Paths, 6`. Without page settings the lines still say section 1 and section 2. `npx vitest run tests/doc-index.test.ts` passed (2 tests). The open editor was not measured, and the editor was not opened in the browser.

2026-10-31, later: with roman numerals and a start of 5, the index lists `Paths, vi` and `Tomato, v`. The lines do not contain `secret-value` or the digit 5. The Word file contains `Tomato, v` and `Paths, vi`. The Page N format lists `Tomato, Page 5` and `Paths, Page 6`. `npx vitest run tests/doc-index.test.ts` passed (3 tests). The open editor was not measured, and the editor was not opened in the browser.

2026-10-31, later: a keep-with-next heading before a table starts on the same page as the table. On a page of 4 lines, 3 lines of text stay on page 1. The heading and a two-row table start on page 2. Without the mark, the heading stays on page 1 and the table starts on page 2. A heading marked keep-with-next and an 80-row table of `Tomato` is more than one page. The heading alone is one page. Widow control on text above a table still uses the plain line split. `npx vitest run tests/table-pages.test.ts tests/keep-with-next.test.ts tests/doc-section.test.ts` passed (8 tests). The screen still measures the open document. The document editor was not opened in the browser.

2026-10-31, later: a 3-line paragraph marked for widow control, after 3 lines on a 4-line page, starts on page 2 with a one-row table. Without the mark, that paragraph starts on page 1 and the table starts on page 2. `npx vitest run tests/table-pages.test.ts tests/keep-with-next.test.ts tests/doc-section.test.ts` passed (8 tests). The screen still measures the open document. The document editor was not opened in the browser.

2026-11-01: `refreshHeadingRefs` rewrites a reference to the heading text. A reference to `paths` becomes `Paths`. A blank heading says that heading has no title. A missing id `secret-value` stores `That heading is missing. Update or remove this reference.` and that word is not in the warning. The heading and the old reference text stay on the document passed in. `npx vitest run tests/doc-heading-ref.test.ts tests/doc-styles.test.ts` passed (6 tests). The document editor was not opened in the browser.

2026-11-01: `refreshReport` updates heading references when it rebuilds the contents field and the figure and table lists. The contents line is `Section 1: Paths`. The reference to `paths` becomes `Paths`. A missing id `secret-value` is not repeated. The document passed in still says `see`. `npx vitest run tests/doc-heading-ref.test.ts tests/doc-contents.test.ts tests/doc-styles.test.ts` passed (9 tests). The document editor was not opened in the browser. The Word file was not written for this reference.

2026-11-01: writing a Word file updates the heading reference first. The file contains `Paths` and `That heading is missing. Update or remove this reference.` It does not contain `secret-value`. The document passed in still says `see`. `npx vitest run tests/doc-heading-ref.test.ts tests/doc-contents.test.ts tests/doc-style-docx.test.ts` passed (8 tests). The document editor was not opened in the browser.

2026-11-01: `importParagraphStyles` adds Note from a template and leaves the document heading at 18. The template heading of 22 is not copied over it. Note is 14 points, based on that heading, so the Paths paragraph is 14 points and bold. The Note paragraph that already stores 16 stays 16. A style whose size is 0 is left out, its id `secret-value` is not stored, and a parent that was left out is not stored. The document passed in still has no marks and a heading size of 18. A template that only repeats the styles already there does not write marks. `npx vitest run tests/doc-styles.test.ts` passed (6 tests). The document editor was not opened in the browser.

2026-11-01: Tools → Named styles has Import styles. A template file with Note at 14 adds Note and leaves Heading at 18. The document passed in still lists only Heading. A file whose text is `secret-value` says that file is not a style template, and that word is not shown. `npx vitest run tests/ui/named-style-panel.test.tsx tests/doc-styles.test.ts` passed (8 tests). The document editor was not opened in the browser.

2026-11-01: a character style named Emphasis that is bold and italic adds those marks to a run marked with that style. The run text `secret-value` stays on the run, and the document passed in keeps only the style mark. A direct choice to leave bold off keeps italic and drops bold. A style id `secret-value` stores `That character style is not in this document.` and that word is not in the warning. `npx vitest run tests/doc-styles.test.ts` passed (7 tests). The named-styles panel does not apply a character style. The document editor was not opened in the browser.

2026-11-01: Tools → Named styles lists character styles stored on the document. Use character style applies Emphasis, which is bold and italic, to the selection. An id `secret-value` is left off that list. `npx vitest run tests/doc-styles.test.ts tests/ui/named-style-panel.test.tsx` passed (10 tests). The document editor was not opened in the browser.

2026-11-01: a character style can be based on another. Emphasis based on Strong, which is bold, makes the run bold and italic. Setting bold off on Emphasis leaves only italic. The run text `secret-value` stays on the run and is not copied onto the marks. A parent id `secret-value` is left off the stored style. A cycle between Strong and Emphasis still finishes, and the stored parent on the input list stays `strong`. `npx vitest run tests/doc-styles.test.ts` passed (9 tests). The document editor was not opened in the browser.

2026-11-01: reading a character style list back keeps bold turned off. Emphasis based on Strong stores `bold: false`, and the run stays italic only. The stored style still has bold off. `npx vitest run tests/doc-styles.test.ts -t "turn it off"` passed (1 test). The document editor was not opened in the browser.

2026-11-01: an index mark can name a subentry. `Tomato` with subentry `North` is `Tomato, North, section 1`. The plain `Tomato` mark stays `Tomato, section 1`. The sentence `secret-value` is not an index line. The document passed in still has an empty index. `npx vitest run tests/doc-index.test.ts` passed (4 tests). The document editor was not opened in the browser.

2026-11-01: an index mark can point at another term. `Beds` with see `Tomato` is `Beds, see Tomato`, and that line has no section number. The plain `Tomato` mark stays `Tomato, section 1`. The sentence `secret-value` is not an index line, and it stays on the document. `npx vitest run tests/doc-index.test.ts` passed (5 tests). The document editor was not opened in the browser. There is no control yet that writes the see attribute.

2026-11-01: Index entry writes a see mark on the selected words. `Beds` with see `Tomato` on the word `ripe` is stored as that mark, and the index line is `Beds, see Tomato`. The status says `The index entry was marked.` and does not repeat `Tomato`. A blank term is refused. An entry that points at itself is refused, and that notice does not repeat `secret-value`. An empty selection is not marked. `npx vitest run tests/ui/index-entry-panel.test.tsx` passed (3 tests). The document editor was not opened in the browser.

2026-11-01: Index entry can store a subentry with the see mark. `Beds` with subentry `North` and see `Tomato` on the word `ripe` is `Beds, North, see Tomato`. The status says `The index entry was marked.` and does not repeat `North` or `Tomato`. `npx vitest run tests/ui/index-entry-panel.test.tsx` passed (3 tests). The document editor was not opened in the browser.

2026-11-01: a figure list can include a page when the caller supplies one. Figure 1 Beds on page 2 is `Figure 1 Beds, 2`. Figure 2 Paths on page 4 is `Figure 2 Paths, 4`. A page written as `secret-value` is left off, and that word is not in the list. `npx vitest run tests/doc-styles.test.ts` passed (9 tests). The editor and the Word export do not supply those page numbers yet. The document editor was not opened in the browser.

2026-11-01: a Word export that stored page settings and left page numbers on writes the figure pages. Beds before a page break and Paths after it are `Figure 1 Beds, 1` and `Figure 2 Paths, 2`. The caption ids are not in the file. The document that was exported still does not contain those list lines. Turning page numbers off does not add a page. `npx vitest run tests/doc-style-docx.test.ts tests/doc-styles.test.ts tests/doc-contents.test.ts tests/doc-heading-ref.test.ts` passed (20 tests). The document editor was not opened in the browser.

2026-11-01: a contents list can include a page when the document numbers pages. Beds before a page break is `Section 1: Beds, 1`. Paths after the break is `Section 1: Paths, 2`. A heading id `secret-value` is not in the line. Turning page numbers off leaves the page off. `npx vitest run tests/doc-contents.test.ts tests/doc-style-docx.test.ts tests/doc-heading-ref.test.ts` passed (12 tests). The document editor was not opened in the browser.

2026-11-01: a table list in a Word export includes the page. Harvest before a page break is `Table 1 Harvest, 1`. Paths after the break is `Table 2 Paths, 2`. A caption id `secret-value` is not in the file. `npx vitest run tests/doc-style-docx.test.ts` passed (7 tests). The document editor was not opened in the browser.

2026-11-01: a Word export rebuilds the index from the marks before it writes the file. A stale line `secret-value` is replaced by `Tomato, section 1` and is not in the file. The document that was exported still has the stale line. `npx vitest run tests/doc-index.test.ts tests/doc-style-docx.test.ts tests/doc-contents.test.ts` passed (16 tests). The document editor was not opened in the browser.

2026-11-01: a text PDF rebuilds the index from the marks before it writes the file. A stale line `secret-value` is replaced by `Tomato, section 1` and is not in the file. The document that was exported still has the stale line. `npx vitest run tests/doc-pdf.test.ts` passed (2 tests). The document editor was not opened in the browser. This is not a PDF/UA file.

2026-11-01: before the page is measured, the contents field numbers headings from page breaks. A heading before a page break is page 1 and the heading after it is page 2. The heading text is not in that page list. A measured page replaces that number. `npx vitest run tests/doc-toc-pages.test.ts tests/doc-contents.test.ts` passed (4 tests). The document editor was not opened in the browser.

2026-11-01: a figure list in the editor numbers captions from page breaks. Beds before a page break is page 1. A table caption Paths after that break is page 2. The caption id `secret-value` is not in the list. The figure list is a block in the document editor. `npx vitest run tests/figure-list-entries.test.ts` passed (1 test). The document editor was not opened in the browser.

2026-11-01: Insert can add a figure list or a table list. Inserting a table list stores `figureList` with kind `table`. `npx vitest run tests/figure-list-entries.test.ts` passed (2 tests). The document editor was not opened in the browser. The Insert menu was not opened.

2026-11-01: an index term with a line break stays one line. `Tomato` and `beds` become `Tomato beds, section 1`. A see that is only space is left off, so the line does not say see. `npx vitest run tests/doc-index.test.ts` passed (7 tests). The document editor was not opened in the browser. This is not a PDF/UA file.

2026-11-01: an index see that names the same term is left off. `Beds` with see `beds` is `Beds, section 1`, and the line does not say see. A see that names a different term still prints. `npx vitest run tests/doc-index.test.ts` passed (8 tests). The document editor was not opened in the browser. This is not a PDF/UA file.

2026-11-01: a page break inside a note does not change a figure or table page. The table caption after one real page break stays on page 2. `npx vitest run tests/figure-list-entries.test.ts` passed (2 tests). The document editor was not opened in the browser. This is not a PDF/UA file.

2026-11-01: a page break inside a note does not change an index page. Paths stays `Paths, 6` after one real page break when the file starts at page 5. `npx vitest run tests/doc-index.test.ts` passed (8 tests). The document editor was not opened in the browser. This is not a PDF/UA file.

2026-11-01: importing styles also copies a character style the document does not already have. Emphasis, based on Strong and italic, is stored. Strong stays bold and is not replaced by the template. A parent that is not in either list is left off. An id `secret-value` is not stored. The run text stays. Named styles import uses this after the paragraph styles. `npx vitest run tests/doc-styles.test.ts -t "adds a character style"` passed (1 test). The document editor was not opened in the browser.

2026-11-01: Named styles can match the selected words. A selection that is 22 points and not bold stores that on Heading. The paragraph Beds becomes 22 points and loses bold. A paragraph that already stores bold and 16 stays that way. Body stays 12 points, and its text `secret-value` stays on the paragraph. A size written as `secret-value` is not stored. No selection says `Select the words to match.` An unknown style id leaves Heading at 18 points and bold. `npx vitest run tests/doc-styles.test.ts tests/ui/named-style-panel.test.tsx -t "stores the selection|matches the selected"` passed (2 tests). In the browser at `http://127.0.0.1:5173/`, Tools → Named styles opened on an existing untitled document. That document has no named styles, so Match the selection was not shown and the document was not changed.

2026-11-01: an index line warns when its see target is not a marked term. `Beds` with see `Paths` is `Beds, see Paths. That index term is missing.` A see of `secret-value` is `Beds. That index term is missing.` and that word is not in the index. A see of `Tomato` still prints `Beds, see Tomato` when Tomato is marked. `npx vitest run tests/doc-index.test.ts -t "term that is not marked|points a term"` passed (2 tests). The document editor was not opened in the browser. This is not a PDF/UA file.

2026-11-01: Named styles can apply the chosen style to one paragraph. Use this style points the first paragraph at Heading, so Beds becomes bold and 18 points. The other paragraph keeps `secret-value` and has no style. A paragraph that already stores bold as false stays not bold. An unknown style id leaves the paragraph as it was. `npx vitest run tests/doc-styles.test.ts tests/ui/named-style-panel.test.tsx -t "assigns a named style|applies the chosen paragraph"` passed (2 tests). The document editor was not opened in the browser.

2026-11-01: an index line can say see also and keep its section. `Beds` with see also `Paths` is `Beds, section 1. See also Paths` when Paths is marked. A see also of `secret-value` is `Fees, section 1. That index term is missing.` and that word is not in the index. Index entry has a See also field. `npx vitest run tests/doc-index.test.ts tests/ui/index-entry-panel.test.tsx` passed (14 tests). The document editor was not opened in the browser. This is not a PDF/UA file.

2026-11-01: an index term marked inside a note is listed. `Beds` in a footnote is `Beds, section 1`. The other words in that note, `secret-value`, stay out of the index. A page break inside a note still does not add a printed page. `npx vitest run tests/doc-index.test.ts` passed (11 tests). The document editor was not opened in the browser. This is not a PDF/UA file.

2026-11-01: a heading inside a note is not a contents line. The contents list is `Section 1: Beds`. The heading `secret-value` inside the note stays out of the list and stays in the note. `npx vitest run tests/doc-contents.test.ts` passed (4 tests). The document editor was not opened in the browser. This is not a PDF/UA file.

2026-11-01: a heading reference leaves a heading inside a note out. The reference says `That heading is missing. Update or remove this reference.` and does not include `secret-value`. A reference inside that note to the body heading still becomes `Paths`. The note heading stays `secret-value`. The document passed in still says `also`. `npx vitest run tests/doc-heading-ref.test.ts -t "heading inside a note"` passed (1 test). The document editor was not opened in the browser. This is not a PDF/UA file.

2026-11-01: a caption inside a note stays out of the figure list. The list is `Figure 1 Beds`. The note still says `secret-value`, and a reference in that note to the body caption becomes `Figure 1`. The document passed in still has the note caption. `npx vitest run tests/doc-styles.test.ts -t "caption inside a note"` passed (1 test). The document editor was not opened in the browser. This is not a PDF/UA file.

2026-11-01: a section break that restarts numbering at 5 lists the next heading as `Section 2: Paths, 5` and the next index term as `Paths, 5`. The heading before the break stays page 1. A restart written as `secret-value` continues the count, and that word is not a page number. Figure and table pages use the same count. `npx vitest run tests/doc-contents.test.ts tests/doc-index.test.ts` passed (17 tests). The document editor was not opened in the browser. This is not a PDF/UA file.

2026-11-01: the contents field in the editor uses that restarted number. A heading after a break that restarts at 5 is page 5, and a measured page 2 stays page 5. The figure list does the same for Paths. A restart written as `secret-value` stays page 2, and that word is not a page number. `npx vitest run tests/doc-toc-pages.test.ts tests/figure-list-entries.test.ts` passed (5 tests). The document editor was not opened in the browser. This is not a PDF/UA file.

2026-11-02: a heading that is only an invisible character is left out of the contents. A heading that starts with that character is listed as `Section 1: Beds`, and a character inside `Be\u200bds` stays. The headings in the document stay as they were. `npx vitest run tests/doc-contents.test.ts -t "invisible character|rebuilds a contents"` passed (2 tests) at 02:29:17. The document editor was not opened in the browser. This is not a PDF/UA file.

2026-11-02: an index term that is only an invisible character is left out. A term that starts with that character is `Beds, section 1`. A character inside the word stays on its own line. A see that is only that character is left off. The marks in the document stay as they were. `npx vitest run tests/doc-index.test.ts -t "only an invisible character|blank see"` passed (2 tests) at 03:58:54. The document editor was not opened in the browser. This is not a PDF/UA file.

2026-11-02: a heading reference treats a heading that is only an invisible character as having no title. A heading that starts with that character is referenced as `Beds`. A character inside the word stays. The headings in the document stay as they were. `npx vitest run tests/doc-heading-ref.test.ts -t "invisible character|missing id"` passed (2 tests) at 04:32:22. The document editor was not opened in the browser. This is not a PDF/UA file.

2026-11-02: an endnote label uses lower-case roman through 3999. The first is `i` and the fourth is `iv`. A count of 4000 stays `4000`. A count that is not a whole number in that range is left blank, and it is not written as `NaN`. `npx vitest run tests/doc-notes.test.ts -t "runaway label"` passed (1 test) at 04:59:11. The document editor was not opened in the browser. This is not a PDF/UA file.
