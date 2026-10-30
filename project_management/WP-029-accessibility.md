---
id: "WP-029"
title: "Accessible editors and exported artifacts"
type: "work_package"
status: "ready"
priority: "P1"
phase: 3
area: "accessibility"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S19"]
---

# Accessible editors and exported artifacts

## Outcome and rationale

Make SuiteLeaf usable with assistive technologies and ensure exported documents retain supported accessibility structure.

## Existing implementation and starting points

Inspect editor toolbars/dialogs, the painted Univer grid, slide canvas, document image-alt controls, export modules, and responsive tests. Existing labels and alt-text fields are a foundation, not proof of end-to-end accessibility.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Create an accessibility matrix for keyboard-only, screen readers, zoom/reflow, high contrast, reduced motion, and touch across web/desktop.
- Provide semantic navigation and editable access to grid cells and slide objects; expose selection, values, headers, formula errors, order, and commands without relying solely on canvas pixels.
- Fix focus management, dialogs, shortcuts, status announcements, drag alternatives, accessible names, and contrast with representative assistive technologies.
- Implement an authoring checker for titles/headings, reading order, alt text, table headers, link meaning, and color-only information, with precise fix locations.
- Preserve supported structure in DOCX/PPTX and tagged PDF where the export pipeline permits it; implement an alternative export path when print-to-PDF cannot retain required tags.
- Document tested standards/platform combinations and known limitations; use WCAG 2.2 AA as an engineering target, not an unverified compliance claim.

## Dependencies and delivery

No hard work-package prerequisites. Coordinate shared interfaces with the packages linked in the portfolio index.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- Core create/edit/save/share workflows can be completed by keyboard and supported screen readers.
- Users can inspect and edit sheet cells and slide objects without visual canvas access.
- Checker findings link to real content and distinguish automatic checks from required human judgment.
- Supported exports retain validated headings, reading order, alt text, and table structure, with explicit limits for other formats.

## Verification

- Vitest/jsdom semantic/focus behavior and automated accessibility checks where meaningful.
- Manual screen-reader verification on selected Windows/macOS/browser combinations; record exact versions/results.
- Use browser tests for focus visibility, zoom/reflow, painted surfaces, and keyboard layout; inspect exported accessibility structure separately.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Automated checks alone do not establish compliance. Do not claim tagged/accessible PDFs from ordinary printing unless verified.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S19`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
