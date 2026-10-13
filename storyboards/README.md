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

## AI versions

Every storyboard also has an AI version, `scenes/ai/NN-slug-ai.spec.ts`, described under "AI version" in its Markdown file. The person types their request into the AI panel, and Gemma 4 E4B, running on the device, does the task with the app's tools. Nothing is scripted or mocked: the test only sends the prompt, then checks the result the way the original storyboard does. A passing run saves `videos/<slug>-ai.mp4` (desktop runs: `videos/electron/<slug>-ai.mp4`). Failed AI runs are kept in `test-results/ai-videos/` so the model's mistakes can be watched, and each run's transcript and metrics go to `test-results/ai-metrics/`.

```sh
npm run storyboards -- --project=ai                                     # browser, WebGPU
npx playwright test --config playwright.storyboards-electron.config.ts  # desktop app, llama.cpp (01–21)
```

The browser runs need the model weights in `~/.cache/suiteleaf-models` (`onnx-community/gemma-4-E4B-it-ONNX`, q4f16 files), and the desktop runs need `gguf/gemma-4-E4B-it-Q4_0.gguf` there. [ai-report.md](ai-report.md) has the pass rates, the failure analysis, and the backend comparison.

| Variable | Purpose |
| --- | --- |
| `STORYBOARD_MODELS` | Folder the static server serves as `/models/` (default `~/.cache/suiteleaf-models`). |
| `STORYBOARD_MODEL_HOST` | Where the browser loads weights from (default the static server's `/models/`). |
| `STORYBOARD_AI_DEVICE` | `webgpu` (default), or `auto` to try WebNN first and fall back to WebGPU. |
| `STORYBOARD_AI_MODEL` | Browser model: `gemma-4-e4b` (default) or `frognano-4b`. |
| `STORYBOARD_AI_THINKING` | FrogNano's thinking budget per reply, in tokens (default: no limit). |
| `STORYBOARD_AI_REVIEW` | The check before the final reply: `issues` (default: only when the app sees a problem), `always` or `off`. |
| `STORYBOARD_AI_CHECKLIST` | The todo checklist: `off` (default), `on`, or `required` (the first step of a multi-part request waits for it). |
| `STORYBOARD_AI_CAPTURE` | `1` keeps every prompt in the metrics, for `scripts/ai-fidelity.mjs`. |
| `STORYBOARD_AI_REVIEW` | The check before the final reply: `issues` (default: only when the app sees a problem), `always` or `off`. |
| `STORYBOARD_AI_CAPTURE` | `1` keeps every prompt in the metrics, for `scripts/ai-fidelity.mjs`. |
| `SUITELEAF_MODEL_PATH` | GGUF file for desktop runs, e.g. the Q8_0 build or a FrogNano GGUF (the model is read from the file name). |
| `STORYBOARD_RUN_TAG` | Stress runs: with `--repeat-each=N`, keep every repeat's metrics and video under `test-results/ai-*/runs/<tag>/`. Summarize with `node scripts/ai-stress-report.mjs <tag> …`. |

## Index

| # | Storyboard | Mode | App |
| --- | --- | --- | --- |
| 01 | [Write your first document](01-first-document.md) | Single-node | Docs |
