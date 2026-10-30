---
id: "WP-031"
title: "Public APIs, webhooks, and safe automation"
type: "work_package"
status: "blocked"
priority: "P2"
phase: 4
area: "platform"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: true
blocked_on: ["WP-007", "WP-008"]
related_sources: ["S03", "S25"]
---

# Public APIs, webhooks, and safe automation

## Outcome and rationale

Provide a documented extension and automation surface for repeatable business workflows without giving plugins unrestricted access to every file.

## Existing implementation and starting points

Node APIs, AI tool functions, and editor commands are existing internal surfaces. Inspect `crates/suiteleaf-node/src/drive_api.rs`, `admin_api.rs`, `apps/web/src/ai/tools/`, and core file schemas before defining stable public contracts.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Publish versioned APIs and SDK examples for files, content operations, permissions, comments, forms, jobs, and exports with pagination, quotas, idempotency, and error contracts.
- Implement scoped application credentials/service identities, consent/admin approval, revocation, and per-action audit records. Separate read, write, share, export, and administrative permissions.
- Add signed webhooks with replay protection, retries, delivery status, dead-letter handling, and secret rotation.
- Create scheduled/event-triggered jobs with persisted state, cancellation, concurrency limits, secrets isolation, and dry-run mode.
- Offer sandboxed scripts/macros and custom functions with time/memory/network limits; define deterministic behavior and user-visible side effects.
- Provide an extension manifest, compatibility/version policy, install/update controls, and examples for query refresh and form-to-document generation.

## Dependencies and delivery

Completion is blocked on `WP-007`, `WP-008`. Design and isolated prototypes may proceed, but do not bypass the prerequisite contracts or release gates.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- A scoped app can act only on authorized resources and loses access after revocation.
- Retries do not duplicate external-facing operations; failed jobs are inspectable and resumable.
- A malicious or runaway extension cannot escape resource/network limits or read unrelated files/secrets.
- Public examples work against the documented API version and can be tested without production data.

## Verification

- API contract, authorization, rate-limit, idempotency, and webhook signature tests.
- Adversarial sandbox tests for filesystem/network escape, secret disclosure, and timeouts.
- Integration-test one scheduled refresh and one form-driven document generation workflow.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

VBA, Apps Script, COM, and third-party add-in compatibility are separate interoperability projects. A safe native script platform does not imply drop-in support for existing macros.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S03`, `S25`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
