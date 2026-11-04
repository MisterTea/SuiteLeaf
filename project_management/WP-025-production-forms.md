---
id: "WP-025"
title: "Production Forms and response workflows"
type: "work_package"
status: "blocked"
priority: "P1"
phase: 3
area: "forms"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: true
blocked_on: ["WP-007"]
related_sources: ["S24"]
---

# Production Forms and response workflows

## Outcome and rationale

Turn the existing hidden Forms implementation into a reliable survey, registration, and quiz tool with safe response collection.

## Existing implementation and starting points

`apps/web/src/editors/Form.tsx` supports text, choice, rating, grid questions, required answers, and response display. `apps/web/src/flags.ts` hides Forms unless `VITE_SUITELEAF_FORMS=1`. Inspect responder roles and sign-up sharing as well.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Separate form schema/version from append-only response submissions so concurrent responses cannot overwrite each other. Validate submissions server-side and use idempotency keys.
- Add sections/branching, long text, checkboxes, dropdowns, date/time, numeric validation, uploads, quizzes/scoring, and accessible progress/navigation.
- Implement published/private/closed states, respondent permissions, optional anonymous submission, anti-abuse controls, quotas, deadlines, and explicit response-retention rules.
- Add CSV/XLSX export, a linked spreadsheet destination, summaries, notifications, and webhooks through the shared automation boundary.
- Provide draft/preview/publish with schema-change behavior for existing responses; support response editing only under explicit policy.
- Enable Forms by default only after feature-flag migration, permission isolation, response durability, and accessibility gates pass.

## Dependencies and delivery

Completion is blocked on `WP-007`. Design and isolated prototypes may proceed, but do not bypass the prerequisite contracts or release gates.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- Concurrent submissions are durably stored exactly once without overwriting existing responses.
- A respondent cannot read other responses or edit questions unless separately authorized.
- Branching, required-field validation, scoring, uploads, and closing a form behave consistently in the server and client.
- Exported/linked responses preserve question/version identity and safely escape spreadsheet formula-looking values.

## Verification

- Vitest/jsdom branching, validation, scoring, serialization, and response export tests; Rust/API tests for concurrency and access.
- Test oversized/malicious uploads, duplicate requests, interrupted submissions, and schema edits after publication.
- Use browser tests only for layout, keyboard/touch navigation, and actual spreadsheet output rendering.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Signatures and payment collection require separate integrations. Do not expose existing response arrays through a public form payload.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S24`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.

# Progress

2026-10-30: Not started. Front matter status is `blocked`. `blocked` is true. `blocked_on` is ["WP-007"]. No product behavior for this package changed on this date. Active work is the WP-001 catalog and a mark-preservation slice of WP-002.

2026-11-03: an authorized export names a question `plot@2` and writes `=1+1` as `'=1+1`. A question id `secret-value` is `question 2`, and that word is not in the header or the notice. A repeated response is kept once. A response id that looks like a credential is written as `response`. An answer `North` stays `North`. The lists passed in stay as they were. `npx vitest run tests/form-responses.test.ts` passed (1 test). Coverage for `apps/web/src/form-responses.ts` was 100% statements, branches, functions, and lines. This is not a public form payload. A form was not published. A server was not started. The package stays blocked on WP-007.

2026-11-03: a responder who reads the form gets the questions and no answers. The prompt stays `Plot`. The stored answer `North` is not in that read, and neither is `secret-value`. The owner still reads `North`. `cargo test -p suitedrive --test drive a_repeated_form_response_is_not_stored_twice` passed (1 test). The owner append test still passed. A responder search for `North` does not find the form. A search for `Plot` finds it, and the snippet does not include `North`. The owner search for `North` finds the form and the snippet includes `North`. `cargo test -p suitedrive --test drive a_repeated_form_response_is_not_stored_twice` passed (1 test). The owner append test and the three search tests still passed. A blank required answer is refused with `Plot is required`. The other answer `secret-value` is not in that refusal, and the form still has one response. `cargo test -p suitedrive --test drive a_repeated_form_response_is_not_stored_twice` passed (1 test). The owner append test still passed. A form with `accepting` set to false refuses another response with `This form is not taking more responses.` The saved form still has one response, `North`. A missing `accepting` field still takes responses. `npx vitest run tests/form.test.ts` passed (10 tests). Coverage for `apps/web/src/form-submit.ts` was 100% statements, branches, functions, and lines. `cargo test -p suitedrive --test drive a_repeated_form_response_is_not_stored_twice` passed (1 test). The owner append test still passed. The sign-up link for a closed form says it is not accepting. Submitting `secret-value` is refused with `This form is not taking more responses.` and that word is not stored. `cargo test -p suitedrive --test drive a_closed_form_refuses_a_sign_up` passed (1 test). `npx vitest run tests/ui/sign-up-closed.test.tsx` passed (1 test). The sign-up page was rendered in a test page. The SuiteLeaf window was not opened. The earlier sign-up link test still passed. This is one node. The package stays blocked on WP-007.

2026-11-03: a response id that is already stored is not added again. The first answer stays `North`. A later answer `secret-value` for that same id is not stored, and that word is not in the form. On the node, a responder who sends `r1` a second time is refused. The saved form still has one response, `North`. `npx vitest run tests/form.test.ts` passed (10 tests). Coverage for `apps/web/src/form-submit.ts` was 100% statements, branches, functions, and lines. `cargo test -p suitedrive --test drive a_repeated_form_response_is_not_stored_twice` passed (1 test). The earlier responder append test still passed. This is one node. Two nodes were not writing at once. A form was not published. The package stays blocked on WP-007.

2026-11-03: a choice can skip later questions. `Large` jumps from Size to Note. The beds answer `secret-value` is not stored. `Small` without beds is refused with `Beds is required`. The sign-up page hides Beds after Large is chosen and still shows Note. `npx vitest run tests/form-branch.test.ts tests/ui/sign-up-closed.test.tsx` passed (3 tests). Coverage for `apps/web/src/form-branch.ts` was 100% statements, branches, functions, and lines. `cargo test -p suitedrive --test drive a_large_plot_skips_the_beds_question` passed (1 test). The earlier sign-up link test still passed. The sign-up page was rendered in a test page. The SuiteLeaf window was not opened. This is one node. The package stays blocked on WP-007.

2026-11-03: a sign-up stores a score for the questions that were shown. Size is worth 1 and the note is worth 1. `Large` with note `North` scores 1 of 2, because the note answer is `Ok` and beds is skipped. The beds answer `secret-value` is not stored. The public questions do not include the correct answer `North`. `npx vitest run tests/form-score.test.ts` passed (1 test). Coverage for `apps/web/src/form-score.ts` was 100% statements, branches, functions, and lines. `cargo test -p suitedrive --test drive a_large_plot_skips_the_beds_question` passed (1 test). The earlier sign-up link test still passed. The sign-up page was not opened for the score. This is one node. The package stays blocked on WP-007.

2026-11-03: a file question stores the name and size, not the file bytes. `Beds.png|12` is stored as `Beds.png (12 bytes)`. `secret-value.png` is refused with `That file is not an allowed upload.` and that name is not in the refusal. A file of 5,000,001 bytes says `That file is too large.` The saved form still has one response. The sign-up page shows a file field for Photo. `npx vitest run tests/form-upload.test.ts` passed (1 test). Coverage for `apps/web/src/form-upload.ts` was 100% statements, 94.73% branches, 100% functions, and 100% lines. `npx vitest run tests/ui/sign-up-closed.test.tsx` passed (3 tests). `cargo test -p suitedrive --test drive a_form_upload_keeps_the_name_and_refuses_a_script` passed (1 test). The earlier sign-up link test still passed. The sign-up page was rendered in a test page. The SuiteLeaf window was not opened. This is one node. The package stays blocked on WP-007.

2026-11-03: a number question keeps a number inside its range. ` 4 ` is stored as `4` when the range is 1 to 10. `secret-value` is refused with `Enter a number.` and that word is not in the refusal. `11` says `That number is outside the range.` The public form includes the minimum and maximum. `npx vitest run tests/form-number.test.ts` passed (1 test). Coverage for `apps/web/src/form-number.ts` was 92.3% statements, 95.65% branches, 100% functions, and 100% lines. `cargo test -p suitedrive --test drive a_form_number_stays_inside_its_range` passed (1 test). The earlier sign-up link test still passed. The sign-up page was not opened for the number. This is one node. The package stays blocked on WP-007.

2026-11-03: a deadline stops new responses. `2020-01-01T00:00:00.000Z` refuses a sign-up with `The deadline for this form has passed.` The answer `secret-value` is not stored and is not in the refusal. A deadline that is not a time stays open. A deadline in 2099 stays open at `2026-11-03T12:00:00.000Z`. `npx vitest run tests/form.test.ts tests/ui/sign-up-closed.test.tsx` passed (14 tests). Coverage for `apps/web/src/form-submit.ts` was 100% statements, branches, functions, and lines. `cargo test -p suitedrive --test drive a_past_deadline_refuses_a_sign_up` passed (1 test). The earlier sign-up link test still passed. The sign-up page was rendered in a test page. The SuiteLeaf window was not opened. This is one node. The package stays blocked on WP-007.
