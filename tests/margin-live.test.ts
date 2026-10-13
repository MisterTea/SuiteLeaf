import { describe, expect, it } from "vitest";
import {
  documentPageSettings,
  pageDimensions,
  type PageSettings,
} from "../packages/core/src/document-layout";
import { livePageSettings } from "../apps/web/src/editors/margin-live";

const inch = (n: number) => n * 96;

function page(patch: Partial<PageSettings> = {}): PageSettings {
  return documentPageSettings({
    type: "doc",
    attrs: {
      pageSettings: {
        margin: inch(1),
        marginTop: inch(1),
        marginBottom: inch(1),
        marginLeft: inch(1),
        marginRight: inch(1),
        header: "Town council",
        footer: "Hearing notes",
        headerFromEdge: inch(0.5),
        footerFromEdge: inch(1),
        ...patch,
      },
    },
  });
}

describe("live page margins", () => {
  it("draws 1.5 inch margins and leaves the header distance", () => {
    const saved = page();
    const shown = livePageSettings(saved, {
      ...saved,
      marginTop: inch(1.5),
      marginBottom: inch(1.5),
      marginLeft: inch(1.5),
      marginRight: inch(1.5),
      header: "Agenda",
      size: "a4",
    });
    expect(shown.marginTop).toBe(inch(1.5));
    expect(shown.marginBottom).toBe(inch(1.5));
    expect(shown.marginLeft).toBe(inch(1.5));
    expect(shown.marginRight).toBe(inch(1.5));
    expect(shown.headerFromEdge).toBe(inch(0.5));
    expect(shown.footerFromEdge).toBe(inch(1));
    expect(shown.header).toBe("Town council");
    expect(shown.footer).toBe("Hearing notes");
    expect(shown.size).toBe("a4");
    expect(shown.landscape).toBe(false);
    expect(pageDimensions(shown)).toEqual({ width: 794, height: 1123 });
  });

  it("keeps a refused margin on the saved page and still draws the others", () => {
    const saved = page();
    const shown = livePageSettings(saved, {
      ...saved,
      marginTop: inch(4),
      marginBottom: inch(0.1),
      marginLeft: inch(1.5),
    });
    expect(shown.marginTop).toBe(inch(1));
    expect(shown.marginBottom).toBe(inch(1));
    expect(shown.marginLeft).toBe(inch(1.5));
    expect(shown.marginRight).toBe(inch(1));
    expect(shown.headerFromEdge).toBe(inch(0.5));
  });

  it("draws a footer distance and a margin that are both being edited", () => {
    const saved = page();
    const shown = livePageSettings(saved, {
      ...saved,
      marginBottom: inch(1.5),
      footerFromEdge: inch(1.5),
    });
    expect(shown.marginBottom).toBe(inch(1.5));
    expect(shown.footerFromEdge).toBe(inch(1.5));
    expect(shown.headerFromEdge).toBe(inch(0.5));
  });

  it("returns the saved page when nothing drawable changed", () => {
    const saved = page();
    expect(livePageSettings(saved, { ...saved, marginTop: Number.NaN })).toBe(saved);
  });
});
