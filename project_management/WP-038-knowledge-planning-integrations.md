---
id: "WP-038"
title: "Tasks, notebooks, portals, and structured-work integrations"
type: "work_package"
status: "blocked"
priority: "P2"
phase: 4
area: "workspace-expansion"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: true
blocked_on: ["WP-026", "WP-027", "WP-031"]
related_sources: ["S01", "S02"]
---

# Tasks, notebooks, portals, and structured-work integrations

## Outcome and rationale

Cover adjacent knowledge and planning workflows through focused integrations and shared document primitives rather than launching several immature standalone applications.

## Existing implementation and starting points

SuiteLeaf has documents, drawings, spreadsheets, forms, search foundations, and versioned files. A full task manager, notebook hierarchy, intranet portal, and Access/AppSheet-style application builder were not established as implemented.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Define pilot workflows for project task lists, linked meeting notes, a team knowledge portal, and structured records collected by forms; document which can reuse existing editors.
- Integrate tasks with assignments/due dates/status, documents with note collections/backlinks, and team portals with permission-aware file views and search.
- Provide structured table/view and form integration boundaries for lightweight database workflows, including record IDs, relationships, validation, access, import/export, and audit history.
- Use public APIs/webhooks and selected external providers where native implementation is not justified; document data ownership, export, and provider outages.
- Create a build-versus-integrate decision and separate implementation estimates before any full notebook, intranet, project-management, or database-app product commitment.
- Keep all linked views subject to effective access and preserve useful offline snapshots where policy allows.

## Dependencies and delivery

Completion is blocked on `WP-026`, `WP-027`, `WP-031`. Design and isolated prototypes may proceed, but do not bypass the prerequisite contracts or release gates.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- Each selected pilot workflow has a complete documented path using native features or explicitly supported integrations.
- Backlinks, portal search, and linked task previews do not leak restricted file content.
- Structured records round-trip with stable identities and declared validation/relationship limits.
- The product matrix distinguishes delivered integration workflows from deferred standalone products.

## Verification

- Unit/integration tests for link identity, permissions, record validation, and event-driven updates.
- Use generated pilot datasets to demonstrate end-to-end task/notes/portal/form workflows.
- Test disconnected providers and export without requiring the provider to remain available forever.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Do not equate a spreadsheet with a full relational database application platform or a document folder with complete OneNote parity. Native adjacent products require explicit follow-on scope.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S01`, `S02`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
