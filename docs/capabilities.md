# Capability catalog

SuiteLeaf release claims come from `packages/core/src/capabilities/catalog.ts`, not from the presence of a menu. The catalog records stable capability IDs, parity tier, platform, runtime mode, UI entry, formats, limits, evidence, and the work package that owns the next change.

Statuses are `absent`, `partial`, `implemented`, and `verified`. `verified` requires an evidence row whose result is `pass`. Documentation can explain a limit. It cannot mark a workflow passed. The disaster-recovery workflow stays inconclusive. A local archive can restore a clean database. That restore does not start a node and is not a remote storage service, so the workflow is not a pass. Independent backup stays `partial`. On 2026-11-01, `npx vitest run --coverage` passed 1805 tests in 325 files. The measured totals were 71.56% lines, 68.49% statements, 63.85% functions, and 61.49% branches. That is below 90%. It is the Vitest suite, not the Rust tests. No capability is `verified`. Employee departure stays inconclusive. A named device can be signed out, and one session can be asked to sign in again. Removing the account can give their files to someone else. The review itself does not remove the account or move any files. That note does not include a device name. It is not a pass. The offline-trip workflow stays inconclusive. An edit that conflicts with a file changed outside SuiteLeaf stays as a recovery draft titled `My edit`. Reloading reads `External edit` from the file. The draft is still there after the store restarts. The desktop app was not started, so this is not a pass.

Parity tiers stay separate:

- `everyday-editor` is the documents, spreadsheets, presentations, and files people use directly.
- `professional-desktop` is deeper Office-style authoring. It is not a claim of full desktop Excel, Word, or PowerPoint.
- `enterprise-workspace` adds shared storage, identity, and administration. It is not a claim about every Microsoft 365 or Google Workspace edition.

The comparison context is stored on the catalog: Microsoft 365 Apps for enterprise and Google Workspace Business Standard, web and desktop, referenced on 2026-10-29. Do not treat a basic-plan feature as missing enterprise behavior, or the reverse.

## Check

```sh
npm run check:capabilities
```

That command validates the catalog and measures coverage for `packages/core/src/capabilities`. The gate fails below 90 percent lines, functions, branches, and statements. Do not add that directory to a coverage exclude list. `npm run test:coverage` remains the whole-suite measurement. It does not yet fail the build on a repository-wide threshold, because that full measurement is not the same command as this catalog check.

`releaseReport` counts `pass`, `fail`, `skipped`, `unavailable-reference`, and `inconclusive` separately. A skipped or unavailable reference is not a pass.

## Update procedure

1. Change the capability row when behavior changes. Name the platform, mode, format, and a limit.
2. Point `evidence.ref` at the test, document, or module that justifies the status.
3. Set `result` from the latest run. Leave it `inconclusive` until a run exists.
4. Add a `baseline` row when a representative existing test is run for a release note. Record the command and the observed result. Do not invent a pass rate.
5. Run `npm run check:capabilities`.

Representative workflows live in the same catalog: report and citations, financial workbook, media presentation, shared folder, offline trip, employee departure, and disaster recovery. They are defined so later packages can attach evidence. An inconclusive workflow is not a completed release gate.
