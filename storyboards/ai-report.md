# Gemma 4 E4B as SuiteLeaf's on-device agent

This report covers the local model behind the AI panel: how each backend runs it, and how well it does the storyboard tasks. Numbers come from an Apple M5 Max (128 GB). Benchmarks: [scripts/ai-bench-llama.mjs](../scripts/ai-bench-llama.mjs) (Electron backend) and [scripts/ai-bench-web.mjs](../scripts/ai-bench-web.mjs) (browser backends). Storyboard metrics come from `test-results/ai-metrics/*.json`, written by every AI storyboard run.

## Backends

| Backend | Where | Weights | Load | Prompt | Generation | Result |
| --- | --- | --- | --- | --- | --- | --- |
| llama.cpp (Metal) | Electron utility process | `ggml-org/gemma-4-E4B-it-GGUF` Q4_0, 4.6 GB | 1.8–2.3 s | 460–3,200 tok/s | 85–104 tok/s | Works |
| WebGPU | Chromium 153, Web Worker | `onnx-community/gemma-4-E4B-it-ONNX` q4f16, 4.9 GB | 6–8 s from a local mirror | 170–640 tok/s | 25–40 tok/s | Works; the web build's fallback |
| WebNN (GPU) | Chromium 153 with `--enable-features=WebMachineLearningNeuralNetwork` | q4f16 | — | — | — | Fails: no kernel for `GatherBlockQuantized` |
| WebNN (GPU, NPU, CPU) | same | q4f16 decoder + uint8 (`q8`) embeddings, 6.9 GB | over 240 s | — | — | Never finishes compiling ("Array buffer allocation failed") |

Both working backends reuse the KV cache between agent turns. Each request replays the model's earlier output token for token, so only the new tool result is evaluated. A typical warm turn costs 40–110 ms of prompt time instead of seconds. The cache resets when the tool set changes, for example when the agent opens a file and the editor's tools replace the file list's. That turn re-evaluates the whole prompt: about 1–2 s on llama.cpp and 4–6 s on WebGPU for 3,500–5,500 tokens.

### WebNN

WebNN is exposed in Playwright's Chromium 153 on macOS only behind `--enable-features=WebMachineLearningNeuralNetwork`. With the flag, `navigator.ml` creates GPU, NPU and CPU contexts (CoreML backend). It still cannot run Gemma 4 E4B:

1. The default q4f16 export stores the 262K-token embedding tables (including the per-layer embeddings) with `com.microsoft.GatherBlockQuantized`. Neither onnxruntime-web's WebNN execution provider nor its CPU fallback in the web build has that kernel, so session creation fails immediately.
2. The 8-bit (`q8`, "quantized") embedding tables use `GatherBlockQuantized` too (8-bit blocks), and their per-layer table is a single 2.8 GB tensor (`[262144, 10752]` uint8). Loading it fails with "Array buffer allocation failed" before WebNN gets to compile; GPU, NPU and CPU each hit the 240 s budget. WebNN also needs fixed shapes, and transformers.js has no fixed-shape KV cache, so the decoder's growing sequence dimensions would leave most of the graph on CPU fallback even with loadable weights.

### 8-bit weights in the browser

`onnx-community/gemma-4-E4B-it-ONNX` also publishes an 8-bit export: `decoder_model_merged_quantized` uses `MatMulNBits` with `bits=8` (5.8 GB), the same operator WebGPU already runs at 4 bits. On WebGPU it fails the same way as above: the 2.8 GB per-layer embedding tensor is larger than the browser will allocate in one buffer, so after 900 s it had not loaded. The 4-bit export keeps every tensor under 2.1 GB, which is why it loads. Running 8-bit weights in the browser would need that tensor split in the graph (two half-width `GatherBlockQuantized` lookups joined by a `Concat`), or 8-bit decoder weights paired with 4-bit fp32 embeddings (`q4`). Electron can use the published Q8_0 GGUF (8 GB) unchanged.

So the web backend tries WebNN first, in its own worker with a 240 s budget, then falls back to WebGPU in a fresh worker. The AI panel shows the backend in use. Storyboard recordings set `suiteleaf.ai.device=webgpu` to skip the known 4-minute WebNN timeout. One recording per batch runs with automatic selection, to show the fallback really happens.

### Caching the browser model

Chromium's Cache API refused the 2 GB weight shards in Playwright's ephemeral profiles ("Unable to add response to browser cache"), so each new profile downloads the weights again. Recordings serve them from a local mirror (`storyboards/scenes/serve.mjs`, `/models/`), which makes that quick. A normal Chrome profile has a much larger quota, but this was not verified here.

## Model behaviour (first observations, before the storyboard loop)

- Tool-call syntax is reliable. No unparseable `<|tool_call>` blocks appeared in the first 20 requests, and Gemma's own `<|"|>` string quoting round-trips.
- It fills required arguments well, but sometimes picks plausible-but-wrong values. Asked to chart Budget vs Actual, it charted `A2:C5`, leaving out the header row; in the raw benchmark it also overwrote the table with flattened values before charting. `insert_chart` now rejects a range whose first row is numbers and names the corrected range.
- It occasionally ends a turn with no text and no tool call in the middle of a task (about 1 in 10 multi-step runs at temperature 1.0). The harness drops the empty reply and resamples, at most twice per run, and counts it as `emptyTurns`.
- It sometimes splits a list into one call per item, each replacing the last, then corrects itself with a final call that has every item.
- It sometimes opens a thought channel (`<|channel>thought`) even though thinking is off. The panel shows it collapsed as "Thinking".

## Stress test: every AI storyboard, three times per backend

Each AI storyboard ran three times on each backend, with nothing scripted or mocked. Sampling is the model's defaults (temperature 1.0, top-k 64, top-p 0.95), so each repeat is an independent attempt. The three backends:

- **web-q4:** the browser build on WebGPU, q4f16 ONNX weights. All 26 storyboards, 78 runs.
- **electron-q4:** the desktop app on llama.cpp with Q4_0 weights. Storyboards 01–21, 63 runs.
- **electron-q8:** the desktop app on llama.cpp with Q8_0 weights. Storyboards 01–21, 63 runs.

Storyboards 22–26 need a cluster server, so they run only in the browser. To reproduce:

```sh
STORYBOARD_RUN_TAG=web-q4 npm run storyboards -- --project=ai --repeat-each=3
STORYBOARD_RUN_TAG=electron-q4 npx playwright test --config playwright.storyboards-electron.config.ts --repeat-each=3
STORYBOARD_RUN_TAG=electron-q8 SUITELEAF_MODEL_PATH=~/.cache/suiteleaf-models/gguf/gemma-4-E4B-it-Q8_0.gguf \
  npx playwright test --config playwright.storyboards-electron.config.ts --repeat-each=3
node scripts/ai-stress-report.mjs web-q4 electron-q4 electron-q8
```

### Summary

Gemma 4 E4B passed 165 of 204 runs (81%). It is reliable at short, single-purpose requests: find and replace, page setup, sorting, filtering, freezing, notes and comments, CSV import, slides, presenting, and every cluster flow. It underperforms in three ways:

1. **It does most of a multi-part request, then stops, and says it did all of it.** 37 of the 38 failures caused by the model ended with a confident summary claiming success. The other one asked for permission instead of acting. Nobody reading only the model's reply would know these tasks had failed.
2. **It misses the one cell that breaks a pattern.** Storyboard 13 never passed: 0 of 9 runs here, and 0 of 12 before. The model formats the rate and amount columns as dollars but never the invoice total (D5), even though the request says "amounts" and the tool's reply shows D5 still unformatted.
3. **It loses structure on long inputs.** Storyboard 04 asks it to turn a 700-word report into a document with two heading levels. It passed 1 of 9 runs. It makes "Volunteers" or "Next year" a sub-heading, adds a title the user didn't ask for, or retypes every paragraph as a heading.

The 8-bit desktop build is clearly better than the 4-bit one, most of all in Sheets (91% against 64%). The browser's 4-bit q4f16 export sits between them (85%), which suggests the Q4_0 GGUF loses more accuracy than the q4f16 ONNX export does.

### Pass rate per storyboard

| Storyboard | web-q4 | electron-q4 | electron-q8 |
| --- | --- | --- | --- |
| 01-first-document | 2/3 | 3/3 | 3/3 |
| 02-find-and-organize-files | 3/3 | 3/3 | 3/3 |
| 03-import-word-document | 3/3 | 3/3 | 2/3 |
| 04-long-report-with-outline | 1/3 | 0/3 | 0/3 |
| 05-tables-images-and-links | 2/3 | 2/3 | 1/3 |
| 06-find-and-replace | 3/3 | 3/3 | 3/3 |
| 07-page-setup-and-export | 3/3 | 3/3 | 3/3 |
| 08-carry-a-file-to-another-computer | 3/3 | 2/3 | 3/3 |
| 09-household-budget-with-formulas | 2/3 | 0/3 | 3/3 |
| 10-sort-without-the-header | 3/3 | 3/3 | 3/3 |
| 11-filter-to-what-matters | 3/3 | 3/3 | 3/3 |
| 12-freeze-the-header-row | 3/3 | 3/3 | 3/3 |
| 13-format-money-and-percentages | 0/3 | 0/3 | 0/3 |
| 14-chart-from-a-table | 1/3 | 1/3 | 3/3 |
| 15-summarize-with-a-pivot | 3/3 | 1/3 | 3/3 |
| 16-import-and-export-csv | 3/3 | 2/3 | 3/3 |
| 17-review-a-budget-with-notes-and-comments | 3/3 | 3/3 | 3/3 |
| 18-highlight-and-check-off | 3/3 | 2/3 | 3/3 |
| 19-open-an-excel-workbook | 2/3 | 3/3 | 3/3 |
| 20-build-a-presentation | 3/3 | 2/3 | 3/3 |
| 21-present-with-speaker-notes | 3/3 | 3/3 | 3/3 |
| 22-connect-to-your-team-server | 3/3 | – | – |
| 23-start-a-document-in-suitedrive | 3/3 | – | – |
| 24-pick-up-on-another-server | 2/3 | – | – |
| 25-when-someone-else-saved-first | 3/3 | – | – |
| 26-sign-out-and-disconnect | 3/3 | – | – |

### Pass rate per app

| App | web-q4 | electron-q4 | electron-q8 |
| --- | --- | --- | --- |
| Docs & files (01–08) | 20/24 (83%) | 19/24 (79%) | 18/24 (75%) |
| Sheets (09–19) | 26/33 (79%) | 21/33 (64%) | 30/33 (91%) |
| Slides (20–21) | 6/6 (100%) | 5/6 (83%) | 6/6 (100%) |
| Server (22–26) | 14/15 (93%) | – | – |
| **All** | **66/78 (85%)** | **45/63 (71%)** | **54/63 (86%)** |

### Agent behaviour

| Backend | Requests | Tool calls | Tool errors | Unreadable calls | Empty replies retried | Median time per prompt |
| --- | --- | --- | --- | --- | --- | --- |
| web-q4 | 712 | 527 | 5 (0.9%) | 0 | 14 (2.0%) | 18 s |
| electron-q4 | 573 | 438 | 7 (1.6%) | 2 | 8 (1.4%) | 9 s |
| electron-q8 | 592 | 455 | 2 (0.4%) | 0 | 4 (0.7%) | 8 s |

The mechanics hold up. Tool-call syntax almost never fails: the parser now repairs the few slips it makes (an extra `[` or `}`, a missing `]`, or a call left open when the turn ends). It never called a tool that doesn't exist, and the repeated-call guard never had to step in. Empty replies still happen, more often at 4 bits, and one resample always recovered. Its failures are about judgment, not mechanics.

### Why runs failed

All but one of the 39 failures were the model's. The exception was desktop 08: the model saved the edited file back to disk, which is fine, but the check expected the draft status. That check now accepts both.

| Failure | Runs | Storyboards |
| --- | --- | --- |
| Left a cell or series out of a multi-part request | 13 | 13 (invoice total never formatted, 9), 14 (charted only Budget, 3), 15 (ignored the tool's note to format the pivot as dollars, 1) |
| Heading levels wrong on a long input | 8 | 04 |
| Left the file it was working in (`back_to_files`) | 5 | 03, 05 (×2), 16, 24 |
| Wrong rows or columns in formulas | 4 | 09 (total one column right, "Left to spend" one row low) |
| Wrong layout or arguments | 7 | 05 (no header row, ×2), 14 (chart not beside the table), 15 (both fields as columns), 18 (filled every row green instead of a rule), 20 (sun on the wrong slide), 01 (typed "after the frost. last") |
| Asked instead of acting | 1 | 19 ("Do you want me to change this to 1020?") |

Failed runs are kept as videos under `test-results/ai-videos/runs/<backend>/`, and their transcripts are under `test-results/ai-metrics/runs/<backend>/`.

### Speed

| | electron-q4 | electron-q8 | web-q4 |
| --- | --- | --- | --- |
| Weights | 4.6 GB | 8.0 GB | 4.9 GB |
| Load (weights in the OS file cache) | 2–3 s | 3 s | 6–8 s |
| Generation, nothing else running | 96–98 tok/s | 68–71 tok/s | 25–40 tok/s |
| Generation during the stress runs | 54 tok/s | 69 tok/s | 20 tok/s |

The isolated figures come from `scripts/ai-bench-llama.mjs` and `scripts/ai-bench-web.mjs`. During the stress runs, the browser and the 4-bit desktop runs shared the GPU, so their figures are lower; the 8-bit run had the GPU to itself. Even so, the 8-bit model's median prompt took 8 s on the desktop, against 18 s in the browser. Q8_0 costs about 30% of generation speed and 3.4 GB of memory, and buys 15 points of pass rate. The desktop default is still Q4_0; set `SUITELEAF_MODEL_PATH` to the Q8_0 file to use it. These numbers argue for making Q8_0 the default on machines with the memory for it.

### WebNN fallback, observed

One more browser run used automatic device selection (`STORYBOARD_AI_DEVICE=auto`). WebNN used its full 240 s budget without finishing compilation, as described above. The worker then fell back to WebGPU and loaded in 7 s, so the first reply came about 4 minutes after the request.

With today's ONNX exports, WebNN only adds that delay. So once WebNN has failed and WebGPU has worked, the browser saves the failure (`localStorage["suiteleaf.ai.webnnFailure"]`) and skips WebNN on later loads until the browser's user agent changes. In a persistent Chromium profile, the first load took 251 s and the next one 6 s. The panel shows a note, "WebNN couldn't run Gemma here, so it runs on WebGPU.", and expands it to give the reason.

### GPUs without 16-bit floats

The q4f16 weights need WebGPU's `shader-f16` feature. Where the adapter lacks it, the worker loads the q4 export instead: 4-bit weights with 32-bit activations, 5.6 GB, with every tensor under 2.1 GB. Forced with `localStorage["suiteleaf.ai.dtype"] = "q4"` on the M5 Max, it loaded in 15 s and ran. It has not been tried on a GPU that actually lacks `shader-f16`. Playwright's default headless shell only offers SwiftShader, a software adapter with 1 GB buffers. The worker now rejects that adapter immediately ("only a software (CPU) adapter is available"), because the model cannot run there. That's why the storyboards use full Chromium (`channel: "chromium"`), which gets the Metal GPU.

## FrogNano 4B compared

[microsoft/FrogNano-4B-2609](https://huggingface.co/microsoft/FrogNano-4B-2609) is Qwen3.5-4B, post-trained with reinforcement learning as a Python coding agent for Microsoft's 5-tool Leaf harness. Its model card says it was "not designed or evaluated as a general-purpose assistant". It runs in the same agent loop as Gemma, with the same tools, system prompt and storyboards. Only the chat format differs (`apps/web/src/ai/qwen.ts`). Choose it with `localStorage["suiteleaf.ai.model"] = "frognano-4b"` in the browser, or a FrogNano GGUF as `SUITELEAF_MODEL_PATH` on the desktop.

### Running it

| | Gemma 4 E4B | FrogNano 4B |
| --- | --- | --- |
| Architecture | Dense transformer | Hybrid: 24 Gated DeltaNet (linear attention) and 8 attention layers |
| Browser weights | `onnx-community/gemma-4-E4B-it-ONNX` q4f16, 4.9 GB | `RASMUS/FrogNano-4B-2609-ONNX` q4f16 (community export), 2.4 GB |
| WebGPU load, generation | 6–8 s, 25–40 tok/s | 4.4 s, 70–74 tok/s |
| WebNN | Fails (`GatherBlockQuantized`) | Fails (`GatherBlockQuantized`) |
| Desktop 4-bit, generation | Q4_0 (4.6 GB), 96–98 tok/s | Q4_K_M (2.8 GB), about 120 tok/s |
| Desktop 8-bit, generation | Q8_0 (8.0 GB), 68–71 tok/s | Q8_0 (4.6 GB), 70–80 tok/s |
| Output per reply in the agent | 35 tokens | 170 tokens (it thinks first) |

The cache reuse between steps works through FrogNano's recurrent layers on both backends. WebNN fails on FrogNano's embedding table, which uses the same `GatherBlockQuantized` operator as Gemma's. An unquantized embedding would fit in 1.27 GB, but that alone would not help much: the linear-attention layers use 48 ONNX Runtime operators (`LinearAttention`, `CausalConvWithState`) that WebNN has no equivalent for, so most of the graph would fall back to the CPU.

### Pass rates, three runs per storyboard

| | Gemma 4 E4B | FrogNano 4B |
| --- | --- | --- |
| Browser, WebGPU 4-bit (26 storyboards) | 66/78 (85%) | 62/78 (79%) |
| Desktop 4-bit (21 storyboards) | 45/63 (71%) | 57/63 (90%) |
| Desktop 8-bit (21 storyboards) | 54/63 (86%) | 57/63 (90%) |
| Median time per user prompt, browser | 18 s | 34 s |
| Median time per user prompt, desktop 4-bit / 8-bit | 9 s / 8 s | 18 s / 21 s |
| Tool errors per tool call (all runs) | 14 / 1,420 | 7 / 1,545 |
| Unreadable calls, empty replies retried | 2, 26 | 0, 3 |

The desktop and browser runs ran at the same time, so their tokens-per-second figures in the per-run table below are lower than the isolated numbers above. Both models ran the same way.

FrogNano is far better at the tasks Gemma could not do:

- **13, invoice formatting:** Gemma 0/9. FrogNano 9/9.
- **04, long report with headings:** Gemma 1/9. FrogNano 7/9.
- **09, budget formulas:** Gemma 5/9. FrogNano 8/9.
- **05, table, photo and link:** Gemma 5/9. FrogNano 8/9.

It also makes fewer mechanical errors, and it reads tool results closely. In the benchmark it noticed that a tool reported a different range from the one it asked for.

Its weaknesses:

- **It does things nobody asked for.** It ticked a box to try out the rule it had just set up (18), made an editable copy of a new pivot table (15), removed a file after reopening it (08), and exported to Excel when asked to download the file (17, every browser run). Gemma's failures were mostly the opposite: leaving part of the task undone.
- **It is slower per request.** It thinks before every step, so a request takes about twice as long as Gemma's on every backend, even though it generates tokens faster.
- **It is weaker in the browser.** The browser export passed 79% against 90% for both desktop builds. Every browser run failed 17 and 23; in 23 it made the folder, then created the document in My Drive. The browser's community q4f16 export (block size 32, symmetric) may lose more accuracy than the Q4_K_M GGUF does, but three runs per storyboard are too few to be sure.
- **Like Gemma, it claims success when it has failed.** Every failed run ended with a confident summary.

### Thinking budget

FrogNano's template can only turn thinking on or off, so the stream function can instead cap it. Once a reply has thought for the budget, it is told to act, using Qwen's documented early-stop phrase, and the reply continues on the cached prompt. With a 128-token budget, desktop Q4_K_M took 10 s per prompt instead of 18 s, but passed 51/63 (81%) instead of 57/63. It lost the long report (04: 0/3) and the chart (14: 0/3), where the plan matters. So FrogNano thinks without a budget by default. `localStorage["suiteleaf.ai.thinkingBudget"]` (or `STORYBOARD_AI_THINKING` for storyboards) sets one. One capped run also lost storyboard 06 to a desktop app crash, which the test runner then waited on for 30 minutes.

### Per-storyboard results

| Storyboard | web-q4 | web-frog-q4 | electron-q4 | electron-frog-q4 | electron-q8 | electron-frog-q8 | electron-frog-q4-t128 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01-first-document | 2/3 | 2/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| 02-find-and-organize-files | 3/3 | 1/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| 03-import-word-document | 3/3 | 3/3 | 3/3 | 3/3 | 2/3 | 3/3 | 3/3 |
| 04-long-report-with-outline | 1/3 | 3/3 | 0/3 | 2/3 | 0/3 | 2/3 | 0/3 |
| 05-tables-images-and-links | 2/3 | 2/3 | 2/3 | 3/3 | 1/3 | 3/3 | 3/3 |
| 06-find-and-replace | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 2/3 |
| 07-page-setup-and-export | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| 08-carry-a-file-to-another-computer | 3/3 | 3/3 | 2/3 | 2/3 | 3/3 | 2/3 | 3/3 |
| 09-household-budget-with-formulas | 2/3 | 3/3 | 0/3 | 3/3 | 3/3 | 2/3 | 1/3 |
| 10-sort-without-the-header | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| 11-filter-to-what-matters | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| 12-freeze-the-header-row | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| 13-format-money-and-percentages | 0/3 | 3/3 | 0/3 | 3/3 | 0/3 | 3/3 | 2/3 |
| 14-chart-from-a-table | 1/3 | 2/3 | 1/3 | 1/3 | 3/3 | 1/3 | 0/3 |
| 15-summarize-with-a-pivot | 3/3 | 2/3 | 1/3 | 1/3 | 3/3 | 3/3 | 3/3 |
| 16-import-and-export-csv | 3/3 | 2/3 | 2/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| 17-review-a-budget-with-notes-and-comments | 3/3 | 0/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| 18-highlight-and-check-off | 3/3 | 1/3 | 2/3 | 3/3 | 3/3 | 2/3 | 2/3 |
| 19-open-an-excel-workbook | 2/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| 20-build-a-presentation | 3/3 | 3/3 | 2/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| 21-present-with-speaker-notes | 3/3 | 2/3 | 3/3 | 3/3 | 3/3 | 3/3 | 2/3 |
| 22-connect-to-your-team-server | 3/3 | 3/3 | – | – | – | – | – |
| 23-start-a-document-in-suitedrive | 3/3 | 0/3 | – | – | – | – | – |
| 24-pick-up-on-another-server | 2/3 | 3/3 | – | – | – | – | – |
| 25-when-someone-else-saved-first | 3/3 | 3/3 | – | – | – | – | – |
| 26-sign-out-and-disconnect | 3/3 | 3/3 | – | – | – | – | – |


| Run | Storyboard runs | Passed | Requests | Tool calls | Tool errors | Unreadable calls | Unknown tools | Repeated calls blocked | Empty replies retried | Output tok/s | Prompt tok/s | Median time per user prompt |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| web-q4 | 78 | 66 (85%) | 712 | 527 | 5 | 0 | 0 | 0 | 14 | 20 | 556 | 18s |
| web-frog-q4 | 78 | 62 (79%) | 772 | 664 | 6 | 0 | 2 | 0 | 3 | 37 | 222 | 34s |
| electron-q4 | 63 | 45 (71%) | 573 | 438 | 7 | 2 | 0 | 0 | 8 | 54 | 1667 | 9s |
| electron-frog-q4 | 63 | 57 (90%) | 519 | 434 | 1 | 0 | 0 | 0 | 0 | 49 | 1520 | 18s |
| electron-q8 | 63 | 54 (86%) | 592 | 455 | 2 | 0 | 0 | 0 | 4 | 69 | 2303 | 8s |
| electron-frog-q8 | 63 | 57 (90%) | 543 | 447 | 0 | 0 | 0 | 0 | 0 | 35 | 1385 | 21s |
| electron-frog-q4-t128 | 63 | 51 (81%) | 509 | 414 | 3 | 0 | 0 | 0 | 0 | 81 | 2218 | 10s |

