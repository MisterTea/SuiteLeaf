---
id: "WP-001"
title: "Capability inventory and parity release gates"
type: "work_package"
status: "done"
priority: "P0"
phase: 1
area: "quality"
created: "2026-10-29"
updated: "2026-11-04"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S01", "S02", "S03"]
---

# Capability inventory and parity release gates

## Outcome and rationale

Create an accurate, maintained view of SuiteLeaf capabilities so planning and release claims reflect working workflows rather than menu entries. The README understates current functionality, while the existence of an implementation does not establish interoperability or reliability.

## Existing implementation and starting points

Start with `README.md`, `docs/architecture.md`, `docs/docs-parity.md`, `docs/excel-visual-parity.md`, `docs/workflows.md`, `apps/web/src/App.tsx`, and `tests/`. Current source includes citations, suggestions, forms, admin tools, presentation masters/recording/PPTX export, and collaboration beyond the README's description.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Create a machine-readable capability catalog with stable IDs, supported platforms/modes, UI entry points, file-format support, known limits, verification evidence, and statuses: absent, partial, implemented, verified.
- Separate everyday editor parity, professional desktop Office parity, and enterprise workspace parity. Record the competitor edition/platform and reference date; do not compare every enterprise feature to a basic plan.
- Define representative workflows: report with citations/review, financial workbook with pivots, media presentation, shared project folder, offline trip, employee departure, and disaster recovery.
- Update user documentation after checking behavior; explicitly distinguish native-file preservation, Office conversion, visual fidelity, and calculation correctness.
- Publish release gates and a capability-to-work-package mapping. Inventory coverage tooling and enforce the repository's above-90% unit-coverage requirement without silently excluding new code.

## Dependencies and delivery

No hard work-package prerequisites. Coordinate shared interfaces with the packages linked in the portfolio index.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- Every advertised feature has a supported mode/platform and linked evidence or an explicit unverified label.
- Existing advanced features are cataloged as extension/hardening work, not duplicated as missing features.
- Release reports identify failed, skipped, unavailable-reference, and inconclusive cases separately from passes.
- The catalog and documentation have a repeatable update/check procedure.

## Verification

- Validate catalog schema and references using a lightweight check.
- Run representative existing tests to establish a dated baseline; record failures without unrelated fixes or invented pass rates.
- Inspect one complete user workflow per editor and distinguish current evidence from historical corpus results.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Do not promise a percentage of total Office feature parity: there is no defined universal denominator. This package creates evidence and gates, not all downstream feature implementations.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S01`, `S02`, `S03`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.

# Progress

2026-10-30: In progress. Added a machine-readable capability catalog in `packages/core/src/capabilities/` with parity tiers (everyday editor, professional desktop, enterprise workspace), statuses, platforms, modes, UI entry points, formats, limits, evidence, seven representative workflows, and the four phase release gates. `npm run check:capabilities` validates the catalog and fails if that directory is under 90% statements, branches, functions, or lines. The check on this date passed at 100% statements, branches, functions, and lines for `packages/core/src/capabilities`. No capability is `verified`. A combined vitest run of the catalog test plus `tests/json-data.test.ts`, `tests/slide-editing.test.ts`, and `tests/sheet-links.test.ts` exited 0 (4 files, 26 tests). Those three files are baseline rows with scoped notes. They are not painted-canvas or full-workflow passes. `docs/capabilities.md` is the update procedure. `npm run test:coverage` is still the whole-suite command and does not yet fail the build on a repository-wide threshold.

Still open for this package: record a dated full-suite coverage measurement, and attach a passing test to each advertised capability before any row becomes `verified`. The 2026-10-31 browser pass below is the workflow note; it does not verify a catalog row.

2026-10-31: independent backup and managed updates are `partial`, not `absent`. The backup evidence is the Rust test that copies issuer `https://idp.example`, audience `suiteleaf`, and an idle time of 1800 seconds, and leaves out the client secret. The update evidence is `npx vitest run tests/updates.test.ts` (9 tests). Neither row is `verified`. The release report now has 6 passes and the remaining evidence stays inconclusive. `npm run check:capabilities` passed at 100% statements, branches, functions, and lines for `packages/core/src/capabilities`. 2026-10-31: one workflow per editor was walked in the browser at `http://127.0.0.1:5174/` (Vite, hash routes). Document: New document opened an editor titled Untitled document; typing into Document content produced “North beds”; Back to files listed the file; reopening showed “North beds” again. Spreadsheet: New spreadsheet opened Untitled spreadsheet, sheet tab Sheet1, name box B5 after a click on the painted grid, and the file appeared in the list. Keystrokes and the formula bar did not show a cell value, so no cell entry is claimed. Presentation: New presentation opened Untitled presentation; the title field accepted “North beds”; the slide list read “Slide 1: North beds”; leaving and reopening kept that title. The status line read “Saved on this device.” No capability is `verified`. A dated full-suite coverage measurement is still open.

2026-10-31, later: the disaster-recovery workflow no longer says backup restore is absent. The note says a clean database can be restored from a local archive, that restore does not start a node, and it is not a pass. Independent backup stays `partial`. `npx vitest run tests/capabilities/catalog.test.ts` passed. `npm run check:capabilities` was not re-run for this note. No capability is `verified`. A dated full-suite coverage measurement is still open.

2026-11-01: `npx vitest run --coverage` passed 1805 tests in 325 files. The totals were 71.56% lines (28303 of 39547), 68.49% statements (32212 of 47030), 63.85% functions (5581 of 8740), and 61.49% branches (24454 of 39764). That is below 90%. The command does not fail the build on that threshold. The first run timed out on `keeps a picture that fills a slide group` at 5 seconds while coverage was on, because that test also reads `datasets/napierone/files/pptx/0153-pptx.pptx` (2.7 MB). The timeout for that test is now 60 seconds, and the second run passed. This measurement is the Vitest suite, not the Rust tests. No capability is `verified`.

2026-11-01: employee departure stays inconclusive. A device named `secret-value` can be signed out in the note, and that name is not in the note. One session can be asked to sign in again. The account is not removed. Files this person owns are not given to someone else. The Admin page shows that list. `npx vitest run tests/departure-checklist.test.ts tests/ui/departure-note.test.tsx tests/capabilities/catalog.test.ts` passed (10 tests). The Admin page was not opened. This is not a pass. No capability is `verified`.

2026-11-01: removing an account can give that person's files to someone else. Sam's Beds and Paths become Priya's. Priya's Notes stays Priya's. Sam is left with no files. Someone who is not an administrator cannot do this. An empty new owner says `Choose a person to own this file.` and does not move Beds. That sentence does not contain `secret-value`. The departure review still does not remove the account or move files. `cargo test -p suitedrive --test directory handing_over_every_owned_file_leaves_someone_elses_file` passed. `npx vitest run tests/departure-checklist.test.ts tests/ui/departure-note.test.tsx tests/capabilities/catalog.test.ts` passed (10 tests). The Admin page was not opened. This is not a pass. No capability is `verified`.

2026-11-01: the offline-trip workflow stays inconclusive. An edit titled `My edit` stays as a recovery draft when the file on disk was changed to `External edit`. Reloading reads `External edit`. Opening the store again still has the draft. `npx vitest run tests/store.test.ts -t "recovery draft"` passed (2 tests). `npx vitest run tests/capabilities/catalog.test.ts` passed (8 tests). The desktop app was not started. This is not a pass. No capability is `verified`.

2026-11-01: the chart capability lists combo charts with bar, line, pie, and scatter. Area, radar, and waterfall stay absent. The status stays `implemented`. `npx vitest run tests/capabilities/catalog.test.ts` passed (8 tests). The spreadsheet was not opened. No capability is `verified`.

2026-11-01: the chart capability also lists area, stacked, waterfall, and histogram charts, which the spreadsheet already draws. Radar charts stay absent. The status stays `implemented`. `npx vitest run tests/capabilities/catalog.test.ts` passed (8 tests). The spreadsheet was not opened. No capability is `verified`.

2026-11-01: the sharing capability no longer says access is unexplained before a permission change. Share changes, folder moves, and group membership have a preview. The remaining limit is that a sharing-policy migration does not produce an impact report. Sharing stays `partial`. `npx vitest run tests/capabilities/catalog.test.ts` passed (8 tests). The share dialog and the Admin page were not opened. No capability is `verified`.

2026-11-01: the sharing capability now records an editor-to-viewer migration for files the owner has. The remaining limit is that this is not an organization-wide policy and the Admin page does not run it. Sharing stays `partial`. `npx vitest run tests/capabilities/catalog.test.ts` passed (8 tests). The Admin page was not opened. No capability is `verified`.

2026-11-04: the catalog is now checked against its sources. `tests/capabilities/catalog-sources.test.ts` fails when:
- a README **What works** bullet, or a README sentence that makes a claim, has no advertised capability behind it;
- a work package whose status is not `blocked` has no capability row;
- the whole-suite coverage gate drops below 90% lines or statements, or excludes anything except type declarations.

`npm run check:capabilities` runs it with the catalog test. It caught two gaps, now closed. Document collaboration was advertised in the README but not in `advertisedIds`; with it removed again, the check failed. Six started packages had no row: WP-003, WP-004, WP-018, WP-022, WP-029, and WP-035. They now have `partial` rows, catalogued as hardening work rather than as missing features. The 13 test files those rows cite were run again today and passed (65 tests).

2026-11-04: a dated full-suite measurement now exists.
- `npx vitest run --coverage`: 615 files and 4,472 tests passed. Statements 93.82%, lines 96.69%, functions 95.77%, branches 85.84%. `vitest.config.ts` fails that command below 90% lines or statements and excludes only type declarations. Branches are below 90% and are not a failing threshold. That is a disclosed limit, not a pass.
- `cargo test -p suiteleaf-node` passed: 65 unit, 1 cluster, and 36 multiuser tests.

These runs are baseline rows in the catalog, and the coverage policy text no longer says there is no repository-wide threshold.

2026-11-04: the spreadsheet workflow now has cell entry. `npx playwright test tests/browser/sheet-collab.spec.ts tests/browser/slide-collab.spec.ts --project=chromium` passed (2 tests). In the sheet test, North was typed into the painted grid in one browser and appeared in the other, while the other worksheet stayed separate. With the 2026-10-31 document and presentation walks and the six two-browser document tests, each editor has one complete workflow on record.

2026-11-04: `docs/capabilities.md` separates native preservation, Office conversion, visual fidelity, and calculation correctness, with a table for each format. It says historical corpus results are not current evidence until they are run again. The README points to that section. `cap-doc-collaboration` is the first `verified` row.

Acceptance evidence:
- Advertised features: every advertised feature names its platforms and modes and has evidence or an inconclusive label. The schema requires this, and the source check ties README claims to advertised rows.
- Existing advanced features: they are catalogued, and every started package has a row.
- Release reports: `releaseReport` counts pass, fail, skipped, unavailable-reference, and inconclusive separately. The catalog test covers a failure beside inconclusive rows.
- Update procedure: `docs/capabilities.md` has a seven-step update procedure, and `npm run check:capabilities` enforces it.

Known limits:
- Branch coverage is 85.84% and is not a failing threshold.
- Rust coverage is not measured.
- Most rows and four of seven workflows remain inconclusive. That is the honest label, not a gap in this package.

Status is `in_review`. WP-012 stays blocked on WP-001 until the evidence is accepted.

2026-11-04, later: the product owner accepted the evidence above. Status is `done`. WP-012 no longer waits on WP-001. The known limits listed above still apply.

2026-11-04, later still: the source check now asks for a capability row only from a package that has started (`in_progress`, `in_review`, or `done`). A `ready` package has no work yet. Before this, unblocking WP-013 as `ready` would have failed the check, because WP-013 has no row. `docs/capabilities.md` says the same.
