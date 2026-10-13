// Benchmarks Gemma 4 E4B on llama.cpp (the Electron backend) with a real
// tool-calling prompt rendered by the official chat template.
//   node scripts/ai-bench-llama.mjs [path/to/model.gguf]
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Template } from "@huggingface/jinja";
import { getLlama } from "node-llama-cpp";

const modelPath =
  process.argv[2] ??
  process.env.SUITELEAF_MODEL_PATH ??
  join(homedir(), ".cache/suiteleaf-models/gguf/gemma-4-E4B-it-Q4_0.gguf");
const template = new Template(
  readFileSync(new URL("../apps/web/src/ai/gemma4-chat-template.jinja", import.meta.url), "utf8"),
);
const tools = [
  {
    type: "function",
    function: {
      name: "set_values",
      description: "Write values or formulas into spreadsheet cells.",
      parameters: {
        type: "object",
        properties: {
          range: { type: "string", description: "A1-style range such as B2:C3" },
          values: { type: "array", items: { type: "array", items: { type: "string" } } },
        },
        required: ["range", "values"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "insert_chart",
      description: "Insert a chart from a range that includes its header row.",
      parameters: {
        type: "object",
        properties: {
          range: { type: "string" },
          type: { type: "string", enum: ["column", "line", "pie", "scatter"] },
          title: { type: "string" },
        },
        required: ["range", "type"],
      },
    },
  },
];
const prompt = template.render({
  messages: [
    { role: "system", content: "You are an assistant inside a spreadsheet app. Use the tools to make changes." },
    {
      role: "user",
      content:
        "Sheet: A1:D6 holds Category, Budget, Actual, Remaining for Design, Engineering, Marketing, Operations, Total.\n\nMake a column chart of budget vs actual by team titled Studio costs by team.",
    },
  ],
  tools,
  bos_token: "<bos>",
  add_generation_prompt: true,
});

const t0 = performance.now();
const llama = await getLlama();
const model = await llama.loadModel({ modelPath });
const context = await model.createContext({ contextSize: 16384, swaFullCache: true });
const sequence = context.getSequence();
const loadMs = performance.now() - t0;
const tokens = model.tokenize(prompt, true);

async function run(label, prefixTokens, maxTokens) {
  const started = performance.now();
  await sequence.adaptStateToTokens(prefixTokens, false);
  const cached = Math.min(sequence.nextTokenIndex, prefixTokens.length - 1);
  if (sequence.nextTokenIndex > cached)
    await sequence.eraseContextTokenRanges([{ start: cached, end: sequence.nextTokenIndex }]);
  let first = 0;
  const out = [];
  for await (const token of sequence.evaluate(prefixTokens.slice(cached), {
    temperature: 1,
    topK: 64,
    topP: 0.95,
    yieldEogToken: true,
  })) {
    if (!first) first = performance.now();
    out.push(token);
    if (model.isEogToken(token) || out.length >= maxTokens) break;
  }
  const end = performance.now();
  const text = model.detokenize(out, true);
  console.log(
    JSON.stringify({
      label,
      promptTokens: prefixTokens.length,
      cached,
      promptMs: Math.round(first - started),
      promptTokPerS: Math.round(((prefixTokens.length - cached) / (first - started)) * 1000),
      outputTokens: out.length,
      genTokPerS: Math.round(((out.length - 1) / (end - first)) * 1000),
    }),
  );
  return { text, out };
}

console.log(JSON.stringify({ gpu: llama.gpu, loadMs: Math.round(loadMs), promptTokens: tokens.length }));
const first = await run("tool call (cold)", tokens, 256);
console.log("OUTPUT:", first.text);
const followUp = model.tokenize(
  prompt +
    first.text.replace(/(<\|tool_response>|<eos>|<turn\|>)$/, "") +
    '<|tool_response>response:insert_chart{value:<|"|>Inserted a column chart "Studio costs by team" from A1:C5.<|"|>}<tool_response|>',
  true,
);
const second = await run("after tool result (warm cache)", followUp, 256);
console.log("OUTPUT:", second.text);
const long = model.tokenize(prompt.replace("Make a column chart", "Write a 300 word essay about budgets instead of using tools, then make a column chart"), true);
await sequence.clearHistory();
await run("long generation", long, 400);
