// Ask the in-app assistant to do something, against the real local model, and
// print the transcript and metrics. For trying prompts and tools by hand.
//   node scripts/ai-try.mjs "Create a document called Notes and write a heading" [--device webgpu] [--shot out.png]
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : fallback;
};
const device = flag("device", "webgpu");
const shot = flag("shot", "/tmp/ai-try.png");
const app = flag("app", "http://127.0.0.1:5190/");
const models = flag("models", "http://127.0.0.1:4790/models/");
const start = flag("start", "");
const prompt = args.join(" ");

const browser = await chromium.launch({
  channel: "chromium",
  args: ["--enable-features=WebMachineLearningNeuralNetwork", "--enable-unsafe-webgpu"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => {
  if (m.type() === "error" || m.text().includes("[suiteleaf-ai]")) console.log("[console]", m.text().slice(0, 300));
});
await page.addInitScript(
  ({ models, device }) => {
    localStorage.setItem("suiteleaf.ai.modelHost", models);
    if (device === "auto") localStorage.removeItem("suiteleaf.ai.device");
    else localStorage.setItem("suiteleaf.ai.device", device);
  },
  { models, device },
);
await page.goto(app + (start ? `#${start}` : ""));
await page.getByRole("button", { name: "AI assistant" }).first().click();
const box = page.getByRole("textbox", { name: "Ask the assistant" });
await box.fill(prompt);
await box.press("Enter");
const started = Date.now();
const show = (item) =>
  item.kind === "tool"
    ? `TOOL ${item.name} ${JSON.stringify(item.args)} -> [${item.status}] ${(item.result ?? "").slice(0, 300)}`
    : `${item.kind.toUpperCase()}: ${item.text}`;
let printed = 0;
let state = "";
for (;;) {
  await page.waitForTimeout(1000);
  const now = await page.evaluate(() => ({
    state: window.__suiteleafAgent?.state(),
    items: window.__suiteleafAgent?.items() ?? [],
    model: document.querySelector(".agent-loading")?.textContent ?? "",
  }));
  if (now.state !== state) console.log(`[${Math.round((Date.now() - started) / 1000)}s] state ${now.state} ${now.model}`);
  state = now.state;
  // Print finished items; the last one may still be streaming.
  const settled = ["done", "error"].includes(now.state) ? now.items.length : now.items.length - 1;
  for (; printed < settled; printed++) console.log(show(now.items[printed]));
  if (["done", "error"].includes(now.state) || Date.now() - started > 20 * 60_000) break;
}
console.log("METRICS", JSON.stringify({ ...(await page.evaluate(() => window.__suiteleafAgent.metrics())), seconds: Math.round((Date.now() - started) / 1000) }));
await page.screenshot({ path: shot });
await browser.close();
