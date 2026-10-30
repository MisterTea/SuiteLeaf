---
id: "WP-006"
title: "Verified offline work and portable presentation bundles"
type: "work_package"
status: "blocked"
priority: "P1"
phase: 1
area: "offline"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: true
blocked_on: ["WP-005"]
related_sources: ["S07", "S08"]
---

# Verified offline work and portable presentation bundles

## Outcome and rationale

Make offline availability a verifiable promise covering file content, dependencies, and reopening—not merely a cached browser tab.

## Existing implementation and starting points

SuiteLeaf supports local files, a production service worker, cluster caches, embedded media, and browser storage. Inspect `apps/web/src/storage.ts`, offline/service-worker tests, `apps/web/src/editors/slide-media.tsx`, and `apps/desktop/src/store.ts`.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Add offline pin/unpin and a readiness checker for files/folders, including content, fonts, images, media, app assets, and explicitly required model assets.
- Report missing dependencies, disk requirements, last verification, and browser-storage eviction risks. Request persistent browser storage where available and offer a local download fallback.
- Create portable slide bundles containing a compatible viewer and allowed dependencies, with integrity checks and clear licensing rules for fonts/media.
- Define offline authentication leases and admin policy for managed files; preserve ordinary no-account local operation.
- Reconcile offline edits through WP-005 and collaboration protocols; explain access-revocation limitations for already downloaded content.

## Dependencies and delivery

Completion is blocked on `WP-005`. Design and isolated prototypes may proceed, but do not bypass the prerequisite contracts or release gates.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- A verified file opens after closing the app/browser, disabling the network, and restarting; editing and saving still work.
- A presentation bundle plays supported media and renders supported fonts without network requests.
- Missing assets prevent a misleading ready label and are listed with remedies.
- Managed offline policy is enforced without deleting unsynchronized edits silently.

## Verification

- Unit-test dependency manifests, integrity, cache eviction handling, and policy decisions.
- Use real server shutdown to verify offline behavior; follow existing repository browser-specific offline constraints.
- Use visual tests only for actual slide rendering and layout offline.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Do not promise remote revocation of unencrypted copies already exported to a user's device. Local AI is optional and must not be required to open or edit ordinary files.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S07`, `S08`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
