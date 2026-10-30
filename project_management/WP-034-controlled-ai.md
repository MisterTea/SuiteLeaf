---
id: "WP-034"
title: "Optional private AI with reviewable edits"
type: "work_package"
status: "ready"
priority: "P1"
phase: 2
area: "ai"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S27", "S28", "S29"]
---

# Optional private AI with reviewable edits

## Outcome and rationale

Preserve the usefulness of SuiteLeaf's local AI while making its resource usage, data access, and edits understandable and controllable.

## Existing implementation and starting points

On-device backends, model downloads, an agent sidebar, guard code, and editor/file tools already exist in `apps/web/src/ai/`, `apps/desktop/src/ai.ts`, and `packages/core/src/ai.ts`. Extend them rather than adding a second assistant.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Make AI explicitly opt-in and hideable, with organization policy for disabling features, approved models/providers, network use, and resource budgets.
- Label local versus remote processing and model download sizes/locations. Core editing must work without model downloads or an AI subscription.
- Present proposed content changes as reviewable diffs with accept/reject and a single logical undo group; retain source references for supported answers.
- Enforce ordinary file permissions for AI search/tools, including newly revoked access. Treat imported documents and retrieved text as untrusted data rather than instructions.
- Add limits for tool scope, destructive actions, external communication, token/compute use, and cancellation; never send file content remotely without the configured explicit policy/user choice.
- Evaluate representative tasks for correctness, unsupported claims, edit preservation, latency, and memory. Offer local model uninstall/cache cleanup and clearly indicate capability limits.

## Dependencies and delivery

No hard work-package prerequisites. Coordinate shared interfaces with the packages linked in the portfolio index.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- Disabling AI removes its prompts/controls and prevents model/provider activity while normal editing continues.
- Users can inspect a proposed edit, reject it, or undo the accepted operation without losing unrelated work.
- An assistant cannot retrieve or modify files the user cannot access, including after access changes.
- A network trace of a declared local-only session contains no document-content upload to model providers.

## Verification

- Vitest for permission guards, diff application, cancellation, undo grouping, policy, and download controls.
- Adversarial tests for prompt injection, unauthorized tool arguments, stale permissions, and accidental external sends.
- Maintain a small versioned task evaluation suite with measured success/failure rather than unsubstantiated AI quality claims.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

No forced bundling or AI prerequisite for ordinary documents. A local model is not automatically accurate or safe; evaluate behavior and preserve user review.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S27`, `S28`, `S29`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
