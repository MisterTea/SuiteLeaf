import { describe, expect, it } from "vitest";
import { defaultPageSettings } from "../packages/core/src/document-layout";
import {
  applyFurnitureText,
  applyPageFurniture,
  furniturePlainText,
  furnitureScopeLabel,
} from "../apps/web/src/editors/doc-header-editor.tsx";

describe("header and footer text edited on the page", () => {
  it("keeps a pasted line break from becoming a second header line", () => {
    expect(furniturePlainText("October\nminutes")).toBe("October minutes");
    expect(furniturePlainText(`Draft\r\n`)).toBe("Draft ");
  });

  it("leaves the page number out of the footer and keeps the rest of page setup", () => {
    const next = applyFurnitureText(
      {
        ...defaultPageSettings,
        header: "Garden club minutes",
        footer: "",
        pageNumbers: true,
        margin: 96,
      },
      "footer",
      "Draft",
    );
    expect(next.footer).toBe("Draft");
    expect(next.header).toBe("Garden club minutes");
    expect(next.pageNumbers).toBe(true);
    expect(next.margin).toBe(96);
    expect(next.footer).not.toMatch(/\d/);
  });

  it("does not invent a per-page header on this base", () => {
    expect(furnitureScopeLabel("header")).toBe("Header · all pages");
    expect(furnitureScopeLabel("footer")).toBe("Footer · all pages");
  });

  it("edits only the header that page is showing", () => {
    const letterhead = {
      ...defaultPageSettings,
      differentFirstPage: true,
      differentOddEven: true,
      firstHeader: "Town Council",
      evenHeader: "Minutes",
      oddHeader: "Council",
      header: "Shared",
      pageNumbers: true,
    };
    const first = applyPageFurniture(letterhead, 0, "header", "Civic Hall");
    expect(first.firstHeader).toBe("Civic Hall");
    expect(first.evenHeader).toBe("Minutes");
    expect(first.oddHeader).toBe("Council");
    expect(first.header).toBe("Shared");
    const even = applyPageFurniture(letterhead, 1, "header", "Notes");
    expect(even.evenHeader).toBe("Notes");
    expect(even.firstHeader).toBe("Town Council");
    const shared = applyPageFurniture(
      { ...defaultPageSettings, header: "Garden club minutes", pageNumbers: true },
      1,
      "header",
      "October minutes",
    );
    expect(shared.header).toBe("October minutes");
    expect(shared.pageNumbers).toBe(true);
  });
});
