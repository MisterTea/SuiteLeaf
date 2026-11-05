/**
 * Office compatibility run (WP-012).
 *
 *   npm run test:office-compat                 # generated fixtures, Microsoft Office as reference
 *   npm run test:office-compat -- --reference=libreoffice
 *   npm run test:office-compat -- --no-reference
 *   npm run test:office-compat -- --force      # ignore saved results
 *
 * Results are appended to datasets/validation/office-compat/results.jsonl.
 * A result is reused only when the converter fingerprint, the fixture spec,
 * and the reference application are unchanged, so an interrupted run resumes
 * where it stopped. The manifest and summary are written beside it. The exit
 * code is 1 when a supported fixture has a release-blocking difference.
 */
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { FIXTURE_SPECS, generateFixture } from "../packages/core/src/compat/fixtures";
import { libreOfficeReference, libreOfficeVersion } from "../packages/core/src/compat/libreoffice";
import { msOfficeReference, msOfficeVersion } from "../packages/core/src/compat/msoffice";
import type { CompatFormat, ReferenceResult } from "../packages/core/src/compat/types";
import { blockingIssues, isCurrent, summaryMarkdown, unusedTolerated } from "../packages/core/src/compat/report";
import { runCompatCase } from "../packages/core/src/compat/sequence";
import type { CompatResult } from "../packages/core/src/compat/types";
// @ts-expect-error The report helper is plain JavaScript.
import { converterRevision, parseReport } from "./office-roundtrip-report.mjs";

const root = resolve(import.meta.dirname, "..");
const out = resolve(root, "datasets/validation/office-compat");
const args = new Set(process.argv.slice(2));

async function fingerprint(reference: string): Promise<string> {
  const hash = createHash("sha256").update(await converterRevision(root)).update(reference);
  const dir = resolve(root, "packages/core/src/compat");
  for (const name of (await readdir(dir)).sort()) hash.update(await readFile(resolve(dir, name)));
  return hash.digest("hex").slice(0, 16);
}

await mkdir(out, { recursive: true });
// Microsoft Office opens files only from folders it was granted. This folder needs that one-time grant.
const officeDir = resolve(out, "msoffice");
await mkdir(officeDir, { recursive: true });
const wanted = args.has("--no-reference")
  ? "none"
  : ([...args].find((a) => a.startsWith("--reference="))?.slice("--reference=".length) ?? "msoffice");

async function chooseReference(): Promise<{ name: string; run?: (bytes: Uint8Array, format: CompatFormat) => Promise<ReferenceResult> }> {
  if (wanted === "msoffice") {
    const versions = await Promise.all((["docx", "xlsx", "pptx"] as const).map((f) => msOfficeVersion(f)));
    if (versions.every(Boolean)) return { name: versions.join(", "), run: (bytes, format) => msOfficeReference(bytes, format, { dir: officeDir }) };
    process.stderr.write("Microsoft Office could not be reached; using LibreOffice.\n");
  }
  if (wanted === "msoffice" || wanted === "libreoffice") {
    const version = await libreOfficeVersion();
    if (version) return { name: version, run: (bytes, format) => libreOfficeReference(bytes, format) };
  }
  return { name: "none" };
}
const chosen = await chooseReference();
const reference = chosen.name;
const print = await fingerprint(reference);
const saved: CompatResult[] = args.has("--force")
  ? []
  : parseReport(await readFile(resolve(out, "results.jsonl"), "utf8").catch(() => ""));
const results: CompatResult[] = [];
const manifest = [];
for (const spec of FIXTURE_SPECS) {
  const fixture = await generateFixture(spec);
  manifest.push({
    id: spec.id,
    format: spec.format,
    generator: spec.generator,
    license: "Generated in this repository; no third-party document content.",
    classification: spec.classification,
    features: spec.features,
    probes: spec.probes,
    specHash: fixture.specHash,
    sha256: fixture.sha256,
    bytes: fixture.bytes.length,
  });
  const previous = saved.filter((r) => r.fixture === spec.id && isCurrent(r, print, fixture.specHash)).at(-1);
  if (previous) {
    results.push(previous);
    process.stderr.write(`${spec.id}: reused\n`);
    continue;
  }
  const result = await runCompatCase(
    { id: spec.id, format: spec.format, bytes: fixture.bytes, sha256: fixture.sha256, specHash: fixture.specHash, probes: spec.probes },
    {
      fingerprint: print,
      reference: chosen.run,
    },
  );
  await appendFile(resolve(out, "results.jsonl"), `${JSON.stringify(result)}\n`);
  results.push(result);
  process.stderr.write(`${spec.id}: ${result.outcome}, reference ${result.reference.status}\n`);
}
const summary = [
  `# Office compatibility run`,
  "",
  `Fingerprint ${print}. Reference: ${reference}.`,
  "",
  summaryMarkdown(results, FIXTURE_SPECS),
  ...unusedTolerated(results).map((entry) => `\nTolerated entry no longer needed: ${entry.fixture} ${entry.dimension} (${entry.owner}).`),
].join("\n");
await writeFile(resolve(out, "manifest.json"), `${JSON.stringify({ fingerprint: print, reference, fixtures: manifest }, null, 2)}\n`);
await writeFile(resolve(out, "summary.md"), `${summary}\n`);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
process.stdout.write(`${summary}\n`);
process.exitCode = blockingIssues(results, FIXTURE_SPECS).length ? 1 : 0;
