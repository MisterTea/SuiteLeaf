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

