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

Storyboards 27 onward describe experiences where SuiteLeaf falls short of Google Workspace. They add two sections between **Scenes** and **Success looks like**:

- **Google Workspace benchmark:** how the same task works in Google Docs, Sheets, Slides, or Drive today, step by step, with click and keystroke counts and the pain points people report, with links.
- **Better than Google Workspace when:** a numbered list of criteria that a recording or a test can check, such as "restoring a version takes at most 3 clicks from the editor".

Their **Gaps and notes** list what SuiteLeaf can't do yet for that storyboard, checked against the code, so whoever implements it knows the starting point. Each has its own script, `scenes/NN-slug.spec.ts`.

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
| 27 | [Share a document with a teammate](27-share-a-document-with-a-teammate.md) | cluster | Docs |
| 28 | [Restore an earlier version](28-restore-an-earlier-version.md) | cluster | Docs |
| 29 | [Comment on a document](29-comment-on-a-document.md) | single-node | Docs |
| 30 | [Suggest changes and accept them](30-suggest-changes-and-accept-them.md) | single-node | Docs |
| 31 | [Rearrange a deck](31-rearrange-a-deck.md) | single-node | Slides |
| 32 | [Give a deck a theme and transitions](32-give-a-deck-a-theme-and-transitions.md) | single-node | Slides |
| 33 | [Start from a template](33-start-from-a-template.md) | single-node | Home |
| 34 | [Count words and check spelling](34-count-words-and-check-spelling.md) | single-node | Docs |
| 35 | [Add a table of contents and footnotes](35-add-a-table-of-contents-and-footnotes.md) | single-node | Docs |
| 36 | [Find any command](36-find-any-command.md) | single-node | Docs, Sheets, Slides |
| 37 | [Dropdown lists in a sheet](37-dropdown-lists-in-a-sheet.md) | single-node | Sheets |
| 38 | [Clean up messy data](38-clean-up-messy-data.md) | single-node | Sheets |
| 39 | [Insert a function with help](39-insert-a-function-with-help.md) | single-node | Sheets |
| 40 | [Trash, star, and restore files](40-trash-star-and-restore.md) | single-node | Files |
| 41 | [A viewer cannot edit a spreadsheet or a presentation](41-view-only-sheets-and-slides.md) | cluster | Sheets, Slides |
| 42 | [Hear that a file was shared, and keep a copy](42-you-were-shared-a-file.md) | cluster | Files |
| 43 | [See who last edited a file](43-who-last-edited.md) | cluster | Files, Docs |
| 44 | [Compare a spreadsheet or a slide version in color](44-compare-sheet-and-slide-versions.md) | cluster | Sheets, Slides |
| 45 | [Check grammar while you write](45-check-grammar.md) | single-node | Docs |
| 46 | [Bold one word in a slide](46-format-one-word-on-a-slide.md) | single-node | Slides |
| 47 | [Save a slide theme and use it again](47-save-a-slide-theme.md) | single-node | Slides |
| 48 | [Dropdowns with several choices, or from a range](48-dropdowns-from-a-range.md) | single-node | Sheets |
| 49 | [Mention someone in a comment](49-mention-someone-in-a-comment.md) | single-node | Docs |
| 50 | [Add a citation and a bibliography](50-citations-and-a-bibliography.md) | single-node | Docs |
| 51 | [Hand over a file, and let a share expire](51-transfer-ownership-and-expire-a-share.md) | cluster | Docs |
| 52 | [Restore one paragraph](52-restore-one-paragraph.md) | cluster | Docs |
| 53 | [Link a cell](53-link-a-cell.md) | single-node | Sheets |
| 54 | [Spell a sheet and a deck](54-spell-a-sheet-and-a-deck.md) | single-node | Sheets, Slides |
| 55 | [Name a range](55-name-a-range.md) | single-node | Sheets |
| 56 | [Insert an equation](56-insert-an-equation.md) | single-node | Docs |
| 57 | [Crop a photo](57-crop-a-photo.md) | single-node | Docs |
| 58 | [Group rows](58-group-rows.md) | single-node | Sheets |
| 59 | [Print the budget](59-print-the-budget.md) | single-node | Sheets |
| 60 | [Comment on a slide](60-comment-on-a-slide.md) | single-node | Slides |
| 61 | [Fade in on click](61-fade-in-on-click.md) | single-node | Slides |
| 61 | [A different first page](61-different-first-page.md) | single-node | Docs |
| 62 | [Odd and even pages](62-odd-and-even-pages.md) | single-node | Docs |
| 63 | [Right-click a misspelling](63-right-click-a-misspelling.md) | single-node | Sheets |
| 63 | [Open a letterhead from Word](63-open-a-letterhead-from-word.md) | single-node | Docs |
| 64 | [Change every copy of a typo](64-change-every-copy-of-a-typo.md) | single-node | Sheets |
| 64 | [Edit the header on the page](64-edit-the-header-on-the-page.md) | single-node | Docs |
| 65 | [Choose a page number](65-choose-a-page-number.md) | single-node | Docs |
| 66 | [Describe a photo](66-describe-a-photo.md) | single-node | Docs |
| 68 | [Space the lines](68-space-the-lines.md) | single-node | Docs |
| 71 | [Group columns](71-group-columns.md) | single-node | Sheets |
| 72 | [Mark a draft](72-mark-a-draft.md) | single-node | Docs |
| 74 | [Two columns for the news](74-two-columns-for-the-news.md) | single-node | Docs |
| 75 | [Start numbering at](75-start-numbering-at.md) | single-node | Docs |
| 77 | [Number the front in roman](77-number-the-front-in-roman.md) | single-node | Docs |
| 78 | [Keep the Word file's margins](78-keep-the-word-margins.md) | single-node | Docs |
| 80 | [Send an outline to Excel](80-send-an-outline-to-excel.md) | single-node | Sheets |
| 82 | [Use a two-inch margin](82-use-a-two-inch-margin.md) | single-node | Docs |
| 84 | [Set how far the header sits from the edge](84-header-from-the-edge.md) | single-node | Docs |
| 87 | [Keep the letterhead's distance](87-keep-the-letterhead-distance.md) | single-node | Docs |
| 91 | [Keep the letterhead off the title](91-keep-the-letterhead-off-the-title.md) | single-node | Docs |
| 94 | [See the margin and the reason](94-see-the-margin-and-the-reason.md) | single-node | Docs |
| 97 | [See the letterhead move](97-see-the-letterhead-move.md) | single-node | Docs |
| 100 | [See the margin move](100-see-the-margin-move.md) | single-node | Docs |
