// First reply to each AI storyboard request, greedy, so the quant is the only
// difference. Q4_K_M is the reference. Q3_K_M is the smaller file the browser
// can map. The prompt is the storyboard's own wording plus FrogNano's system
// prompt and the tool names and descriptions.
//   node scripts/ai-bench-storyboards.mjs
//   node scripts/ai-bench-storyboards.mjs --tokenize
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Template } from "@huggingface/jinja";
import { getLlama } from "node-llama-cpp";

const root = new URL("..", import.meta.url).pathname;
const gguf = join(homedir(), ".cache/suiteleaf-models/gguf");
const q4 = join(gguf, "FrogNano-4B-2609-Q4_K_M.gguf");
const q3 = join(gguf, "FrogNano-4B-2609-Q3_K_M.gguf");
const maxTokens = Number(process.env.BENCH_TOKENS ?? 512);
const outPath = join(root, "test-results/ai-bench-storyboards.json");
const log = (...a) => console.error(...a);

const agentSrc = readFileSync(join(root, "apps/web/src/ai/agent.ts"), "utf8");
const system =
  sliceBetween(agentSrc, "export const SYSTEM_PROMPT = `", "`;") +
  sliceBetween(agentSrc, "const FROG_PROMPT = `", "`;");
const template = new Template(readFileSync(join(root, "apps/web/src/ai/frognano-chat-template.jinja"), "utf8"));
const tools = toolCatalog();
const requests = storyboardRequests();

function sliceBetween(source, start, end) {
  const at = source.indexOf(start);
  if (at < 0) throw new Error(`Missing ${start}`);
  const from = at + start.length;
  const to = source.indexOf(end, from);
  return source.slice(from, to);
}

function toolCatalog() {
  const dir = join(root, "apps/web/src/ai/tools");
  const found = new Map();
  const visit = (path) => {
    for (const name of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, name.name);
      if (name.isDirectory()) visit(file);
      else if (name.name.endsWith(".ts")) collectTools(readFileSync(file, "utf8"), found);
    }
  };
  visit(dir);
  return [...found.entries()].map(([name, description]) => ({
    type: "function",
    function: { name, description, parameters: { type: "object", properties: {} } },
  }));
}

function collectTools(source, found) {
  const re = /name:\s*"([a-z][a-z0-9_]*)"/g;
  let match;
  while ((match = re.exec(source))) {
    const window = source.slice(match.index, match.index + 800);
    const description = /description:\s*(?:"((?:\\.|[^"\\])*)"|`((?:\\.|[^`\\])*)`)/.exec(window);
    const text = (description?.[1] ?? description?.[2] ?? "").replace(/\\n/g, " ").replace(/\\"/g, '"');
    if (text && !found.has(match[1])) found.set(match[1], text.split(/(?<=\.)\s/)[0].slice(0, 220));
  }
}

function storyboardRequests() {
  const dir = join(root, "storyboards/scenes/ai");
  const rows = [];
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".ts")).sort()) {
    const source = readFileSync(join(dir, name), "utf8");
    const constants = constStrings(source);
    const re = /askAgent\s*\(\s*[\w.]+\s*,/g;
    let match;
    let step = 0;
    while ((match = re.exec(source))) {
      const expr = readExpression(source, match.index + match[0].length);
      const text = expr.kind === "string" ? expr.value : constants.get(expr.value);
      step += 1;
      if (!text) continue;
      rows.push({ id: `${name.replace(/\.spec\.ts$/, "")}#${step}`, file: name, text });
    }
  }
  return rows;
}

function constStrings(source) {
  const found = new Map();
  const re = /const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/g;
  let match;
  while ((match = re.exec(source))) {
    const expr = readExpression(source, match.index + match[0].length);
    if (expr.kind === "string") found.set(match[1], expr.value);
  }
  return found;
}

/** A string literal, a chain of them joined by +, or a bare name. */
function readExpression(source, index) {
  let i = index;
  let value = "";
  let kind = "";
  const skip = () => {
    while (i < source.length && /\s/.test(source[i])) i += 1;
  };
  for (;;) {
    skip();
    const part = readAtom(source, i);
    if (!part) return { kind: kind || "name", value, end: i };
    if (part.kind === "name" && kind === "string") return { kind, value, end: i };
    if (part.kind === "name") return part;
    kind = "string";
    value += part.value;
    i = part.end;
    skip();
    if (source[i] !== "+") return { kind, value, end: i };
    i += 1;
  }
}

function readAtom(source, index) {
  const quote = source[index];
  if (quote !== '"' && quote !== "'" && quote !== "`") {
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(index));
    return name ? { kind: "name", value: name[0], end: index + name[0].length } : null;
  }
  if (quote === "`" && source.slice(index).includes("${")) return null;
  let value = "";
  for (let i = index + 1; i < source.length; i += 1) {
    if (source[i] === "\\") {
      const next = source[i + 1];
      value += next === "n" ? "\n" : next === "t" ? "\t" : next;
      i += 1;
      continue;
    }
    if (source[i] === quote) return { kind: "string", value, end: i + 1 };
    value += source[i];
  }
  return null;
}

function render(text) {
  return template.render({
    messages: [
      { role: "system", content: system },
      { role: "user", content: text },
    ],
    tools,
    add_generation_prompt: true,
  });
}

const firstCall = (text) => /<function=([\w.-]+)>/.exec(text)?.[1] ?? null;

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const agree = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
};

async function runModel(modelPath, prompts) {
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath });
  const context = await model.createContext({ contextSize: 8192, swaFullCache: true });
  const sequence = context.getSequence();
  const rows = [];
  for (const request of requests) {
    const prompt = render(request.text);
    const ids = model.tokenize(prompt, true);
    if (ids.length + maxTokens > 8192) {
      rows.push({ id: request.id, skipped: "prompt too long", promptTokens: ids.length });
      continue;
    }
    if (process.argv.includes("--tokenize")) {
      rows.push({ id: request.id, promptTokens: ids.length });
      continue;
    }
    await sequence.clearHistory();
    const started = performance.now();
    let firstAt = 0;
    const generated = [];
    let text = "";
    for await (const token of sequence.evaluate(ids, { temperature: 0, yieldEogToken: true })) {
      if (!firstAt) firstAt = performance.now();
      generated.push(token);
      text = model.detokenize(generated, true);
      if (model.isEogToken(token) || text.includes("</tool_call>") || text.includes("<|im_end|>") || generated.length >= maxTokens)
        break;
    }
    const ended = performance.now();
    const promptMs = Math.round((firstAt || ended) - started);
    const generateMs = Math.round(ended - (firstAt || ended));
    rows.push({
      id: request.id,
      promptTokens: ids.length,
      outputTokens: generated.length,
      promptMs,
      generateMs,
      genTokPerS: generateMs ? Math.round(((generated.length - 1) / generateMs) * 1000) : 0,
      tool: firstCall(text),
      text,
    });
    log(`${request.id} ${rows.at(-1).tool ?? "—"} ${rows.at(-1).outputTokens} tok`);
  }
  await context.dispose();
  await model.dispose();
  return rows;
}

log(`${requests.length} storyboard requests, ${tools.length} tools`);
if (process.argv.includes("--list")) {
  for (const request of requests) log(`${request.id}: ${request.text.slice(0, 80)}`);
  process.exit(0);
}

const prompts = requests.map((request) => ({ ...request, prompt: render(request.text) }));
const models = [
  ["q4", q4],
  ["q3", q3],
].filter(([, path]) => process.argv.includes("--tokenize") || path === q4 || !process.argv.includes("--q4-only"));

const result = { requests: requests.length, tools: tools.length, maxTokens, models: {} };
for (const [name, path] of process.argv.includes("--tokenize") ? [["q4", q4]] : models) {
  if (name === "q3" && process.argv.includes("--q4-only")) continue;
  log(`loading ${name}`);
  result.models[name] = await runModel(path, prompts);
}

if (result.models.q4 && result.models.q3 && !process.argv.includes("--tokenize")) {
  const paired = result.models.q4.map((row, i) => ({ q4: row, q3: result.models.q3[i] })).filter((row) => row.q4.text && row.q3.text);
  const sameTool = paired.filter((row) => row.q4.tool && row.q4.tool === row.q3.tool);
  const q4Called = paired.filter((row) => row.q4.tool);
  result.summary = {
    compared: paired.length,
    skipped: result.models.q4.filter((row) => row.skipped).length,
    q4Called: q4Called.length,
    sameFirstTool: sameTool.length,
    sameFirstToolOfCalled: q4Called.length ? sameTool.length / q4Called.length : 0,
    q3MissedCall: paired.filter((row) => row.q4.tool && !row.q3.tool).length,
    differentTool: paired.filter((row) => row.q4.tool && row.q3.tool && row.q4.tool !== row.q3.tool).length,
    medianAgreeChars: median(paired.map((row) => agree(row.q4.text, row.q3.text))),
    q4: speed(result.models.q4),
    q3: speed(result.models.q3),
  };
  log(JSON.stringify(result.summary, null, 2));
}

if (process.argv.includes("--tokenize")) {
  const counts = result.models.q4.map((row) => row.promptTokens);
  log(JSON.stringify({ requests: counts.length, min: Math.min(...counts), median: median(counts), max: Math.max(...counts) }));
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 1));
  log(`wrote ${outPath}`);
}

function speed(rows) {
  const done = rows.filter((row) => row.generateMs);
  return {
    medianGenTokPerS: median(done.map((row) => row.genTokPerS)),
    medianPromptMs: median(done.map((row) => row.promptMs)),
    medianOutputTokens: median(done.map((row) => row.outputTokens)),
  };
}
