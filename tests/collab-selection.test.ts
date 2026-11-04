import { describe, expect, it } from "vitest";
import {
  localSelectionMessage,
  localSheetSelectionMessage,
  localSlideSelectionMessage,
  remoteCaret,
  remoteSheetSelection,
  remoteSlideSelection,
  sheetSelectionLabel,
  slideSelectionLabel,
} from "../apps/web/src/collab/selection";

describe("live carets", () => {
  it("sends a caret and ignores a message that carries the paragraph", () => {
    expect(localSelectionMessage(1, 4)).toEqual({ type: "selection", anchor: 1, head: 4 });
    expect(localSelectionMessage(-1, 4)).toBeNull();
    expect(localSelectionMessage(1.5, 4)).toBeNull();
    expect(
      remoteCaret({ type: "selection", name: "Maya", anchor: 1, head: 4 }, "Sam"),
    ).toEqual({ name: "Maya", anchor: 1, head: 4 });
    expect(
      remoteCaret(
        { type: "selection", name: "Maya", anchor: 1, head: 4, text: "Tomatoes are in" },
        "Sam",
      ),
    ).toBeNull();
    expect(remoteCaret({ type: "selection", name: "Sam", anchor: 1, head: 4 }, "Sam")).toBeNull();
    expect(localSheetSelectionMessage({
      sheetId: "fees",
      startRow: 0,
      startColumn: 0,
      endRow: 1,
      endColumn: 1,
    })).toEqual({
      type: "selection",
      sheetId: "fees",
      startRow: 0,
      startColumn: 0,
      endRow: 1,
      endColumn: 1,
    });
    expect(localSheetSelectionMessage({
      sheetId: "secret-value\nfees",
      startRow: 0,
      startColumn: 0,
      endRow: 0,
      endColumn: 0,
    })).toBeNull();
    expect(localSheetSelectionMessage({
      sheetId: "fees",
      startRow: 2,
      startColumn: 0,
      endRow: 1,
      endColumn: 0,
    })).toBeNull();
    const range = remoteSheetSelection({
      type: "selection",
      name: "Maya",
      sheetId: "fees",
      startRow: 0,
      startColumn: 0,
      endRow: 1,
      endColumn: 1,
    }, "Sam");
    expect(range && sheetSelectionLabel(range)).toBe("Maya A1:B2");
    expect(remoteSheetSelection({
      type: "selection",
      name: "Maya",
      sheetId: "fees",
      startRow: 0,
      startColumn: 0,
      endRow: 0,
      endColumn: 0,
      text: "North",
    }, "Sam")).toBeNull();
    expect(remoteSheetSelection({
      type: "selection",
      name: "Sam",
      sheetId: "fees",
      startRow: 0,
      startColumn: 0,
      endRow: 0,
      endColumn: 0,
    }, "Sam")).toBeNull();
    expect(remoteSheetSelection({
      type: "selection",
      name: "Maya",
      anchor: 1,
      head: 4,
    }, "Sam")).toBeNull();
    expect(remoteSheetSelection(null, "Sam")).toBeNull();
    expect(remoteSheetSelection({ type: "update" }, "Sam")).toBeNull();
    expect(remoteSheetSelection({
      type: "selection",
      name: "Maya",
      sheetId: "fees",
      startRow: 0,
      startColumn: 0,
      endRow: 0,
      endColumn: 0,
      update: "x",
    }, "Sam")).toBeNull();
    expect(remoteSheetSelection({
      type: "selection",
      name: "",
      sheetId: "fees",
      startRow: 0,
      startColumn: 0,
      endRow: 0,
      endColumn: 0,
    }, "Sam")).toBeNull();
    expect(remoteSheetSelection({
      type: "selection",
      name: 1,
      sheetId: 4,
      startRow: 0,
      startColumn: 0,
      endRow: 0,
      endColumn: 0,
    }, "Sam")).toBeNull();
    expect(localSheetSelectionMessage({
      sheetId: "fees",
      startRow: 0,
      startColumn: 1,
      endRow: 0,
      endColumn: 0,
    })).toBeNull();
    expect(localSheetSelectionMessage({
      sheetId: "",
      startRow: 0,
      startColumn: 0,
      endRow: 0,
      endColumn: 0,
    })).toBeNull();
    expect(localSheetSelectionMessage({
      sheetId: "n".repeat(81),
      startRow: 0,
      startColumn: 0,
      endRow: 0,
      endColumn: 0,
    })).toBeNull();
    expect(localSheetSelectionMessage({
      sheetId: "fees",
      startRow: 0,
      startColumn: 0,
      endRow: 0,
      endColumn: 1_000_001,
    })).toBeNull();
    const one = remoteSheetSelection({
      type: "selection",
      name: "Maya",
      sheetId: "fees",
      startRow: 0,
      startColumn: 26,
      endRow: 0,
      endColumn: 26,
    }, "Sam");
    expect(one && sheetSelectionLabel(one)).toBe("Maya AA1");
    expect(remoteCaret(null, "Sam")).toBeNull();
    expect(remoteCaret({ type: "selection", name: "Maya", anchor: 1 }, "Sam")).toBeNull();
  });

  it("reports another person's slide without moving this person's slide", () => {
    expect(localSlideSelectionMessage({ slideId: "s1", elementId: "pic" })).toEqual({
      type: "selection",
      slideId: "s1",
      elementId: "pic",
    });
    expect(localSlideSelectionMessage({ slideId: "secret-value\ns1" })).toBeNull();
    expect(localSlideSelectionMessage({ slideId: "s1", elementId: "secret-value\npic" })).toBeNull();
    expect(remoteSlideSelection(null, "Sam")).toBeNull();
    expect(remoteSlideSelection({ type: "selection", name: "", slideId: "s2" }, "Sam")).toBeNull();
    expect(remoteSlideSelection({ type: "selection", name: "Maya", slideId: "secret-value\ns2" }, "Sam")).toBeNull();
    expect(remoteSlideSelection({ type: "selection", name: "Maya", slideId: "s2", notes: "Water the beds" }, "Sam")).toBeNull();
    expect(remoteSlideSelection({ type: "selection", name: "Maya", slideId: "s2", elementId: "secret-value\npic" }, "Sam")).toBeNull();
    const remote = remoteSlideSelection(
      { type: "selection", name: "Maya", slideId: "s2", elementId: "title" },
      "Sam",
    );
    expect(remote).toEqual({ name: "Maya", slideId: "s2", elementId: "title" });
    expect(remote && slideSelectionLabel(remote, "North")).toBe("Maya is on North, object title");
    expect(
      remoteSlideSelection(
        { type: "selection", name: "Maya", slideId: "s2", title: "North beds" },
        "Sam",
      ),
    ).toBeNull();
    expect(JSON.stringify(remote)).not.toContain("secret-value");
    expect(slideSelectionLabel(
      { name: "Maya", slideId: "s2" },
      "secret-value\nNorth",
    )).toBe("Maya is on a slide");
  });
});
