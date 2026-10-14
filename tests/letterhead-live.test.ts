import { describe, expect, it } from "vitest";
import {
  documentPageSettings,
  type PageSettings,
} from "../packages/core/src/document-layout";
import { liveEdgeDistances } from "../apps/web/src/editors/letterhead-live";

const inch = (n: number) => n * 96;

function page(patch: Partial<PageSettings> = {}): PageSettings {
  return documentPageSettings({
    type: "doc",
    attrs: {
      pageSettings: {
        margin: inch(1),
        marginTop: inch(1),
        marginBottom: inch(1),
        header: "Town council",
        footer: "Hearing notes",
        headerFromEdge: inch(0.75),
        footerFromEdge: inch(1),
        ...patch,
      },
    },
  });
}

describe("live letterhead distances", () => {
  it("draws a valid footer distance and leaves the margin and the header", () => {
    const saved = page();
    const shown = liveEdgeDistances(saved, {
      ...saved,
      footerFromEdge: inch(1.5),
      marginBottom: inch(2),
    });
    expect(shown.footerFromEdge).toBe(inch(1.5));
    expect(shown.headerFromEdge).toBe(inch(0.75));
    expect(shown.marginBottom).toBe(inch(1));
    expect(shown.footer).toBe("Hearing notes");
  });

  it("draws a half-inch header and leaves the top margin", () => {
    const saved = page();
    const shown = liveEdgeDistances(saved, {
      ...saved,
      headerFromEdge: inch(0.5),
      marginTop: inch(2),
    });
    expect(shown.headerFromEdge).toBe(inch(0.5));
    expect(shown.footerFromEdge).toBe(inch(1));
    expect(shown.marginTop).toBe(inch(1));
  });

  it("keeps the saved distance when the draft is under 0.25 inches", () => {
    const saved = page();
    const shown = liveEdgeDistances(saved, {
      ...saved,
      footerFromEdge: inch(0.2),
      headerFromEdge: Number.NaN,
    });
    expect(shown).toBe(saved);
  });
});
