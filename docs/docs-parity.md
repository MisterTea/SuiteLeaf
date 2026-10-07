# Docs comparison workflow

This comparison covers the short-report workflow in `docs/workflows.md`, based
on Google Workspace For Dummies chapters 5–7. It is a bounded acceptance
workflow, not a claim that SuiteLeaf implements every Google Docs feature.

Each round is run by a fresh subagent. A round creates a disposable document in
each application, captures its UI checkpoints, produces one MP4 per
application, and reports observed differences. Application fixes occur between
rounds. Google Docs is the reference for observed behavior.

## Shared report

Title: `Docs workflow parity — round N`

Body:

> Quarterly Report
>
> Project cedar is on schedule.
>
> Project Cedar has two milestones.
>
> Actions
>
> Review the draft.
>
> Approve the draft.

## Checkpoints

1. Create and name the document; enter the shared report.
2. Apply Heading 1 to Quarterly Report; confirm the outline and font-size toolbar.
3. Apply bold emphasis to a phrase; move the caret between differently formatted
   passages and confirm the toolbar tracks the current formatting.
4. Find `cedar`, replace a single occurrence with `Maple`, navigate forward and
   backward, then replace the remaining occurrence. Check match counts and undo.
5. Compare case-sensitive search and accent-insensitive search with `café café`.
   Try `cedar \\d+` in regular-expression mode and an invalid `[` expression.
6. Insert a 2-row, 2-column table and enter the same cell values in each app.
7. Insert the same local image where file-upload support is available.
8. Reopen and verify that text, headings, emphasis, table and image persist.
9. Export plain text and open print preview; compare supported content.

Record every completed and blocked checkpoint. Do not treat an untested step as
passing. A clean round means zero observed differences for completed shared
checkpoints; incomplete reference runs cannot establish a clean round.

## Evidence

Local run recordings and comparison reports are stored under
`test-results/docs-parity/round-N/`. Screenshot-based MP4s must explicitly identify
that capture method; they show chronological checkpoints, not continuous input
or motion. Reference books and private Google document URLs are not distributed
with application bundles.

## Fixes made between rounds

Round 1 identified point-size/default-font toolbar differences, missing search
controls, and fixed-size table insertion. SuiteLeaf now uses point sizes,
updates font controls from the current selection, supports single replacement,
backward search, case/regex/diacritic options, and accepts table dimensions.

Round 2 established a stable Google Docs reference in an isolated browser.
Its recordings identified stale search counts, missing automatic selection and
replacement advance, missing highlights, different heading weight/paragraph
spacing, and excessive whitespace in TXT exports. Search now follows editor
transactions, selects a match when the query changes, advances after replacing,
and decorates all matches. Document typography and TXT serialization were
adjusted against that observed reference. Each change is subject to the next
fresh comparison round; passing unit tests alone does not establish UI parity.
