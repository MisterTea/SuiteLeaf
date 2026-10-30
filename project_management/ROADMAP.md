---
id: "PM-ROADMAP"
title: "Delivery sequence and requirement coverage"
type: "roadmap"
status: "planning"
created: "2026-10-29"
updated: "2026-10-29"
blocked: false
blocked_on: []
---

# Delivery sequence and requirement coverage

## Phase 1: Trust the work

Start evidence/inventory (WP-001), durable collaboration (WP-002), save/sync (WP-005), backup/restore (WP-010), and managed releases (WP-011). Once evidence contracts exist, establish the compatibility corpus (WP-012), user reports (WP-013), and format-specific fidelity (WP-014–016). Spreadsheet and slide collaboration (WP-003–004) follow the durable session contract. Offline readiness (WP-006) builds on durable local-save/sync state. Permissions (WP-007) and identity (WP-008) can start while this work proceeds.

**Exit gate:** supported edits survive disconnection and restart; local/server/backup state is truthful; supported Office content survives edit/export/reopen with explicit limitations; independent restore works; releases have a safe deployment/recovery path. This is a workflow gate, not a promised date.

## Phase 2: Adopt as a team

Deliver effective-access explanations (WP-007), enterprise identity (WP-008), provisioning/offboarding (WP-009), permission-aware search (WP-026), tasks/notifications/approvals (WP-027), migration (WP-028), operations/support (WP-033), optional governed AI (WP-034), transparent packaging/exit (WP-035), and shared templates (WP-036).

**Exit gate:** a pilot organization can import representative files and users, review access, collaborate, diagnose failures, recover records, offboard an employee, and export its data without bespoke undocumented scripts. Record residual requirements for each pilot rather than claiming every organization can migrate.

## Phase 3: Replace professional daily workflows

Expand document publishing/review/research (WP-017–019), spreadsheet ingestion/analysis/performance (WP-020–022), slide authoring/recording (WP-023–024), Forms (WP-025), accessibility (WP-029), and mobile (WP-030). Accessibility requirements belong in designs from the beginning; their phase number does not justify postponing baseline usability.

**Exit gate:** representative report, financial workbook, presentation, form, accessible-editing, and mobile workflows complete within SuiteLeaf, and declared interchange/export behavior is verified. New features must join the collaboration and compatibility contracts rather than bypassing them.

## Phase 4: Expand the platform

Deliver safe automation (WP-031), advanced governance (WP-032), communications integrations (WP-037), and knowledge/planning/structured-work integrations (WP-038). Earlier packages may implement a minimal internal job/outbox abstraction and integrate with the public automation platform later; this avoids a circular dependency.

**Exit gate:** integrations and policies have scoped access, lifecycle controls, diagnostics, and tested exports. Native email/conferencing, a full DAX/VBA engine, and standalone notebook/database/portal products remain explicit product decisions; integration support must not be advertised as complete native parity.

## Major dependency chains

- WP-001 → WP-012 → WP-013 and WP-014/WP-015/WP-016.
- WP-002 → WP-003, WP-004, and WP-018.
- WP-005 → WP-006; WP-005 + WP-010 → WP-033.
- WP-007 + WP-008 + WP-010 → WP-009.
- WP-007 + WP-010 + WP-012 + WP-013 → WP-028.
- WP-007 → WP-025, WP-026, WP-027, and WP-036.
- WP-007 + WP-008 → WP-031; plus WP-010 → WP-032.
- WP-023 → WP-024.
- WP-005 + WP-006 + WP-029 → WP-030.
- WP-008 + WP-031 → WP-037.
- WP-026 + WP-027 + WP-031 → WP-038.

The package YAML is the authoritative current blocked state. These are initial dependency chains. A predecessor can deliver a stable accepted interface before all optional enhancements, but change the dependency explicitly rather than silently bypassing it.

## Coverage of the feature recommendations

| Recommendation | Owning work packages |
| --- | --- |
| Accurate capability claims and workflow evidence | WP-001, WP-012 |
| Shared editing, presence, reconnect, offline reconciliation, undo | WP-002, WP-003, WP-004, WP-005, WP-006 |
| Office round trips, unsupported objects, fonts, compatibility reports | WP-012, WP-013, WP-014, WP-015, WP-016 |
| Save/sync diagnostics and conflict recovery | WP-005, WP-033 |
| Offline files and presentation bundles | WP-006 |
| Explainable access, guests, expiration, permission preview | WP-007 |
| Enterprise SSO, MFA/passkeys, session policy | WP-008 |
| SCIM and safe employee departure | WP-009 |
| Independent backup and disaster recovery | WP-010 |
| Signing, update rings, rollback, managed settings | WP-011 |
| Professional styles, fields, captions, references, indexes | WP-017 |
| Tracked revisions, combine/compare, assigned review, approval | WP-018, WP-027 |
| Research/citations, reference managers, languages, mail merge | WP-019 |
| Query editor, connectors, refresh jobs | WP-020, WP-031 |
| Structured tables, advanced pivots/charts, formula audit, Goal Seek/Solver | WP-015, WP-021 |
| Profiling, responsiveness, cancellation, capacity tiers | WP-022 |
| Masters/design, media, accessible slides, presenter tools | WP-016, WP-023, WP-029 |
| Faithful recordings, narration, captions, portable video | WP-024 |
| Production Forms, branching, uploads, quizzes, response exports | WP-025 |
| Team search and discovery | WP-026 |
| Comments, inbox, tasks, review notifications | WP-027 |
| Google Drive/SharePoint migration and cutover | WP-028 |
| Accessibility, screen readers, tagged exports | WP-029 |
| Mobile/touch and offline lifecycle | WP-030 |
| APIs, extensions, scripts, webhooks, schedules | WP-031 |
| Retention, legal holds, discovery, sensitive-data controls | WP-032 |
| Operations, capacity/quota diagnostics, support and escalation | WP-033 |
| Optional AI, local/remote transparency, reviewable edits | WP-034 |
| Transparent packaging, predictable costs, cancellation and exit | WP-035 |
| Organization templates and branding | WP-036 |
| Email/calendar/contacts/chat/meetings integration strategy | WP-037 |
| Tasks/notebooks/portals/structured-work integration strategy | WP-038 |

## Coverage of recurring complaints

| Complaint theme | User/admin outcome | Owning packages |
| --- | --- | --- |
| Opaque or stuck synchronization | Know where every revision is and recover failed work | WP-005, WP-033 |
| Formatting/calculation changes during interchange | Know and verify what exports preserve | WP-012–016 |
| Offline availability fails at travel/presentation time | Verify dependencies and reopen without a network | WP-006, WP-024, WP-030 |
| Confusing permissions and surprise inherited access | Explain effective access and preview changes | WP-007, WP-032 |
| Confusing licenses, cost increases, bundled AI | Clear packaging, predictable usage, optional AI, portable files | WP-034, WP-035 |
| Intrusive/uncontrollable AI | Disable it, see processing location, review/undo edits | WP-034 |
| Slow spreadsheets with no useful explanation | Measure costs, cancel work, choose a better data workflow | WP-020, WP-022 |
| Fragmented offboarding and lost ownership | Revoke access and verify transfer before deletion | WP-009, WP-010, WP-032 |
| Support loops and uncertain recovery | Redacted diagnostics, clear escalation, proven restore | WP-010, WP-033 |

## Cross-package interface decisions to record early

1. Stable document/worksheet/slide/object IDs and native schema migration rules.
2. Durable revision identifiers shared by saving, collaboration, history, approval, export, and backup.
3. One server-side effective-access evaluator reused by files, collaboration, search, AI, automation, and notifications.
4. A versioned compatibility-finding schema with locations and severity shared by imports, exports, CLI, and migration.
5. A durable job/event/outbox model shared by refresh, notifications, migration, forms, and later public automation.
6. Offline policy and data-lifecycle semantics that distinguish local copies, server state, backups, retention, and exports.
7. Feature catalog and test evidence that separate implemented, tested, unsupported, and inconclusive states.

Record decisions with rationale, alternatives, migration consequences, and affected package IDs. Do not let different feature teams invent incompatible versions of these contracts.
