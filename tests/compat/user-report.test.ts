import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPAT_CONVERTER_VERSION,
  COMPAT_EVIDENCE_CORPUS,
  analyzeFontCompatibility,
  createCompatibilityReport,
  createFile,
  formatCompatibilityReportJson,
  formatCompatibilityReportMarkdown,
  formatCompatibilityReportTerminal,
  preserveUnsupportedParts,
  resolveExportChoice,
  scanDocCompatibility,
  scanSheetCompatibility,
  scanSlideCompatibility,
  type DocFile,
  type SheetFile,
  type SlideFile,
} from "../../packages/core/src";
import { parseConvertArgs, runConvertCommand } from "../../apps/desktop/src/convert-cli";
import { exportPptx } from "../../packages/core/src/pptx-export";
import { openOfficeFile } from "../../packages/core/src/open-office";

let tempDir: string;
beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "suiteleaf-report-test-"));
});
afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("compatibility findings and reports", () => {
  it("builds structured reports with correct summary counts and export status", () => {
    const report = createCompatibilityReport({
      sourceName: "Quarterly.sldoc",
      sourceFormat: "sldoc",
      targetFormat: "docx",
      sourceHash: "abc123hash",
      findings: [
        {
          id: "f-1",
          severity: "info",
          impact: "notice",
          dimension: "fonts",
          feature: "fonts.metric-match",
          title: "Calibri matched",
          message: "Mapped to SuiteLeaf Willow",
          sourceFormat: "sldoc",
          targetFormat: "docx",
          location: { kind: "doc", paragraph: 1 },
          recommendedAction: "No action needed.",
          testedSupport: true,
          evidenceReference: COMPAT_EVIDENCE_CORPUS,
        },
        {
          id: "f-2",
          severity: "warning",
          impact: "unsupported-display",
          dimension: "fonts",
          feature: "fonts.substitution",
          title: "Custom font substituted",
          message: "Futura will be substituted",
          sourceFormat: "sldoc",
          targetFormat: "docx",
          location: { kind: "doc", paragraph: 3 },
          recommendedAction: "Install Futura or use Calibri.",
          testedSupport: true,
          evidenceReference: COMPAT_EVIDENCE_CORPUS,
        },
      ],
    });

    expect(report.converterVersion).toBe(COMPAT_CONVERTER_VERSION);
    expect(report.canExport).toBe(true);
    expect(report.summary.total).toBe(2);
    expect(report.summary.info).toBe(1);
    expect(report.summary.warnings).toBe(1);
    expect(report.summary.unsupportedDisplay).toBe(1);
    expect(report.summary.dataLoss).toBe(0);
    expect(report.sourceHash).toBe("abc123hash");
  });

  it("distinguishes Office metric-matched fonts from unmapped custom fonts", () => {
    const findings = analyzeFontCompatibility(
      ["Calibri", "SuiteLeaf Willow", "Unregistered Brand Pro", "Arial"],
      "docx",
      { kind: "doc", paragraph: 2 },
    );

    const calibri = findings.find((f) => f.title.includes("Calibri"));
    expect(calibri?.severity).toBe("info");
    expect(calibri?.impact).toBe("notice");
    expect(calibri?.testedSupport).toBe(true);

    const willow = findings.find((f) => f.title.includes("SuiteLeaf Willow"));
    expect(willow?.severity).toBe("info");
    expect(willow?.message).toContain("exports to Office as 'Calibri'");

    const brand = findings.find((f) => f.title.includes("Unregistered Brand Pro"));
    expect(brand?.severity).toBe("warning");
    expect(brand?.impact).toBe("unsupported-display");
    expect(brand?.message).toContain("Character widths differ");
    expect(brand?.recommendedAction).toContain("appropriate license");
    expect(brand?.location.paragraph).toBe(2);
  });

  it("scans documents for math, SVG images, and font styles with location mapping", () => {
    const doc = createFile("doc", "Project Spec") as DocFile;
    doc.content = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Introduction and Goals" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              marks: [{ type: "fontFamily", attrs: { family: "Baskerville Pro Custom" } }],
              text: "This document describes our findings.",
            },
          ],
        },
        {
          type: "math",
          attrs: { equation: "E = mc^2" },
          content: [{ type: "text", text: "E = mc^2" }],
        },
        {
          type: "image",
          attrs: { src: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" },
        },
      ],
    };

    const report = scanDocCompatibility(doc, "docx", { sourceHash: "hash-doc-1" });
    expect(report.sourceName).toBe("Project Spec");
    expect(report.sourceHash).toBe("hash-doc-1");

    const fontFinding = report.findings.find((f) => f.feature === "fonts.substitution");
    expect(fontFinding).toBeDefined();
    expect(fontFinding?.location.kind).toBe("doc");

    const mathFinding = report.findings.find((f) => f.feature === "word.equation");
    expect(mathFinding?.severity).toBe("warning");
    expect(mathFinding?.impact).toBe("unsupported-editing");

    const svgFinding = report.findings.find((f) => f.feature === "word.vector-image");
    expect(svgFinding?.severity).toBe("info");
    expect(svgFinding?.impact).toBe("notice");
  });

  it("scans spreadsheets for external links and unsupported functions", () => {
    const sheet = createFile("sheet", "Financial Model") as SheetFile;
    sheet.content = {
      workbook: {
        sheetOrder: ["s1", "s2"],
        sheets: {
          s1: {
            name: "Summary",
            cellData: {
              "0": {
                "0": { v: "Revenue", s: { ff: "Aptos" } },
                "1": { f: "=[Budget.xlsx]Sheet1!$B$5*1.1", v: 550 },
              },
              "1": {
                "0": { v: "Live Feed" },
                "1": { f: '=WEBSERVICE("https://api.example.com/quote")', v: 42 },
              },
            },
          },
          s2: {
            name: "Details",
            cellData: {},
          },
        },
      },
    } as any;

    const report = scanSheetCompatibility(sheet, "xlsx");
    expect(report.canExport).toBe(true);

    const extLink = report.findings.find((f) => f.feature === "sheet.external-link");
    expect(extLink).toBeDefined();
    expect(extLink?.location).toMatchObject({
      kind: "sheet",
      sheet: "Summary",
      cell: "B1",
      formula: "=[Budget.xlsx]Sheet1!$B$5*1.1",
    });

    const webservice = report.findings.find((f) => f.feature === "sheet.unsupported-function");
    expect(webservice).toBeDefined();
    expect(webservice?.impact).toBe("data-loss");
    expect(webservice?.location.cell).toBe("B2");
  });

  it("scans slides for SmartArt, diagrams, media, and fonts", () => {
    const deck = createFile("slide", "Company Overview") as SlideFile;
    deck.content = {
      slideOrder: ["slide-1"],
      slides: {
        "slide-1": {
          id: "slide-1",
          elements: [
            {
              id: "el-title",
              type: "title",
              content: "Executive Summary",
              fontFamily: "Calibri",
            },
            {
              id: "el-diagram",
              type: "smartart",
              content: "Workflow",
            } as any,
            {
              id: "el-video",
              type: "video",
              content: "video.mp4",
            } as any,
          ],
        },
      },
    } as any;

    const report = scanSlideCompatibility(deck, "pptx");
    const smartArt = report.findings.find((f) => f.feature === "slide.smartart");
    expect(smartArt).toBeDefined();
    expect(smartArt?.impact).toBe("unsupported-editing");
    expect(smartArt?.location).toMatchObject({
      kind: "slide",
      slideIndex: 1,
      slideTitle: "Executive Summary",
      elementId: "el-diagram",
    });

    const media = report.findings.find((f) => f.feature === "slide.embedded-media");
    expect(media).toBeDefined();
    expect(media?.impact).toBe("notice");
  });

  it("preserves unsupported package parts without executing macros and verifies source hash", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", "<w:document><w:body><w:p/></w:body></w:document>");
    zip.file("word/_rels/document.xml.rels", '<Relationships><Relationship Id="rId1" Target="vbaProject.bin"/></Relationships>');
    zip.file("word/vbaProject.bin", new Uint8Array([0x50, 0x4b, 0x01, 0x02]));
    zip.file("customXml/item1.xml", "<data>CustomMetadata</data>");
    zip.file("[Content_Types].xml", "<Types/>");
    zip.file("_rels/.rels", '<Relationships><Relationship Id="r1" Target="word/document.xml"/></Relationships>');

    const bytes = await zip.generateAsync({ type: "uint8array" });
    const expectedHash = createHash("sha256").update(bytes).digest("hex");

    const manifest = await preserveUnsupportedParts(zip, bytes);
    expect(manifest.sourceHash).toBe(expectedHash);
    expect(manifest.validRelationships).toBe(true);

    const vba = manifest.preservedParts.find((p) => p.path === "word/vbaProject.bin");
    expect(vba).toBeDefined();
    expect(vba?.isExecutable).toBe(true); // Flagged as executable stream to isolate/quarantine

    const customXml = manifest.preservedParts.find((p) => p.path === "customXml/item1.xml");
    expect(customXml).toBeDefined();
    expect(customXml?.isExecutable).toBe(false);
  });

  it("handles export choices and guarantees source file preservation", () => {
    const report = createCompatibilityReport({
      sourceName: "Report.sldoc",
      sourceFormat: "sldoc",
      targetFormat: "docx",
      findings: [
        {
          id: "w-1",
          severity: "warning",
          impact: "unsupported-editing",
          dimension: "objects",
          feature: "test.feature",
          title: "Complex shape",
          message: "Static rendering",
          sourceFormat: "sldoc",
          targetFormat: "docx",
          location: { kind: "doc", paragraph: 1 },
          recommendedAction: "Review layout.",
          testedSupport: true,
        },
      ],
    });

    const proceed = resolveExportChoice(report, "proceed");
    expect(proceed.action).toBe("export");
    expect(proceed.format).toBe("docx");
    expect(proceed.originalHashPreserved).toBe(true);

    const alternative = resolveExportChoice(report, "choose-alternative", "pdf");
    expect(alternative.action).toBe("convert-alternative");
    expect(alternative.format).toBe("pdf");
    expect(alternative.originalHashPreserved).toBe(true);

    const cancelled = resolveExportChoice(report, "keep-original");
    expect(cancelled.action).toBe("abort");
    expect(cancelled.message).toContain("unchanged");
    expect(cancelled.originalHashPreserved).toBe(true);
  });

  it("formats Markdown, Terminal, and JSON compatibility reports", () => {
    const report = createCompatibilityReport({
      sourceName: "Catalog.slsheet",
      sourceFormat: "slsheet",
      targetFormat: "xlsx",
      findings: [
        {
          id: "f-formula",
          severity: "warning",
          impact: "data-loss",
          dimension: "formulas",
          feature: "sheet.external-link",
          title: "External Workbook Link",
          message: "Values depend on outside workbook",
          sourceFormat: "slsheet",
          targetFormat: "xlsx",
          location: { kind: "sheet", sheet: "Prices", cell: "C4" },
          recommendedAction: "Convert to static value before sharing.",
          testedSupport: true,
          evidenceReference: COMPAT_EVIDENCE_CORPUS,
        },
      ],
    });

    const md = formatCompatibilityReportMarkdown(report);
    expect(md).toContain("# Compatibility Report: Catalog.slsheet");
    expect(md).toContain("Prices!C4");
    expect(md).toContain("Convert to static value before sharing.");

    const term = formatCompatibilityReportTerminal(report);
    expect(term).toContain("[Compatibility Report]");
    expect(term).toContain("[WARNING]");

    const json = formatCompatibilityReportJson(report);
    const parsed = JSON.parse(json);
    expect(parsed.sourceName).toBe("Catalog.slsheet");
    expect(parsed.findings[0].feature).toBe("sheet.external-link");
  });

  it("CLI convert command accepts --report and produces report files", async () => {
    // Generate a presentation fixture
    const deck = createFile("slide", "Presentation Deck") as SlideFile;
    const first = deck.content.slideOrder[0];
    deck.content.slides[first] = {
      ...deck.content.slides[first],
      elements: [
        {
          id: "el-1",
          type: "smartart",
          content: "Flowchart",
          fontFamily: "Custom Brand Font",
        } as any,
      ],
    };
    const bytes = await exportPptx(deck);
    const pptxPath = join(tempDir, "slides.pptx");
    await writeFile(pptxPath, bytes);

    const reportJsonPath = join(tempDir, "report.json");
    const reportMdPath = join(tempDir, "report.md");

    // Test argument parser
    const parsed = parseConvertArgs([
      pptxPath,
      "--to",
      "pdf",
      "--report",
      reportJsonPath,
    ]);
    expect(parsed).toEqual({
      source: pptxPath,
      output: undefined,
      to: "pdf",
      report: reportJsonPath,
    });

    // Run convert with JSON report
    const logs: string[] = [];
    const code = await runConvertCommand(
      [pptxPath, "--to", "pdf", "--output", tempDir, "--report", reportJsonPath],
      {
        convertOffice: openOfficeFile,
        openRenderer: async () => async () => Buffer.from("%PDF-1.4\n"),
        log: (msg) => logs.push(msg),
        error: (msg) => logs.push(`ERR: ${msg}`),
      },
    );

    expect(code).toBe(0);
    const savedJson = await readFile(reportJsonPath, "utf8");
    const jsonReport = JSON.parse(savedJson);
    expect(jsonReport.sourceFormat).toBe("slslide");
    expect(jsonReport.findings.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.includes("Wrote compatibility report"))).toBe(true);

    // Run convert with Markdown report
    const mdCode = await runConvertCommand(
      [pptxPath, "--to", "pdf", "--output", tempDir, "--report", reportMdPath],
      {
        convertOffice: openOfficeFile,
        openRenderer: async () => async () => Buffer.from("%PDF-1.4\n"),
        log: (msg) => logs.push(msg),
        error: (msg) => logs.push(`ERR: ${msg}`),
      },
    );
    expect(mdCode).toBe(0);
    const savedMd = await readFile(reportMdPath, "utf8");
    expect(savedMd).toContain("# Compatibility Report");

    // Run convert with terminal report
    const termLogs: string[] = [];
    const termCode = await runConvertCommand(
      [pptxPath, "--to", "pdf", "--output", tempDir, "--report"],
      {
        convertOffice: openOfficeFile,
        openRenderer: async () => async () => Buffer.from("%PDF-1.4\n"),
        log: (msg) => termLogs.push(msg),
        error: (msg) => termLogs.push(`ERR: ${msg}`),
      },
    );
    expect(termCode).toBe(0);
    expect(termLogs.some((l) => l.includes("[Compatibility Report]"))).toBe(true);
  });
});
