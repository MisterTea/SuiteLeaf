// Compares backends on real agent prompts with greedy decoding, so sampling
// plays no part: llama.cpp Q8_0 (the reference), llama.cpp 4-bit, and the
// browser's WebGPU q4f16, the last both with and without its cache reuse.
// Prompts come from a capture run (STORYBOARD_AI_CAPTURE=1). FIDELITY_MODEL
// picks the model (gemma-4-e4b, or frognano-4b with its Q4_K_M build).
//   npm run dev -w @suiteleaf/web -- --port 5190
//   node storyboards/scenes/serve.mjs 4790
//   node scripts/ai-fidelity.mjs test-results/ai-metrics/runs/capture-gemma > fidelity.json
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { getLlama } from "node-llama-cpp";

const dir = process.argv[2];
const tokens = Number(process.env.FIDELITY_TOKENS ?? 48);
const gguf = join(homedir(), ".cache/suiteleaf-models/gguf");
const app = process.env.BENCH_APP ?? "http://127.0.0.1:5190/";
const models = process.env.BENCH_MODELS ?? "http://127.0.0.1:4790/models/";
const log = (...a) => console.error(...a);
const modelId = process.env.FIDELITY_MODEL ?? "gemma-4-e4b";
const setup = {
  "gemma-4-e4b": {
    q8: "gemma-4-E4B-it-Q8_0.gguf",
    q4: "gemma-4-E4B-it-Q4_0.gguf",
    stop: ["<turn|>", "<|tool_response>", "<eos>"],
    reset: "<bos><|turn>user\nHi<turn|>\n<|turn>model\n",
    call: /<\|tool_call>call:([\w.-]+)(\{[\s\S]*?\})<tool_call\|>/,
  },
  "frognano-4b": {
    q8: "FrogNano-4B-2609-Q8_0.gguf",
    q4: "FrogNano-4B-2609-Q4_K_M.gguf",
    stop: ["<|im_end|>", "<|endoftext|>"],
    reset: "<|im_start|>user\nHi<|im_end|>\n<|im_start|>assistant\n",
    call: /<function=([\w.-]+)>([\s\S]*?)<\/function>/,
  },
}[modelId];

/** Prompts in the order each run made them; later ones extend earlier ones. */
const runs = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const data = JSON.parse(readFileSync(join(dir, file), "utf8"));
  // Each askAgent run repeats the earlier prompts; the last run has them all.
  const prompts = data.runs.at(-1)?.prompts ?? [];
  if (prompts.length) runs.push({ title: data.title, prompts });
}
const all = runs.flatMap((r) => r.prompts.map((prompt, i) => ({ title: r.title, step: i, prompt })));
log(`${all.length} prompts from ${runs.length} storyboards`);

async function llamaOutputs(file) {
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath: join(gguf, file) });
  const context = await model.createContext({ contextSize: 32768, swaFullCache: true });
  const sequence = context.getSequence();
  const out = [];
  for (const { prompt } of all) {
    await sequence.clearHistory();
    const ids = model.tokenize(prompt, true);
    const generated = [];
    for await (const token of sequence.evaluate(ids, { temperature: 0, yieldEogToken: true })) {
      generated.push(token);
      if (model.isEogToken(token) || generated.length >= tokens) break;
    }
    out.push({ ids: ids.length, text: model.detokenize(generated, true) });
  }
  await context.dispose();
  await model.dispose();
  return out;
}

async function browserOutputs() {
  const browser = await chromium.launch({ channel: "chromium", args: ["--enable-unsafe-webgpu"] });
  const page = await browser.newPage();
  await page.goto(new URL("icon.svg", app).toString());
  const result = await page.evaluate(
    async ({ models, all, tokens, modelId, stop, reset }) => {
      localStorage.setItem("suiteleaf.ai.modelHost", models);
      localStorage.setItem("suiteleaf.ai.device", "webgpu");
      localStorage.setItem("suiteleaf.ai.model", modelId);
      const { localModel } = await import("/src/ai/backend.ts");
      const model = localModel();
      const status = await model.load();
      if (status.state !== "ready") return { error: status.message };
      const run = (prompt, maxTokens) =>
        new Promise((done) => {
          let text = "";
          model.generate({ prompt, maxTokens, stop, temperature: 0 }, (e) => {
            if (e.type === "text") text += e.text;
            else done({ ...e, text });
          });
        });
      const inOrder = [];
      for (const { prompt } of all) inOrder.push(await run(prompt, tokens));
      const fresh = [];
      for (const { prompt } of all) {
        await run(reset, 1); // drops the cache
        fresh.push(await run(prompt, tokens));
      }
      return { inOrder, fresh };
    },
    { models, all, tokens, modelId, stop: setup.stop, reset: setup.reset },
  );
  await browser.close();
  return result;
}

const firstCall = (text) => setup.call.exec(text)?.slice(1, 3).join("") ?? null;
/** Characters the two outputs share from the start. */
const agree = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

log("llama.cpp Q8_0…");
const q8 = await llamaOutputs(setup.q8);
log(`llama.cpp ${setup.q4}…`);
const q4 = await llamaOutputs(setup.q4);
log("browser q4f16…");
const web = await browserOutputs();
if (web.error) throw new Error(web.error);

const rows = all.map((p, i) => {
  const ref = q8[i].text;
  const entry = (text) => ({ same: text === ref, sameCall: firstCall(text) === firstCall(ref), agreeChars: agree(text, ref) });
  return {
    title: p.title,
    step: p.step,
    promptTokens: q8[i].ids,
    browserPromptTokens: web.fresh[i].promptTokens,
    browserCachedTokens: web.inOrder[i].cachedTokens,
    q4: entry(q4[i].text),
    webCached: entry(web.inOrder[i].text),
    webFresh: entry(web.fresh[i].text),
    webCacheMatchesFresh: web.inOrder[i].text === web.fresh[i].text,
    texts: { q8: ref, q4: q4[i].text, webCached: web.inOrder[i].text, webFresh: web.fresh[i].text },
  };
});
const share = (f) => `${rows.filter(f).length}/${rows.length}`;
const summary = {
  prompts: rows.length,
  sameAsQ8: { q4: share((r) => r.q4.same), webFresh: share((r) => r.webFresh.same), webCached: share((r) => r.webCached.same) },
  sameFirstCallAsQ8: {
    q4: share((r) => r.q4.sameCall),
    webFresh: share((r) => r.webFresh.sameCall),
    webCached: share((r) => r.webCached.sameCall),
  },
  webCacheMatchesFresh: share((r) => r.webCacheMatchesFresh),
  tokenCountsMatch: share((r) => r.promptTokens === r.browserPromptTokens),
};
process.stdout.write(`\n${JSON.stringify({ summary, rows }, null, 1)}\n`);
log(JSON.stringify(summary, null, 1));
