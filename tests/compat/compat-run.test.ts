import { beforeAll, describe, expect, it } from "vitest";
import type { JsonNode, SheetFile, SlideFile, SuiteFile } from "../../packages/core/src/index";
import { FIXTURE_SPECS, generateFixtures, type Fixture } from "../../packages/core/src/compat/fixtures";
import { TOLERATED, blockingIssues, summaryMarkdown, unusedTolerated } from "../../packages/core/src/compat/report";
import { runCompatCase, type CompatOptions } from "../../packages/core/src/compat/sequence";
import type { CompatResult, Dimension } from "../../packages/core/src/compat/types";

/**
 * The CI gate for WP-012. Generated DOCX, XLSX, and PPTX fixtures go through
 * import, an edit, a native save and reopen, export, and reimport. Without a
 * reference application, layout that only a renderer can see stays
 * `unavailable-reference`, never a pass.
 */

let fixtures: Fixture[];
const run = (fixture: Fixture, options: Partial<CompatOptions> = {}) =>
  runCompatCase(
    { id: fixture.id, format: fixture.format, bytes: fixture.bytes, sha256: fixture.sha256, specHash: fixture.specHash, probes: fixture.probes },
    { fingerprint: "test", ...options },
  );
const byId = (id: string) => fixtures.find((f) => f.id === id)!;
const outcomes = (result: CompatResult) => Object.fromEntries(result.dimensions.map((d) => [d.dimension, d.outcome]));
const lost = (result: CompatResult, dimension: Dimension) =>
  result.dimensions.find((d) => d.dimension === dimension)!.probes.filter((p) => p.lostAt).map((p) => [p.probe.kind, p.lostAt]);

beforeAll(async () => {
  fixtures = await generateFixtures();
}, 60_000);

describe("office compatibility run", () => {
  it("reports each dimension of every generated fixture separately, and nothing blocks a release", async () => {
    const results = await Promise.all(fixtures.map((fixture) => run(fixture)));
    const table = Object.fromEntries(results.map((r) => [r.fixture, outcomes(r)]));
    expect(table).toEqual({
      "docx-report": {
        content: "pass",
        formulas: "not-measured",
        review: "pass",
        objects: "pass",
        fonts: "pass",
        layout: "unavailable-reference",
        media: "pass",
      },
      "xlsx-budget": {
        content: "pass",
        formulas: "pass",
        review: "pass",
        objects: "not-measured",
        fonts: "pass",
        layout: "not-measured",
        media: "not-measured",
      },
      "pptx-plan": {
        content: "pass",
        formulas: "not-measured",
        review: "not-measured",
        objects: "pass",
        fonts: "pass",
        layout: "pass",
        media: "pass",
      },
    });
    for (const result of results) {
      expect(result.outcome).toBe("completed");
      expect(result.reference.status).toBe("unavailable");
    }
    const summary = summaryMarkdown(results, FIXTURE_SPECS);
    expect(blockingIssues(results, FIXTURE_SPECS), summary).toEqual([]);
    expect(unusedTolerated(results)).toEqual([]);
    expect(summary).toContain("no ref");
  }, 60_000);

  it("reports a dropped run font under fonts, blocks it, and accepts it once tolerated with an owner", async () => {
    const plain = (node: JsonNode): JsonNode => ({
      ...node,
      marks: node.marks?.filter((mark) => mark.type !== "textStyle"),
      content: node.content?.map(plain),
    });
    const result = await run(byId("docx-report"), {
      beforeExport: (file: SuiteFile) => ({ ...file, content: plain(file.content as JsonNode) }) as SuiteFile,
    });
    expect(lost(result, "fonts")).toEqual([["font", "export"]]);
    expect(blockingIssues([result], FIXTURE_SPECS)).toEqual([{ fixture: "docx-report", reason: "fonts loss: font lost at export" }]);
    const tolerated = [{ fixture: "docx-report", dimension: "fonts" as const, owner: "WP-014", limitation: "x", documentedIn: "docs/office-imports.md" }];
    expect(blockingIssues([result], FIXTURE_SPECS, tolerated)).toEqual([]);
    expect(summaryMarkdown([result], FIXTURE_SPECS, tolerated)).toContain("LOSS (tolerated)");
    expect(TOLERATED).toEqual([]);
  }, 60_000);

  it("reports a lost formula under formulas", async () => {
    const result = await run(byId("xlsx-budget"), {
      beforeExport: (file: SuiteFile) => {
        const book = (file as SheetFile).content.workbook as { sheets: Record<string, { cellData: Record<string, Record<string, { f?: string }>> }> };
        delete book.sheets["sheet-1"]!.cellData["4"]!["1"]!.f;
        return file;
      },
    });
    expect(outcomes(result).formulas).toBe("loss");
    expect(lost(result, "formulas")).toEqual([["formula", "export"]]);
    expect(outcomes(result).content).toBe("pass");
  }, 60_000);

  it("reports a missing picture under media and a flattened revision under review", async () => {
    const strip = (node: JsonNode): JsonNode => ({
      ...node,
      marks: node.marks?.filter((mark) => mark.type !== "suggestion"),
      content: node.content?.filter((child) => child.type !== "image").map(strip),
    });
    const result = await run(byId("docx-report"), {
      beforeExport: (file: SuiteFile) => ({ ...file, content: strip(file.content as JsonNode) }) as SuiteFile,
    });
    expect(outcomes(result).media).toBe("loss");
    expect(outcomes(result).review).toBe("loss");
    expect(lost(result, "review")).toEqual([["revision", "export"]]);
    expect(outcomes(result).content).toBe("pass");
  }, 60_000);

  it("reports a removed slide object under objects", async () => {
    const result = await run(byId("pptx-plan"), {
      beforeExport: (file: SuiteFile) => {
        const deck = (file as SlideFile).content;
        const first = deck.slides[deck.slideOrder[0]!]!;
        first.elements = first.elements.filter((el) => el.type !== "table");
        return file;
      },
    });
    expect(outcomes(result).objects).toBe("loss");
    expect(lost(result, "objects")).toEqual([
      ["table", "export"],
      ["text", "export"],
    ]);
  }, 60_000);

  it("reports a refusal and a timeout as such, never as a pass", async () => {
    const broken = { ...byId("docx-report"), bytes: new TextEncoder().encode("not a zip") };
    const refused = await run(broken);
    expect(refused.outcome).toBe("rejected");
    expect(refused.code).toBeTruthy();
    expect(blockingIssues([refused], FIXTURE_SPECS)[0]!.reason).toContain("SuiteLeaf rejected");
    const slow = await run(byId("pptx-plan"), { timeoutMs: 1 });
    expect(slow.outcome).toBe("timed-out");
    expect(slow.code).toBe("timeout");
    expect(slow.dimensions.every((d) => d.outcome !== "pass")).toBe(true);
  }, 60_000);

  it("uses the reference application's view and blocks when it cannot open the export", async () => {
    const pptx = byId("pptx-plan");
    const opened = await run(pptx, { reference: async () => ({ status: "opened", application: "Fake 1", view: { pages: 3 } }) });
    expect(outcomes(opened).layout).toBe("loss");
    expect(lost(opened, "layout")).toEqual([["pages", "reference"]]);
    const failed = await run(pptx, { reference: async () => ({ status: "failed", application: "Fake 1", detail: "crash" }) });
    expect(blockingIssues([failed], FIXTURE_SPECS)).toEqual([{ fixture: "pptx-plan", reason: "Fake 1 failed" }]);
    const docx = await run(byId("docx-report"), {
      reference: async () => ({ status: "opened", application: "Fake 1", view: { pages: 2, text: "Garden report Tomatoes are in Second page SuiteLeaf edit marker" } }),
    });
    expect(outcomes(docx).layout).toBe("pass");
  }, 60_000);
});
