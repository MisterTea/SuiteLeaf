import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { exportDocx } from "../packages/core/src/docx-export";
import {
  defaultPageSettings,
  documentPageSettings,
  pageFace,
  pageNumberHint,
  setDifferentFirstPage,
  setDifferentOddEven,
} from "../packages/core/src/document-layout";
import { minutesDocument } from "./odd-even-fixture";

const saved = (pageSettings: object) =>
  documentPageSettings({ type: "doc", attrs: { pageSettings } });

describe("odd and even page settings", () => {
  it("keeps old documents on one shared header", () => {
    const settings = saved({ header: "Old file", footer: "Draft" });
    expect(settings.differentFirstPage).toBe(false);
    expect(settings.differentOddEven).toBe(false);
    expect(settings.firstHeader).toBe("");
    expect(settings.evenHeader).toBe("");
    expect(settings.header).toBe("Old file");
    expect(defaultPageSettings.differentOddEven).toBe(false);
    expect(pageFace(settings, 0, 3)).toMatchObject({
      header: "Old file",
      footer: "Draft",
      numberSide: "right",
      pageNumber: "1 / 3",
    });
    expect(pageFace(settings, 1, 3).numberSide).toBe("right");
  });

  it("leaves page 1 as letterhead and mirrors later pages", () => {
    const shared = saved({
      header: "Garden club minutes",
      footer: "Club copy",
      pageNumbers: true,
      differentFirstPage: true,
      firstHeader: "Riverside Garden Club",
      firstFooter: "",
    });
    expect(pageFace(shared, 0, 4)).toMatchObject({
      header: "Riverside Garden Club",
      footer: "",
      numberSide: "none",
      pageNumber: "",
    });
    expect(pageFace(shared, 1, 4)).toMatchObject({
      header: "Garden club minutes",
      numberSide: "right",
      pageNumber: "2 / 4",
    });
    const mirrored = setDifferentOddEven(
      {
        ...shared,
        evenHeader: "Even pages",
        evenFooter: "Left edge",
        oddHeader: "Odd pages",
        oddFooter: "Right edge",
      },
      true,
    );
    expect(pageFace(mirrored, 0, 4).header).toBe("Riverside Garden Club");
    expect(pageFace(mirrored, 0, 4).numberSide).toBe("none");
    expect(pageFace(mirrored, 1, 4)).toMatchObject({
      header: "Even pages",
      footer: "Left edge",
      headerAlign: "left",
      numberSide: "left",
      pageNumber: "2 / 4",
    });
    expect(pageFace(mirrored, 2, 4)).toMatchObject({
      header: "Odd pages",
      footer: "Right edge",
      headerAlign: "right",
      numberSide: "right",
      pageNumber: "3 / 4",
    });
    expect(pageFace(mirrored, 3, 4).numberSide).toBe("left");
    const restored = setDifferentOddEven(mirrored, false);
    expect(restored.header).toBe("Garden club minutes");
    expect(restored.evenHeader).toBe("Even pages");
    expect(pageFace(restored, 1, 4)).toMatchObject({
      header: "Garden club minutes",
      footer: "Club copy",
      numberSide: "right",
    });
    expect(pageFace(restored, 0, 4).header).toBe("Riverside Garden Club");
    expect(pageNumberHint(mirrored)).toContain("Left on even pages");
  });

  it("copies the shared header the first time odd and even pages are turned on", () => {
    const next = setDifferentOddEven(
      {
        ...defaultPageSettings,
        header: "Garden club minutes",
        footer: "Club copy",
        pageNumbers: true,
      },
      true,
    );
    expect(next.evenHeader).toBe("Garden club minutes");
    expect(next.oddHeader).toBe("Garden club minutes");
    expect(next.evenFooter).toBe("Club copy");
    expect(next.oddFooter).toBe("Club copy");
    const edited = setDifferentOddEven(
      { ...next, evenHeader: "Even pages", differentOddEven: false },
      true,
    );
    expect(edited.evenHeader).toBe("Even pages");
    expect(edited.oddHeader).toBe("Garden club minutes");
  });

  it("turns the first page off without deleting its letterhead", () => {
    const on = setDifferentFirstPage(
      { ...defaultPageSettings, firstHeader: "Riverside Garden Club", header: "Minutes" },
      true,
    );
    expect(pageFace(on, 0, 2).header).toBe("Riverside Garden Club");
    expect(pageFace(on, 1, 2).header).toBe("Minutes");
    const off = setDifferentFirstPage(on, false);
    expect(off.firstHeader).toBe("Riverside Garden Club");
    expect(pageFace(off, 0, 2).header).toBe("Minutes");
  });

  it("writes different first, even, and odd headers into a Word file", async () => {
    const file = minutesDocument();
    file.content.attrs = {
      pageSettings: {
        ...(file.content.attrs?.pageSettings as object),
        differentOddEven: true,
        evenHeader: "Even pages",
        oddHeader: "Odd pages",
        evenFooter: "Left edge",
        oddFooter: "Right edge",
      },
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const settingsXml = await zip.file("word/settings.xml")!.async("string");
    expect(settingsXml).toMatch(/evenAndOddHeaders/);
    expect(await zip.file("word/document.xml")!.async("string")).toContain("w:titlePg");
    const headers = await Promise.all(
      Object.keys(zip.files)
        .filter((path) => /word\/header\d+\.xml$/.test(path))
        .map((path) => zip.file(path)!.async("string")),
    );
    expect(headers.join("\n")).toContain("Riverside Garden Club");
    expect(headers.join("\n")).toContain("Even pages");
    expect(headers.join("\n")).toContain("Odd pages");
    const footers = (
      await Promise.all(
        Object.keys(zip.files)
          .filter((path) => /word\/footer\d+\.xml$/.test(path))
          .map((path) => zip.file(path)!.async("string")),
      )
    ).join("\n");
    expect(footers).toContain("Left edge");
    expect(footers).toContain("Right edge");
    expect(footers).toContain("PAGE");
  });
});
