# Storyboards

A storyboard describes one user experience from start to finish: who the person is, what they are trying to do, each scene they go through, and what success looks like. Each storyboard has a recording of SuiteLeaf performing it.

Storyboards are drawn from:

- the workflow references in [docs/workflows.md](../docs/workflows.md) and [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md);
- how the same tasks work in Google Workspace and Microsoft Office;
- what people ask about and struggle with online, especially on Reddit (r/googlesheets, r/MicrosoftWord, r/sysadmin).

## Format

Each storyboard is `NN-slug.md` with these sections:

- **Header:** mode (single-node or cluster), app, and links to the video and its script.
- **Who and why:** the person and their goal.
- **Inspired by:** the docs, product behaviour, and community threads it draws on.
- **Scenes:** numbered steps, each with the action and what the user sees.
- **Success looks like:** the end state.
- **Gaps and notes:** anything SuiteLeaf couldn't do, or did differently from Docs, Sheets, Word, or Excel, found while recording.

## Recordings

Each storyboard's script is a Playwright test in [scenes/](scenes) whose title is the storyboard slug. A passing run saves `videos/<slug>.mp4`. The videos show captions for each scene and a dot for the pointer.

Record every storyboard after building the web app:

```sh
npm run build:web
npm run storyboards
```

Cluster-mode storyboards also need the server and auth sidecar:

```sh
cargo build -p suiteleaf-node && npm run build:auth
```

Run a single storyboard with `npm run storyboards -- -g 08-sort-data`. Recording requires `ffmpeg` on your `PATH`.

| Variable | Purpose |
| --- | --- |
| `STORYBOARD_DIST` | Web build to record (default `apps/web/dist`). |
| `STORYBOARD_PORT` | Port for the static server (default 4180). |
| `STORYBOARD_NODE`, `STORYBOARD_AUTH` | Server binary and auth bundle for cluster storyboards. |
| `STORYBOARD_SLOWMO` | Delay between actions in ms (default 60). |

## Index

| # | Storyboard | Mode | App |
| --- | --- | --- | --- |
| 01 | [Write your first document](01-first-document.md) | single-node | Docs |
| 02 | [Find and organize your files](02-find-and-organize-files.md) | single-node | Files |
| 03 | [Open a Word document](03-import-word-document.md) | single-node | Docs |
| 04 | [Write a long report and move around it with the outline](04-long-report-with-outline.md) | single-node | Docs |
| 05 | [Add a table, a photo and a link](05-tables-images-and-links.md) | single-node | Docs |
| 06 | [Fix a repeated typo with find and replace](06-find-and-replace.md) | single-node | Docs |
| 07 | [Set up pages and export for Word and the web](07-page-setup-and-export.md) | single-node | Docs |
| 08 | [Carry a file to another computer](08-carry-a-file-to-another-computer.md) | single-node | Docs |
| 09 | [Build a household budget with formulas](09-household-budget-with-formulas.md) | single-node | Sheets |
| 10 | [Sort a column without moving the header](10-sort-without-the-header.md) | single-node | Sheets |
| 11 | [Filter to what matters](11-filter-to-what-matters.md) | single-node | Sheets |
| 12 | [Freeze the header row](12-freeze-the-header-row.md) | single-node | Sheets |
| 13 | [Format money and percentages](13-format-money-and-percentages.md) | single-node | Sheets |
| 14 | [Turn a table into a chart](14-chart-from-a-table.md) | single-node | Sheets |
| 15 | [Summarize spending with a pivot table](15-summarize-with-a-pivot.md) | single-node | Sheets |
| 16 | [Import and export a CSV without losing leading zeros](16-import-and-export-csv.md) | single-node | Sheets |
| 17 | [Review a budget with notes and comments](17-review-a-budget-with-notes-and-comments.md) | single-node | Sheets |
| 18 | [Highlight and check off tasks](18-highlight-and-check-off.md) | single-node | Sheets |
| 19 | [Open an Excel workbook and send it back](19-open-an-excel-workbook.md) | single-node | Sheets |
| 20 | [Build a presentation](20-build-a-presentation.md) | single-node | Slides |
| 21 | [Present with speaker notes](21-present-with-speaker-notes.md) | single-node | Slides |
| 22 | [Connect to your team's server](22-connect-to-your-team-server.md) | single-node → cluster | Home |
| 23 | [Start a document in SuiteDrive](23-start-a-document-in-suitedrive.md) | cluster | Docs |
| 24 | [Pick up on another server](24-pick-up-on-another-server.md) | cluster (two servers) | Slides |
| 25 | [When someone else saved first](25-when-someone-else-saved-first.md) | cluster | Docs |
| 26 | [Sign out and go back to this computer](26-sign-out-and-disconnect.md) | cluster → single-node | Home |
