import { describe, expect, it } from "vitest";
import { defaultPageSettings } from "../packages/core/src/document-layout";
import {
  applyFurnitureText,
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
});
