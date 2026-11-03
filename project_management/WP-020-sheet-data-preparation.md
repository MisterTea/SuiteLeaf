---
id: "WP-020"
title: "Spreadsheet queries, connectors, and refresh"
type: "work_package"
status: "in_progress"
priority: "P1"
phase: 3
area: "spreadsheets"
created: "2026-10-29"
updated: "2026-10-30"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S18"]
---

# Spreadsheet queries, connectors, and refresh

## Outcome and rationale

Provide repeatable data ingestion and transformation workflows comparable to common Power Query use cases.

## Existing implementation and starting points

SuiteLeaf already imports CSV/TSV and Excel and uses Arquero for pivots. Inspect `apps/web/src/csv-import.tsx`, `apps/web/src/csv.ts`, `apps/web/src/editors/Sheets.tsx`, and the core workbook schema.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Create a versioned query-step model for select/rename/type conversion, filtering, sorting, split/merge, joins, append, grouping, and deduplication with preview and per-step errors.
- Provide initial local CSV/JSON and authenticated HTTP/database connector interfaces; choose a small supported connector set and document credential/network requirements.
- Separate source data, transformations, and output ranges. Store provenance and refresh timestamps without storing credentials in portable workbook JSON.
- Implement manual refresh first, then scheduled server refresh with cancellation, timeouts, retries, concurrency limits, and notifications. Use the common automation job model when WP-031 is available.
- Support parameterized sources, stable schema handling, and review of breaking schema changes; never overwrite unrelated user cells.
- Make expensive work asynchronous and expose progress/diagnostics to WP-022.

## Dependencies and delivery

No hard work-package prerequisites. Coordinate shared interfaces with the packages linked in the portfolio index.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- A saved query can be reopened and refreshed to reproduce the same transformations.
- Schema drift produces a clear error or explicit remapping, not silent column corruption.
- Credentials do not appear in exports/logs and unauthorized viewers cannot refresh protected sources.
- Refresh failure preserves the last successful output and labels it stale.

## Verification

- Vitest transform fixtures, schema drift, cancellation, output placement, and credential redaction.
- Server integration tests for scheduled refresh and authorization; connector contract tests using local mock services.
- Painted-grid tests only for output visibility and progress layout.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Full Power Query M-language compatibility and every commercial connector are not implied. Define interoperability limits and keep source access opt-in.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S18`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.

# Progress

2026-10-30: In progress. `packages/core/src/sheet-query.ts` stores version 1 steps for select, rename, filter, and sort. The same document and source produce the same rows on a later refresh. A step that names a column the source no longer has fails. If a previous success was passed in, those rows are returned and marked stale. `queryDocument` refuses an extra field whose name looks like a password, token, or API key. `tests/sheet-query.test.ts` passed (3 tests). Limits are in `docs/sheet-query.md`.

2026-10-30, later: `writeQueryOutput` writes a successful result into a cell grid, header first. It replaces only the previous output rectangle, clears cells that result no longer uses, and refuses a cell outside that rectangle that already has a value. A failed refresh returns the same grid. `npx vitest run tests/sheet-query.test.ts` passed (5 tests). 2026-10-30, later still: `refreshGridQuery` reads a header row and the data under it, runs the saved steps, and writes beside that range. The source cells stay, and a missing column does not write over the previous output. `npx vitest run tests/sheet-query.test.ts` passed (6 tests). 2026-10-31: the spreadsheet toolbar button Query filters the selection. Matching rows are written one blank column to the right, and the source cells are not written. A destination cell that already has a value stops the write. The status text does not include the cell value. `npx vitest run tests/sheet-query-panel.test.ts tests/sheet-query.test.ts` passed (8 tests). The web app typecheck passed. In the browser, Query on an existing spreadsheet opened the panel, and Refresh with an empty column said to name the column. That click did not write cells. The painted grid was not used to type a source table. 2026-10-31, later: `refreshRemoteQuery` fetches one https table through a caller-supplied function and runs the saved steps. A view that is not allowed does not fetch and keeps the last Tomato row, marked stale. An http address is not fetched. A failed response whose body contains `token=secret-value` keeps that Tomato row, and the error does not contain `secret-value`. A table that no longer has the `crop` column keeps the last rows and names `crop`. A successful fetch of the North Tomato and South Bean rows returns only the Tomato row. The query document does not contain the address. `npx vitest run tests/sheet-query.test.ts` passed (7 tests). 2026-10-31, later still: `runScheduledRefresh` leaves a one-minute schedule alone 30 seconds after the last run and does not fetch. A schedule of one second is never due. A view that is not allowed does not fetch, does not move `lastRunAt`, and keeps the Tomato row marked stale without the text `secret-value`. A due fetch that gets status 500 moves `lastRunAt` to `2026-10-31T01:00:00.000Z` and keeps the Tomato row. `npx vitest run tests/sheet-query.test.ts` passed (8 tests). The function does not start a timer.

2026-10-31, later: `refreshDatabaseQuery` sends `SELECT crop, bed FROM beds` and returns the North Tomato row. An `INSERT` is not sent, and the error does not contain `secret-value`. A view that is not allowed is not sent. A driver error that contains `password=secret-value` is replaced with "The database query did not answer." and the Tomato row stays marked stale. The query document does not contain the statement. `npx vitest run tests/sheet-query.test.ts` passed (9 tests). This does not open a database itself. Limits are in `docs/sheet-query.md`.

2026-10-31, later still: a source that renamed `crop` to `plant` fails the saved filter and keeps the last Tomato row, marked stale. `remapQuery` changes that filter and the select to `plant` when the caller maps `crop` to `plant`. The refresh then returns the North Tomato row with `plant` and `bed`. The original document still says `crop`. Mapping `crop` to `api_key` is refused. The source row `Bean` stays. `npx vitest run tests/sheet-query.test.ts` passed (10 tests). A column that is not in the map is not dropped. The painted grid was not used.

2026-11-01: mapping `crop` to `secret-value` is refused with `That column cannot be remapped.` The refusal does not contain `secret-value` or `crop`. The document passed in still says `crop`. `npx vitest run tests/sheet-query.test.ts` passed (14 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-10-31, later: a viewer is not allowed to refresh a protected https source. The fetch is not called, the last Tomato row stays and is marked stale, and the error does not contain `secret-value`. An editor of that same source gets the North Tomato row. Someone with no access is not sent `SELECT crop, bed FROM beds`, and a driver error containing `password=secret-value` is not shown. `npx vitest run tests/sheet-query.test.ts` passed (12 tests). The spreadsheet Query button does not pass a source role, so this check runs when the caller supplies one. The painted grid was not used.

2026-10-31, later: a spreadsheet stores the filter on `crop` equals `Tomato`. Reading that file back returns the same steps. Refreshing them returns the North Tomato row. The file does not contain `secret-value`, and the source rows are not stored on the query. `npx vitest run tests/sheet-query.test.ts` passed (13 tests). The query panel stores that filter on the spreadsheet when the refresh changes the sheet. Opening the panel again shows column `crop` and value `Tomato`, and Refresh sends those values. `npx vitest run tests/sheet-query-panel.test.ts tests/ui/sheet-query-panel.test.tsx` passed (4 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-10-31, later: a `dedupe` step on `crop` keeps the first Tomato row, note `kept`, and the Bean row. The second Tomato row, note `secret-value`, is dropped. The result does not contain `secret-value`. The source still has that note. A dedupe of `note` when the source has no `note` column keeps the last Tomato row, marked stale, and the error names `note`. `npx vitest run tests/sheet-dedupe.test.ts tests/sheet-query.test.ts` passed (14 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-10-31, later: a `group` step sums `amount` by `bed`. North is `10` plus `5`, and a non-numeric `secret-value` is not added, so North is `15` and South is `3`. The result does not contain `secret-value`. The source still has that amount. Counting the same rows gives North `3` and South `1`. A group by `plot`, which is not a column, keeps the last North row, marked stale, and the error names `plot`. `npx vitest run tests/sheet-group.test.ts tests/sheet-dedupe.test.ts tests/sheet-query.test.ts` passed (15 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-10-31, later: a `split` step divides `place` on a comma into `bed` and `crop`. `North, Tomato` becomes bed `North` and crop `Tomato`, and the note `kept` stays. The source cell stays `North, Tomato`. A value `secret-value` with no comma keeps the last North row, marked stale. The error says the column does not split into 2 parts and does not contain `secret-value`. `npx vitest run tests/sheet-split.test.ts tests/sheet-group.test.ts tests/sheet-query.test.ts` passed (15 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-10-31, later: a `join` on `bed` copies the note `kept` onto the North Tomato row. The South row gets an empty note. A second North note `secret-value` and a West note `secret-value` are not copied. The query document does not contain `secret-value`. The source and the lookup stay as they were. A refresh without the lookup keeps the last North row, marked stale, and says a join needs a lookup table. `npx vitest run tests/sheet-join.test.ts tests/sheet-split.test.ts tests/sheet-query.test.ts` passed (15 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-10-31, later: an `append` step stacks West Pea after North Tomato and South Bean. The extra note `secret-value` is copied because that row was appended. The query document does not contain `Pea` or `secret-value`. The source and the extra table stay as they were. A refresh without the extra table keeps the last North row, marked stale, and says an append needs another table. That error does not contain `secret-value`. `npx vitest run tests/sheet-append.test.ts tests/sheet-join.test.ts tests/sheet-query.test.ts` passed (15 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-10-31, later: a `merge` step joins `bed` and `crop` with `, ` into `place`. North and Tomato become `North, Tomato`, and the note `kept` stays. The source row still has `bed` and `crop`. A merge that names `plot` keeps the last row, marked stale. The error says `plot` is not in the source and does not contain `secret-value`. `npx vitest run tests/sheet-merge.test.ts tests/sheet-query.test.ts` passed (14 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-10-31, later: a `convert` step turns `amount` `010` into `10`. The source cell stays `010`. `planted` `2026-10-31` stays an ISO date. `2026-02-31` is refused. `amount` `secret-value` keeps the last row, marked stale. The error says the column is not a number and does not contain `secret-value`. `npx vitest run tests/sheet-convert.test.ts tests/sheet-query.test.ts` passed (14 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-10-31, later: `runScheduledBatch` refreshes Beds on the second try after the first answer fails. Only one refresh runs at a time. Paths and North are cancelled and are not fetched. The notices say `Beds was refreshed.` and that Paths and North were cancelled. They do not contain `secret-value`, and that word is in the Beds address. `npx vitest run tests/sheet-schedule-batch.test.ts tests/sheet-query.test.ts` passed (14 tests). This does not start a timer. The spreadsheet was not opened in the browser. The painted grid was not used.

2026-11-01: a scheduled refresh stops waiting after one second. The result says `The source took too long.` The last row `Tomato` stays. The notice does not contain `secret-value`, and that word is in the address. A limit that is not a time says `The refresh limit is not a time.` and does not fetch. `npx vitest run tests/sheet-schedule-batch.test.ts` passed (3 tests). This does not start a timer. The spreadsheet was not opened in the browser. The painted grid was not used.

2026-10-31, later: the query panel can convert a column. `010` is written beside the selection as `10`. The source cell stays `010`. `secret-value` is not a number, nothing is written, and the message does not contain `secret-value`. The saved step is that conversion. `npx vitest run tests/sheet-query-panel.test.ts tests/ui/sheet-query-panel.test.tsx tests/sheet-query.test.ts` passed (18 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-10-31, later: the query panel can sort rows. Z to A on `crop` writes Tomato before Bean beside the selection. The Bean note stays with that row. The message does not contain `secret-value`. The source row stays Bean. A sort of `plot`, which is not a column, writes nothing, and the message names `plot`. An empty name says to name the column to sort. The saved step is that sort. `npx vitest run tests/sheet-query-panel.test.ts tests/ui/sheet-query-panel.test.tsx tests/sheet-query.test.ts` passed (19 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-11-01: the query panel can drop duplicate rows. Two Tomato rows keep the first note `kept` and drop the second note `secret-value`. The message does not contain `secret-value`. The source row stays Tomato with that note. A column named `plot` writes nothing, and the message names `plot`. An empty name says to name the column to check for duplicates. The saved step is that dedupe. `npx vitest run tests/sheet-query-panel.test.ts tests/ui/sheet-query-panel.test.tsx tests/sheet-query.test.ts` passed (20 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-11-01: the query panel can group rows. North amounts `10` and `5`, plus `secret-value`, sum to `15`. South is `3`. The message does not contain `secret-value`. The source row stays North with that amount. A column named `plot` writes nothing, and the message names `plot`. An empty name says to name the column to group by. The saved step can be a count. `npx vitest run tests/sheet-query-panel.test.ts tests/ui/sheet-query-panel.test.tsx tests/sheet-query.test.ts` passed (21 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-11-01: a group can average the numeric amounts. North amounts `10` and `5`, plus `secret-value`, average to `7.5`. South is `3`. The result does not contain `secret-value`. The source row still has that amount. East, whose only amount is that word, is blank. Count still counts that row. `npx vitest run tests/sheet-group.test.ts` passed (1 test). The query panel lists Average. The spreadsheet was not opened in the browser. The painted grid was not used.

2026-11-01: the query panel can split a column. `North, kept` is written as bed `North` and note `kept`. `South, secret-value` is written as bed `South` and note `secret-value`. The message does not contain `secret-value`. The source row stays `South, secret-value`. Asking for three parts writes nothing, and the message names `plot`. An empty name says to name the column to split. The saved step is that split. `npx vitest run tests/sheet-query-panel.test.ts tests/ui/sheet-query-panel.test.tsx tests/sheet-query.test.ts` passed (22 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-11-01: the query panel can merge columns. Bed `North` and note `kept` are written as `North, kept`. Bed `South` and note `secret-value` are written as `South, secret-value`. The crop column stays. The message does not contain `secret-value`. The source row stays `South` and `secret-value` in separate cells. A column named `plot` writes nothing, and the message names `plot`. One column says to name at least two columns to merge. The saved step is that merge. `npx vitest run tests/sheet-query-panel.test.ts tests/ui/sheet-query-panel.test.tsx tests/sheet-query.test.ts` passed (23 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-11-01: the query panel can join or append a range on the same sheet. Joining `E1:F4` on `bed` writes North with note `kept`. A later North note `secret-value` and a West note `secret-value` are not copied. The message does not contain `secret-value`. The source row stays North Tomato. A column named `plot` writes nothing, and the message names `plot`. A range named `secret-value` writes nothing, and the message does not repeat that word. Appending `E1:G2` stacks West Pea and its note `secret-value` under North Tomato. That message does not contain `secret-value`. An empty range says to name the lookup range. The saved join step keeps `E1:F4`. The saved append step keeps `E1:F2`. `npx vitest run tests/sheet-query-panel.test.ts tests/ui/sheet-query-panel.test.tsx tests/sheet-query.test.ts tests/sheet-join.test.ts tests/sheet-append.test.ts` passed (27 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-11-01: `reviewQuerySchema` follows a rename of `bed` to `plot`. A filter on `plot` whose value is `secret-value` is not a missing column. A later sort of `gone` is step 3. The note does not contain `secret-value`. Check columns reads the header row `bed` and `crop`, says step 1 uses `plot`, and does not write the sheet. A filter on `bed` says the columns in that step are in the source. The panel button shows that note and does not refresh. `npx vitest run tests/sheet-schema-review.test.ts tests/ui/sheet-query-panel.test.tsx tests/sheet-query-panel.test.ts` passed (15 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-11-01: a filter step can store `{{plot}}`. Refresh with `plot` set to `North` keeps the North row. A bed named `secret-value` is dropped, and that word is not in the saved step or the kept rows. A refresh with no value says `Name the value for plot.` `npx vitest run tests/sheet-query.test.ts` passed (14 tests). The query panel does not ask for this value. The spreadsheet was not opened in the browser. The painted grid was not used.

2026-11-01: the query panel Parameter field saves `{{plot}}` and uses `North` only for that refresh. The saved step does not contain `North`. A bed named `secret-value` is not written. A parameter named `secret-value` is refused with `Name the parameter with letters and digits.` and that word is not in the message. `npx vitest run tests/sheet-query-panel.test.ts tests/ui/sheet-query-panel.test.tsx tests/sheet-query.test.ts` passed (28 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-11-01: a field named `apiKey` with value `secret` is refused with `A query cannot store a credential.` The refusal does not contain `apiKey` or `secret`. A field named `secret-value` is refused the same way, and that word is not in the refusal. The saved query still does not include that field. `npx vitest run tests/sheet-query.test.ts` passed (15 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-11-01: a local CSV table keeps a quoted comma. `North, kept` stays one field, and a crop `secret-value` stays in that row. A filter for Tomato keeps only the North row. The query document does not contain `secret-value`. A JSON file `secret-value` is refused with `That file is not a table of text.` and that word is not in the refusal. The last Tomato row stays and is marked stale. `npx vitest run tests/sheet-query-local.test.ts` passed (2 tests). The query panel does not ask for this file. The spreadsheet was not opened in the browser. The painted grid was not used.

2026-11-01: the query panel has a Local table file control. A JSON file named `secret-value.json` that is not a table says `That file is not a table of text.` and does not repeat that name. A CSV with Tomato and `secret-value` says `The table has 2 rows.` and does not repeat either cell. The open spreadsheet writes those rows at the active cell. That write was not run in this test. `npx vitest run tests/ui/local-query-file.test.tsx tests/sheet-query-local.test.ts` passed (3 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-11-01: a local table does not overwrite a cell that already has a value. A destination holding `secret-value` is blocked, and that word is not in the result of the check. The status says `A cell already has a value.` An empty destination is not blocked. The table values still include the imported crop `secret-value`. `npx vitest run tests/ui/local-query-file.test.tsx tests/sheet-query-local.test.ts` passed (5 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-11-01: an https address with a user, a password, or a `token` query is not fetched. The notice is `The source address cannot include a credential.` and does not contain `secret-value`. That address is not due for a scheduled refresh. `npx vitest run tests/sheet-query.test.ts` passed (15 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-11-01: the query panel can refresh an https source on a schedule. A one-minute wait fetches when the minute has passed, and the same moment does not fetch again. The notice is `The source was refreshed.` A row value `secret-value` is passed to the sheet writer and is not in the notice. An address with `token=secret-value` says `The source address cannot include a credential.` and is not fetched. `npx vitest run tests/ui/query-schedule.test.tsx tests/ui/sheet-query-panel.test.tsx tests/sheet-query.test.ts` passed (19 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-11-01: a scheduled refresh is stored on the spreadsheet. Fifteen minutes and `https://example.test/rows.json` are written when the schedule starts, and opening the panel fills those fields without fetching. Stop removes the record. An address with `token=secret-value` is not stored, and the saved-query check says `The source address cannot include a credential.` without repeating that word. `npx vitest run tests/ui/query-schedule.test.tsx tests/sheet-query-panel.test.ts tests/ui/sheet-query-panel.test.tsx` passed (18 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-11-01: a join does not match a blank key. An empty bed stays empty when the lookup row for an empty bed has the note `secret-value`. That word is not in the result. North still takes the first note `kept`. `npx vitest run tests/sheet-join.test.ts` passed (2 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-11-01: a local JSON or CSV table with a leading byte-order mark still reads the first column as `bed`. `npx vitest run tests/sheet-query-local.test.ts` passed (3 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-11-01: a query sort puts plain numbers in numeric order. `2` comes before `10`, and each note stays with its row. The source rows stay in their original order. `npx vitest run tests/sheet-query.test.ts tests/sheet-query-panel.test.ts` passed (29 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-11-01: a filter can keep the other rows. `match` `ne` on crop `Tomato` keeps South, whose crop is `secret-value`, and drops North. The source row stays Tomato. Reopening the spreadsheet keeps that match. Exclude this value on the query panel stores `ne`, and clearing it stores an exact match again. `npx vitest run tests/sheet-query.test.ts tests/sheet-query-panel.test.ts tests/ui/sheet-query-panel.test.tsx` passed (33 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-11-01: the query panel can replace a column name before the next refresh. A filter on `crop` becomes a filter on `plant`. The note is `The step now uses plant.` A new name `secret-value` says `That column cannot be remapped.` and that sentence does not repeat the name. The filter stays on `plant`. `npx vitest run tests/ui/sheet-query-panel.test.tsx -t "replacement column"` passed. The spreadsheet was not opened in the browser. The painted grid was not used.

2026-11-01: a scheduled refresh can send a source token. The request for `https://example.test/beds` includes `secret-value` as the authorization. The stored schedule is one minute and that address, and it does not include the token. The notice `The source was refreshed.` does not include the token. `npx vitest run tests/ui/query-schedule.test.tsx -t "source token"` passed. The spreadsheet was not opened in the browser. The painted grid was not used.

2026-11-01: a source address with a credential in the path or the fragment is not fetched. `https://tables.example/beds` and a fragment `north` are still allowed. A path containing `token` and a fragment containing `api_key` say `The source address cannot include a credential.` The notice does not contain `secret-value`. `npx vitest run tests/sheet-query.test.ts -t "path or the fragment"` passed. The spreadsheet was not opened in the browser. The painted grid was not used.

2026-11-01: rows that arrive after Stop scheduled refresh are not written. The status stays `The scheduled refresh is stopped.` A late row `secret-value` is not written and is not in that status. `npx vitest run tests/ui/query-schedule.test.tsx` passed (5 tests). The spreadsheet was not opened in the browser. The painted grid was not used.

2026-11-01: a filter can keep a row whose column contains the text. `beds` keeps `Water the beds` and drops `secret-value`. A blank search keeps only a blank cell. The source row stays as it was. The query panel checkbox Cell contains this text stores that match. `npx vitest run tests/sheet-query.test.ts tests/ui/sheet-query-panel.test.tsx -t "contains"` passed (2 tests). The spreadsheet was not opened. The painted grid was not used.

2026-11-01: a group can keep the smallest or largest number. North amounts `10` and `5` have a minimum of `5` and a maximum of `10`. The amount `secret-value` is not copied, and a group with no numbers is blank. The source row stays as it was. The query panel lists Minimum and Maximum. `npx vitest run tests/sheet-group.test.ts tests/ui/sheet-query-panel.test.tsx -t "smallest|minimum group"` passed (2 tests). The spreadsheet was not opened. The painted grid was not used.

2026-11-01: a join matches a plain number written two ways. A bed `10` takes the note from a lookup bed `10.0`. The source cell stays `10` and the lookup cell stays `10.0`. `North` does not match `north`. A later note `secret-value` is not copied. `npx vitest run tests/sheet-join.test.ts` passed (3 tests). The spreadsheet was not opened. The painted grid was not used.

2026-11-01: dedupe and group treat a plain number written two ways as one value. A plot `10` and `10.0` keeps the first dedupe row `10`, and those amounts sum as one group labeled `10`. `north` stays separate. The source row `10.0` stays. `npx vitest run tests/sheet-dedupe.test.ts tests/sheet-group.test.ts tests/sheet-join.test.ts` passed (6 tests). The spreadsheet was not opened. The painted grid was not used.

2026-11-01: a filter matches a plain number written two ways. A plot filter `10` keeps `10` and `10.0` and drops `north`. Exclude `10` drops both numbers and keeps `north`. The source cell stays `10.0`. `npx vitest run tests/sheet-query.test.ts -t "written two ways in a filter"` passed (1 test). The spreadsheet was not opened. The painted grid was not used.

2026-11-01: a date conversion keeps the calendar day from a timestamp. `2026-10-31T15:00:00Z` becomes `2026-10-31`, and `2026-01-15T23:00:00-05:00` becomes `2026-01-15`. `2026-02-31T00:00:00Z` keeps the last row and marks it stale. The notice is `Column planted is not an ISO date.` A cell `secret-value` is not in that notice. The source cell stays as it was written. `npx vitest run tests/sheet-convert.test.ts` passed (2 tests) at 23:07:05. The spreadsheet was not opened. The painted grid was not used.

2026-11-02: a split that does not fit refuses a credential column name. The notice is `That column does not split into 2 parts.` The column name `secret-value` is not in that notice, and the source cell stays `North`. A normal column still says `Column place does not split into 2 parts.` `npx vitest run tests/sheet-split.test.ts` passed (2 tests) at 02:22:23. The spreadsheet was not opened. The painted grid was not used.

2026-11-02: a query notice does not repeat a credential column name. A missing column says `That column is not in the source.` A value that is not a number says `That column is not a number.` A value that is not a date says `That column is not an ISO date.` A normal column still says `Column plot is not in the source.` The source cell stays as it was written. `npx vitest run tests/sheet-merge.test.ts tests/sheet-convert.test.ts tests/sheet-split.test.ts` passed (6 tests) at 04:35:52. The spreadsheet was not opened. The painted grid was not used.
