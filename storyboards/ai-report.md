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
2. With the uint8 embedding tables (standard `DequantizeLinear` + `Gather`), session creation never finishes on any WebNN device. One run was stopped after more than 15 minutes; with a 240 s budget, GPU, NPU and CPU all timed out and logged "Array buffer allocation failed". WebNN also needs fixed shapes, and transformers.js has no fixed-shape KV cache, so the decoder's growing sequence dimensions would leave most of the graph on CPU fallback even if compilation finished.

So the web backend tries WebNN first, in its own worker with a 240 s budget, then falls back to WebGPU in a fresh worker. The AI panel shows the backend in use. Storyboard recordings set `suiteleaf.ai.device=webgpu` to skip the known 4-minute WebNN timeout. One recording per batch runs with automatic selection, to show the fallback really happens.

### Caching the browser model

Chromium's Cache API refused the 2 GB weight shards in Playwright's ephemeral profiles ("Unable to add response to browser cache"), so each new profile downloads the weights again. Recordings serve them from a local mirror (`storyboards/scenes/serve.mjs`, `/models/`), which makes that quick. A normal Chrome profile has a much larger quota, but this was not verified here.

## Model behaviour (first observations, before the storyboard loop)

- Tool-call syntax is reliable. No unparseable `<|tool_call>` blocks appeared in the first 20 requests, and Gemma's own `<|"|>` string quoting round-trips.
- It fills required arguments well, but sometimes picks plausible-but-wrong values. Asked to chart Budget vs Actual, it charted `A2:C5`, leaving out the header row; in the raw benchmark it also overwrote the table with flattened values before charting. `insert_chart` now rejects a range whose first row is numbers and names the corrected range.
- It occasionally ends a turn with no text and no tool call in the middle of a task (about 1 in 10 multi-step runs at temperature 1.0). The harness drops the empty reply and resamples, at most twice per run, and counts it as `emptyTurns`.
- It sometimes splits a list into one call per item, each replacing the last, then corrects itself with a final call that has every item.
- It sometimes opens a thought channel (`<|channel>thought`) even though thinking is off. The panel shows it collapsed as "Thinking".

The storyboard pass rates and failure analysis follow in the sections below.
