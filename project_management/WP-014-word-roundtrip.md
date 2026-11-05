---
id: "WP-014"
title: "Word document round-trip fidelity"
type: "work_package"
status: "in_progress"
priority: "P0"
phase: 1
area: "documents"
created: "2026-10-29"
updated: "2026-11-04"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S15", "S16", "S17"]
---

# Word document round-trip fidelity

## Outcome and rationale

Let people exchange professional documents with Word while retaining supported structure, review state, and appearance through edits.

## Existing implementation and starting points

Inspect `packages/core/src/word.ts`, `packages/core/src/docx-export.ts`, `packages/core/src/doc-binary.ts`, page/layout helpers, `apps/web/src/editors/Docs.tsx`, and document corpus tests. DOCX import/export and substantial pagination/review features already exist.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Prioritize corpus failures in sections, headers/footers, numbering, tables, image anchoring/wrapping, text boxes, typography, notes, fields, citations, comments, and tracked changes.
- Preserve semantic structure and stable anchors while editing; add versioned native migrations for new attributes.
- Map supported review operations and author/date metadata bidirectionally. Report unsupported move/format/structural revision semantics instead of silently flattening them.
- Keep unsupported OOXML parts only when safe and still correctly related; distinguish retained source from actually editable native content.
- Verify editable exports and pagination against explicitly recorded Word versions and font sets; integrate structured warnings from WP-013 when available.

## Dependencies and delivery

Completion is blocked on `WP-012`. Design and isolated prototypes may proceed, but do not bypass the prerequisite contracts or release gates.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- A report with sections, repeated headers, tables, notes, citations, comments, and revisions survives the supported edit/reopen sequence.
- All supported content remains editable in Word and SuiteLeaf; unsupported cases have explicit findings.
- Font substitution and page-number/layout differences are visible in evidence rather than hidden by text-only comparisons.
- Legacy Word conversion rejects unsupported/encrypted cases honestly and preserves originals.

## Verification

- Vitest semantic round-trip and revision tests; layout/real-typing browser tests only where necessary.
- Use WP-012 differential fixtures and reference Word exports; verify source hashes.
- Test new document attributes through native saves and older supported files.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

New publishing features are WP-017 and review functionality is WP-018. Fidelity work must coordinate their schema contracts, not duplicate them.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S15`, `S16`, `S17`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.

# Progress

2026-10-30: Not started. Front matter status is `blocked`. `blocked` is true. `blocked_on` is ["WP-012"]. No product behavior for this package changed on this date. Active work is the WP-001 catalog and a mark-preservation slice of WP-002.

2026-11-04: WP-012's compatibility run found a font loss that this package owns. The generated fixture `docx-report` sets Calibri on every run. After import and export, Arial is the only font in the document. DOCX import keeps a run's font only for symbol fonts (`word-symbols.ts`), and there is no document default font, so `docx-export.ts` writes Arial. Word would lay out a Calibri document in Arial. The run tolerates this as a `fonts` loss owned by WP-014 (`TOLERATED` in `packages/core/src/compat/report.ts`), and `docs/office-imports.md` states the limit. When it is repaired, remove that entry; the run lists an entry that no longer matches a loss. This package is still blocked on WP-012, and no product behavior changed here.

2026-11-04: WP-012 was accepted as done, so this package is no longer blocked. Status is `ready`, meaning it is ready to start; no work has begun. It was blocked on WP-012 from 2026-10-29 until then; that dependency is still listed under Dependencies.

2026-11-04: DOCX import keeps a run's own font. Before this, only symbol fonts survived, and any other run font was dropped, so DOCX export wrote Arial. The import already marked symbol-font text so it would get through Mammoth, which keeps no fonts. It now also marks a run whose font differs from the document's body font. The run's font is read from `w:rFonts`, or from the theme when the run names a theme font. The text arrives as a `textStyle` font in the SuiteLeaf face drawn the same way, and DOCX export writes the Office name back. A run in the body font gets no mark. When the document names no body font, every run that names a font keeps it. There is no font-specific logic: the general font mapping in `office-fonts.ts` does the translation.

`tests/symbol-fonts.test.ts` covers:
- a Georgia run, a run in the body font, a theme run, an unusual name, and a plain run;
- a document with no body font;
- symbol-only marking left as it was.

`npx vitest run tests/symbol-fonts.test.ts tests/compat tests/capabilities` passed (41 tests). `npx vitest run --coverage` passed (617 files, 4,494 tests): statements 93.84% and lines 96.7%. `word-fonts.ts` was at 100% statements and lines.

2026-11-04: on the first 60 NapierOne DOCX files, 50 name fonts on their runs. Before this change, 14 of those 71 fonts were still present after import and export. After it, 67 of 71 were, and all 60 files still imported and exported. The 4 that remain were not examined. The WP-012 run with LibreOffice 26.2.5.2 (fingerprint `2aabca6e038309e9`) now passes `fonts` for `docx-report`: 15 dimensions passed, nothing was lost, and nothing blocked a release. The tolerated entry was removed, and the WP-012 CI test now plants a dropped font and checks that it blocks. `docs/office-imports.md` and `docs/office-compat.md` were updated.

Still open in this package:
- Fonts set only on a paragraph style, such as a heading's theme font, are not carried onto the text.
- A document that names no body font still exports Arial as its default. Word would use Times New Roman.
- The rest of the requirements and acceptance criteria above: sections, numbering, image anchoring, notes, fields, citations, comments and revisions through edits, editability in Word, and legacy conversion.

2026-11-04, later: Word sections survive import.

- **The document's header and footer come from the first section**, the one on page one. Before this, they came from the last section's properties, so a report with an appendix showed the appendix header on every page and lost its own.
- **Each later section that starts on a new page becomes a SuiteLeaf section break** (`word-sections.ts`). The break carries that section's default header and footer and its page-number restart. A section that names no header or footer keeps the previous section's, as Word does.
- **What is not represented gets an import note:** a section that continues on the same page or column gets no break, a break that cannot be placed is reported, and so is a section whose page orientation differs, because SuiteLeaf stores one orientation per document.
- **Export already wrote a section break's header and footer**, so the round trip now keeps both sections and both headers.

`tests/word-sections.test.ts` covers start type, restart, inheritance, a one-paragraph section, an existing page break, an unplaced break, and orientation. Writing it found a bug: the first version took each section's anchor from the text after the section-ending paragraphs, so a one-paragraph section lost its anchor. Anchors are now read from the text that follows each section end.

2026-11-04, later: the WP-012 run has a fourth fixture, `docx-sections`: two sections with their own headers, a footer with a page number, a footnote, a numbered list, and a hyperlink. New probes check header text, footnote text, and the section count. With the section import turned off, `layout` was a loss at import (the appendix header and the second section were gone). With it on, every probe passes.

`npm run test:office-compat` with LibreOffice 26.2.5.2 (fingerprint `184bf44e1bbb190d`) gave 17 dimensions passing, no loss, and nothing blocking. `npx vitest run --coverage` passed (618 files, 4,498 tests): statements 93.86% and lines 96.71%. `word-sections.ts` was at 100% statements and lines. `word-headers.ts` was at 89.38% statements, up from 88.97%; it was already below 90% before this change.

On the first 200 NapierOne DOCX files, all 200 still imported and exported. 35 had more than one section, with 73 sections starting on a new page. 68 of those breaks were placed, and the 5 files with an unplaced break each say so in their import notes. Whether each break landed on the right paragraph was not checked by hand.

Still open:
- Fonts set only on a paragraph style.
- The Times New Roman default for a document that names no body font.
- Orientation and margins per section.
- Numbering, image anchoring, fields, citations, comments and revisions through edits, editability in Word, and legacy conversion.

2026-11-04, later still: numbered lists keep their numbering style and restart on export.

- **The losses.** A probe of wider Word features found that lettered and roman lists came back as decimal. It also found that DOCX export put every ordered list under one Word numbering definition and ignored its start number. In the generated report, `a) Compost first` became `3. Compost first`, and a second decimal list that should restart at 1 continued at 5.
- **Import.** `word-lists.ts` reads each numbered paragraph's format from numbering.xml: directly, through a level override, or through its paragraph style. It then sets the matching ordered list's `type` (`a`, `A`, `i`, `I`), matched by its first item's text. The editor's ordered list already stores and draws `type`.
- **Export.** Each ordered list now gets a numbering definition for its style and start, and its own instance, so it restarts.

Known limits:
- The punctuation after the number is not kept (`a)` comes back as `a.`).
- Mammoth reads two different lists with nothing between them as one list.

The probe also showed what already survives: tracked deletions, formatting revisions, comments, endnotes, external links, and merged cells. Two other losses were seen and not fixed: internal links to a bookmark, and paragraph-style fonts.

2026-11-04, later still: the WP-012 fixture `docx-sections` now has a lettered list and a restarted decimal list. New `numbered` probes check `b Mulch after` and `1 Weed the paths` at every stage. With the change reverted, the lettered list was lost at import and the restart at export. A table-cell probe kind replaced plain text for table contents, because PowerPoint cannot read table cells.

2026-11-04, later still: Microsoft Office is now the WP-012 reference application, as the product owner asked. Word, Excel, and PowerPoint are driven through AppleScript, and each export is opened read-only and closed without saving.
- **Word** reported both sections' headers, the footnote, two pages, and its own list numbers, `a Compost first` and `1 Weed the paths`.
- **Excel** recalculated a cached 999 to 60.
- **PowerPoint** reported the slides, text, notes, and table count.

The first version used a new file name each run and had Word save a text file, so the Office sandbox asked for access every time. The run now opens one fixed file per format and writes no output file.

`npm run test:office-compat -- --force` with Word 16.114.4, Excel 16.114.1, and PowerPoint 16.114.4 (fingerprint `6bf3d2644771117c`) gave all four fixtures opened, 17 dimensions passing, and nothing blocking. `npx vitest run --coverage` passed (620 files, 4,509 tests): statements 93.87% and lines 96.71%. `word-lists.ts`, `msoffice.ts`, and `docx-blocks.ts` were each above 98% statements.

2026-11-04, later still: links within a document survive.

- **Import.** A Word link to a bookmark now becomes a SuiteLeaf link to the heading that holds the bookmark: `#plan` becomes `#planting-plan`, the slug the editor follows. A heading is matched by its text, not by its Word style name, which can be renamed or localized.
- **Export.** Every heading carries a bookmark named from its slug (`h_planting_plan`, letters, digits, and underscores, at most 40 characters, unique in the file). A `#slug` link is written as a Word internal hyperlink to it. `slugify` moved to `packages/core/src/heading-anchors.ts`, and the editor's `anchors.ts` re-exports it, so import, export, and the editor use one slug rule.
- **Limit.** A link to a bookmark that is not on an imported heading keeps its text, and the import notes count it.

The WP-012 fixture `docx-sections` now has a bookmarked heading and an internal link, checked by an `internal-link` probe. A link counts only when its target exists at that stage: a heading in SuiteLeaf, a bookmark in the Word package. With the change reverted, `objects` was a loss at import. Word now reports each internal hyperlink whose bookmark exists. It confirmed `the plan` both in the source and in SuiteLeaf's export.

`npm run test:office-compat` with Word, Excel, and PowerPoint 16.114 (fingerprint `598b0877d1ee247d`) gave 18 dimensions passing, no loss, and nothing blocking. `npx vitest run --coverage` passed (621 files, 4,512 tests): statements 93.88% and lines 96.72%. `heading-anchors.ts` was fully covered. `docx-runs.ts` was at 88.07% statements, up from 87.96%; it was below 90% before this change.

On the first 200 NapierOne DOCX files, all 200 still imported and exported. 3 files had 87 internal links between them. 6 now resolve to a heading, where 0 did before. The rest point at bookmarked paragraphs that are not imported as headings: one file has 63 links and one imported heading. Following those would need anchors on any paragraph, in the model and in the editor. That is not done.

2026-11-04, later still: a paragraph style's font reaches its text.

- **Import.** Most Word documents set the heading font only on the heading style, often a theme font, so imported headings were drawn in the body font. `wordStyleFonts` resolves each paragraph style's font through `w:basedOn` and the theme, and guards against style cycles. A run that names no font of its own now takes its paragraph style's font, through the same marks as run fonts, when that font differs from the body font. Innermost paragraphs are read first, so a text box keeps its own paragraph's style. The editor's named styles still carry no font family.
- **Export.** The font is written on the runs, not as a named style.
- **Existing tests.** Two assertions in `tests/office.test.ts` (Apache POI `65099.docx`) pinned headings and table text to bold only. Their styles set Arial Gras (`EdfTitre3`) and Arial (`EdfCorpstexte`) while the body is Calibri, so those fonts are now expected.

Evidence:
- **Compat run.** The WP-012 fixture `docx-sections` now has a Heading 1 style in Cambria and a `fonts` probe. Word reports each paragraph's font as part of the reference. With style fonts turned off, `fonts` was a loss at export, and Microsoft Word agreed. `npm run test:office-compat` with Word, Excel, and PowerPoint 16.114 (fingerprint `9ba745807cdcfa4e`) gave 19 dimensions passing, no loss, and nothing blocking.
- **Corpus.** On the first 200 NapierOne DOCX files, 1,021 of 1,660 headings carry an explicit font, up from 486. All 200 files imported and exported, in 25 seconds both before and after.
- **Tests.** `npx vitest run --coverage` passed (621 files, 4,513 tests): statements 93.88% and lines 96.72%. `word-symbols.ts` was fully covered and `word-fonts.ts` was at 97.22% statements.

Still open in this package:
- The Times New Roman default for a document that names no body font.
- Orientation and margins per section.
- Links to bookmarks that are not on headings.
- Fields, citations, editability in Word, and legacy `.doc` conversion.

2026-11-04, later still: a document that names no body font, and honest legacy conversion.

**No body font.** Microsoft Word reported that the generated `docx-sections` file draws its unstyled text in Times New Roman. SuiteLeaf stored no body font, and its export drew that text in Arial. `wordDefaultFont` now returns Word's own fallback, Times New Roman (SuiteLeaf Maple), when neither the default paragraph style nor the document defaults name a font. Word's fonts for the export now match the source: Cambria and Times New Roman.

The Word package reader in the WP-012 run now counts that effective body font, and `docx-sections` has a Times New Roman probe. With import not storing the body font, the probe was a loss at export. `tests/word-margins.test.ts` expected no page settings for a file without margins. It now expects only the fallback body font and page numbers off; margins still use the default.

**Legacy Word (acceptance criterion 4).** The corpus has 476 Word 97–2003 files, plus 20 password-protected NapierOne DOCX files. Run through `openOfficeReader`, the entry the app's Office worker uses, they showed:
- three encrypted `.doc` files (`PasswordProtected.doc`, `password_password_cryptoapi.doc`, `password_tika_binaryrc4.doc`) "imported" instead of refused;
- seven fuzzed files threw a raw `TypeError`.

`doc-binary.ts` now refuses these:
- the header's fEncrypted or fObfuscated flag, as `encrypted`;
- a file that is not a compound file or has no WordDocument stream, as `invalid-container`;
- any failure while reading the text, as `invalid-container`.

Every message says the original is unchanged. A readable file with no text now says so in its import notes.

After the change:
- 464 `.doc` and 2 other legacy files imported;
- 3 were refused as encrypted and 8 as invalid containers;
- all 20 password-protected DOCX files were refused as encrypted;
- nothing threw anything else, and no input changed, checked by SHA-256 of the bytes passed in and of the file on disk.

Of the imports with very little content, 113 were short test documents and 9 had no readable text, now noted. `tdf132637_protectTrackChanges.doc` is only protected against edits, and it still opens.

`tests/doc-binary.test.ts` covers the flags, the refusals, Word 95 text, the UTF-16 fallback, a Word 97 piece table with a property record, and the no-text note, plus corpus-guarded checks of the three encrypted files. `doc-binary.ts` was at 88.49% statements and 98.88% lines in its own test, up from 66.32%. The one uncovered line is the defensive catch, which no constructed input reached.

`npx vitest run --coverage` passed (622 files, 4,520 tests): statements 93.89% and lines 96.73%. The Office run with Word, Excel, and PowerPoint 16.114 (fingerprint `4b3262aca3bb3118`) gave 19 dimensions passing and nothing blocking.

Still open:
- Orientation and margins per section.
- Links to bookmarks that are not on headings.
- Fields and citations.
- Editability in Word: whether every supported construct can still be edited there.

