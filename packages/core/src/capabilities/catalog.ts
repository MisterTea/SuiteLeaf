import { advertisedIds, capabilities, progressCapabilities } from "./catalog-data";
import type { CapabilityCatalog, Evidence } from "./schema";

export { departureChecklist, type DepartureItem } from "./departure";

const open: Evidence = {
  kind: "documentation",
  ref: "project_management/ROADMAP.md",
  result: "inconclusive",
  note: "Workflow is defined. No end-to-end run is recorded in this catalog.",
};

export const capabilityCatalog: CapabilityCatalog = {
  id: "suiteleaf-capabilities",
  updated: "2026-11-04",
  competitor: {
    product: "Microsoft 365 and Google Workspace",
    edition: "Microsoft 365 Apps for enterprise compared with Google Workspace Business Standard, each on its documented web and desktop clients",
    platform: "web and desktop",
    referenceDate: "2026-10-29",
  },
  capabilities: [...capabilities, ...progressCapabilities],
  advertisedIds,
  workflows: [
    {
      id: "flow-report-review",
      name: "Report with citations and review",
      summary: "Draft a report, apply headings, insert a citation, and reopen the native file.",
      capabilityIds: ["cap-docs-editing", "cap-citations", "cap-native-files"],
      evidence: open,
    },
    {
      id: "flow-financial-workbook",
      name: "Financial workbook with pivots",
      summary: "Enter values, calculate totals, build a pivot, and export XLSX.",
      capabilityIds: ["cap-sheets-grid", "cap-pivots", "cap-sheets-xlsx-export"],
      evidence: open,
    },
    {
      id: "flow-media-presentation",
      name: "Media presentation",
      summary: "Author slides with images and notes, show them, and import a PPTX.",
      capabilityIds: ["cap-slides-authoring", "cap-slides-show", "cap-pptx-import"],
      evidence: open,
    },
    {
      id: "flow-shared-folder",
      name: "Shared project folder",
      summary: "Sign in, save to SuiteDrive, and share a folder.",
      capabilityIds: ["cap-accounts", "cap-suitedrive", "cap-sharing"],
      evidence: open,
    },
    {
      id: "flow-offline-trip",
      name: "Offline trip",
      summary: "Keep a desktop file available after disconnect and reopen it from a recovery draft.",
      capabilityIds: ["cap-desktop-recovery", "cap-local-autosave"],
      evidence: {
        kind: "documentation",
        ref: "tests/store.test.ts",
        result: "inconclusive",
        note: "An edit that conflicts with a file changed outside SuiteLeaf stays as a recovery draft. Reloading reads the outside file. The draft is still there after the store restarts. The desktop app was not started, so this is not a pass.",
      },
    },
    {
      id: "flow-employee-departure",
      name: "Employee departure",
      summary: "Review an account in admin and explain what offboarding does not yet do.",
      capabilityIds: ["cap-admin", "cap-accounts"],
      evidence: {
        kind: "documentation",
        ref: "project_management/WP-008-enterprise-identity.md",
        result: "inconclusive",
        note: "A named device can be signed out. Removing the account can give their files to someone else. This review does not remove the account or move any files. This is not a pass.",
      },
    },
    {
      id: "flow-disaster-recovery",
      name: "Disaster recovery",
      summary: "State that cluster replication is not an independent restore path.",
      capabilityIds: ["cap-independent-backup", "cap-suitedrive"],
      evidence: {
        kind: "documentation",
        ref: "project_management/WP-010-backup-restore.md",
        result: "inconclusive",
        note: "A clean database can be restored from a local archive. That restore does not start a node, is not a remote storage service, and is not a pass for this workflow.",
      },
    },
  ],
  gates: [
    {
      id: "gate-phase-1",
      phase: 1,
      summary: "Supported edits survive disconnect and restart, Office limits are explicit, and restore and release recovery exist.",
      workPackages: ["WP-001", "WP-002", "WP-003", "WP-004", "WP-005", "WP-006", "WP-010", "WP-011", "WP-012", "WP-013", "WP-014", "WP-015", "WP-016"],
    },
    {
      id: "gate-phase-2",
      phase: 2,
      summary: "A pilot can import files and users, review access, diagnose failures, offboard someone, and export data.",
      workPackages: ["WP-007", "WP-008", "WP-009", "WP-026", "WP-027", "WP-028", "WP-033", "WP-034", "WP-035", "WP-036"],
    },
    {
      id: "gate-phase-3",
      phase: 3,
      summary: "Representative report, workbook, presentation, form, accessibility, and mobile workflows complete inside SuiteLeaf.",
      workPackages: ["WP-017", "WP-018", "WP-019", "WP-020", "WP-021", "WP-022", "WP-023", "WP-024", "WP-025", "WP-029", "WP-030"],
    },
    {
      id: "gate-phase-4",
      phase: 4,
      summary: "Integrations and policies have scoped access, lifecycle controls, diagnostics, and tested exports.",
      workPackages: ["WP-031", "WP-032", "WP-037", "WP-038"],
    },
  ],
  coverage: {
    command: "npm run test:coverage",
    runner: "vitest",
    provider: "@vitest/coverage-v8",
    policy:
      "AGENTS.md requires unit coverage above 90 percent. vitest.config.ts measures every source file under apps/web/src, apps/desktop/src, packages/core/src, and services/*/src, excludes only type declarations, and fails npm run test:coverage below 90 percent lines or statements. Branches and functions are measured and reported but are not a failing threshold for the whole suite. npm run check:capabilities measures packages/core/src/capabilities and fails under 90 percent lines, functions, branches, and statements. Rust coverage is not measured by these commands.",
    mustInclude: ["packages/core/src/capabilities"],
    mustNotExclude: ["packages/core/src/capabilities"],
  },
  baseline: [
    {
      name: "Full Vitest suite with coverage",
      command: "npx vitest run --coverage",
      result: "pass",
      detail:
        "2026-11-04: 614 files and 4,467 tests passed. Statements 93.82%, lines 96.69%, functions 95.77%, branches 85.84%. Branches are below 90% and are not a failing threshold. This is the Vitest suite, not the Rust tests.",
    },
    {
      name: "Node Rust tests",
      command: "cargo test -p suiteleaf-node",
      result: "pass",
      detail: "2026-11-04: 65 unit, 1 cluster, and 36 multiuser tests passed. Other crates were not part of this run.",
    },
    {
      name: "Two-browser editors",
      command:
        "npx playwright test tests/browser/doc-collab.spec.ts tests/browser/sheet-collab.spec.ts tests/browser/slide-collab.spec.ts --project=chromium",
      result: "pass",
      detail:
        "2026-11-04: 6 document tests, 1 spreadsheet test, and 1 presentation test passed. The spreadsheet test types North into the painted grid and sees it on the other screen. Other browsers were not run.",
    },
    {
      name: "Native JSON helpers",
      command:
        "npx vitest run tests/capabilities/catalog.test.ts tests/json-data.test.ts tests/slide-editing.test.ts tests/sheet-links.test.ts",
      result: "pass",
      detail:
        "2026-10-30: this file was in a 4-file, 26-test run that exited 0. json-data covers compare, copy, and native size limits. It does not reopen an editor document.",
    },
    {
      name: "Slide editing unit tests",
      command:
        "npx vitest run tests/capabilities/catalog.test.ts tests/json-data.test.ts tests/slide-editing.test.ts tests/sheet-links.test.ts",
      result: "pass",
      detail:
        "2026-10-30: slide-editing.test.ts passed inside the same 4-file run. That is editor-logic evidence, not a painted-canvas browser pass.",
    },
    {
      name: "Sheet link unit tests",
      command:
        "npx vitest run tests/capabilities/catalog.test.ts tests/json-data.test.ts tests/slide-editing.test.ts tests/sheet-links.test.ts",
      result: "pass",
      detail:
        "2026-10-30: sheet-links.test.ts passed inside the same 4-file run. Link behavior is not the whole spreadsheet grid.",
    },
  ],
};

export { checkCatalog, checkParsedCatalog, coverageExcludesRequired, releaseReport, WORK_PACKAGE_IDS } from "./check";
export type { CatalogIssue, ReleaseReport } from "./check";
export type { Capability, CapabilityCatalog, Evidence, EvidenceResult, ReleaseGate, Workflow } from "./schema";
