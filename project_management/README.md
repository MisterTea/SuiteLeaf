# SuiteLeaf to Microsoft Office: work portfolio

Rebuilt 2026-11-15 from the current worktree at base commit `40ac7ee2` and Microsoft documentation. This replaces the previous planning content and completion claims. Existing package IDs and filenames are retained because application capability records, documentation and tests reference them. Historical implementation remains in the repository; historical planning is available through Git.

**Conclusion:** SuiteLeaf has a substantial editor and workspace foundation. The most consequential remaining work is measured Office fidelity, calculation correctness, dependable save/collaboration, and completion of professional workflows. Existing helpers and passing historical unit tests do not establish end-to-end parity.

Start with [the comparison](COMPARISON.md), then [the delivery roadmap](ROADMAP.md). [Sources](SOURCES.md) records the Microsoft benchmark and local evidence. This is a planning/source-review deliverable, not a live Office benchmark or a claim that the app currently passes these gates.

## Scope

The primary target is Word, Excel and PowerPoint in Microsoft 365 desktop on Windows, with Mac and web differences recorded separately. Cluster features are compared with relevant Microsoft 365 services, not assumed to come with an Apps-only subscription. Outlook and the wider ecosystem have explicit packages and exclusions. No platform-wide or percentage parity claim is made.

All 38 packages are newly planned acceptance work. `ready` means sufficiently described for triage; dependencies still gate integration. It does not mean implementation is absent, dependencies are complete, or historical work has been undone. Owners are unassigned. Effort is provisional. The catalog's historical phases/statuses are not rewritten by this documentation reset; WP-001 reconciles those against fresh evidence.

## Work packages

| Package | Outcome | Priority | Wave | Effort | Dependencies |
| --- | --- | --- | --- | --- | --- |
| [WP-001](WP-001-capability-baseline.md) | Reconcile the Office parity baseline | P0 | 1 | S | None |
| [WP-002](WP-002-collaboration-foundation.md) | Prove document collaboration under failure | P0 | 1 | L | WP-001 |
| [WP-003](WP-003-sheet-collaboration.md) | Complete spreadsheet collaboration semantics | P0 | 1 | XL | WP-002 |
| [WP-004](WP-004-slide-collaboration.md) | Complete presentation collaboration semantics | P0 | 1 | L | WP-002 |
| [WP-005](WP-005-save-sync-recovery.md) | Make save and recovery dependable | P0 | 1 | L | WP-001 |
| [WP-006](WP-006-offline-readiness.md) | Complete the offline working trip | P0 | 1 | L | WP-005 |
| [WP-007](WP-007-permission-explanations.md) | Enforce and explain sharing permissions | P0 | 2 | M | WP-002 |
| [WP-008](WP-008-enterprise-identity.md) | Deliver enterprise identity integration | P1 | 2 | L | WP-007 |
| [WP-009](WP-009-provisioning-offboarding.md) | Complete employee onboarding and departure | P1 | 2 | L | WP-008 |
| [WP-010](WP-010-backup-restore.md) | Demonstrate independent disaster recovery | P0 | 1 | L | WP-005 |
| [WP-011](WP-011-managed-releases.md) | Ship trusted desktop updates | P0 | 1 | L | WP-005 |
| [WP-012](WP-012-compatibility-corpus.md) | Measure Office round trips against Office | P0 | 1 | L | WP-001 |
| [WP-013](WP-013-compatibility-reports.md) | Make conversion losses visible and recoverable | P0 | 1 | M | WP-012 |
| [WP-014](WP-014-word-roundtrip.md) | Close DOCX fidelity gaps | P0 | 1 | XL | WP-012 |
| [WP-015](WP-015-excel-compatibility.md) | Match Excel workbook and calculation semantics | P0 | 1 | XL | WP-012 |
| [WP-016](WP-016-powerpoint-roundtrip.md) | Close PPTX visual and editable-object gaps | P0 | 1 | XL | WP-012 |
| [WP-017](WP-017-document-publishing.md) | Finish professional document layout and print | P1 | 3 | XL | WP-014 |
| [WP-018](WP-018-document-review.md) | Finish Word-compatible review workflows | P1 | 3 | L | WP-014, WP-002 |
| [WP-019](WP-019-research-proofing-merge.md) | Complete research, language and mail merge | P1 | 3 | L | WP-017 |
| [WP-020](WP-020-sheet-data-preparation.md) | Turn sheet queries into dependable data preparation | P1 | 3 | XL | WP-015 |
| [WP-021](WP-021-sheet-advanced-analysis.md) | Complete analytical spreadsheet workflows | P1 | 3 | XL | WP-015, WP-020 |
| [WP-022](WP-022-sheet-performance.md) | Make large workbooks responsive and printable | P1 | 3 | L | WP-015 |
| [WP-023](WP-023-presentation-authoring.md) | Finish professional slide authoring | P1 | 3 | XL | WP-016 |
| [WP-024](WP-024-presentation-recording.md) | Complete presenting, media and recording | P1 | 3 | L | WP-023 |
| [WP-025](WP-025-production-forms.md) | Finish reliable forms and responses | P2 | 3 | L | WP-007, WP-005 |
| [WP-026](WP-026-workspace-search.md) | Deliver permission-aware workspace discovery | P1 | 2 | L | WP-007 |
| [WP-027](WP-027-team-workflows.md) | Complete review assignments and approvals | P2 | 2 | M | WP-007, WP-018 |
| [WP-028](WP-028-migration-tools.md) | Make Office migration resumable and reversible | P1 | 2 | L | WP-013, WP-007 |
| [WP-029](WP-029-accessibility.md) | Make all editors usable with assistive technology | P0 | 3 | L | WP-001 |
| [WP-030](WP-030-mobile-workflows.md) | Complete touch and mobile lifecycle workflows | P2 | 3 | L | WP-005, WP-029 |
| [WP-031](WP-031-automation-platform.md) | Deliver safe automation and a macro migration path | P2 | 4 | XL | WP-007, WP-015 |
| [WP-032](WP-032-governance.md) | Enforce governance across actual data paths | P2 | 4 | XL | WP-007, WP-010 |
| [WP-033](WP-033-operations-support.md) | Make cluster operations supportable | P1 | 2 | L | WP-010, WP-011 |
| [WP-034](WP-034-controlled-ai.md) | Make the assistant reliable and permission-correct | P1 | 2 | L | WP-007, WP-005 |
| [WP-035](WP-035-commercial-transparency.md) | Publish an honest feature and support matrix | P2 | 2 | S | WP-001 |
| [WP-036](WP-036-shared-templates.md) | Deliver reusable organization templates | P1 | 2 | M | WP-007, WP-014, WP-016 |
| [WP-037](WP-037-communications-integrations.md) | Close Outlook mail, calendar and contact workflows | P2 | 4 | XL | WP-008, WP-007 |
| [WP-038](WP-038-knowledge-planning-integrations.md) | Define the broader Office replacement boundary | P2 | 4 | XL | WP-007, WP-026, WP-031 |

## Definition of done

- Reproduce the named user workflow in SuiteLeaf and the relevant Office reference. Record fixture hashes, app versions, OS/hardware, runtime mode, dates and commands. Report observed results, failures, unavailable references and exclusions separately.
- Demonstrate create/import, meaningful edit, undo where applicable, save, close/reopen and export. Test negative and recovery paths as well as the successful path. Native preservation, conversion, rendered fidelity and calculation correctness require separate evidence.
- Use Vitest for behavior, dialog text, page rules, import/export and saved state; jsdom for component behavior. Use Rust/API integration tests for backend semantics. Playwright is reserved for layout, painted sheet/slide surfaces, real document typing and storyboards. Use external-provider and native-app checks when needed; do not duplicate a string assertion in a browser test.
- Keep unit coverage above 90%. The current repository gate enforces lines/statements at 90%; that floor is not proof of branch coverage or a reason to lower existing coverage. Report all metrics and current coverage rather than copying historical totals. Run relevant tests, type/lint checks for implementation changes, and `npm run check:capabilities` when capability claims change.
- Before creating a PR or pushing to main, run local CI with `nektos/act` and resolve failures, as required by AGENTS.md. This planning task does neither. Building/installing the app is outside this task.
- Update capability status and user documentation to the demonstrated scope. Do not mark a package complete because its helper exists or a mocked test passes. Attach actual evidence and list remaining limitations.
- For Office-font mismatches, investigate shared import, inheritance, autofit, measurement and font data. Fix a proven metric mismatch in the SuiteLeaf counterpart font. Do not add named-font spacing/offset overrides. No font mismatch is claimed to have been reproduced by this review.
- Split source files exceeding 1,000 lines into semantic modules when touched, except genuine datasets. Reuse existing work and preserve unrelated worktree changes.

## Planning validation

The folder is documentation only. Package/link/dependency checks and the repository capability check are the relevant checks for this reset. A new full test, coverage, performance, Office or accessibility certification is not implied by this document.

Validation on 2026-11-15: `npm run check:capabilities` passed 13 tests across 2 files. Capability-scope coverage: statements 96.87%, branches 95.83%, functions 93.75%, lines 96.73%; these are not whole-application coverage figures. All 38 package IDs, 323 relative links and dependency acyclicity were checked; `git diff --check -- project_management` passed.
