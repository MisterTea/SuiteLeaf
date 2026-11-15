# SuiteLeaf compared with Microsoft Office

Assessment date: 2026-11-15. Repository base: `40ac7ee2`, including the current uncommitted worktree. Method: README, capability catalog, feature documentation and source entry-point inspection, plus current Microsoft primary documentation. No Office application was launched and no fresh parity corpus, rendering or timing benchmark was run for this planning review.

## Benchmark and evidence language

Use Microsoft 365 Word, Excel and PowerPoint desktop on Windows as the professional authoring reference; record macOS and web variants separately. Current Microsoft documentation is a feature benchmark, not a pinned executable build. WP-001 and WP-012 must record installed builds before quantitative comparison. [Microsoft's application service description](https://learn.microsoft.com/en-us/office365/servicedescriptions/office-applications-service-description/office-applications-service-description) distinguishes applications, platforms and service dependencies; do not assume Apps-only licensing includes every enterprise service.

- **Present, bounded:** repository evidence identifies a working implementation with stated scope; no fresh runtime certification here.
- **Partial:** substantial implementation exists but known limits or incomplete integration prevent parity claims.
- **Unverified:** end-to-end evidence is missing or historical; this does not mean the feature is absent.
- **Not established:** the inspected evidence does not support the capability; first inventory, then decide whether to build or integrate.

There is no defensible overall parity percentage from this inspection. The catalog's dated evidence is useful history, but must not be relabeled as today's measured result.

## Core applications

| Area | Office benchmark | SuiteLeaf evidence and remaining gap | Work packages |
| --- | --- | --- | --- |
| Basic editing | Word/Excel/PowerPoint authoring | Present, bounded: rich text, grid formulas/styles, slide objects and local files. Verify complete everyday workflows before expanding menus. [README](../README.md) | 001, 017, 022, 023 |
| Word publishing | Sections, styles, references and professional layout; web/desktop differ [S1] | Partial/unverified: pagination, styles, table splitting, citations and indexing modules exist. Need full long-report editing, field updates and print consistency. [layout](../packages/core/src/document-pagination.ts), [styles](../docs/document-styles.md) | 014, 017, 019 |
| Word review | Desktop review/compare and document editing [S1] | Partial: combine, approval and DOCX review helpers exist; verify complex revisions and collaborative acceptance, rather than reimplementing a review model. [review](../docs/document-review.md) | 002, 018 |
| DOCX interchange | Editable Word documents | Partial: import/export exists. Current harness does not prove rendered equivalence; font, section, floating-object and field fidelity need reference fixtures. [harness limits](../docs/office-compat.md) | 012–014 |
| Excel computation | Recalculation and spreadsheet semantics; define exact supported function set | Partial/unverified: grid engine plus custom formula helpers. Need independently recalculated Excel outputs, arrays/names/dates/errors and stale-cache handling. [catalog](../packages/core/src/capabilities/catalog-data.ts) | 012, 015 |
| Data preparation | Power Query imports, transformations and refresh, including web functionality subject to plan/source limits [S3, S4] | Partial: local transforms, joins, append, parameters and schema checks exist; not a demonstrated M-compatible connector platform. [queries](../docs/sheet-query.md) | 020 |
| Analytics | Pivots plus related-table models and measures through Power Pivot [S5] | Partial: charts, pivots, slicers, solver and goal seek have code. Catalog expressly excludes Power Pivot equivalence. Separate ordinary pivots from relational/DAX ambitions. [goal seek](../docs/goal-seek.md), [slicers](../docs/pivot-slicer.md) | 021 |
| Large sheets and print | Usable large-workbook editing and paginated output | Unverified: cost scans do not establish recalculation speed; README limits sheet printing to 10,000 cells. [performance](../docs/sheet-performance.md), [README](../README.md) | 022 |
| PowerPoint authoring | Object, media and collaboration support varies by platform [S2] | Partial: master/theme, geometry, animation and alignment work exists. Need integrated authoring and export tests for a complete branded deck. [master UI](../apps/web/src/editors/slide-master-ui.tsx), [PPTX export](../packages/core/src/pptx-export.ts) | 016, 023 |
| Present and record | Presenter controls, narration and portable video [S6, S7] | Partial: presentation/recording components exist. Presenter documentation explicitly describes notes and audience regions in one window, not a tested external-display workflow. [presenter](../docs/presenter-display.md) | 024 |
| Fonts and rendering | Reference layout under recorded Office/font versions | Unverified: SuiteLeaf has metric-matched Office counterparts and shared measurement helpers. No mismatch reproduced in this review; require rendered comparisons and shared-cause/font-data fixes if found. [font mapping](../packages/core/src/office-fonts.ts) | 012, 014–017, 022–023 |

## Shared workspace and adjacent products

| Area | Benchmark boundary | SuiteLeaf evidence and remaining gap | Work packages |
| --- | --- | --- | --- |
| Save, sync and history | Office cloud version history depends on OneDrive/SharePoint [S8] | Present but bounded: local/browser saves, atomic desktop files, recovery drafts and SuiteDrive history. Cross-mode crash/conflict certification remains open. [README](../README.md) | 005–006 |
| Coauthoring | Real-time shared editing; platform support differs [S2] | Document collaboration has dated verified evidence; sheet/slide code exists but catalog remains partial. Partition, structural edits and per-user undo need acceptance coverage. [collaboration](../docs/collaboration.md) | 002–004 |
| Identity and administration | Organization services beyond an Apps-only installation [S10] | Partial: accounts, social sign-in, session policy and sharing. SSO/provisioning, departure and service-path enforcement require actual provider/cluster proof. [identity](../docs/identity.md) | 007–009 |
| Disaster recovery and updates | Operational readiness target, not a claim of identical Microsoft service architecture | Partial: sealed backups and signed-manifest components exist. Clean-cluster restore and trusted installer distribution need deployment evidence. [backups](../docs/backup.md), [updates](../docs/updates.md) | 010–011, 033 |
| Search, approvals and migration | Team productivity workflows, with service-specific licensing | Partial: dedicated modules exist; permissions, indexing freshness, notifications and resumability need product-level acceptance. [search](../packages/core/src/search), [migration](../packages/core/src/migration) | 026–028, 036 |
| Accessibility and mobile | Office checker supports author guidance; device support differs [S11] | Partial: document checks, slide reading order and mobile helpers. Checkers alone do not demonstrate screen-reader operation of grid/canvas or robust touch editing. [accessibility](../docs/accessibility.md) | 029–030 |
| Forms | Separate Microsoft Forms-style workflow; not Word/Excel/PowerPoint parity | Partial: submission, branching and export components exist. Cross-node uniqueness and respondent privacy require integration verification. [forms](../docs/forms.md) | 025 |
| Automation | VBA, Office Scripts and add-ins have different APIs, permissions and platforms [S9] | Partial: API/job/sandbox/webhook modules exist. VBA is not executed; preserved macro bytes are not macro compatibility. No blanket COM/add-in compatibility claim. [automation](../packages/core/src/automation) | 031 |
| Governance | Enterprise service scope must be specified independently [S10] | Partial: policy models exist; actual retention/hold/export/replication enforcement needs proof. [governance](../docs/data-governance-residency.md) | 032 |
| Assistant | Microsoft Copilot respects existing data permissions [S12]; availability is separately scoped | Partial: local/server AI and editing tools exist. Current permission code is under active uncommitted development; evaluate task quality and server-side access, not feature-name equivalence. [policy](../docs/ai-policy.md) | 034 |
| Outlook and calendar | Mail, calendar and contacts are a separate application/service scope [S10] | Present, bounded: SuiteLeaf Mail includes IMAP/SMTP, Gmail OAuth, contacts and optional Google Calendar/Tasks sidebar. Full Exchange, scheduling, recurring events and delegation are not established by this review. [mail](../docs/mail.md) | 037 |
| OneNote, Access and broader ecosystem | Application/service availability depends on platform and plan [S10] | Not established: knowledge/planning connectors do not establish notebook, relational database, meetings or diagram-editor replacements. Assign build/integrate/defer decisions explicitly. [integrations](../packages/core/src/integrations/knowledge-planning) | 038 |
| Cost and portability | Compare actual edition/platform and separately required services [S10] | Differentiator: Apache-2.0, no-account local editing, local/self-hosted options. Hosted costs are unpublished; do not invent a price advantage or treat metadata-only export as complete portability. [packaging](../docs/packaging.md) | 035 |

## What to do first

1. Establish trusted Office fixtures and honest capability evidence.
2. Prevent silent data loss and wrong calculations across save, sync and conversion.
3. Finish the report, financial workbook and branded presentation workflows, including keyboard access.
4. Demonstrate team operations and broader ecosystem workflows under separately named scopes.

The main delivery risk is confusing local helper coverage with an integrated replacement workflow. This is why every new package defines observable acceptance, rather than inheriting the old `done` label. See [roadmap](ROADMAP.md) for ordering and [source register](SOURCES.md) for S-number references.
