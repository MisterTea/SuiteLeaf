import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { connectDocs } from "../packages/core/src/collab";
import { mirrorSlides, seedSlideRoom } from "../apps/web/src/collab/slide-room";
import {
  noteSlideEdit,
  redoLocalSlide,
  slideConflictText,
  undoLocalSlide,
} from "../apps/web/src/collab/slide-undo";

function snap(doc: Y.Doc) {
  return {
    elements: new Map(doc.getMap<string>("slideElements").entries()),
    slides: new Map(doc.getMap<string>("slides").entries()),
  };
}

describe("slide undo", () => {
  it("takes back a local object and leaves one someone else changed", () => {
    const local = new Y.Doc();
    const remote = new Y.Doc();
    connectDocs(local, remote);
    const before = snap(local);
    mirrorSlides(local, {
      slideOrder: ["s1"],
      slides: {
        s1: {
          id: "s1",
          elements: [
            { id: "a", text: "West" },
            { id: "b", text: "North" },
          ],
        },
      },
    }, { added: ["s1"] });
    const after = snap(local);
    noteSlideEdit(local, before.elements, after.elements, before.slides, after.slides);
    remote.getMap<string>("slideElements").set("s1\u001fb", JSON.stringify({ id: "b", text: "Beans" }));
    const undone = undoLocalSlide(local);
    expect(JSON.parse(local.getMap<string>("slideElements").get("s1\u001fb")!).text).toBe("Beans");
    expect(local.getMap<string>("slideElements").has("s1\u001fa")).toBe(false);
    const notice = slideConflictText(undone?.conflicts ?? []);
    expect(notice).toBe("s1 b was changed by someone else and was left as it is.");
    expect(notice).not.toContain("North");
    expect(notice).not.toContain("Beans");
    expect(notice).not.toContain("secret-value");
    const redone = redoLocalSlide(local);
    expect(redone?.conflicts).toEqual([]);
    expect(JSON.parse(local.getMap<string>("slideElements").get("s1\u001fa")!).text).toBe("West");
    expect(undoLocalSlide(new Y.Doc())).toBeNull();
    expect(slideConflictText([])).toBe("An object was changed by someone else and was left as it is.");
    expect(slideConflictText(["slideElements\u001fsecret-value\nb"])).toBe(
      "An object was changed by someone else and was left as it is.",
    );
    expect(slideConflictText(["slides\u001fs2"])).toBe(
      "s2 was changed by someone else and was left as it is.",
    );
    expect(slideConflictText(["slideElements\u001fs1\u001fa", "slides\u001fs2"])).toBe(
      "s1 a, s2 were changed by someone else and were left as they are.",
    );
    const quiet = new Y.Doc();
    quiet.getMap<string>("slideElements").set("s1\u001fa", "same");
    const same = new Map([["s1\u001fa", "same"]]);
    noteSlideEdit(quiet, same, same, new Map(), new Map());
    expect(undoLocalSlide(quiet)).toBeNull();
    const blocked = new Y.Doc();
    const empty = new Map<string, string>();
    blocked.getMap<string>("slideElements").set("s1\u001fb", JSON.stringify({ text: "North" }));
    noteSlideEdit(blocked, empty, new Map(blocked.getMap<string>("slideElements").entries()), empty, empty);
    blocked.getMap<string>("slideElements").set("s1\u001fb", JSON.stringify({ text: "Beans" }));
    const stayed = undoLocalSlide(blocked);
    expect(stayed?.conflicts).toEqual(["slideElements\u001fs1\u001fb"]);
    expect(JSON.parse(blocked.getMap<string>("slideElements").get("s1\u001fb")!).text).toBe("Beans");
  });

  it("seeds an empty room so undo keeps the original slide", () => {
    const doc = new Y.Doc();
    const deck = {
      slideOrder: ["only"],
      slides: {
        only: {
          id: "only",
          elements: [{ id: "w", type: "text", content: "Intro" }],
        },
      },
    };
    seedSlideRoom(doc, deck);
    expect(undoLocalSlide(doc)).toBeNull();
    expect(doc.getMap("slides").has("only")).toBe(true);
    expect(JSON.parse(doc.getMap<string>("slideElements").get("only\u001fw")!).content).toBe("Intro");

    const before = snap(doc);
    mirrorSlides(doc, {
      slideOrder: ["only"],
      slides: {
        only: {
          id: "only",
          elements: [
            { id: "w", type: "text", content: "Intro" },
            { id: "shape", type: "shape", shapeType: "rect" },
          ],
        },
      },
    }, { edited: ["only"] });
    noteSlideEdit(
      doc,
      before.elements,
      new Map(doc.getMap<string>("slideElements").entries()),
      before.slides,
      new Map(doc.getMap<string>("slides").entries()),
    );
    expect(undoLocalSlide(doc)?.conflicts).toEqual([]);
    expect(doc.getMap("slides").has("only")).toBe(true);
    expect(JSON.parse(doc.getMap<string>("slideElements").get("only\u001fw")!).content).toBe("Intro");
    expect(doc.getMap("slideElements").has("only\u001fshape")).toBe(false);

    const occupied = new Y.Doc();
    occupied.getMap("slides").set("keep", "{}");
    seedSlideRoom(occupied, deck);
    expect(occupied.getMap("slides").has("only")).toBe(false);
    const ordered = new Y.Doc();
    ordered.getMap("slideOrder").set("order", "[]");
    seedSlideRoom(ordered, deck);
    expect(ordered.getMap("slides").size).toBe(0);
    seedSlideRoom(new Y.Doc(), { slideOrder: [], slides: {} });
    seedSlideRoom(doc, deck);
    expect(doc.getMap("slideElements").has("only\u001fshape")).toBe(false);
  });
});
