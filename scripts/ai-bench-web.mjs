// Benchmarks Gemma 4 E4B in Chromium (the web backend) on WebNN and WebGPU,
// using the app's own backend and prompt code from a running Vite dev server.
//   npm run dev -w @suiteleaf/web -- --port 5190
//   node storyboards/scenes/serve.mjs 4790   # serves ~/.cache/suiteleaf-models at /models/
//   node scripts/ai-bench-web.mjs [webnn-gpu|webgpu|auto ...]
import { chromium } from "@playwright/test";

const app = process.env.BENCH_APP ?? "http://127.0.0.1:5190/";
const models = process.env.BENCH_MODELS ?? "http://127.0.0.1:4790/models/";
const devices = process.argv.slice(2).length ? process.argv.slice(2) : ["webnn-gpu", "webgpu"];

for (const device of devices) {
  const browser = await chromium.launch({
    channel: "chromium",
    args: ["--enable-features=WebMachineLearningNeuralNetwork", "--enable-unsafe-webgpu"],
  });
  const page = await browser.newPage();
  page.on("console", (m) => {
    const text = m.text();
    if (/suiteleaf-ai|error|warn/i.test(text)) console.log(`  [${device} console] ${text.slice(0, 400)}`);
  });
  page.on("pageerror", (e) => console.log(`  [${device} pageerror] ${e.message}`));
  page.on("crash", () => console.log(`  [${device}] renderer crashed`));
  page.on("worker", (w) => w.on("close", () => console.log(`  [${device}] worker closed`)));
  await page.goto(new URL("icon.svg", app).toString());
  const result = await page.evaluate(
    async ({ device, models }) => {
      localStorage.setItem("suiteleaf.ai.modelHost", models);
      if (device === "auto") localStorage.removeItem("suiteleaf.ai.device");
      else localStorage.setItem("suiteleaf.ai.device", device);
      const { localModel } = await import("/src/ai/backend.ts");
      const { renderSystem } = await import("/src/ai/gemma.ts");
      const model = localModel();
      model.onStatus((s) => console.log(`[suiteleaf-ai] status ${s.state} ${Math.round((s.progress ?? 0) * 100)}% ${s.message ?? ""}`));
      const t0 = performance.now();
      const status = await model.load();
      const loadMs = Math.round(performance.now() - t0);
      if (status.state !== "ready") return { device, status, loadMs };
      const tools = [
        {
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
      ];
      const prompt =
        renderSystem("You are an assistant inside a spreadsheet app. Use the tools to make changes.", tools) +
        "<|turn>user\nSheet: A1:D6 holds Category, Budget, Actual, Remaining for Design, Engineering, Marketing, Operations, Total.\n\nMake a column chart of budget vs actual by team titled Studio costs by team.<turn|>\n<|turn>model\n";
      const run = (prompt, maxTokens) =>
        new Promise((done) => {
          let text = "";
          const started = performance.now();
          model.generate(
            { prompt, maxTokens, stop: ["<turn|>", "<|tool_response>", "<eos>"], temperature: 1, topK: 64, topP: 0.95 },
            (event) => {
              if (event.type === "text") text += event.text;
              else done({ ...event, text, wallMs: Math.round(performance.now() - started) });
            },
          );
        });
      const first = await run(prompt, 200);
      const second = first.type === "done"
        ? await run(
            prompt +
              first.text.replace(/(<\|tool_response>|<eos>|<turn\|>)$/, "") +
              '<|tool_response>response:insert_chart{value:<|"|>Inserted a column chart.<|"|>}<tool_response|>',
            100,
          )
        : null;
      return { device, status, loadMs, first, second };
    },
    { device, models },
  );
  const rate = (r) =>
    r && r.type === "done"
      ? {
          promptTokens: r.promptTokens,
          cached: r.cachedTokens,
          promptMs: r.promptMs,
          promptTokPerS: Math.round(((r.promptTokens - r.cachedTokens) / r.promptMs) * 1000),
          outputTokens: r.outputTokens,
          genTokPerS: Math.round((r.outputTokens / Math.max(1, r.generateMs)) * 1000),
          reason: r.reason,
          text: r.text,
        }
      : r;
  console.log(
    JSON.stringify(
      { device, loadMs: result.loadMs, status: result.status, first: rate(result.first), second: rate(result.second) },
      null,
      1,
    ),
  );
  await browser.close();
}
