---
id: "WP-032"
title: "Retention, discovery, and organizational data policy"
type: "work_package"
status: "blocked"
priority: "P2"
phase: 4
area: "governance"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: true
blocked_on: ["WP-007", "WP-008", "WP-010"]
related_sources: ["S14", "S25"]
---

# Retention, discovery, and organizational data policy

## Outcome and rationale

Add the policy and evidence controls required by organizations that must retain, discover, classify, or restrict business data.

## Existing implementation and starting points

SuiteLeaf has roles, groups, sharing, versioning, and audit events, but these do not establish legal retention, discovery, or tamper-resistant audit storage. Inspect SuiteDrive metadata, node admin APIs, and the full-replica architecture.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Define organization-scoped retention schedules, exceptions, legal holds, lifecycle disposition, and policy precedence, including deleted accounts/files and old versions.
- Provide authorized discovery search/export with immutable manifests, hashes, provenance, and audit trails; coordinate indexing with WP-026 when available.
- Implement sensitive-data labels and detection policies with explainable matches, review/override, external-sharing restrictions, and controls for export/offline/AI use.
- Export audit events to an independently controlled append-only destination; define retention, actor attribution, clock handling, and integrity verification.
- Document encryption/key management and administrative trust boundaries. If data residency or tenant-isolated placement is offered, replace the assumption that every node can store every account/file with explicit placement rules.
- Build policy dry runs and impact reports before enforcement; make exceptions reviewable and expiring.

## Dependencies and delivery

Completion is blocked on `WP-007`, `WP-008`, `WP-010`. Design and isolated prototypes may proceed, but do not bypass the prerequisite contracts or release gates.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- Active holds prevent prohibited deletion/disposition and remain effective when an employee account is removed.
- A discovery export can be verified independently against its manifest and authorized scope.
- Sharing/export policy decisions are explainable and logged without leaking sensitive content to unauthorized users.
- Deployment documentation truthfully states which operators/nodes can access data and which residency guarantees are actually enforced.

## Verification

- Server policy-matrix tests for hold/retention/deletion/ownership interactions and cross-node enforcement.
- Tamper-detection and audit-export verification tests; discovery isolation tests.
- Test classification false positives, overrides, policy migration dry runs, and full restore under retention policy.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Do not claim legal compliance, certification, end-to-end encryption, or regional isolation without appropriate verification. Retention is not backup, and encryption at rest does not exclude privileged server operators.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S14`, `S25`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
