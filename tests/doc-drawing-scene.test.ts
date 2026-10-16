import { describe, expect, it } from "vitest";
import { drawingRecord, readDrawing } from "../apps/web/src/editors/doc-drawing-scene";

describe("drawing scenes", () => {
  it("keeps the shapes and drops a deleted one", () => {
    const json = drawingRecord({
      elements: [
        { isDeleted: false, id: "box" },
        { isDeleted: true, id: "gone" },
      ],
      appState: { viewBackgroundColor: "#fff8e7" },
      files: {},
    });
    const scene = readDrawing(json);
    expect(scene?.elements).toEqual([{ isDeleted: false, id: "box" }]);
    expect(scene?.appState.viewBackgroundColor).toBe("#fff8e7");
  });

  it("rejects a scene that is not JSON", () => {
    expect(readDrawing("not json")).toBeNull();
    expect(drawingRecord({ elements: [] })).toBeNull();
  });

  it("drops a scene that would dwarf the document", () => {
    expect(drawingRecord({ elements: [{ id: "x".repeat(1_500_001) }] })).toBeNull();
    expect(readDrawing("x".repeat(1_500_001))).toBeNull();
  });
});
