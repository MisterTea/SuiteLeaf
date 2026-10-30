---
id: "WP-019"
title: "Research, multilingual proofing, and mail-merge depth"
type: "work_package"
status: "ready"
priority: "P1"
phase: 3
area: "documents"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S16", "S17"]
---

# Research, multilingual proofing, and mail-merge depth

## Outcome and rationale

Extend existing citation, proofreading, and mail-merge features so users can produce research documents and personalized batches without manual cleanup.

## Existing implementation and starting points

`packages/core/src/citations.ts` has a small book/article source model and APA/MLA/Chicago formatting. `apps/web/src/editors/doc-citations.ts`, proofing modules, and `mail-merge.ts` already exist; mail merge replaces text placeholders with column values.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Expand source metadata to multiple authors, editors, DOI/URL, publication/access dates, journal/volume/pages, and source types with explicit versioned migration.
- Support bibliography import/export using documented formats such as BibTeX and RIS; add a reference-manager integration boundary with permissions and clear offline behavior.
- Provide style-aware citation formatting, bibliography refresh, missing-source diagnostics, and citations that survive DOCX exchange.
- Add language selection per document/range, dictionary management, spelling/grammar suggestions with explanations, and tested multilingual/RTL cases; keep local/private operation choices clear.
- Extend mail merge with preview, missing-field validation, locale-aware formatting, conditional/repeated content, batch naming, and document/PDF output. Add labels/envelopes only with defined print templates and verification.

## Dependencies and delivery

No hard work-package prerequisites. Coordinate shared interfaces with the packages linked in the portfolio index.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- Imported bibliography entries can be cited, updated, exported, and reopened without losing supported metadata.
- Proofing respects selected language and user dictionaries and does not silently send text to a remote service.
- A batch merge previews errors before generating files, preserves source templates, and produces deterministic distinct outputs.
- Missing data and citation targets are reported with actionable locations.

## Verification

- Vitest for citation parsers, style fixtures, escaping, merge conditions, locale formatting, and export behavior.
- Use layout verification for labels/envelopes and complex bibliography wrapping.
- Test hostile bibliography/text input and offline proofing behavior.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Do not claim every citation style or perfect grammar quality. Automatic email delivery requires an explicitly configured communications integration and user authorization; document generation alone must not send messages.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S16`, `S17`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
