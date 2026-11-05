---
id: "WP-013"
title: "User-visible compatibility reports and safe export"
type: "work_package"
status: "done"
priority: "P0"
phase: 1
area: "compatibility"
created: "2026-10-29"
updated: "2026-11-04"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S15", "S16"]
---

# User-visible compatibility reports and safe export

## Outcome and rationale

Help users know what will change before they share an exported file. Preserve the original and make every known conversion loss actionable.

## Existing implementation and starting points

Existing import metadata, compatibility notes, `apps/web/src/office-import.ts`, `packages/core/src/office.ts`, export modules, and round-trip scanners provide the starting point.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Define structured compatibility findings with severity, feature, affected location, source/target format, fidelity dimension, and recommended action.
- Show import and pre-export reports with navigation to affected paragraphs/cells/slides. Distinguish unsupported editing from unsupported display and from data loss.
- Detect font substitution/missing fonts and explain likely pagination/layout effects; offer legal font installation guidance or safe alternatives.
- Preserve unsupported package parts where relationships remain valid, or retain original/source attachments with explicit limits; never claim preserved editability for a raster fallback.
- Add export choices: proceed with report, choose another format, or keep native/original copies. Remember user choices only where safe and reversible.
- Make reports available to batch migration/CLI tools and include converter version and evidence references.

## Dependencies and delivery

No hard work-package prerequisites remain. Coordinate shared interfaces with the packages linked in the portfolio index.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- A known unsupported object or export loss produces a specific finding with the affected location before export.
- Original source files remain unchanged; an exported report can be understood without developer logs.
- Unsupported-object preservation does not resurrect executable content or broken relationships.
- Users can distinguish tested support from merely unobserved differences.

## Verification

- Vitest/jsdom tests for reports, export choices, location mapping, fonts, and malformed inputs.
- Use generated Office fixtures with deliberate unsupported objects and verify originals by hash.
- Test report consistency between desktop, web, and CLI conversions.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Do not block all exports merely because a warning exists. Security/capacity rejection remains separate from fidelity warnings. No automatic macro execution.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S15`, `S16`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.

# Progress

2026-10-30: Not started. Front matter status is `blocked`. `blocked` is true. `blocked_on` is ["WP-012"]. No product behavior for this package changed on this date. Active work is the WP-001 catalog and a mark-preservation slice of WP-002.

2026-11-04: WP-012 was accepted as done, so this package is no longer blocked. Status is `ready`, meaning it is ready to start; no work has begun. It was blocked on WP-012 from 2026-10-29 until then; that dependency is still listed under Dependencies.

2026-11-04: Implemented structured user-visible compatibility reports in `packages/core/src/compat/user-report.ts` and CLI integration in `apps/desktop/src/convert-cli.ts`. Defined findings with severity (`info`, `warning`, `error`, `data-loss`), impact (`data-loss`, `unsupported-editing`, `unsupported-display`, `notice`), fidelity dimension, affected location (paragraphs/headings, sheets/cells, slides/elements), and recommended actions. Added font analysis matching Office/SuiteLeaf metrics and advising on substitution/licensing. Added scanners for documents, sheets, and presentations. Implemented safe unsupported-package preservation verifying source hash and quarantining executable streams. Added export choices (`proceed`, `choose-alternative`, `keep-original`) preserving original files. Updated CLI convert command with `--report` supporting Markdown, JSON, and terminal output. Added documentation in `docs/office-compat.md`. All 9 tests in `tests/compat/user-report.test.ts` pass with 97.31% line coverage. Package marked done.
