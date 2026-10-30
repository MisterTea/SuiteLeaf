---
id: "WP-023"
title: "Professional presentation authoring and accessible design"
type: "work_package"
status: "ready"
priority: "P1"
phase: 3
area: "presentations"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S19"]
---

# Professional presentation authoring and accessible design

## Outcome and rationale

Extend existing slide tools into complete professional authoring workflows with coherent masters, reusable design, and accessible output.

## Existing implementation and starting points

SuiteLeaf already has themes, masters, transitions, animation panes, presenter notes, media, and PPTX export. Inspect `apps/web/src/editors/Slides.tsx`, `slide-master-panel.tsx`, `slide-animation-pane.tsx`, `slide-theme-library.ts`, and `slide-media.tsx`.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Audit and complete master/layout editing, placeholder inheritance, theme fonts/colors, brand templates, and design propagation without destroying slide-specific overrides.
- Complete selection/layer management, grouping, alignment/distribution, snapping/guides, object locking, and precise geometry controls where current behavior is insufficient.
- Expand prioritized animation timing, order, triggers, and transition behavior with a preview identical to slideshow playback; clearly map supported export behavior.
- Add alt-text and reading-order tools, contrast/missing-title checks, accessible chart summaries, and caption/subtitle support for media and presentations.
- Support presenter next-slide/notes/timer workflows and document behavior for separate audience/presenter displays.
- Coordinate shared template distribution with WP-036 and exported accessibility with WP-029.

## Dependencies and delivery

No hard work-package prerequisites. Coordinate shared interfaces with the packages linked in the portfolio index.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- Changing a master updates inheriting slides while preserving documented overrides.
- Users can create a polished branded deck without editing source data manually.
- Reading order and alt text are inspectable and survive native files and supported exports.
- Preview and slideshow execute the supported animation sequence consistently.

## Verification

- Vitest for inheritance, geometry commands, animation sequencing, and accessibility metadata.
- Painted-canvas tests for alignment, selection, guides, animation appearance, and presenter layouts.
- Manual assistive-technology review of representative decks with recorded findings.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Do not claim full SmartArt, Morph, or arbitrary PowerPoint animation compatibility. Identify unsupported semantics and prioritize according to corpus/customer workflows.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S19`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
