import { describe, expect, it } from "vitest";
import {
  bodyEdgeInsets,
  documentPageSettings,
  edgeDistanceError,
  edgeIntrusionNote,
} from "../packages/core/src/document-layout";
import { exportDocx } from "../packages/core/src/docx-export";
import { createFile } from "../packages/core/src";
import JSZip from "jszip";

const inch = (n: number) => n * 96;

function layout(headerFromEdge: number, footerFromEdge = inch(1)) {
  return {
    marginTop: inch(1),
    marginBottom: inch(1),
    marginLeft: inch(1),
    marginRight: inch(1),
    header: "Town council",
    footer: "Hearing notes",
    headerFromEdge,
    footerFromEdge,
  };
}

describe("header and footer distance from the edge", () => {
  it("opens without a distance on the margin, the same inset as the text", () => {
    const settings = documentPageSettings({
      type: "doc",
      attrs: { pageSettings: { margin: 96, header: "Town council" } },
    });
    expect(settings.marginTop).toBe(96);
    expect(settings.headerFromEdge).toBe(96);
    expect(settings.footerFromEdge).toBe(96);
    expect(bodyEdgeInsets(settings).top).toBe(96);
  });

  it("keeps a saved distance and does not pull it back to the margin", () => {
    const settings = documentPageSettings({
      type: "doc",
      attrs: {
        pageSettings: {
          margin: 96,
          marginTop: 96,
          headerFromEdge: inch(0.5),
          footerFromEdge: inch(1.5),
        },
      },
    });
    expect(settings.headerFromEdge).toBe(inch(0.5));
    expect(settings.footerFromEdge).toBe(inch(1.5));
    expect(settings.marginTop).toBe(96);
  });

  it("refuses a distance under 0.25 inches and accepts 0.5 and 1.5", () => {
    expect(edgeDistanceError("header", 0)).toMatch(/at least 0.25 inches/);
    expect(edgeDistanceError("footer", inch(0.2))).toMatch(/footer/);
    expect(edgeDistanceError("header", inch(0.25))).toBeNull();
    expect(edgeDistanceError("header", inch(0.5))).toBeNull();
    expect(edgeDistanceError("header", inch(1.5))).toBeNull();
  });

  it("moves only the header at 0.5 inches and pushes the body at 1.5 without changing the margin", () => {
    const clear = layout(inch(0.5));
    expect(bodyEdgeInsets(clear).top).toBe(inch(1));
    expect(edgeIntrusionNote("header", clear)).toBeNull();
    const into = layout(inch(1.5));
    const insets = bodyEdgeInsets(into);
    expect(insets.top).toBeGreaterThan(inch(1.5));
    expect(insets.bottom).toBe(inch(1));
    expect(edgeIntrusionNote("header", into)).toMatch(/inside the text area/);
    expect(edgeIntrusionNote("header", into)).toMatch(/moves down/);
    expect(into.marginTop).toBe(inch(1));
  });

  it("pushes the body up when the footer crosses the bottom margin", () => {
    const into = layout(inch(1), inch(1.5));
    expect(bodyEdgeInsets(into).bottom).toBeGreaterThan(inch(1.5));
    expect(bodyEdgeInsets(into).top).toBe(inch(1));
    expect(edgeIntrusionNote("footer", into)).toMatch(/moves up/);
    expect(edgeIntrusionNote("footer", into)).toMatch(/does not change/);
  });

  it("writes the distances into the Word page margins without changing the body edges", async () => {
    const file = createFile("doc", "Thesis notes");
    if (file.kind !== "doc") throw new Error("expected a document");
    file.content = {
      type: "doc",
      attrs: {
        pageSettings: {
          margin: 96,
          marginTop: 96,
          marginBottom: 96,
          marginLeft: 96,
          marginRight: 96,
          header: "Town council",
          footer: "Hearing notes",
          headerFromEdge: inch(0.5),
          footerFromEdge: inch(1.5),
        },
      },
      content: [{ type: "paragraph", content: [{ type: "text", text: "Notes" }] }],
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain('w:header="720"');
    expect(xml).toContain('w:footer="2160"');
    expect(xml).toContain('w:top="1440"');
  });
});
