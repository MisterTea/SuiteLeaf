---
id: WP-024
status: ready
priority: P1
wave: 3
effort: L
owner: unassigned
updated: 2026-11-15
---

# WP-024: Complete presenting, media and recording

## Outcome and baseline

Presenter controls and recording code exist; documentation explicitly says audience and notes regions share one window.

Evidence inspected: [docs/presenter-display.md](../docs/presenter-display.md); [apps/web/src/editors/slide-record.ts](../apps/web/src/editors/slide-record.ts); [apps/web/src/editors/slide-editor-presenter.tsx](../apps/web/src/editors/slide-editor-presenter.tsx). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Implement true audience/presenter windows, external-display lifecycle, rehearsal timings, media playback, narration and portable video export.

## Acceptance criteria

- [ ] Present on two displays with notes absent from audience output.
- [ ] reconnect a display safely.
- [ ] record a 10-minute narrated deck and export a playable video with measured audio/video drift below 100ms.
- [ ] handle denied microphone access.

## Dependencies and execution

Dependencies: WP-023. These gate final integration acceptance, not initial investigation. Wave 3; priority P1; rough effort L (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
