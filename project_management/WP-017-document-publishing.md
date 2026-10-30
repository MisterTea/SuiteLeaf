---
id: "WP-017"
title: "Professional document styles, fields, and structure"
type: "work_package"
status: "ready"
priority: "P1"
phase: 3
area: "documents"
created: "2026-10-29"
updated: "2026-10-29"
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
