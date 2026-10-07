# Sheets workflow comparison — round 2

Google Sheets is ground truth. This fresh subagent performed one product verification round, with no source edits and no further product iteration. Recording recovery below belongs to this same round.

## Scope and starting state

Same manual-derived scope as round 1: `docs/workflows.md` scenarios 2–3 and Kenneshaw chapter 1 budget/formula/formatting material. Both measured runs start with the identical six-row Category/Budget/Actual/Remaining table, bold headers, currency cells, C3=425, SUM totals 2200/2030/170, no chart and no filter. Round 2 measures chart creation A1:C5, C3 update 425→450, filter creation A1:D5, save/reopen. Initial table entry and initial formatting were verified previously and are not replayed in these videos.

Google reference: https://docs.google.com/spreadsheets/d/1iX7R8yeE6JSjUMqCNqR2X9BHe8j28STGdJm264Dei5g/edit

## Deliverable recordings and limits

- `google-sheets.mp4` (50.47s): actual signed-in Google Sheets in isolated Brave, native full desktop recording. Contains chart creation, value update, filter, and browser reopen. Cmd+R was intercepted by Sheets as fill-right, temporarily replacing the selected range. Undo restored the range; browser Reload was then used after Saved to Drive was observed. The restored final state is independently visible at 47s and in `google-reopened.png`. This recovery is an operator shortcut mistake, not a SuiteLeaf defect. The desktop includes unrelated background tab strips.
- `suiteleaf.mp4` (17.16s): actual SuiteLeaf browser viewport recording in an isolated Playwright Chromium context, transcoded from its original WebM. Shows a native workbook import with the identical prefilled starting table, chart creation, 425→450 update, range filter, return to library/reopen, native download. `record-suiteleaf.mjs` is reproducible; `suiteleaf-clean.webm` is original capture. No simulated UI or synthetic frames.
- Native SuiteLeaf screen recording was obscured by an unrelated foreground Docs task, even though native bound Brave actions succeeded. Preserved as `suiteleaf-obscured-desktop-attempt.mp4`; not comparison evidence. A brief `suiteleaf-final-verification.mp4` is supplemental native evidence only. `round-2.suiteleaf` from native run contains an incidental A1C3 named range created while trying native name-box entry; the clean viewport run and `clean-final.suiteleaf` exclude that operator artifact.
- Videos have different duration, capture dimensions, toolbar design and action timing. Comparison concerns behavior and data, not pixel equality.

## Comparison

| Checked behavior | Google Sheets | SuiteLeaf round 2 | Result |
| --- | --- | --- | --- |
| Calculated final totals | 2200/2055/145 | 2200/2055/145 | Match |
| Food update and remaining | 450/50 | 450/50 | Match |
| Currency cells and bold heading | Retained | Retained | Match |
| Header-derived default title | Budget and Actual | Budget and Actual | Match |
| Column chart data | Eight bars, four categories | Eight bars, four categories | Match |
| Currency Y labels | Dollars, two decimals | Dollars, two decimals | Match |
| Legend | Budget then Actual, at top | Budget then Actual, at top | Match |
| Category axis title | Category | Category | Match |
| Placement | Below totals | Below totals, persisted y=192 | Match |
| Live Food Actual bar | Rises from 425 to 450 | Height 70.0143→74.1328px; other seven bars unchanged | Match |
| Filter creation and accessible button | Remove filter | Remove filter, pressed state true | Match |
| Reopen | Data/formulas/chart/filter retained | Data/formulas/chart/filter retained | Match |

Automatic axis tick spacing (Google 250, SuiteLeaf 300), colors, font, exact chart dimensions and placement offset differ. These are presentation choices, with numeric values, categories, series ordering and readable labels preserved.

`google-reopened.png` is an inspected video frame at 47s. `suiteleaf-initial.png` and `suiteleaf-reopened.png` are actual captured viewport states; `suiteleaf-chart.png` is an inspected clean MP4 frame at 15s. `bar-heights.json` records observed rendered bar heights. `clean-final.suiteleaf` retains numeric source cells, all seven formulas, exact formula caches, number styles, A1:C5 chart source and A1:D5 filter source.

No remaining functional discrepancies were observed for this exercised chart/update/filter/save-reopen scope. This does not certify full Google Sheets parity: chart resizing, sort/filter criteria, pivots, CSV import/export, broader functions and other manual workflows are outside this round.
