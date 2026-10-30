---
id: "WP-024"
title: "Faithful presentation recording and portable video"
type: "work_package"
status: "blocked"
priority: "P1"
phase: 3
area: "presentations"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: true
blocked_on: ["WP-023"]
related_sources: ["S19", "S08"]
---

# Faithful presentation recording and portable video

## Outcome and rationale

Record what the audience actually sees and hears, rather than a simplified reconstruction of slide objects.

## Existing implementation and starting points

`apps/web/src/editors/slide-record.ts` currently maps shapes to rectangles and text to simple canvas text. Recording exists, but this renderer is insufficient evidence of faithful slideshow/video output.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Use a shared render pipeline or supported capture of the actual presentation surface so masters, fonts, tables, images, charts, media, and animation frames match playback.
- Add microphone narration, permission/error handling, timed slide advancement, pause/resume, and retake or segment replacement with clear recording indicators.
- Capture supported audio/video without feedback loops and identify unsupported codecs or capture restrictions before recording.
- Offer portable video output with documented codecs and platform behavior; provide conversion only through licensed supported dependencies.
- Preserve captions/transcripts and make their privacy/storage behavior clear. Include offline readiness checks and export progress/cancellation.

## Dependencies and delivery

Completion is blocked on `WP-023`. Design and isolated prototypes may proceed, but do not bypass the prerequisite contracts or release gates.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- A reference deck's recording includes its actual shapes, styled text, masters, media, and supported animation sequence.
- Narration and slide timing remain synchronized within a documented measured tolerance.
- Permission denial, disk exhaustion, interrupted capture, and unsupported codec produce recoverable errors.
- The exported video plays in the stated target players and never silently omits unsupported content.

## Verification

- Unit-test timeline, recording state, retakes, and error handling.
- Use actual canvas/video frame comparison for fidelity and test recordings with measured audio/video markers.
- Verify playback on supported desktop/browser targets; label unavailable platform checks.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Avoid browser-specific output advertised as universally compatible. Recording or uploading a user's voice/video requires clear user action; do not start capture when merely opening a deck.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S19`, `S08`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
