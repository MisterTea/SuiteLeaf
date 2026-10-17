import { describe, expect, it } from "vitest";
import {
  defaultPageSettings,
  documentPageSettings,
  furnitureImage,
  pageFace,
} from "../packages/core/src/document-layout";
import { liveFurnitureImages } from "../apps/web/src/editors/letterhead-text-live";

const png = "data:image/png;base64,aaaa";

describe("header and footer images", () => {
  it("keeps a picture and drops anything that is not an image", () => {
    expect(furnitureImage(png)).toBe(png);
    expect(furnitureImage("https://example.com/logo.png")).toBe("");
    expect(furnitureImage("data:image/svg+xml;base64,aaaa")).toBe("");
  });

  it("puts the shared picture on later pages and the first-page picture on page 1", () => {
    const settings = documentPageSettings({
      type: "doc",
      attrs: {
        pageSettings: {
          differentFirstPage: true,
          headerImage: png,
          firstHeaderImage: "data:image/gif;base64,bbbb",
        },
      },
    });
    expect(pageFace(settings, 0, 2).headerImage).toBe("data:image/gif;base64,bbbb");
    expect(pageFace(settings, 1, 2).headerImage).toBe(png);
    expect(pageFace(settings, 0, 2).footerImage).toBe("");
    expect(pageFace(settings, 1, 2).footerImage).toBe("");
  });

  it("shows a footer picture on every page, and a first-page picture only on page 1", () => {
    const settings = documentPageSettings({
      type: "doc",
      attrs: {
        pageSettings: {
          differentFirstPage: true,
          footerImage: png,
          firstFooterImage: "data:image/jpeg;base64,cccc",
        },
      },
    });
    expect(pageFace(settings, 0, 2).footerImage).toBe("data:image/jpeg;base64,cccc");
    expect(pageFace(settings, 1, 2).footerImage).toBe(png);
  });

  it("draws a new picture while page setup is open and leaves the saved page alone when nothing changed", () => {
    const shown = liveFurnitureImages(defaultPageSettings, {
      ...defaultPageSettings,
      headerImage: png,
    });
    expect(shown.headerImage).toBe(png);
    expect(shown.footerImage).toBe("");
    expect(liveFurnitureImages(defaultPageSettings, defaultPageSettings)).toBe(defaultPageSettings);
  });

  it("refuses a picture that is too large to store", () => {
    expect(furnitureImage(`data:image/png;base64,${"a".repeat(1_500_000)}`)).toBe("");
  });
});
