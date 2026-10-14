import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createFile, type SuiteFile } from "@suiteleaf/core";
import { exportXlsx } from "../packages/core/src/xlsx-export";
import {
  borderTypesToApply,
  sheetBorderKinds,
  visibleBorderSides,
} from "../apps/web/src/editors/sheet-borders";

const thin = { s: 1, cl: { rgb: "#000000" } };

describe("sheet border words", () => {
  it("lists Bottom, Outside, All, and None instead of only All", () => {
    expect(sheetBorderKinds.map((kind) => kind.label)).toEqual([
      "Bottom",
      "Outside",
      "All",
      "None",
    ]);
    expect(sheetBorderKinds.map((kind) => kind.type)).toEqual([
      "BOTTOM",
      "OUTSIDE",
      "ALL",
      "NONE",
    ]);
    expect(borderTypesToApply("BOTTOM")).toEqual(["NONE", "BOTTOM"]);
    expect(borderTypesToApply("OUTSIDE")).toEqual(["NONE", "OUTSIDE"]);
    expect(borderTypesToApply("ALL")).toEqual(["NONE", "ALL"]);
    expect(borderTypesToApply("NONE")).toEqual(["NONE"]);
    for (const kind of sheetBorderKinds)
      expect(borderTypesToApply(kind.type)).not.toEqual(["ALL"]);
  });

  it("reads a header line as only the bottom edge", () => {
    expect(visibleBorderSides({ b: thin })).toBe("b");
    expect(visibleBorderSides({ t: thin, l: thin })).toBe("tl");
    expect(visibleBorderSides({ t: thin, r: thin })).toBe("tr");
    expect(visibleBorderSides({ l: thin })).toBe("l");
    expect(visibleBorderSides({ r: thin })).toBe("r");
    expect(visibleBorderSides({ b: thin, l: thin })).toBe("bl");
    expect(visibleBorderSides({ r: thin, b: thin })).toBe("rb");
    expect(visibleBorderSides({ t: thin, r: thin, b: thin, l: thin })).toBe(
      "trbl",
    );
    expect(visibleBorderSides({ t: null, r: null, b: null, l: null })).toBe("");
    expect(visibleBorderSides({ b: { s: 0 } })).toBe("");
    expect(visibleBorderSides(null)).toBe("");
  });
});

function cellXml(xml: string, ref: string) {
  return (
    xml.match(new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*(?:/>|>[\\s\\S]*?</c>)`))?.[0] ??
    ""
  );
}

function borderOf(stylesXml: string, sheetXml: string, ref: string) {
  const index = Number(/\bs="(\d+)"/.exec(cellXml(sheetXml, ref))?.[1] ?? -1);
  if (index < 0) return "";
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? "";
  const xf = [...cellXfs.matchAll(/<xf\b[^>]*>/g)][index]?.[0] ?? "";
  const borderId = Number(/borderId="(\d+)"/.exec(xf)?.[1] ?? -1);
  const borders = /<borders\b[^>]*>([\s\S]*?)<\/borders>/.exec(stylesXml)?.[1] ?? "";
  return [...borders.matchAll(/<border\b[^>]*>[\s\S]*?<\/border>/g)][borderId]?.[0] ?? "";
}

function sideStyle(border: string, name: string) {
  const tag = new RegExp(`<${name}\\b([^>]*)>`).exec(border)?.[1] ?? "";
  return /style="([^"]+)"/.exec(tag)?.[1] ?? "";
}

describe("xlsx border export", () => {
  it("writes a bottom border on the header and no border on the data cells", async () => {
    const file = createFile("sheet", "Grocery list") as Extract<
      SuiteFile,
      { kind: "sheet" }
    >;
    const id = file.content.workbook.sheetOrder[0];
    file.content.workbook.sheets[id].cellData = {
      0: {
        0: { v: "Groceries", s: { bd: { b: thin } } },
        1: { v: "Amount", s: { bd: { b: thin } } },
      },
      1: {
        0: { v: "Milk", s: { bd: { t: null } } },
        1: { v: 4 },
      },
      2: {
        0: { v: "Bread" },
        1: { v: 2 },
      },
    };
    const zip = await JSZip.loadAsync(await exportXlsx(file));
    const sheetXml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    const stylesXml = await zip.file("xl/styles.xml")!.async("string");
    for (const ref of ["A1", "B1"]) {
      const border = borderOf(stylesXml, sheetXml, ref);
      expect(sideStyle(border, "bottom")).toBe("thin");
      expect(sideStyle(border, "top")).toBe("");
      expect(sideStyle(border, "left")).toBe("");
      expect(sideStyle(border, "right")).toBe("");
    }
    for (const ref of ["A2", "B2", "A3", "B3"]) {
      const border = borderOf(stylesXml, sheetXml, ref);
      for (const side of ["top", "right", "bottom", "left"])
        expect(sideStyle(border, side)).toBe("");
    }
  });
});
