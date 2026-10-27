import { describe, expect, it } from "vitest";
import { createFile, type Presentation, type SlideFile } from "@suiteleaf/core";
import {
  DeckHistory,
  PASTE_NUDGE,
  canDeleteSlides,
  centeredTextBox,
  commandFromKey,
  deleteSlides,
  duplicateSlides,
  moveSelection,
  pastedElements,
  reorderGroup,
  shapeElement,
  withElements,
} from "../apps/web/src/editors/slide-editing";

function deck(labels: string[]): Presentation {
  const file = createFile("slide", "Q3 update") as SlideFile;
  const first = file.content.slideOrder[0];
  file.content.slides[first].elements[0].content = labels[0];
  for (const label of labels.slice(1)) {
    const id = `slide-${label}`;
    file.content.slideOrder.push(id);
    file.content.slides[id] = {
      id,
      elements: [
        {
          id: `text-${label}`,
          type: "text",
          x: 80,
          y: 40,
          width: 400,
          height: 60,
          content: label,
        },
      ],
    };
  }
  file.content.slides[first].id = first;
  return file.content;
}

const labelsOf = (presentation: Presentation) =>
  presentation.slideOrder.map(
    (id) =>
      presentation.slides[id].elements.find((el) => el.content)?.content ?? id,
  );

const key = (
  name: string,
  mods: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean; repeat?: boolean } = {},
) => ({
  key: name,
  metaKey: !!mods.meta,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
  repeat: !!mods.repeat,
});

describe("slide rearranging", () => {
  const initial = [
    "Q3 update",
    "Old pipeline",
    "Old targets",
    "Agenda",
    "Roadmap",
    "Results",
    "Chart",
    "Appendix",
  ];

  it("moves a slide to the start with Cmd+Shift+Up and keeps a dragged group in order", () => {
    const presentation = deck(initial);
    const results = presentation.slideOrder[5];
    const moved = moveSelection(presentation.slideOrder, [results], "start");
    expect(labelsOf({ ...presentation, slideOrder: moved })).toEqual([
      "Results",
      "Q3 update",
      "Old pipeline",
      "Old targets",
      "Agenda",
      "Roadmap",
      "Chart",
      "Appendix",
    ]);

    const outdated = [moved[2], moved[3]];
    const grouped = reorderGroup(moved, outdated, 7);
    expect(labelsOf({ ...presentation, slideOrder: grouped })).toEqual([
      "Results",
      "Q3 update",
      "Agenda",
      "Roadmap",
      "Chart",
      "Old pipeline",
      "Old targets",
      "Appendix",
    ]);
  });

  it("moves a non-contiguous selection one slot without reordering it", () => {
    const order = ["a", "b", "c", "d", "e"];
    expect(moveSelection(order, ["b", "d"], "up")).toEqual(["b", "a", "d", "c", "e"]);
    expect(moveSelection(order, ["b", "d"], "down")).toEqual(["a", "c", "b", "e", "d"]);
    expect(moveSelection(["a", "b"], ["a"], "up")).toEqual(["a", "b"]);
    expect(moveSelection(order, ["b", "d"], "end")).toEqual(["a", "c", "e", "b", "d"]);
  });

  it("duplicates after the last selected slide and deletes the group in one step", () => {
    let presentation = deck(["Results", "Chart", "Old pipeline", "Old targets"]);
    const chart = presentation.slideOrder[1];
    const duplicated = duplicateSlides(presentation, [chart], () => "copy-1");
    presentation = duplicated.deck;
    expect(labelsOf(presentation)).toEqual([
      "Results",
      "Chart",
      "Chart",
      "Old pipeline",
      "Old targets",
    ]);
    expect(duplicated.newIds).toEqual(["copy-1"]);

    const outdated = presentation.slideOrder.slice(3);
    expect(canDeleteSlides(presentation.slideOrder, outdated)).toBe(true);
    const removed = deleteSlides(presentation, outdated);
    expect("error" in removed).toBe(false);
    if ("error" in removed) return;
    expect(removed.removed).toBe(2);
    expect(labelsOf(removed.deck)).toEqual(["Results", "Chart", "Chart"]);
    expect(deleteSlides(removed.deck, removed.deck.slideOrder)).toEqual({
      error: "Presentations must have at least one slide.",
    });
  });

  it("pastes at the original position and nudges a second copy on the same slide", () => {
    const presentation = deck(["Results"]);
    const slideId = presentation.slideOrder[0];
    const shape = shapeElement("roundRect", 960, 540, () => "shape");
    const withShape = withElements(presentation, slideId, [shape]);
    const elsewhere = pastedElements(
      [],
      [shape],
      () => "pasted",
      { width: 960, height: 540 },
    );
    expect(elsewhere[0]).toMatchObject({ x: shape.x, y: shape.y });
    const again = pastedElements(
      withShape.slides[slideId].elements,
      [shape],
      () => "nudged",
      { width: 960, height: 540 },
    );
    expect(again[0].x).toBe(shape.x + PASTE_NUDGE);
    expect(again[0].y).toBe(shape.y + PASTE_NUDGE);
    expect(again[0].id).not.toBe(shape.id);
  });

  it("puts a new text box in the middle of the slide", () => {
    const box = centeredTextBox(960, 540, () => "box");
    expect(box.x + box.width / 2).toBe(480);
    expect(box.y + box.height / 2).toBe(270);
  });

  it("maps menu shortcuts from the canvas and refuses them while typing a title", () => {
    expect(commandFromKey(key("z", { meta: true }), "none")).toEqual({ type: "undo" });
    expect(commandFromKey(key("z", { ctrl: true, shift: true }), "none")).toEqual({
      type: "redo",
    });
    expect(commandFromKey(key("y", { meta: true }), "none")).toEqual({
      type: "redo",
    });
    expect(commandFromKey(key("d", { ctrl: true }), "none")).toEqual({ type: "duplicate" });
    expect(commandFromKey(key("ArrowUp", { meta: true, shift: true }), "none")).toEqual({
      type: "move",
      where: "start",
    });
    expect(commandFromKey(key("ArrowDown", { ctrl: true }), "none")).toEqual({
      type: "move",
      where: "down",
    });
    expect(commandFromKey(key("Delete"), "none")).toEqual({ type: "delete" });
    expect(commandFromKey(key("Backspace"), "none")).toEqual({ type: "delete" });
    expect(commandFromKey(key("b", { meta: true }), "slide-text")).toEqual({ type: "bold" });
    expect(commandFromKey(key("u", { ctrl: true }), "slide-text")).toEqual({ type: "underline" });
    expect(commandFromKey(key("d", { meta: true }), "slide-text")).toBeNull();
    expect(commandFromKey(key("z", { meta: true }), "other")).toBeNull();
    expect(commandFromKey(key("z", { meta: true }), "notes")).toEqual({ type: "undo" });
  });

  it("changes slides with Right and Left only when nothing on the slide is selected", () => {
    expect(commandFromKey(key("ArrowRight"), "none")).toEqual({ type: "go", where: "next" });
    expect(commandFromKey(key("ArrowLeft", { repeat: true }), "none")).toEqual({
      type: "go",
      where: "prev",
    });
    expect(commandFromKey(key("ArrowRight"), "none", true)).toBeNull();
    expect(commandFromKey(key("ArrowRight", { shift: true }), "none")).toBeNull();
    expect(commandFromKey(key("ArrowLeft", { meta: true }), "none")).toBeNull();
    expect(commandFromKey(key("ArrowRight"), "slide-text")).toBeNull();
    expect(commandFromKey(key("ArrowRight"), "notes")).toBeNull();
    expect(commandFromKey(key("ArrowRight"), "other")).toBeNull();
  });

  it("returns to the exact starting deck after 10 mixed edits are undone", () => {
    const start = deck(["Results", "Chart", "Appendix"]);
    const history = new DeckHistory(start);
    let current = structuredClone(start);
    const commit = (next: Presentation) => {
      history.commit(next);
      current = next;
    };
    const id = () => crypto.randomUUID();

    commit({
      ...current,
      slideOrder: moveSelection(current.slideOrder, [current.slideOrder[1]], "up"),
    });
    const duplicated = duplicateSlides(current, [current.slideOrder[0]], id);
    commit(duplicated.deck);
    const removed = deleteSlides(current, [duplicated.newIds[0]]);
    if ("error" in removed) throw new Error(removed.error);
    commit(removed.deck);
    const box = centeredTextBox(current.width, current.height, id);
    commit(withElements(current, current.slideOrder[0], [box]));
    const slideId = current.slideOrder[0];
    const bolded = {
      ...current,
      slides: {
        ...current.slides,
        [slideId]: {
          ...current.slides[slideId],
          elements: current.slides[slideId].elements.map((el) =>
            el.id === box.id ? { ...el, bold: true } : el,
          ),
        },
      },
    };
    commit(bolded);
    current = bolded;
    const centered = {
      ...current,
      slides: {
        ...current.slides,
        [slideId]: {
          ...current.slides[slideId],
          elements: current.slides[slideId].elements.map((el) =>
            el.id === box.id ? { ...el, align: "center" as const } : el,
          ),
        },
      },
    };
    commit(centered);
    current = centered;
    const shape = shapeElement("roundRect", current.width, current.height, id);
    commit(withElements(current, slideId, [shape]));
    commit({
      ...current,
      slideOrder: moveSelection(current.slideOrder, [current.slideOrder.at(-1)!], "start"),
    });
    const again = duplicateSlides(current, [current.slideOrder[1]], id);
    commit(again.deck);
    const gone = deleteSlides(current, [again.newIds[0]]);
    if ("error" in gone) throw new Error(gone.error);
    commit(gone.deck);

    expect(history.canUndo).toBe(true);
    for (let i = 0; i < 10; i++) {
      const prev = history.undo();
      expect(prev).not.toBeNull();
      current = prev!;
    }
    expect(current).toEqual(history.tip);
    expect(current).toEqual(start);
    expect(history.canUndo).toBe(false);
  });

  it("collapses typing in one text box into a single undo step", () => {
    const start = deck(["Results"]);
    const history = new DeckHistory(start);
    const slideId = start.slideOrder[0];
    let content = "";
    for (const ch of "Shipped") {
      content += ch;
      const next = structuredClone(start);
      next.slides[slideId].elements[0].content = content;
      history.commit(next, `type:${next.slides[slideId].elements[0].id}`);
    }
    expect(history.undo()?.slides[slideId].elements[0].content).toBe("Results");
    expect(history.canUndo).toBe(false);
  });
});
