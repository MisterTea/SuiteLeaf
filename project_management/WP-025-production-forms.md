---
id: "WP-025"
title: "Production Forms and response workflows"
type: "work_package"
status: "blocked"
priority: "P1"
phase: 3
area: "forms"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: true
blocked_on: ["WP-007"]
related_sources: ["S24"]
---

# Production Forms and response workflows

## Outcome and rationale

Turn the existing hidden Forms implementation into a reliable survey, registration, and quiz tool with safe response collection.

## Existing implementation and starting points

`apps/web/src/editors/Form.tsx` supports text, choice, rating, grid questions, required answers, and response display. `apps/web/src/flags.ts` hides Forms unless `VITE_SUITELEAF_FORMS=1`. Inspect responder roles and sign-up sharing as well.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Separate form schema/version from append-only response submissions so concurrent responses cannot overwrite each other. Validate submissions server-side and use idempotency keys.
- Add sections/branching, long text, checkboxes, dropdowns, date/time, numeric validation, uploads, quizzes/scoring, and accessible progress/navigation.
- Implement published/private/closed states, respondent permissions, optional anonymous submission, anti-abuse controls, quotas, deadlines, and explicit response-retention rules.
- Add CSV/XLSX export, a linked spreadsheet destination, summaries, notifications, and webhooks through the shared automation boundary.
- Provide draft/preview/publish with schema-change behavior for existing responses; support response editing only under explicit policy.
- Enable Forms by default only after feature-flag migration, permission isolation, response durability, and accessibility gates pass.

## Dependencies and delivery

Completion is blocked on `WP-007`. Design and isolated prototypes may proceed, but do not bypass the prerequisite contracts or release gates.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- Concurrent submissions are durably stored exactly once without overwriting existing responses.
- A respondent cannot read other responses or edit questions unless separately authorized.
- Branching, required-field validation, scoring, uploads, and closing a form behave consistently in the server and client.
- Exported/linked responses preserve question/version identity and safely escape spreadsheet formula-looking values.

## Verification

- Vitest/jsdom branching, validation, scoring, serialization, and response export tests; Rust/API tests for concurrency and access.
- Test oversized/malicious uploads, duplicate requests, interrupted submissions, and schema edits after publication.
- Use browser tests only for layout, keyboard/touch navigation, and actual spreadsheet output rendering.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Signatures and payment collection require separate integrations. Do not expose existing response arrays through a public form payload.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S24`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
