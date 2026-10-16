import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendResults,
  finishedPaths,
  nextPaths,
  parseReport,
} from "../scripts/office-roundtrip-report.mjs";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("office round-trip report", () => {
  it("skips finished rows, retries a truncated line, and refreshes the summary", async () => {
    const dir = await mkdtemp(join(tmpdir(), "suiteleaf-roundtrip-"));
    dirs.push(dir);
    const inventory = [
      { path: "one.docx", sha256: "a", format: "docx" },
      { path: "two.docx", sha256: "b", format: "docx" },
      { path: "three.docx", sha256: "c", format: "docx" },
    ]
      .map((row) => JSON.stringify(row))
      .join("\n");
    await writeFile(
      join(dir, "results.jsonl"),
      `${JSON.stringify({
        path: "one.docx",
        sha256: "a",
        format: "docx",
        converterRevision: "rev",
        outcome: "match",
        expectedRejection: false,
        differences: [],
      })}\n{"path":"two.docx","sha256":"b"`,
    );
    const loaded = parseReport(await readFile(join(dir, "results.jsonl"), "utf8"));
    expect([...finishedPaths(loaded, "rev")]).toEqual(["one.docx"]);
    expect(await nextPaths(inventory, await readFile(join(dir, "results.jsonl"), "utf8"), "rev", 10)).toEqual([
      "two.docx",
      "three.docx",
    ]);
    const summary = await appendResults(
      dir,
      [
        {
          path: "two.docx",
          sha256: "b",
          format: "docx",
          outcome: "diff",
          expectedRejection: false,
          differences: [
            {
              feature: "import.text",
              owner: "suiteleaf",
              description: "Import dropped text on 1 item.",
            },
          ],
        },
      ],
      "rev",
      3,
    );
    expect(summary.finished).toBe(2);
    expect(summary.unfinished).toBe(1);
    expect(summary.features[0]).toMatchObject({
      feature: "import.text",
      owner: "suiteleaf",
      count: 1,
    });
    expect(await nextPaths(inventory, await readFile(join(dir, "results.jsonl"), "utf8"), "rev", 10)).toEqual([
      "three.docx",
    ]);
    expect(await nextPaths(inventory, "", "rev", 10, 1)).toEqual(["two.docx", "three.docx"]);
    expect(await nextPaths(inventory, "", "rev", 1, 2)).toEqual(["three.docx"]);
  });
});
