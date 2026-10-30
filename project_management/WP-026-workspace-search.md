---
id: "WP-026"
title: "Permission-aware workspace search and discovery"
type: "work_package"
status: "blocked"
priority: "P1"
phase: 2
area: "files"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: true
blocked_on: ["WP-007"]
related_sources: ["S09", "S11"]
---

# Permission-aware workspace search and discovery

## Outcome and rationale

Let users find authorized information across a team workspace without opening every file or exposing restricted content.

## Existing implementation and starting points

Local search already extracts text from documents, workbooks, slides, drawings, and forms in `apps/web/src/library-search.ts`, with a text bound for large files. SuiteDrive browsing and permissions are separate existing foundations.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Build a server-side index keyed by stable file/version IDs with incremental updates, deletion handling, rebuilds, and observable freshness.
- Index supported content plus title, owner, type, folder, modified time, and shared state; add filters, previews, snippets, and deep links to paragraphs/cells/slides.
- Enforce effective access at query and result retrieval time, including group/ACL changes and revocation. Search snippets, counts, suggestions, and caches must not leak restricted information.
- Provide local/offline search over available files, clearly distinguishing indexed scope and staleness.
- Add saved searches and useful recent/shared discovery; keep semantic/AI search optional and subject to identical authorization.

## Dependencies and delivery

Completion is blocked on `WP-007`. Design and isolated prototypes may proceed, but do not bypass the prerequisite contracts or release gates.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- Authorized content is searchable and results navigate to the correct file location.
- Permission revocation removes discoverability within a documented bound and blocks opening immediately according to server policy.
- Deleted files, stale versions, and renamed/moved files reconcile correctly without orphaned results.
- Rebuilding the index does not mutate document content or require unrestricted user-facing access.

## Verification

- Unit-test extraction, filters, snippets, anchors, and index updates; integration-test ACL invalidation and query isolation.
- Test hidden terms cannot be inferred through counts/autocomplete.
- Benchmark indexing/query behavior on a representative corpus with no invented scale guarantees.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

This does not index email or third-party services until explicit connectors exist. Form responses require stronger access separation than public question text.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S09`, `S11`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
