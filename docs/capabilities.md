# Capability catalog

SuiteLeaf release claims come from `packages/core/src/capabilities/catalog.ts`, not from the presence of a menu. The catalog records stable capability IDs, parity tier, platform, runtime mode, UI entry, formats, limits, evidence, and the work package that owns the next change.

Statuses are `absent`, `partial`, `implemented`, and `verified`. `verified` requires an evidence row whose result is `pass`. Documentation can explain a limit. It cannot mark a workflow passed. The disaster-recovery, offline-trip, and employee-departure workflows stay inconclusive. Each one's evidence note says what was shown and why it is not a pass. Document collaboration is `verified`: Rust tests across three nodes, six two-browser tests, and unit tests passed on 2026-11-04.

On 2026-11-04, `npx vitest run --coverage` passed 4,467 tests in 614 files. Statements were 93.82%, lines 96.69%, functions 95.77%, and branches 85.84%. `vitest.config.ts` fails that command below 90% lines or statements. Branches and functions are reported but are not a failing threshold. This is the Vitest suite. Rust coverage is not measured.

Parity tiers stay separate:

- `everyday-editor` is the documents, spreadsheets, presentations, and files people use directly.
- `professional-desktop` is deeper Office-style authoring. It is not a claim of full desktop Excel, Word, or PowerPoint.
- `enterprise-workspace` adds shared storage, identity, and administration. It is not a claim about every Microsoft 365 or Google Workspace edition.

The comparison context is stored on the catalog: Microsoft 365 Apps for enterprise and Google Workspace Business Standard, web and desktop, referenced on 2026-10-29. Do not treat a basic-plan feature as missing enterprise behavior, or the reverse.

## Check

```sh
npm run check:capabilities
```

That command validates the catalog and checks it against its sources. It fails when:

- a README **What works** bullet, or a README sentence that makes a claim, has no advertised capability behind it;
- a work package whose status is not `blocked` has no capability row, so existing work is not left out or listed as missing;
- the whole-suite coverage gate drops below 90 percent lines or statements, or excludes anything except type declarations;
- `packages/core/src/capabilities` falls below 90 percent lines, functions, branches, or statements.

Do not add that directory to a coverage exclude list. `npm run test:coverage` is the whole-suite measurement, and it fails below 90 percent lines or statements.

`releaseReport` counts `pass`, `fail`, `skipped`, `unavailable-reference`, and `inconclusive` separately. A skipped or unavailable reference is not a pass.

## Update procedure

1. Change the capability row when behavior changes. Name the platform, mode, format, and a limit.
2. Point `evidence.ref` at the test, document, or module that justifies the status.
3. Set `result` from the latest run. Leave it `inconclusive` until a run exists.
4. Add a `baseline` row when a representative existing test is run for a release note. Record the command and the observed result. Do not invent a pass rate.
5. When a README bullet or claim changes, update `README_CLAIMS` or `README_SENTENCES` in `tests/capabilities/catalog-sources.test.ts`.
6. When a work package starts, give it a capability row, even if that row is `partial` with inconclusive evidence.
7. Run `npm run check:capabilities`.

Representative workflows live in the same catalog: report and citations, financial workbook, media presentation, shared folder, offline trip, employee departure, and disaster recovery. They are defined so later packages can attach evidence. An inconclusive workflow is not a completed release gate.

## Four kinds of file claims

A file claim is one of four things. Each one needs its own evidence, and one does not imply another.

- **Native preservation:** a SuiteLeaf file saved and opened again keeps what was in it.
- **Office conversion:** a Word, Excel, or PowerPoint file becomes an editable SuiteLeaf file, or the reverse, with the content and structure carried across.
- **Visual fidelity:** the converted file looks like the source when it is laid out or rendered.
- **Calculation correctness:** formulas give the same results as the source application.

| Format | Native preservation | Office conversion | Visual fidelity | Calculation correctness |
| --- | --- | --- | --- | --- |
| `.sldoc`, `.slsheet`, `.slslides`, `.sldraw` | `cap-native-files`, implemented | Not applicable | Same renderer that saved it. Not separately verified | Spreadsheet formulas are stored. Results are not certified against another application |
| `.docx` | Not applicable | `cap-office-import` and `cap-docs-docx-export`, partial | Not verified. Measured corpus work is WP-012 and WP-014 | Fields are WP-017 |
| `.xlsx` and other Excel formats | Not applicable | `cap-office-import` and `cap-sheets-xlsx-export`, partial | Not verified. Historical notes are in `docs/excel-visual-parity.md`. Measured corpus work is WP-012 and WP-015 | Not verified. Formula compatibility is WP-015 |
| `.pptx` and other PowerPoint formats | Not applicable | `cap-pptx-import` and `cap-pptx-export`, partial | Not verified. Measured corpus work is WP-012 and WP-016 | Not applicable |

Historical corpus results in `docs/` describe the files and the revision they were measured on. They are not current evidence for a catalog row until the run is repeated and recorded with a date.
