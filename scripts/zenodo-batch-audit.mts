import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, basename, posix } from "node:path";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { parsePowerPoint } from "../packages/core/src/pptx.ts";
import { exportPptx } from "../packages/core/src/pptx-export.ts";
import { scanOfficePackage } from "../packages/core/src/roundtrip-scan.ts";

const root =
  process.env.ZENODO_ROOT || "/Users/jjg/GauciNAS/Datasets/zenodo10k";
const batch = Number(process.argv[2] || 1);
if (!Number.isInteger(batch) || batch < 1)
  throw Error("Batch must be a positive integer");
const manifest = JSON.parse(
  await readFile(join(root, "metadata/upstream-tree.json"), "utf8"),
);
const paths = manifest.entries
  .filter((e: any) => e.type === "file" && /\.pptx$/i.test(e.path))
  .map((e: any) => e.path)
  .sort();
const selected = paths.slice((batch - 1) * 10, batch * 10);
const out = join(
  root,
  "audit",
  `batch-${String(batch).padStart(4, "0")}${process.env.ZENODO_AUDIT_SUFFIX || ""}`,
);
await mkdir(out, { recursive: true });
await writeFile(join(out, "manifest.json"), JSON.stringify(selected, null, 2));
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });
function text(xml: string) {
  return [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
    .map((m) => String(parser.parse(`<v>${m[1]}</v>`).v ?? ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
async function inventory(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const files = Object.keys(zip.files)
    .filter((n) => !zip.files[n].dir)
    .sort();
  const slides: any[] = [];
  const notes: any[] = [];
  const assets: any[] = [];
  let relationships = 0;
  for (const name of files) {
    if (
      /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/.test(name)
    ) {
      const xml = await zip.file(name)!.async("string");
      const row = {
        name,
        text: text(xml),
        images: (xml.match(/<p:pic[\s>]/g) || []).length,
        tables: (xml.match(/<a:tbl[\s>]/g) || []).length,
        charts: (xml.match(/<c:chart[\s>]/g) || []).length,
      };
      (/^ppt\/slides\//.test(name) ? slides : notes).push(row);
    }
    if (/\.rels$/.test(name))
      relationships += (
        (await zip.file(name)!.async("string")).match(/<Relationship[\s>]/g) ||
        []
      ).length;
    if (/^ppt\/(media|embeddings)\//.test(name))
      assets.push({
        name,
        sha256: hash(await zip.file(name)!.async("uint8array")),
      });
  }
  const presentation = zip.file("ppt/presentation.xml");
  const relsFile = zip.file("ppt/_rels/presentation.xml.rels");
  if (presentation && relsFile) {
    const rels = new Map(
      [
        ...(await relsFile.async("string")).matchAll(
          /<Relationship\b([^>]*)\/?>/g,
        ),
      ].map((m) => {
        const attrs = parser.parse(`<x ${m[1]}/>`).x;
        return [attrs["@_Id"], String(attrs["@_Target"] || "")];
      }),
    );
    const order = [
      ...(await presentation.async("string")).matchAll(
        /<p:sldId\b([^>]*)\/?>/g,
      ),
    ].map((m) => {
      const attrs = parser.parse(`<x ${m[1]}/>`).x;
      const target = rels.get(attrs["@_r:id"]) || "";
      return target.startsWith("/")
        ? target.slice(1)
        : posix.normalize(posix.join("ppt", target));
    });
    if (order.length)
      slides.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  }
  return {
    counts: {
      slides: slides.length,
      textCharacters: slides.reduce((n, s) => n + s.text.length, 0),
      images: slides.reduce((n, s) => n + s.images, 0),
      tables: slides.reduce((n, s) => n + s.tables, 0),
      charts: slides.reduce((n, s) => n + s.charts, 0),
      notes: notes.length,
      relationships,
      assets: assets.length,
      parts: files.length,
    },
    slides,
    notes,
    assets,
    parts: files,
  };
}
const results: any[] = [];
for (let i = 0; i < selected.length; i++) {
  const path = selected[i];
  const stem = `${String((batch - 1) * 10 + i + 1).padStart(5, "0")}-${basename(path, ".pptx")}`;
  try {
    const source = await readFile(join(root, "files", path));
    const before = await inventory(source);
    const model = await parsePowerPoint(source, basename(path));
    const exported = await exportPptx(model);
    await writeFile(join(out, `${stem}.pptx`), exported);
    const after = await inventory(exported);
    const beforeText = before.slides
      .flatMap((s) => s.text.split(/\s+/))
      .filter(Boolean);
    const afterWords = new Map<string, number>();
    for (const word of after.slides
      .flatMap((s) => s.text.split(/\s+/))
      .filter(Boolean))
      afterWords.set(word, (afterWords.get(word) || 0) + 1);
    const missingWords: string[] = [];
    for (const word of beforeText) {
      const n = afterWords.get(word) || 0;
      if (n) afterWords.set(word, n - 1);
      else missingWords.push(word);
    }
    const afterHashes = new Set(after.assets.map((a) => a.sha256));
    const missingAssets = before.assets.filter(
      (a) => !afterHashes.has(a.sha256),
    );
    const charCounts = new Map<string, number>();
    for (const ch of after.slides
      .map((s) => s.text)
      .join("")
      .replace(/\s/g, ""))
      charCounts.set(ch, (charCounts.get(ch) || 0) + 1);
    let missingNonWhitespaceCharacters = 0;
    for (const ch of before.slides
      .map((s) => s.text)
      .join("")
      .replace(/\s/g, "")) {
      const n = charCounts.get(ch) || 0;
      if (n) charCounts.set(ch, n - 1);
      else missingNonWhitespaceCharacters++;
    }
    const orderedTextChangedSlides = before.slides.flatMap((slide, index) =>
      slide.text.replace(/\s/g, "") ===
      after.slides[index]?.text.replace(/\s/g, "")
        ? []
        : [index + 1],
    );
    if (after.slides.length > before.slides.length)
      orderedTextChangedSlides.push(
        ...after.slides
          .slice(before.slides.length)
          .map((_, i) => before.slides.length + i + 1),
      );
    const sourceDigest = await scanOfficePackage(source, "pptx");
    const exportedDigest = await scanOfficePackage(exported, "pptx");
    const differences = Object.keys(before.counts)
      .filter((k) => (before.counts as any)[k] !== (after.counts as any)[k])
      .map((k) => ({
        feature: k,
        before: (before.counts as any)[k],
        after: (after.counts as any)[k],
      }));
    const sourceHashAfter = hash(await readFile(join(root, "files", path)));
    const row = {
      path,
      sourceSha256: hash(source),
      sourceUnchanged: sourceHashAfter === hash(source),
      exportSha256: hash(exported),
      exportFile: `${stem}.pptx`,
      outcome:
        orderedTextChangedSlides.length ||
        missingNonWhitespaceCharacters ||
        missingAssets.length ||
        differences.length
          ? "differences-detected"
          : "no-differences-in-measured-features",
      differences,
      missingNonWhitespaceCharacters,
      orderedTextChangedSlides,
      missingWordCount: missingWords.length,
      missingWordSample: missingWords.slice(0, 100),
      missingAssets,
      sourceDigest,
      exportedDigest,
      before,
      after,
      limitations:
        "Structural/content audit only. Ordered slide text is checked after whitespace normalization. Word/character loss counts are supplementary and ignore order. Equal counts do not prove fidelity. Visual comparison and PowerPoint PDF generation are separate.",
    };
    await writeFile(
      join(out, `${stem}.audit.json`),
      JSON.stringify(row, null, 2),
    );
    results.push({
      path,
      outcome: row.outcome,
      sourceUnchanged: row.sourceUnchanged,
      differences,
      missingNonWhitespaceCharacters,
      orderedTextChangedSlides,
      missingWordCount: missingWords.length,
      missingAssets: missingAssets.length,
    });
  } catch (e) {
    results.push({ path, outcome: "error", error: String(e) });
  }
  await writeFile(
    join(out, "summary.json"),
    JSON.stringify({ batch, results }, null, 2),
  );
  console.log(JSON.stringify(results.at(-1)));
}
