---
id: "WP-036"
title: "Shared templates and organization branding"
type: "work_package"
status: "blocked"
priority: "P1"
phase: 2
area: "templates"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: true
blocked_on: ["WP-007"]
related_sources: ["S01", "S02"]
---

# Shared templates and organization branding

## Outcome and rationale

Make reusable documents, workbooks, decks, and form designs centrally discoverable and maintainable while preserving users' edits.

## Existing implementation and starting points

A template model/store/gallery already exists in `apps/web/src/templates/`, and slide themes and mail merge have reusable structures. Extend current local templates with managed organization distribution.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Add organization template ownership, versioning, publish/retire, permissions, categories, previews, and admin curation.
- Support style/brand bundles with approved fonts/colors/logos and editor-specific placeholders, chart styles, slide layouts, and document fields.
- Create files as independent instances with source-template/version provenance; template updates must not silently overwrite user documents.
- Offer an explicit update/compare workflow for supported template-linked styles and explain conflicts with local overrides.
- Package template dependencies for offline use and verify font/image licensing and export compatibility.
- Provide starter templates for the reference workflows without using private or unlicensed sample content.

## Dependencies and delivery

Completion is blocked on `WP-007`. Design and isolated prototypes may proceed, but do not bypass the prerequisite contracts or release gates.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- Authorized users can discover and instantiate an approved template with all required assets.
- Retiring a template prevents new use while existing documents remain intact.
- A template version update has explicit effects and does not replace user-authored content.
- Templates survive organization export and work offline when declared ready.

## Verification

- Vitest template lifecycle, permission, provenance, migration, and instance independence tests.
- Visual preview/layout checks for representative documents, sheets, and decks.
- Verify links/assets and supported Office exports through the compatibility pipeline.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Do not recreate the existing gallery. Templates are not executable plugins; scripts require the scoped automation platform.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S01`, `S02`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
