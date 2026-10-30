---
id: "WP-016"
title: "PowerPoint object and media round-trip fidelity"
type: "work_package"
status: "blocked"
priority: "P0"
phase: 1
area: "presentations"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: true
blocked_on: ["WP-012"]
related_sources: ["S15", "S19"]
---

# PowerPoint object and media round-trip fidelity

## Outcome and rationale

Preserve editable presentation content and supported visual behavior across PowerPoint import, edits, and export.

## Existing implementation and starting points

`packages/core/src/pptx.ts`, `packages/core/src/pptx-export.ts`, the `pptx-*` helpers, and `apps/web/src/editors/slide-surface.tsx` already handle extensive PowerPoint features. Current working-tree changes include ongoing fidelity work; preserve and coordinate with it.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Prioritize masters/layout inheritance, theme fonts/colors, placeholder text, bullet hierarchies, tables, cropping, vector/metafile images, grouped objects, diagrams, charts, and media.
- Retain native drawing parts with correct relationships where supported, and distinguish editable objects from image fallbacks.
- Map supported animation and transition semantics in both directions; preserve speaker notes, alt text, object order, and slide dimensions.
- Add explicit reports for unsupported SmartArt/diagram editing, fonts, linked media, object behaviors, and animation effects.
- Validate complete decks and representative edits, not only an initial slide thumbnail; ensure PDF/print paths match supported rendering.

## Dependencies and delivery

Completion is blocked on `WP-012`. Design and isolated prototypes may proceed, but do not bypass the prerequisite contracts or release gates.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- A deck containing imported masters, tables, grouped artwork, media, and animations exports with no unreported supported-content loss.
- Changing a text box or picture does not remove unrelated inherited artwork.
- Unsupported content is preserved safely or reported precisely, never silently replaced with an inaccurate object.
- Exported PPTX opens in PowerPoint and supported objects remain editable.

## Verification

- Vitest OOXML/resource/relationship tests and WP-012 corpus comparisons.
- Use visual comparisons of slide rendering, print/PDF output, and painted-canvas interactions.
- Verify import/export source hashes and include missing-media and missing-font cases.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

This does not make every imported object fully editable. Advanced authoring is WP-023 and recording is WP-024.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S15`, `S19`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
