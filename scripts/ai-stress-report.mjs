// Summarize AI storyboard stress runs (test-results/ai-metrics/runs/<tag>/*.json)
// as Markdown tables: pass rate per storyboard and per app, and the agent's
// behaviour (tool errors, unreadable calls, empty replies, speed) per backend.
//   node scripts/ai-stress-report.mjs [tag ...]
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "test-results/ai-metrics/runs");
const tags = process.argv.slice(2).length ? process.argv.slice(2) : existsSync(root) ? readdirSync(root) : [];
const app = (title) => {
  const n = Number(title.slice(0, 2));
  return n <= 8 ? "Docs & files" : n <= 19 ? "Sheets" : n <= 21 ? "Slides" : "Server (cluster)";
};
const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) ?? 0), 0);
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "–");

const byTag = {};
for (const tag of tags) {
  const dir = join(root, tag);
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const data = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const title = data.title.replace(/-ai$/, "");
    (byTag[tag] ??= {})[title] ??= [];
    byTag[tag][title].push(data);
  }
}

const titles = [...new Set(Object.values(byTag).flatMap((t) => Object.keys(t)))].sort();
console.log(`### Pass rate per storyboard\n`);
console.log(`| Storyboard | ${tags.join(" | ")} |`);
console.log(`| --- | ${tags.map(() => "---").join(" | ")} |`);
for (const title of titles)
  console.log(
    `| ${title} | ${tags
      .map((tag) => {
        const runs = byTag[tag]?.[title];
        if (!runs) return "–";
        return `${runs.filter((r) => r.status === "passed").length}/${runs.length}`;
      })
      .join(" | ")} |`,
  );

console.log(`\n### Pass rate per app\n`);
const apps = [...new Set(titles.map(app))];
console.log(`| App | ${tags.join(" | ")} |`);
console.log(`| --- | ${tags.map(() => "---").join(" | ")} |`);
for (const a of apps)
  console.log(
    `| ${a} | ${tags
      .map((tag) => {
        const runs = Object.entries(byTag[tag] ?? {})
          .filter(([t]) => app(t) === a)
          .flatMap(([, r]) => r);
        const passed = runs.filter((r) => r.status === "passed").length;
        return runs.length ? `${passed}/${runs.length} (${pct(passed, runs.length)})` : "–";
      })
      .join(" | ")} |`,
  );

console.log(`\n### Agent behaviour per backend\n`);
console.log(
  "| Run | Storyboard runs | Passed | Requests | Tool calls | Tool errors | Unreadable calls | Unknown tools | Repeated calls blocked | Empty replies retried | Output tok/s | Prompt tok/s | Median time per user prompt |",
);
console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const tag of tags) {
  const runs = Object.values(byTag[tag] ?? {}).flat();
  const agentRuns = runs.flatMap((r) => r.runs ?? []);
  const m = agentRuns.map((r) => r.metrics ?? {});
  const seconds = agentRuns.map((r) => r.seconds).sort((a, b) => a - b);
  const median = seconds.length ? seconds[Math.floor(seconds.length / 2)] : 0;
  const passed = runs.filter((r) => r.status === "passed").length;
  console.log(
    `| ${tag} | ${runs.length} | ${passed} (${pct(passed, runs.length)}) | ${sum(m, (x) => x.requests)} | ${sum(m, (x) => x.toolCalls)} | ${sum(m, (x) => x.toolErrors)} | ${sum(m, (x) => x.parseErrors)} | ${sum(m, (x) => x.unknownTools)} | ${sum(m, (x) => x.repeatedCalls)} | ${sum(m, (x) => x.emptyTurns)} | ${Math.round((sum(m, (x) => x.outputTokens) / Math.max(1, sum(m, (x) => x.generateMs))) * 1000)} | ${Math.round(((sum(m, (x) => x.promptTokens) - sum(m, (x) => x.cachedTokens)) / Math.max(1, sum(m, (x) => x.promptMs))) * 1000)} | ${median}s |`,
  );
}

console.log(`\n### Failed runs\n`);
for (const tag of tags)
  for (const [title, runs] of Object.entries(byTag[tag] ?? {}))
    for (const r of runs.filter((x) => x.status !== "passed"))
      console.log(
        `- **${tag} · ${title}**: ${(r.error ?? r.status ?? "no outcome").replace(/\s+/g, " ").slice(0, 300)} Tools: ${(r.runs ?? []).map((x) => (x.metrics?.tools ?? []).join(", ") || "none").join(" / ")}.`,
      );
