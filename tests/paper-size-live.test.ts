import { describe, expect, it } from "vitest";
import {
  documentPageSettings,
  pageDimensions,
  type PageSettings,
} from "../packages/core/src/document-layout";
import { livePageSettings } from "../apps/web/src/editors/margin-live";
import {
  livePaperSize,
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

describe("live paper size", () => {
  it("draws A4 before apply and draws the draft header with the margin", () => {
    const saved = page();
    const shown = livePageSettings(saved, {
      ...saved,
      size: "a4",
      header: "Agenda",
      marginTop: inch(1.5),
    });
    expect(shown.size).toBe("a4");
    expect(shown.landscape).toBe(false);
    expect(pageDimensions(shown)).toEqual({ width: 794, height: 1123 });
    expect(shown.header).toBe("Agenda");
    expect(shown.footer).toBe("Hearing notes");
    expect(shown.marginTop).toBe(inch(1.5));
    expect(shown.headerFromEdge).toBe(inch(0.75));
  });

  it("returns the saved page when the size did not change", () => {
    const saved = page();
    expect(livePaperSize(saved, { ...saved, header: "Agenda" })).toBe(saved);
  });

  it("keeps Letter when cancel would draw the saved page again", () => {
    const saved = page();
    const shown = livePageSettings(saved, { ...saved, size: "letter" });
    expect(shown.size).toBe("letter");
    expect(pageDimensions(shown)).toEqual(pageDimensions(saved));
  });

  it("names Letter and A4 in inches", () => {
    expect(paperSizeCaption(page())).toBe("Letter, 8.5 × 11 in");
    expect(paperSizeCaption(page({ size: "a4" }))).toBe("A4, 8.27 × 11.7 in");
  });

  it("uses one zoom so A4 is taller and narrower than Letter", () => {
    const zoom = paperPreviewZoom(450, 560);
    expect(zoom).toBeLessThan(1);
    const letter = pageDimensions(page());
    const a4 = pageDimensions(page({ size: "a4" }));
    expect(a4.width * zoom).toBeLessThan(letter.width * zoom);
    expect(a4.height * zoom).toBeGreaterThan(letter.height * zoom);
    expect(a4.height * zoom).toBeLessThanOrEqual(560);
    expect(letter.width * zoom).toBeLessThanOrEqual(450);
  });
});
