import { describe, expect, it } from "vitest";
import {
  DOC_MAIN_TAB_ID,
  createFile,
  diffDocPackage,
  diffSheetPackage,
  isSlmediaUri,
  isSuitePackageBytes,
  parseFileBytes,
  readZipCentralDirectory,
  readZipEntry,
  serializeFile,
  serializeFileBytes,
  splitDoc,
  splitSheet,
  type DocFile,
  type SheetFile,
} from "@suiteleaf/core";

function makePngDataUri(seed: number, len = 4800): string {
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = (i * seed) & 0xff;
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

describe("sldoc & slsheet v2 ZIP sectioned packages", () => {
  it("splits, packs, diffs, and round-trips a multi-tab .sldoc with deduplicated images", async () => {
    const doc = createFile("doc", "Design Spec") as DocFile;
    const imgUri = makePngDataUri(17);
    doc.properties = {
      author: "Alice",
      subject: "Architecture",
      keywords: ["zip", "sections"],
    };
    doc.tabTitle = "Overview";
    doc.content = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello main tab" }] },
        { type: "image", attrs: { src: imgUri, alt: "Diagram" } },
      ],
    };
    doc.tabs = [
      {
        id: "appendix",
        title: "Appendix",
        content: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Extra notes" }] },
            // Same image reused on tab 2 -> deduplicated!
            { type: "image", attrs: { src: imgUri, alt: "Diagram copy" } },
          ],
        },
      },
    ];

    const parts = splitDoc(doc);
    expect(parts.manifest.version).toBe(2);
    expect(parts.manifest.kind).toBe("doc");
    expect(parts.manifest.tabOrder).toEqual([DOC_MAIN_TAB_ID, "appendix"]);
    expect(Object.keys(parts.manifest.media)).toHaveLength(1);
    const mainImgSrc = String(parts.tabs[DOC_MAIN_TAB_ID].content?.[1].attrs?.src);
    expect(isSlmediaUri(mainImgSrc)).toBe(true);

    // serializeFileBytes auto-upgrades doc to v2 ZIP; parseFileBytes round-trips cleanly
    const zipBytes = await serializeFileBytes(doc);
    expect(isSuitePackageBytes(zipBytes)).toBe(true);
    const parsed = (await parseFileBytes(zipBytes, "doc")) as DocFile;
    expect(parsed.kind).toBe("doc");
    expect(parsed.tabTitle).toBe("Overview");
    expect(parsed.tabs).toHaveLength(1);
    expect(parsed.content.content?.[1].attrs?.src).toBe(imgUri);
    expect(parsed.tabs?.[0].content.content?.[1].attrs?.src).toBe(imgUri);

    // Legacy v1 JSON still parses
    const v1Bytes = new TextEncoder().encode(serializeFile(doc));
    const parsedV1 = (await parseFileBytes(v1Bytes, "doc")) as DocFile;
    expect(parsedV1.tabs?.[0].title).toBe("Appendix");

    // Editing only tab 2 produces a 1-blob delta (no re-upload of main tab, global, or PNG)
    const edited = structuredClone(doc);
    edited.tabs![0].content.content![0].content![0].text = "Updated appendix";
    const delta = diffDocPackage(parts.manifest, splitDoc(edited));
    expect(delta.globalChanged).toBe(false);
    expect(delta.changedSectionIds).toEqual(["appendix"]);
    expect(delta.changedBlobs.size).toBe(1);
  });

  it("splits, extracts cross-sheet formula deps, diffs, and round-trips a multi-sheet .slsheet", async () => {
    const sheet = createFile("sheet", "Budget") as SheetFile;
    const s1 = sheet.content.workbook.sheetOrder[0];
    sheet.content.workbook.sheets[s1].name = "Summary";
    sheet.content.workbook.sheets[s1].cellData = {
      0: { 0: { v: 150, f: "=SUM(Revenue!A1:A2)" } },
    };
    sheet.content.workbook.sheetOrder.push("rev");
    sheet.content.workbook.sheets["rev"] = {
      id: "rev",
      name: "Revenue",
      rowCount: 100,
      columnCount: 10,
      cellData: {
        0: { 0: { v: 100 } },
        1: { 0: { v: 50 } },
      },
      defaultColumnWidth: 100,
      defaultRowHeight: 24,
    };
    const chartImg = makePngDataUri(29);
    sheet.content.images = [
      {
        id: "img1",
        sheetId: s1,
        src: chartImg,
        row: 2,
        column: 2,
        offsetX: 0,
        offsetY: 0,
        width: 200,
        height: 120,
        anchorType: "0",
      },
    ];

    const parts = splitSheet(sheet);
    expect(parts.manifest.version).toBe(2);
    expect(parts.manifest.kind).toBe("sheet");
    expect(parts.manifest.sheetOrder).toEqual([s1, "rev"]);
    expect(parts.manifest.sheets[s1].deps).toEqual(["rev"]);
    expect(Object.keys(parts.manifest.media)).toHaveLength(1);

    const zipBytes = await serializeFileBytes(sheet);
    expect(isSuitePackageBytes(zipBytes)).toBe(true);

    // Random-access ZIP read extracts only Revenue sheet
    const readRange = async (offset: number, len: number) =>
      zipBytes.subarray(offset, offset + len);
    const cd = await readZipCentralDirectory(zipBytes.byteLength, readRange);
    expect(cd.has("manifest.json")).toBe(true);
    expect(cd.has("global.json")).toBe(true);
    expect(cd.has("sheets/rev.json")).toBe(true);
    const revRaw = await readZipEntry(cd.get("sheets/rev.json")!, readRange);
    expect(JSON.parse(new TextDecoder().decode(revRaw)).name).toBe("Revenue");

    // Full round-trip rehydrates image and worksheets
    const parsed = (await parseFileBytes(zipBytes, "sheet")) as SheetFile;
    expect(parsed.kind).toBe("sheet");
    expect(parsed.content.workbook.sheetOrder).toEqual([s1, "rev"]);
    expect(parsed.content.images?.[0].src).toBe(chartImg);

    // Editing only Revenue sheet produces a 1-blob delta
    const edited = structuredClone(sheet);
    edited.content.workbook.sheets["rev"].cellData = {
      0: { 0: { v: 200 } },
      1: { 0: { v: 50 } },
    };
    const delta = diffSheetPackage(parts.manifest, splitSheet(edited));
    expect(delta.globalChanged).toBe(false);
    expect(delta.changedSectionIds).toEqual(["rev"]);
    expect(delta.changedBlobs.size).toBe(1);
  });
});
