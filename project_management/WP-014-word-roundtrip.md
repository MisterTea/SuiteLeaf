---
id: "WP-014"
title: "Word document round-trip fidelity"
type: "work_package"
status: "blocked"
priority: "P0"
phase: 1
area: "documents"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: true
blocked_on: ["WP-012"]
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
