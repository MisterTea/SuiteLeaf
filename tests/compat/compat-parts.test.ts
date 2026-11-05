import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { FIXTURE_PNG, FIXTURE_SPECS, PNG_SHA256, generateFixture } from "../../packages/core/src/compat/fixtures";
import {
  PROFILE_XCU,
  csvCells,
  csvView,
  libreOfficeReference,
  libreOfficeVersion,
  pdfPages,
  type Exec,
} from "../../packages/core/src/compat/libreoffice";
import { blockingIssues, isCurrent, summaryMarkdown, unusedTolerated, type Tolerated } from "../../packages/core/src/compat/report";
import { EDIT_PROBE, applyEdit, probeSeen, scoreDimensions } from "../../packages/core/src/compat/sequence";
import type { CompatResult } from "../../packages/core/src/compat/types";
import { modelView, packageView, xmlText } from "../../packages/core/src/compat/views";

describe("fixtures", () => {
  it("writes a real PNG and refuses an unknown fixture", async () => {
    expect([...FIXTURE_PNG.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(PNG_SHA256).toMatch(/^[0-9a-f]{64}$/);
    await expect(generateFixture({ ...FIXTURE_SPECS[0]!, id: "nope" })).rejects.toThrow("No generator for nope.");
  });

  it("hashes the spec, so a changed probe makes saved results stale", async () => {
    const spec = FIXTURE_SPECS[1]!;
    const a = await generateFixture(spec);
    const b = await generateFixture({ ...spec, probes: spec.probes.slice(1) });
    expect(a.specHash).not.toBe(b.specHash);
    expect(isCurrent({ fingerprint: "f", specHash: a.specHash }, "f", a.specHash)).toBe(true);
    expect(isCurrent({ fingerprint: "f", specHash: a.specHash }, "g", a.specHash)).toBe(false);
    expect(isCurrent({ fingerprint: "f", specHash: a.specHash }, "f", b.specHash)).toBe(false);
  });
});

describe("views", () => {
  it("decodes XML entities and leaves an unknown one", () => {
    expect(xmlText("Beds &amp; paths &lt;3 &#65;&#x42; &bogus;")).toBe("Beds & paths <3 AB &bogus;");
  });

  it("reads an Excel package's shared strings, inline strings, formulas, comments, fonts, and a column past Z", async () => {
    const zip = new JSZip();
    zip.file("xl/workbook.xml", '<workbook><sheets><sheet name="A &amp; B" sheetId="1" r:id="rId1"/></sheets></workbook>');
    zip.file("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
    zip.file("xl/sharedStrings.xml", "<sst><si><t>North</t></si></sst>");
    zip.file(
      "xl/worksheets/sheet1.xml",
      '<sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>West</t></is></c><c r="AA1"><f>B2*2</f><v>4</v></c><c r="C1"/></row></sheetData>',
    );
    zip.file("xl/threadedComments/threadedComment1.xml", "<ThreadedComments><threadedComment><text>Looks right</text></threadedComment></ThreadedComments>");
    zip.file("xl/styles.xml", '<fonts><font><name val="Calibri"/></font><font><name val="Calibri"/></font></fonts>');
    zip.file("xl/media/image1.png", FIXTURE_PNG);
    const view = await packageView(await zip.generateAsync({ type: "uint8array" }), "xlsx");
    expect(view.text).toBe("North\nWest");
    expect(view.formulas).toEqual({ "A & B!AA1": { formula: "B2*2", value: 4 } });
    expect(view.comments).toEqual(["Looks right"]);
    expect(view.fonts).toEqual(["Calibri"]);
    expect(view.images).toEqual([PNG_SHA256]);
  });

  it("reads nothing from a model kind it does not compare", () => {
    expect(modelView({ kind: "drawing" } as never)).toEqual({});
  });
});

describe("probes", () => {
  it("treats an unmeasured field as unknown, not as missing", () => {
    expect(probeSeen({ dimension: "fonts", kind: "font", value: "Calibri" }, {})).toBeUndefined();
    expect(probeSeen({ dimension: "fonts", kind: "font", value: "Calibri" }, undefined)).toBeUndefined();
    expect(probeSeen({ dimension: "fonts", kind: "font", value: "calibri" }, { fonts: ["Calibri"] })).toBe(true);
    const formula = { dimension: "formulas", kind: "formula", sheet: "S", cell: "A1", formula: "SUM(B1:B2)", value: 3 } as const;
    expect(probeSeen(formula, { formulas: {} })).toBe(false);
    expect(probeSeen(formula, { formulas: { "S!A1": { formula: "=sum(B1:B2)", value: 3 } } })).toBe(true);
    expect(probeSeen(formula, { formulas: { "S!A1": { formula: "SUM(B1)", value: 3 } } })).toBe(false);
    expect(probeSeen(formula, { formulas: { "S!A1": { value: 4 } } })).toBe(false);
    expect(probeSeen(formula, { formulas: { "S!A1": { formula: "SUM(B1:B2)" } } })).toBe(true);
    expect(probeSeen(formula, { formulas: { "S!A1": {} } })).toBeUndefined();
  });

  it("calls a probe the source never had incomplete, and the edit marker is not expected before the edit", () => {
    const probe = { dimension: "content", kind: "text", value: "Tomatoes" } as const;
    const views = { source: { text: "Beans" }, import: { text: "Beans" } };
    expect(scoreDimensions([probe], views, "unavailable").find((d) => d.dimension === "content")!.outcome).toBe("incomplete");
    const marker = scoreDimensions([EDIT_PROBE], { source: { text: "" }, import: { text: "" }, edit: { text: EDIT_PROBE.value } }, "opened");
    expect(marker.find((d) => d.dimension === "content")!.outcome).toBe("pass");
    const onlyReference = scoreDimensions([{ dimension: "layout", kind: "pages", count: 2 }], { source: {} }, "opened");
    expect(onlyReference.find((d) => d.dimension === "layout")!.outcome).toBe("not-measured");
  });

  it("adds the marker to a new row of the first sheet and leaves the original file alone", () => {
    const sheet = { kind: "sheet", content: { workbook: { sheetOrder: ["s"], sheets: { s: {} } } } } as never;
    const edited = applyEdit(sheet) as unknown as { content: { workbook: { sheets: { s: { cellData: unknown } } } } };
    expect(edited.content.workbook.sheets.s.cellData).toEqual({ "1": { "0": { v: EDIT_PROBE.value, t: 1 } } });
    expect((sheet as { content: { workbook: { sheets: { s: object } } } }).content.workbook.sheets.s).toEqual({});
  });
});

function fakeOffice(files: Record<string, string>, fail?: Error): { exec: Exec; calls: string[][] } {
  const calls: string[][] = [];
  const exec: Exec = async (_file, args) => {
    calls.push(args);
    if (args[0] === "--version") return { stdout: "LibreOffice 9.9\n" };
    if (fail) throw fail;
    const outdir = args[args.indexOf("--outdir") + 1]!;
    await mkdir(outdir, { recursive: true });
    for (const [name, text] of Object.entries(files)) await writeFile(join(outdir, name), text);
    return { stdout: "" };
  };
  return { exec, calls };
}

describe("LibreOffice reference", () => {
  it("counts PDF pages and parses CSV cells with quotes", () => {
    expect(pdfPages("<< /Type /Pages /Count 2 >> << /Type /Page >> << /Type/Page /Parent 1 >>")).toBe(2);
    expect(csvCells('a,"b, c","say ""hi""",')).toEqual(["a", "b, c", 'say "hi"', ""]);
    expect(csvView([{ name: "Costs", csv: "Bed,Cost\nNorth,10\n,\n" }])).toEqual({
      text: "Bed\nCost\nNorth",
      formulas: { "Costs!B2": { value: 10 } },
    });
  });

  it("reads every sheet's values from CSV in a profile that recalculates and blocks macros", async () => {
    const { exec, calls } = fakeOffice({ "input-Costs.csv": "Total,60\n", "input-Summary.csv": "Doubled,120\n" });
    const result = await libreOfficeReference(new Uint8Array([1]), "xlsx", { exec });
    expect(result).toEqual({
      status: "opened",
      application: "LibreOffice 9.9",
      view: { text: "Total\nDoubled", formulas: { "Costs!B1": { value: 60 }, "Summary!B1": { value: 120 } } },
    });
    expect(calls[1]![0]).toMatch(/^-env:UserInstallation=file:/);
    expect(calls[1]).toContain("--headless");
    expect(PROFILE_XCU).toContain("OOXMLRecalcMode");
    expect(PROFILE_XCU).toContain("DisableMacrosExecution");
  });

  it("renders a document to PDF and text, and a deck to PDF only", async () => {
    const docx = await libreOfficeReference(new Uint8Array([1]), "docx", {
      exec: fakeOffice({ "input.pdf": "/Type /Page /Type /Page", "input.txt": "Garden report" }).exec,
    });
    expect(docx.view).toEqual({ pages: 2, text: "Garden report", numbered: "", cells: ["Garden report"] });
    const pptx = await libreOfficeReference(new Uint8Array([1]), "pptx", { exec: fakeOffice({ "input.pdf": "/Type /Page" }).exec });
    expect(pptx.view).toEqual({ pages: 1 });
  });

  it("is unavailable when LibreOffice cannot start, and separates a failure from a timeout", async () => {
    const missing: Exec = async () => {
      throw new Error("ENOENT");
    };
    expect(await libreOfficeVersion({ exec: missing })).toBeNull();
    expect((await libreOfficeReference(new Uint8Array([1]), "docx", { exec: missing })).status).toBe("unavailable");
    const failed = await libreOfficeReference(new Uint8Array([1]), "docx", { exec: fakeOffice({}, new Error("bad file\nmore")).exec });
    expect(failed).toEqual({ status: "failed", application: "LibreOffice 9.9", detail: "bad file" });
    const slow = Object.assign(new Error("killed"), { killed: true });
    expect((await libreOfficeReference(new Uint8Array([1]), "pptx", { exec: fakeOffice({}, slow).exec })).status).toBe("timed-out");
  });
});

describe("report", () => {
  const result = (fixture: string, patch: Partial<CompatResult> = {}): CompatResult => ({
    fixture,
    format: "docx",
    sha256: "",
    specHash: "",
    fingerprint: "f",
    outcome: "completed",
    reference: { status: "opened", application: "Fake" },
    dimensions: [{ dimension: "content", outcome: "pass", probes: [] }],
    ...patch,
  });

  it("ignores a fixture classified as rejected and blocks an incomplete supported one", () => {
    const specs = [
      { ...FIXTURE_SPECS[0]!, id: "kept", classification: "supported" as const },
      { ...FIXTURE_SPECS[0]!, id: "refused", classification: "rejected" as const },
    ];
    const incomplete = result("kept", { dimensions: [{ dimension: "media", outcome: "incomplete", probes: [] }] });
    expect(blockingIssues([incomplete, result("refused", { outcome: "rejected" })], specs)).toEqual([
      { fixture: "kept", reason: "media incomplete" },
    ]);
    const timedOut = result("kept", { reference: { status: "timed-out" } });
    expect(blockingIssues([timedOut], specs)).toEqual([{ fixture: "kept", reason: "Reference timed-out" }]);
  });

  it("lists a tolerated entry that no longer matches a loss", () => {
    const entry: Tolerated = { fixture: "kept", dimension: "fonts", owner: "WP-014", limitation: "x", documentedIn: "docs/x.md" };
    expect(unusedTolerated([result("kept")], [entry])).toEqual([entry]);
    const summary = summaryMarkdown([result("kept")], FIXTURE_SPECS, [entry]);
    expect(summary).toContain("| kept | completed | opened | pass |");
    expect(summary).toContain("Release-blocking: none");
    expect(summary).toContain("Tolerated:\n- kept fonts (WP-014): x");
  });
});
