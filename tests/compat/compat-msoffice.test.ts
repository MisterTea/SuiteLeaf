import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Exec } from "../../packages/core/src/compat/libreoffice";
import {
  excelScript,
  excelView,
  msOfficeReference,
  msOfficeVersion,
  powerPointScript,
  powerPointView,
  wordScript,
  wordView,
} from "../../packages/core/src/compat/msoffice";

const office = (reply: string, fail?: Error): { exec: Exec; calls: string[][] } => {
  const calls: string[][] = [];
  return {
    calls,
    exec: async (file, args) => {
      calls.push([file, ...args]);
      if (args[0] === "-e") return { stdout: "16.114.4\n" };
      if (fail) throw fail;
      return { stdout: reply };
    },
  };
};

describe("Microsoft Office reference", () => {
  it("reads Word's pages, body, headers, footnotes, and list numbers", () => {
    const view = wordView(
      "### pages 2\n### body\nTomatoes\u0002\rWater\n### header Club report\r\n### footer \n### footnote Planted\r\n### link the plan\n### citation CITATION Día19 \\l 3082\n### citation PAGE\n### font Cambria\n### font Cambria\n### item a)\tCompost\r\n### item 1.\tWeed\n",
    );
    expect(view).toEqual({
      pages: 2,
      text: "Tomatoes\u0002\nWater",
      headers: ["Club report"],
      footnotes: ["Planted"],
      internalLinks: ["the plan"],
      citations: ["Día19"],
      fonts: ["Cambria"],
      cells: ["Tomatoes\u0002\nWater"],
      numbered: "a Compost\n1 Weed",
    });
  });

  it("reads Excel's recalculated values with each sheet's origin", () => {
    expect(excelView("### Costs\t2\t27\nBed\t10.0\t\n\t60.0\t\n### Summary\t1\t1\nDoubled\t120.0\t\n")).toEqual({
      text: "Bed\nDoubled",
      formulas: { "Costs!AB2": { value: 10 }, "Costs!AB3": { value: 60 }, "Summary!B1": { value: 120 } },
    });
  });

  it("reads PowerPoint's slides, text, notes, and table count", () => {
    expect(
      powerPointView("### slides 2\n### shape shape type auto\nGarden plan\n### shape shape type table\n### shape shape type picture\n### note Remember\n"),
    ).toEqual({ text: "Garden plan", notes: "Remember", tables: 1, pages: 2 });
  });

  it("writes scripts that open read-only, close without saving, and write no file", () => {
    for (const script of [wordScript("/x/a.docx"), excelScript("/x/a.xlsx"), powerPointScript("/x/a.pptx")]) {
      expect(script).toContain("saving no");
      expect(script).not.toMatch(/save as/);
    }
    expect(wordScript('/x/"odd".docx')).toContain('POSIX file "/x/\\"odd\\".docx"');
    expect(excelScript("/x/a.xlsx")).toContain("calculate full");
  });

  it("opens one fixed file per format, so the sandbox grant is asked for once", async () => {
    const dir = await mkdtemp(join(tmpdir(), "office-ref-"));
    const { exec, calls } = office("### Costs\t1\t1\nTotal\t60.0\t\n");
    const result = await msOfficeReference(new Uint8Array([1]), "xlsx", { dir, exec, platform: "darwin" });
    expect(result).toEqual({
      status: "opened",
      application: "Microsoft Excel 16.114.4",
      view: { text: "Total", formulas: { "Costs!B1": { value: 60 } } },
    });
    expect(await readdir(dir)).toEqual(["reference.xlsx"]);
    expect(calls[1]![0]).toBe("osascript");
    const word = await msOfficeReference(new Uint8Array([1]), "docx", { dir, exec: office("### pages 1\n### body\nHi\n").exec, platform: "darwin" });
    expect(word.view?.pages).toBe(1);
    const deck = await msOfficeReference(new Uint8Array([1]), "pptx", { dir, exec: office("### slides 3\n").exec, platform: "darwin" });
    expect(deck.view?.pages).toBe(3);
  });

  it("is unavailable off macOS or when the app cannot be reached, and separates failure from timeout", async () => {
    expect(await msOfficeVersion("docx", { platform: "linux" })).toBeNull();
    const dir = await mkdtemp(join(tmpdir(), "office-ref-"));
    const missing: Exec = async () => {
      throw new Error("no app");
    };
    expect((await msOfficeReference(new Uint8Array([1]), "docx", { dir, exec: missing, platform: "darwin" })).status).toBe("unavailable");
    const failed = await msOfficeReference(new Uint8Array([1]), "docx", { dir, exec: office("", new Error("denied\nmore")).exec, platform: "darwin" });
    expect(failed).toEqual({ status: "failed", application: "Microsoft Word 16.114.4", detail: "denied" });
    const slow = Object.assign(new Error("killed"), { killed: true });
    expect((await msOfficeReference(new Uint8Array([1]), "pptx", { dir, exec: office("", slow).exec, platform: "darwin" })).status).toBe("timed-out");
  });
});
