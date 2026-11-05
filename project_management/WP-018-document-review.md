---
id: "WP-018"
title: "Document review, comparison, and approvals"
type: "work_package"
status: "in_progress"
priority: "P1"
phase: 3
area: "documents"
created: "2026-10-29"
updated: "2026-11-04"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S21", "S16"]
---

# Document review, comparison, and approvals

## Outcome and rationale

Allow reviewers to propose, compare, and combine changes without losing attribution or silently accepting revisions.

## Existing implementation and starting points

Suggestions, comments, comparisons, and version restoration already exist in `apps/web/src/editors/doc-suggestions.ts`, `doc-suggestions-ui.tsx`, `doc-comments.tsx`, `version-history.tsx`, and `packages/core/src/doc-diff.ts`.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Extend tracked changes to supported formatting and structural operations, including tables, paragraph movement, and object edits; define unsupported cases explicitly.
- Implement compare and combine for separately edited documents with a shared baseline, reviewer attribution, conflict review, and selective acceptance/rejection.
- Add assigned review tasks, resolved/reopened comments, notifications, and a review-completion view; use WP-027's shared workflow model when available.
- Support original/final/markup views and safe export choices. Preserve Word revision/comment metadata in coordination with WP-014.
- Bind approval to a specific immutable version; subsequent edits invalidate or supersede approval rather than leaving a misleading approved badge.

## Dependencies and delivery

Completion is blocked on `WP-002`. Design and isolated prototypes may proceed, but do not bypass the prerequisite contracts or release gates.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- Combining two reviewers' copies retains nonconflicting edits and requires decisions for overlapping changes.
- Accept/reject works on supported text, format, and structural changes with correct authorship and undo.
- A document's approved version can be retrieved exactly; editing it creates a new unapproved revision.
- Review data survives collaboration, native saves, and supported DOCX round trips.

## Verification

- Vitest for merge conflicts, revision transformations, export views, permissions, and version-bound approval.
- Use real typing/caret tests for suggestion-mode editing and selection behavior.
- Test review under reconnect and concurrent accept/reject operations.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Cryptographic signatures and legally binding e-signature services require separate provider/legal requirements. A review approval badge is not an e-signature.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S21`, `S16`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.

# Progress

2026-10-30: Not started. Front matter status is `blocked`. `blocked` is true. `blocked_on` is ["WP-002"]. No product behavior for this package changed on this date. Active work is the WP-001 catalog and a mark-preservation slice of WP-002.

2026-11-03: two reviewers can be combined against a baseline. Maya changes the first paragraph to `Tomatoes` and Sam changes the second to `Plots`. Both changes stay. When both change the first paragraph, it stays `North` and the decision is `Block 1 needs a choice. Maya and Sam both changed it.` The other reviewer's text `secret-value` is not in that decision. A reviewer named `secret-value` is called `a reviewer`. The copies passed in stay as they were. `npx vitest run tests/review-combine.test.ts` passed (1 test). Coverage for `packages/core/src/review-combine.ts` was 100% statements, 97.29% branches, 100% functions, and 100% lines. The document editor was not opened. This is not an approval and it is not an e-signature. The package stays blocked on WP-002.

2026-11-03: a Word file can carry the review and open it again. The part `word/suiteleaf-review.json` keeps the decision for Maya and Sam, the left choice, and revision `rev-1`. A note `secret-value` is stored as `Block 2 needs a choice.` and that word is not in the part. Opening the file puts that review on the document, and the paragraph is still `North`. A Word file with no review part reads as no review. A broken part is ignored. `npx vitest run tests/review-docx.test.ts tests/review-store.test.ts` passed (2 tests). Coverage for `packages/core/src/review-docx.ts` and `packages/core/src/review-store.ts` together was 94.52% statements, 92.98% branches, 100% functions, and 100% lines. The editor's Word download does not add this part yet. The document editor was not opened. This is not an e-signature. The package stays blocked on WP-002.

2026-11-03: the Word download adds the review part when the document has a stored review. A document whose review names Maya and Sam, chooses the left copy of block 1, and records revision `rev-1` writes `word/suiteleaf-review.json` with those facts. A document with no review writes no part. `npx vitest run tests/review-docx.test.ts` passed (1 test). Coverage for `packages/core/src/review-docx.ts` was 100% statements, branches, functions, and lines. The download function the editor calls was used. The Word menu was not clicked. The document editor was not opened. This is not an e-signature. The package stays blocked on WP-002.

2026-11-03: a shared document keeps the review with the paragraph text. A room value `secret-value` is left out, and that word is not in the saved fragment. A review whose note is `secret-value` is stored as `Block 1 needs a choice.` The paragraph stays `North`. The choice stays `left` and the revision stays `rev-1`. `npx vitest run tests/collab-rich.test.ts` passed (6 tests). `cargo test -p suiteleaf-node --bin suiteleaf-node a_review_stays_with_the_fragment` passed (1 test). The same comment-thread test still passed. The document editor was not opened. This was not typed in two browsers. This is not an e-signature. The package stays blocked on WP-002.

2026-11-03: the open document copies the room review onto itself. The paragraph stays `North` and the revision is `rev-1`. Changing the review to a note `secret-value` stores `Block 1 needs a choice.` and revision `rev-2`. That word is not in the room. A document with no review stays `North`. `npx vitest run tests/ui/collab-review-sync.test.tsx` passed (1 test). Coverage for `apps/web/src/editors/collab-review-sync.ts` was 100% statements, branches, functions, and lines. The document was rendered in a test page. The SuiteLeaf window was not opened. This was not typed in two browsers. This is not an e-signature. The package stays blocked on WP-002.

2026-11-03: a review can be shown as the baseline, the current text, or the changed blocks. Original stays `North`. Final shows the current first paragraph. Markup marks that paragraph changed and leaves `Beds` unmarked. A removed second paragraph is marked removed and its text `secret-value` is not in that marker. The documents passed in stay as they were. `npx vitest run tests/review-view.test.ts` passed (1 test). Coverage for `packages/core/src/review-view.ts` was 100% statements, branches, functions, and lines. The document editor was not opened. This is not an e-signature. The package stays blocked on WP-002.

2026-11-03: a review can be saved on the document and read back. The decision `Block 1 needs a choice. Maya and Sam both changed it.` stays, the choice `left` on block 1 stays, and the approved revision name `rev-1` stays. A note `secret-value` is stored as `Block 2 needs a choice.` and that word is not in the saved document. The paragraph stays `North`. A paragraph is not a place to store a review. A document with no review says `This document has no stored review.` A review that is not a record says `The stored review cannot be read.` and does not repeat the stored text. `npx vitest run tests/review-store.test.ts` passed (1 test). Coverage for `packages/core/src/review-store.ts` was 92.72% statements, 91.83% branches, 100% functions, and 100% lines. The saved copy was JSON. A Word file was not written. The document editor was not opened. This is not an e-signature. The package stays blocked on WP-002.

2026-11-03: the latest review choice can be undone. Maya's `Tomatoes` and Sam's `Rows` are both chosen. Undoing the latest choice keeps `Tomatoes` and puts the second paragraph back to `Beds`. The decision still names Maya and Sam. Undoing the remaining choice puts both paragraphs back to `North` and `Beds`. Undoing when nothing was chosen says `There is no choice to undo.` The copies passed in stay as they were. `npx vitest run tests/review-combine.test.ts` passed (3 tests). Coverage for `packages/core/src/review-combine.ts` was 100% statements, 98.18% branches, 100% functions, and 100% lines. The document editor was not opened. This is not an approval and it is not an e-signature. The package stays blocked on WP-002.

2026-11-03: approving `rev-1` stores `North`. Reading that approval still returns `North` after the stored copy is changed in memory. Editing the document to `Beds` as `rev-2` leaves the approval on `North` and the current revision is not approved. Saving the same `North` text stays on `rev-1` and stays approved. A revision named `secret-value` says `Name a revision.` and that word is not stored. A paragraph is not a document. A document that was never approved says `This document is not approved.` The document passed in stays `North`. `npx vitest run tests/review-approval.test.ts` passed (1 test). Coverage for `packages/core/src/review-approval.ts` was 100% statements, branches, functions, and lines. The document editor was not opened. This is not an e-signature. The package stays blocked on WP-002.

2026-11-03: a disputed block can use one reviewer's text. Maya's first paragraph `Tomatoes` is kept, and Sam's second paragraph still needs a choice. Choosing Sam's first paragraph keeps `secret-value` in the document and not in the decision. A block that does not need a choice stays `North`. A block number of 0 says `Name a block number.` Choosing the right copy of a deleted second paragraph leaves `North`. The copies passed in stay as they were. `npx vitest run tests/review-combine.test.ts` passed (2 tests). Coverage for `packages/core/src/review-combine.ts` was 100% statements, 98.03% branches, 100% functions, and 100% lines. The document editor was not opened. This is not an approval and it is not an e-signature. The package stays blocked on WP-002.

2026-11-04: WP-002 was accepted as done, so this package is no longer blocked. It was blocked on WP-002 from 2026-10-29 until then; that dependency is still listed under Dependencies.
