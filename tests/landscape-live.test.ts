import { describe, expect, it } from "vitest";
import {
  documentPageSettings,
  pageDimensions,
  type PageSettings,
} from "../packages/core/src/document-layout";
import { livePageSettings } from "../apps/web/src/editors/margin-live";
import { liveOrientation } from "../apps/web/src/editors/landscape-live";
import {
  paperPreviewZoom,
  paperSizeCaption,
} from "../apps/web/src/editors/paper-size-live";

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
        headerFromEdge: inch(0.75),
        footerFromEdge: inch(1),
        ...patch,
      },
    },
  });
}

describe("live landscape", () => {
  it("turns the page before apply and leaves the header text", () => {
    const saved = page();
    const shown = livePageSettings(saved, {
      ...saved,
      landscape: true,
      header: "Agenda",
      footer: "Draft",
    });
    expect(shown.landscape).toBe(true);
    expect(pageDimensions(shown)).toEqual({ width: 1056, height: 816 });
    expect(shown.header).toBe("Town council");
    expect(shown.footer).toBe("Hearing notes");
    expect(shown.size).toBe("letter");
    expect(paperSizeCaption(shown)).toBe("Letter, 11 × 8.5 in");
  });

  it("returns the saved page when orientation did not change", () => {
    const saved = page();
    expect(liveOrientation(saved, { ...saved, header: "Agenda" })).toBe(saved);
  });

  it("restores portrait when the draft is portrait again", () => {
    const saved = page();
    const shown = livePageSettings(saved, { ...saved, landscape: false });
    expect(shown.landscape).toBe(false);
    expect(pageDimensions(shown)).toEqual({ width: 816, height: 1056 });
    expect(paperSizeCaption(shown)).toBe("Letter, 8.5 × 11 in");
  });

  it("keeps landscape when A4 is chosen, and still moves the margin", () => {
    const saved = page({ landscape: true });
    const shown = livePageSettings(saved, {
      ...saved,
      size: "a4",
      marginTop: inch(1.5),
      marginBottom: inch(1.5),
      marginLeft: inch(1.5),
      marginRight: inch(1.5),
      header: "Agenda",
    });
    expect(shown.size).toBe("a4");
    expect(shown.landscape).toBe(true);
    expect(pageDimensions(shown)).toEqual({ width: 1123, height: 794 });
    expect(shown.marginTop).toBe(inch(1.5));
    expect(shown.header).toBe("Town council");
    expect(shown.headerFromEdge).toBe(inch(0.75));
    expect(paperSizeCaption(shown)).toBe("A4, 11.7 × 8.27 in");
  });

  it("fits landscape in the same preview frame as portrait", () => {
    const zoom = paperPreviewZoom(450, 560);
    expect(zoom).toBeLessThan(1);
    const wide = pageDimensions(page({ landscape: true }));
    const a4 = pageDimensions(page({ size: "a4", landscape: true }));
    expect(wide.width).toBeGreaterThan(wide.height);
    expect(wide.width * zoom).toBeLessThanOrEqual(450);
    expect(wide.height * zoom).toBeLessThanOrEqual(560);
    expect(a4.width * zoom).toBeLessThanOrEqual(450);
    expect(a4.height * zoom).toBeLessThanOrEqual(560);
    expect(a4.width).toBeGreaterThan(a4.height);
  });
});
