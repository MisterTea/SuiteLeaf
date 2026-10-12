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
| 01 | [Write your first document](01-first-document.md) | Single-node | Docs |
