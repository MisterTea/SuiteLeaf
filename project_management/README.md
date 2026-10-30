---
id: "PM-INDEX"
title: "SuiteLeaf work-package portfolio"
type: "index"
status: "planning"
created: "2026-10-29"
updated: "2026-10-29"
blocked: false
blocked_on: []
---

# SuiteLeaf work-package portfolio

This directory translates a source-based SuiteLeaf assessment and research into Microsoft Office/Google Workspace capabilities and customer complaints into **38 implementation work packages**. No chat history is required. Each package explains the problem, current implementation, code entry points, requirements, dependencies, acceptance criteria, verification, and boundaries. [ROADMAP.md](ROADMAP.md) explains delivery order and coverage; [SOURCES.md](SOURCES.md) preserves research links and caveats.

## Product direction

First make SuiteLeaf a trustworthy documents/spreadsheets/presentations/files replacement: preserve work, explain sharing and sync, support Office exchange, and remain usable locally. Then make it adoptable by organizations through identity, migration, recovery, and operations. Expand advanced editing and adjacent workspace services in measured steps.

Two parity targets must remain distinct:

1. **Editor parity:** everyday and professional document, spreadsheet, presentation, offline, print, and interchange workflows.
2. **Workspace parity:** editors plus shared storage, identity, administration, governance, integrations, and communications/knowledge applications.

Microsoft and Google capabilities vary by edition, platform, and date. Full desktop Excel/VBA/Power Pivot, complete native email/conferencing, arbitrary Office add-ins, and legal compliance certifications are not implied by an everyday-editor parity claim. Packages explicitly identify where a supported subset, integration, or later product decision is required.

## Baseline and evidence

The source review was performed against the working tree on October 29, 2026, including existing uncommitted work. It was not an end-to-end certification. The README lags source capabilities: suggestions, citations, mail merge, document structure, presentation masters/animations/recording/PPTX export, admin tools, templates, forms, and partial collaboration already exist. Extend and validate them rather than creating duplicate systems.

Known audit leads include incomplete-looking spreadsheet/presentation inbound collaboration, sheet cell keys without worksheet identity, text-based collaboration compaction, and a simplified presentation-recording renderer. Reproduce and resolve these with tests; do not treat source inspection alone as a proven incident.

## Metadata contract

Every work package starts with YAML front matter:

- `id`: stable `WP-NNN` identifier; never reuse an ID for unrelated work.
- `title`, `area`, `type`: human title, primary domain, and `work_package`.
- `status`: `ready`, `blocked`, `in_progress`, `in_review`, or `done`; `ready` means ready to start, not implemented.
- `priority`: `P0` adoption/reliability blocker, `P1` next competitive capability, `P2` deep parity/platform expansion.
- `phase`: `1` trust the work, `2` adopt as a team, `3` daily professional workflows, `4` expand the platform.
- `owner`: initially `unassigned`; replace with an accountable person/team.
- `created`, `updated`: ISO dates.
- `blocked`: whether unmet hard dependencies currently prevent completion/delivery.
- `blocked_on`: IDs of currently unmet hard dependencies; initially all prerequisites are unmet. Clear a prerequisite only after its relevant contract and acceptance evidence are accepted. Keep the original dependency history in the package's Dependencies section or a decision note.
- `related_sources`: IDs in SOURCES.md; repository-only packages can use an empty list.

Initial state: **16 ready packages and 22 blocked packages**. The index describes initial dependencies; update it alongside front matter as work progresses. Dependencies gate completion/integration, not necessarily research or isolated implementation. A related package mentioned in prose is not automatically a hard blocker: parallel implementation can proceed against an agreed interface. Product-owner scope decisions are described as such, not represented as nonexistent work-package IDs.

## Work-package index

| ID | Work package | Priority | Phase | Initially blocked on |
| --- | --- | --- | --- | --- |
| [WP-001](WP-001-capability-baseline.md) | Capability inventory and parity release gates | P0 | 1 | None |
| [WP-002](WP-002-collaboration-foundation.md) | Durable document collaboration and session protocol | P0 | 1 | None |
| [WP-003](WP-003-sheet-collaboration.md) | Bidirectional spreadsheet collaboration | P0 | 1 | WP-002 |
| [WP-004](WP-004-slide-collaboration.md) | Bidirectional presentation collaboration | P0 | 1 | WP-002 |
| [WP-005](WP-005-save-sync-recovery.md) | Explainable saving, synchronization, and conflict recovery | P0 | 1 | None |
| [WP-006](WP-006-offline-readiness.md) | Verified offline work and portable presentation bundles | P1 | 1 | WP-005 |
| [WP-007](WP-007-permission-explanations.md) | Explainable sharing and safe permission changes | P0 | 2 | None |
| [WP-008](WP-008-enterprise-identity.md) | Enterprise sign-in, MFA, and session policy | P0 | 2 | None |
| [WP-009](WP-009-provisioning-offboarding.md) | Provisioning and safe employee offboarding | P1 | 2 | WP-007, WP-008, WP-010 |
| [WP-010](WP-010-backup-restore.md) | Independent backups and disaster recovery | P0 | 1 | None |
| [WP-011](WP-011-managed-releases.md) | Signed releases and managed updates | P0 | 1 | None |
| [WP-012](WP-012-compatibility-corpus.md) | Office compatibility corpus and differential verification | P0 | 1 | WP-001 |
| [WP-013](WP-013-compatibility-reports.md) | User-visible compatibility reports and safe export | P0 | 1 | WP-012 |
| [WP-014](WP-014-word-roundtrip.md) | Word document round-trip fidelity | P0 | 1 | WP-012 |
| [WP-015](WP-015-excel-compatibility.md) | Excel formula and workbook compatibility | P0 | 1 | WP-012 |
| [WP-016](WP-016-powerpoint-roundtrip.md) | PowerPoint object and media round-trip fidelity | P0 | 1 | WP-012 |
| [WP-017](WP-017-document-publishing.md) | Professional document styles, fields, and structure | P1 | 3 | None |
| [WP-018](WP-018-document-review.md) | Document review, comparison, and approvals | P1 | 3 | WP-002 |
| [WP-019](WP-019-research-proofing-merge.md) | Research, multilingual proofing, and mail-merge depth | P1 | 3 | None |
| [WP-020](WP-020-sheet-data-preparation.md) | Spreadsheet queries, connectors, and refresh | P1 | 3 | None |
| [WP-021](WP-021-sheet-advanced-analysis.md) | Advanced spreadsheet analysis and visualization | P1 | 3 | None |
| [WP-022](WP-022-sheet-performance.md) | Spreadsheet performance diagnostics and capacity | P1 | 3 | None |
| [WP-023](WP-023-presentation-authoring.md) | Professional presentation authoring and accessible design | P1 | 3 | None |
| [WP-024](WP-024-presentation-recording.md) | Faithful presentation recording and portable video | P1 | 3 | WP-023 |
| [WP-025](WP-025-production-forms.md) | Production Forms and response workflows | P1 | 3 | WP-007 |
| [WP-026](WP-026-workspace-search.md) | Permission-aware workspace search and discovery | P1 | 2 | WP-007 |
| [WP-027](WP-027-team-workflows.md) | Notifications, assigned work, and approvals | P1 | 2 | WP-007 |
| [WP-028](WP-028-migration-tools.md) | Resumable Office and Workspace migration | P1 | 2 | WP-007, WP-010, WP-012, WP-013 |
| [WP-029](WP-029-accessibility.md) | Accessible editors and exported artifacts | P1 | 3 | None |
| [WP-030](WP-030-mobile-workflows.md) | Complete mobile and touch workflows | P1 | 3 | WP-005, WP-006, WP-029 |
| [WP-031](WP-031-automation-platform.md) | Public APIs, webhooks, and safe automation | P2 | 4 | WP-007, WP-008 |
| [WP-032](WP-032-governance.md) | Retention, discovery, and organizational data policy | P2 | 4 | WP-007, WP-008, WP-010 |
| [WP-033](WP-033-operations-support.md) | Operational visibility and actionable support | P1 | 2 | WP-005, WP-010 |
| [WP-034](WP-034-controlled-ai.md) | Optional private AI with reviewable edits | P1 | 2 | None |
| [WP-035](WP-035-commercial-transparency.md) | Transparent packaging, ownership, and exit | P1 | 2 | None |
| [WP-036](WP-036-shared-templates.md) | Shared templates and organization branding | P1 | 2 | WP-007 |
| [WP-037](WP-037-communications-integrations.md) | Email, calendar, contacts, chat, and meeting integrations | P2 | 4 | WP-008, WP-031 |
| [WP-038](WP-038-knowledge-planning-integrations.md) | Tasks, notebooks, portals, and structured-work integrations | P2 | 4 | WP-026, WP-027, WP-031 |

## Shared implementation requirements

These requirements apply to every package and are intentionally repeated in condensed form in individual files:

- Follow root `AGENTS.md`. Keep every TypeScript file under 1,000 lines; extract focused modules when working near an oversized existing file. Do not turn a feature package into an unrelated repository-wide refactor.
- Preserve users' files and existing repository changes. Inspect current implementations before replacing them. Use versioned native schemas/migrations and explicit compatibility limits for new persisted fields.
- Keep permission enforcement server-side. A disabled control, local sheet protection, or AI guard alone is not authorization.
- Keep local, server-synced, backed-up, and retained states distinct. A replica is not a backup; a backup is not a legal hold; a downloaded file cannot be remotely recalled by ordinary ACL revocation.
- Use Vitest for TypeScript behavior, persistence, conversions, and jsdom UI. Keep unit coverage **above 90%** and report measured scope; do not exclude new code to meet the gate. Use Rust tests for Rust behavior.
- Use Playwright for layout/overlap/scrolling, painted grids/canvases, real document typing/caret/selection/browser-specific keys, or storyboard recordings. Do not add browser tests that only read dialog text already covered by unit tests.
- Add deterministic failure cases, not only happy paths. Reference-app unavailability, skipped tests, and unreviewed visual evidence are not passes.
- Update relevant user/admin documentation and the capability catalog. Record tested platforms, modes, formats, limitations, and migration/rollback consequences.
- Check signing, export, and dependency licensing where relevant. Do not redistribute private corpus documents, books, proprietary fonts, or provider credentials.
- No effort estimates or dates are promises in this portfolio. Size packages after the initial investigation and divide into issues while retaining the package-level acceptance gate.

## Definition of done

A package is done when its stated user outcome works on its declared target matrix, every acceptance criterion has evidence, required tests and coverage pass, migrations and recovery paths are documented/tested, meaningful risks/limits are disclosed, and documentation/catalog entries are updated. Partial implementation stays `in_progress` or is explicitly split into separately accepted scope; do not close it based on a menu item or a mock.

For an explicitly requested local app build, run `npm run build` and then `npm run package:desktop`; report the installed version and whether SuiteLeaf was open and needs reopening. Merely updating these planning documents does not require a build or replacement of the installed application.

## Planning provenance

The initial comparison combined repository inspection with official product documentation and community reports. Complaints are qualitative signals, not prevalence estimates. Community claims about pricing, permission semantics, limits, or fixes must be rechecked against current official documentation during implementation. No commercial purchases, production migrations, external messages, or deployment actions are authorized merely by this portfolio.
