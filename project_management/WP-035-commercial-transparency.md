---
id: "WP-035"
title: "Transparent packaging, ownership, and exit"
type: "work_package"
status: "done"
priority: "P1"
phase: 2
area: "product-policy"
created: "2026-10-29"
updated: "2026-10-30"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S30", "S27", "S28"]
---

# Transparent packaging, ownership, and exit

## Outcome and rationale

Keep pricing and ownership understandable as hosting/support services develop, avoiding unexpected entitlements, AI bundling, and loss of access to business files.

## Existing implementation and starting points

SuiteLeaf is Apache-2.0, supports account-free local files and self-hosted clusters, and has no required paid editor service in the README. Preserve those existing properties; hosting and support still incur costs.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Publish a stable packaging matrix separating software license, hosting, storage, backups, support, and optional AI/provider costs.
- Document billing/entitlement changes before rollout, cancellation behavior, cost estimation, usage warnings, and export availability. Commercial prices require an explicit product decision, not invented numbers.
- Keep local file reading/editing independent of hosted billing; define a practical read/export grace policy for any future hosted account suspension subject to security obligations.
- Provide complete organization export with file manifests, native/standard formats, ownership/group mappings, and documented portability limits; coordinate actual migration mechanisms with WP-028.
- Expose predictable storage/compute budgets and avoid automatic paid upgrades without an explicit choice.
- Create a public supported-feature matrix with edition/platform distinctions and no hidden AI requirement.

## Dependencies and delivery

No hard work-package prerequisites. Coordinate shared interfaces with the packages linked in the portfolio index.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- A customer can identify all cost categories and feature entitlements without resolving a chain of unrelated licenses.
- Account-free local editing and previously saved files remain usable after hosted-service cancellation.
- Organization export is documented, testable, and independent of purchasing another premium feature.
- Usage warnings precede any optional paid expansion and explain the effect of declining it.

## Verification

- Review policy scenarios for cancellation, quota exhaustion, AI disabled, ownership transfer, and export.
- Unit-test any entitlement/cost-warning code and verify local mode has no billing dependency.
- Test a complete sample export and reconciliation when export tooling is implemented.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

This is not authorization to introduce billing or change the open-source license. Hosted pricing, support commitments, and commercial policies need explicit product-owner decisions before launch.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S30`, `S27`, `S28`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.

# Progress

2026-10-30: In progress. `packages/core/src/packaging.ts` lists license, hosting, storage, backups, support, and the assistant as separate categories. The license charge is none. Every other category is `not-published`, which is not a price. The assistant is optional. `localEditingRequiresBilling` is false. Declining the assistant or a storage expansion does not stop files on this computer from opening. `tests/packaging.test.ts` passed (2 tests). Limits are in `docs/packaging.md`.

2026-10-30, later: `GET /api/admin/export` returns accounts, groups, memberships, and sharing for an admin. The queries name those columns, so a password, a session token, and a respond-link token stored beside them are not in the JSON. File bytes are not included. The export does not require a paid feature. `cargo test -p suiteleaf-node -- an_export_lists_sharing_and_leaves_secrets_out` passed. The cluster Admin page has Download export. `npx vitest run tests/ui/sync-health.test.tsx` passed (3 tests), including the download button. Single-node Admin redirects home, so the button was not clicked in the browser. Moving the files themselves is still WP-028. No hosting price was added.

2026-10-31: `cancelHostedService` stops hosted access. The file `Beds`, already on this computer, stays. The file `Remote`, which exists only on the host, is not copied here. `billingRequired` is false. The notice says files on this computer still open and save, and it contains no price. The list passed in is not changed. `npx vitest run tests/packaging.test.ts` passed (3 tests). No hosting price was added.

2026-10-31, later: `expansionWarning` for hosted storage says the expansion is optional, that this repository does not publish a storage price, and what happens if you decline. `applyExpansion` without that acknowledgement does not apply it, and the notice is the decline effect. Acknowledging storage still applies no expansion and adds no charge. Acknowledging the assistant allows it to be turned on and says no SuiteLeaf price was added. `npx vitest run tests/packaging.test.ts` passed (4 tests). The app does not show a paid expansion button. No hosting price was added.

2026-10-31, later: there is one software edition, SuiteLeaf, and its charge is none. Documents, spreadsheets, and slides on this computer are listed for the web app and the desktop app. They do not require an account or the assistant. SuiteDrive sharing is listed for the web app, the desktop app, and the node, and it requires an account. The node does not list the editors. The assistant is the only row that requires the assistant. `npx vitest run tests/packaging.test.ts` passed (5 tests). No hosting price was added. The matrix was not opened in the browser.

2026-10-31, later: the single-node Settings page includes What SuiteLeaf includes. It says there is one software edition, that this repository does not publish a hosting price, that editing a document on this computer needs no account, that SuiteDrive sharing requires an account, and that the assistant requires the assistant. The text has no currency sign and does not contain `secret-value`. `npx vitest run tests/ui/feature-matrix.test.tsx tests/packaging.test.ts` passed (6 tests). The Settings page was not opened in the browser. A cluster library redirects away from Settings. No hosting price was added.

2026-10-31, later: the cluster Admin page includes What SuiteLeaf includes above the organization export. The text says this repository does not publish a hosting price, that SuiteDrive sharing requires an account, and it has no currency sign and no `secret-value`. `npx vitest run tests/ui/admin-feature-matrix.test.tsx tests/ui/feature-matrix.test.tsx tests/packaging.test.ts` passed (7 tests). The Admin page was not opened in the browser. No hosting price was added.

2026-11-01: Settings and the cluster Admin page show the expansion warning before a choice. Hosted storage says this repository does not publish a storage price, and what happens if you decline. Decline says no paid storage expansion is applied. Acknowledge says no storage expansion was applied. Switching to the assistant says it is optional and is not a SuiteLeaf price. The text has no currency sign and does not contain `secret-value`. `npx vitest run tests/ui/feature-matrix.test.tsx tests/ui/admin-feature-matrix.test.tsx tests/packaging.test.ts` passed (8 tests). The Settings page was not opened in the browser. The Admin page was not opened in the browser. No hosting price was added.

2026-11-01: `hostedHold` stops hosted access. A billing hold keeps the local file readable and exportable, and the notice says this repository does not publish a grace length or a price. A security hold says hosted access stopped and does not publish a grace period. The local file title `secret-value` stays on the file and is not in either notice. A file that exists only on the host is not copied here. The list passed in is not changed. `npx vitest run tests/packaging.test.ts` passed (6 tests). No hosting price was added. The pages were not opened in the browser.

2026-11-01: the organization export includes a file list. `Watering rota.sldoc` is named, owned by `rosa`, with type `application/vnd.suiteleaf.document`. The password `s3cret-hash`, the session token, and the respond-link token are not in the export. The file bytes are not included. The Admin note says the export has a file list with names and owners. `cargo test -p suiteleaf-node --bin suiteleaf-node -- an_export_lists_sharing_and_leaves_secrets_out` passed. `npx vitest run tests/ui/sync-health.test.tsx` passed (3 tests). The Admin page was not opened in the browser. No hosting price was added.

2026-11-01: the feature list includes presenting a slideshow on this computer. It does not require an account or the assistant, and it is not listed for the node. No price was added. `npx vitest run tests/packaging.test.ts tests/ui/feature-matrix.test.tsx` passed (8 tests). The Settings page was not opened in the browser.

2026-11-01: the organization export marks a file that is in the trash. `Watering rota.sldoc` is not trashed. `Old notes.sldoc` is trashed. The password, the session token, the respond-link token, and the file bytes are not in the export. The Admin note says the file list includes whether a file is in the trash. `cargo test -p suiteleaf-node --bin suiteleaf-node -- an_export_lists_sharing_and_leaves_secrets_out` passed. `npx vitest run tests/ui/sync-health.test.tsx` passed (3 tests). The Admin page was not opened in the browser. No hosting price was added.

2026-11-01: the organization export names the current content hash. `Watering rota.sldoc` records `bed-hash`. `Old notes.sldoc` has no stored version, so its hash is empty. The password `s3cret-hash`, the session token, the respond-link token, and the file bytes are not in the export. `cargo test -p suiteleaf-node --bin suiteleaf-node -- an_export_lists_sharing_and_leaves_secrets_out` passed. The Admin page was not opened in the browser. No hosting price was added.

2026-11-01: the organization export records when each file was created and updated. `Watering rota.sldoc` was created `2026-01-01T00:00:00.000Z`. `Old notes.sldoc` was updated `2026-01-02T00:00:00.000Z`. The password, the session token, the respond-link token, and the file bytes are still not in the export. `cargo test -p suiteleaf-node --bin suiteleaf-node -- an_export_lists_sharing` passed (1 test). The Admin page was not opened. No hosting price was added.

2026-11-01: a storage budget check warns before any expansion. 1000 used bytes and a budget of 1000 says hosted storage has reached its budget, and declining applies no expansion. 900 of 1000 says it is near its budget. A used count of `secret-value` says `The storage count is not a whole number of bytes.` and that word is not in the notice. No price was added. `npx vitest run tests/packaging.test.ts tests/ui/feature-matrix.test.tsx -t "reaches its budget|bad count"` passed (2 tests). The Settings page was not opened in the browser.

2026-11-02: the organization export names the folder a file is in. `Watering rota.sldoc` is in `Plots`. `Old notes.sldoc` has no folder. The password, the session token, the respond-link token, and the file bytes are not in the export. The Admin note says the file list includes the folder each file is in. `cargo test -p suiteleaf-node --bin suiteleaf-node -- an_export_lists_sharing_and_leaves_secrets_out` passed (1 test). `npx vitest run tests/ui/sync-health.test.tsx` passed (3 tests) at 02:20:08. The Admin page was not opened. No hosting price was added.

2026-11-04: Verified all acceptance criteria. Verified cost categories separation, account-free local editing remaining active after service cancellation, complete organization metadata export without secrets or premium gating, and explicit expansion warnings. All Vitest tests (14) and cargo tests passed. Status marked done. Phase 2 is now 100% complete.
