---
id: "WP-030"
title: "Complete mobile and touch workflows"
type: "work_package"
status: "blocked"
priority: "P1"
phase: 3
area: "mobile"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: true
blocked_on: ["WP-005", "WP-006", "WP-029"]
related_sources: ["S07", "S08"]
---

# Complete mobile and touch workflows

## Outcome and rationale

Make mobile usage dependable for review and practical editing, with usable touch controls and clear offline behavior.

## Existing implementation and starting points

Responsive tests, mobile projects, toolbar overflow handling, and `apps/web/src/editors/sheet-phone-gestures.ts` already exist. Extend these rather than treating mobile as absent.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Define supported phone/tablet workflows: browse, open, review/comment, edit text/cells/slides, upload media, save/export/share, and offline reopen.
- Adapt touch targets, selection handles, virtual keyboard avoidance, grid scrolling, slide manipulation, and command discovery without desktop-only hover requirements.
- Handle app backgrounding, browser suspension, viewport/orientation changes, device storage pressure, and interrupted uploads with recovery.
- Provide installable web-app behavior where supported and document differences from desktop; evaluate native wrappers only if specific OS integration gaps justify them.
- Test real target devices, input methods, accessibility features, and supported browser limits.

## Dependencies and delivery

Completion is blocked on `WP-005`, `WP-006`, `WP-029`. Design and isolated prototypes may proceed, but do not bypass the prerequisite contracts or release gates.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- A user can complete each declared mobile workflow without hidden offscreen controls or inaccessible hover actions.
- Backgrounding or orientation change does not lose unsaved edits or strand an upload.
- Pinned content reopens offline according to WP-006 readiness state.
- Unsupported mobile operations are identified before users begin destructive or expensive work.

## Verification

- Vitest for gesture/state logic and lifecycle persistence.
- Playwright mobile layout/grid/canvas/typing tests plus a documented real-device matrix for virtual keyboards and OS file sharing.
- Verify screen-reader and touch combinations from WP-029.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Do not claim native iOS/Android applications merely because the web UI is responsive. Full desktop feature density need not fit on a phone, but data must remain preserved.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S07`, `S08`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
