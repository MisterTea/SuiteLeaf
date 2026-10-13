import { describe, expect, it } from "vitest";
import { createFile, type Presentation, type SlideFile } from "@suiteleaf/core";
import {
  DeckHistory,
  PASTE_NUDGE,
  canDeleteSlides,
  alignBoxes,
  spaceBoxesEvenly,
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

describe("alignBoxes", () => {
  const market = {
    id: "market",
    type: "text" as const,
    x: 72,
    y: 150,
    width: 180,
    height: 72,
    content: "Market",
  };
  const saturday = {
    id: "saturday",
    type: "text" as const,
    x: 360,
    y: 310,
    width: 640,
    height: 88,
    content: "Saturday",
  };
  const notes = {
    id: "notes",
    type: "text" as const,
    x: 760,
    y: 40,
    width: 160,
    height: 64,
    content: "Notes",
  };
  const elements = [market, saturday, notes];

  it("lines up the left edge, then the top, and leaves everyone else alone", () => {
    const left = alignBoxes(elements, ["market", "saturday"], "left");
    expect(left.map((el) => el.id)).toEqual(["market", "saturday"]);
    expect(left.find((el) => el.id === "notes")).toBeUndefined();
    expect(left.find((el) => el.id === "market")).toBe(market);
    const moved = left.find((el) => el.id === "saturday")!;
    expect(moved.x).toBe(market.x);
    expect(moved.y).toBe(saturday.y);
    expect(moved.width).toBe(saturday.width);
    expect(moved.content).toBe("Saturday");
    expect(market.width).toBe(180);
    expect(market.content).toBe("Market");

    const afterLeft = elements.map(
      (el) => left.find((aligned) => aligned.id === el.id) ?? el,
    );
    const top = alignBoxes(afterLeft, ["market", "saturday"], "top");
    expect(top.map((el) => el.id)).not.toContain("notes");
    const lifted = top.find((el) => el.id === "saturday")!;
    expect(lifted.y).toBe(market.y);
    expect(lifted.x).toBe(market.x);
    expect(lifted.width).toBe(saturday.width);
    expect(lifted.content).toBe("Saturday");

    const alone = alignBoxes(elements, ["saturday"], "left");
    expect(alone).toEqual([saturday]);
    expect(alone[0]).toBe(saturday);
    expect(alone[0].x).toBe(360);
  });

  it("lines up the further right edge, then the lower bottom, and leaves everyone else alone", () => {
    const wide = {
      id: "market",
      type: "text" as const,
      x: 72,
      y: 120,
      width: 540,
      height: 90,
      content: "Market",
    };
    const narrow = {
      id: "saturday",
      type: "text" as const,
      x: 500,
      y: 220,
      width: 240,
      height: 200,
      content: "Saturday",
    };
    const aside = {
      id: "notes",
      type: "text" as const,
      x: 36,
      y: 20,
      width: 168,
      height: 64,
      content: "Notes",
    };
    const boxes = [wide, narrow, aside];
    expect(wide.width).toBeGreaterThan(narrow.width);
    expect(narrow.x + narrow.width).toBeGreaterThan(wide.x + wide.width);
    expect(narrow.y + narrow.height).toBeGreaterThan(wide.y + wide.height);

    const right = alignBoxes(boxes, ["market", "saturday"], "right");
    expect(right.map((el) => el.id)).toEqual(["market", "saturday"]);
    expect(right.find((el) => el.id === "notes")).toBeUndefined();
    expect(right.find((el) => el.id === "saturday")).toBe(narrow);
    const moved = right.find((el) => el.id === "market")!;
    const furthest = narrow.x + narrow.width;
    expect(moved.x + moved.width).toBe(furthest);
    expect(moved.width).toBe(wide.width);
    expect(moved.y).toBe(wide.y);
    expect(moved.height).toBe(wide.height);
    expect(moved.content).toBe("Market");
    expect(narrow.content).toBe("Saturday");

    const afterRight = boxes.map(
      (el) => right.find((aligned) => aligned.id === el.id) ?? el,
    );
    const bottom = alignBoxes(afterRight, ["market", "saturday"], "bottom");
    expect(bottom.map((el) => el.id)).not.toContain("notes");
    expect(bottom.find((el) => el.id === "saturday")).toBe(narrow);
    const dropped = bottom.find((el) => el.id === "market")!;
    expect(dropped.y + dropped.height).toBe(narrow.y + narrow.height);
    expect(dropped.x).toBe(moved.x);
    expect(dropped.width).toBe(wide.width);
    expect(dropped.height).toBe(wide.height);
    expect(dropped.content).toBe("Market");
    expect(afterRight.find((el) => el.id === "notes")).toEqual(aside);

    const aloneRight = alignBoxes(boxes, ["market"], "right");
    expect(aloneRight).toEqual([wide]);
    expect(aloneRight[0]).toBe(wide);
    expect(aloneRight[0].x).toBe(72);
    const aloneBottom = alignBoxes(boxes, ["saturday"], "bottom");
    expect(aloneBottom[0]).toBe(narrow);
    expect(aloneBottom[0].y).toBe(220);
  });
});

describe("spaceBoxesEvenly", () => {
  const gapAcross = (
    left: { x: number; width: number },
    right: { x: number },
  ) => right.x - (left.x + left.width);
  const gapDown = (
    upper: { y: number; height: number },
    lower: { y: number },
  ) => lower.y - (upper.y + upper.height);

  const market = {
    id: "market",
    type: "text" as const,
    x: 36,
    y: 56,
    width: 250,
    height: 78,
    content: "Market",
  };
  const saturday = {
    id: "saturday",
    type: "text" as const,
    x: 600,
    y: 56,
    width: 170,
    height: 78,
    content: "Saturday",
  };
  const notes = {
    id: "notes",
    type: "text" as const,
    x: 790,
    y: 56,
    width: 150,
    height: 78,
    content: "Notes",
  };
  const door = {
    id: "door",
    type: "text" as const,
    x: 36,
    y: 210,
    width: 170,
    height: 70,
    content: "Door",
  };
  const elements = [market, door, saturday, notes];

  it("evens the gaps between different widths and leaves the outer boxes and Door", () => {
    expect(market.width).not.toBe(saturday.width);
    expect(saturday.width).not.toBe(notes.width);
    expect(gapAcross(market, saturday)).not.toBe(gapAcross(saturday, notes));

    const spaced = spaceBoxesEvenly(
      elements,
      ["notes", "market", "saturday"],
      "across",
    );
    expect(spaced.map((el) => el.id)).toEqual(["market", "saturday", "notes"]);
    expect(spaced.find((el) => el.id === "door")).toBeUndefined();
    expect(spaced.find((el) => el.id === "market")).toBe(market);
    expect(spaced.find((el) => el.id === "notes")).toBe(notes);
    const middle = spaced.find((el) => el.id === "saturday")!;
    expect(middle).not.toBe(saturday);
    expect(gapAcross(market, middle)).toBe(gapAcross(middle, notes));
    expect(middle.x).toBe(453);
    expect(middle.y).toBe(saturday.y);
    expect(middle.width).toBe(saturday.width);
    expect(middle.height).toBe(saturday.height);
    expect(middle.content).toBe("Saturday");
    expect(market.content).toBe("Market");
    expect(notes.content).toBe("Notes");
    expect(notes.width).toBe(150);

    const byId = new Map(spaced.map((el) => [el.id, el]));
    const next = elements.map((el) => byId.get(el.id) ?? el);
    const moved = next.filter((el, index) => el !== elements[index]);
    expect(moved.map((el) => el.id)).toEqual(["saturday"]);
    expect(moved.map((el) => el.id)).not.toContain("door");
    expect(next.find((el) => el.id === "door")).toBe(door);
  });

  it("evens vertical gaps and keeps each box's x", () => {
    const cedar = {
      id: "cedar",
      type: "text" as const,
      x: 64,
      y: 24,
      width: 230,
      height: 88,
      content: "Cedar",
    };
    const maple = {
      id: "maple",
      type: "text" as const,
      x: 380,
      y: 128,
      width: 150,
      height: 60,
      content: "Maple",
    };
    const birch = {
      id: "birch",
      type: "text" as const,
      x: 150,
      y: 360,
      width: 200,
      height: 64,
      content: "Birch",
    };
    const stacked = [birch, maple, cedar, door];
    expect(cedar.height).not.toBe(maple.height);
    expect(gapDown(cedar, maple)).not.toBe(gapDown(maple, birch));

    const spaced = spaceBoxesEvenly(
      stacked,
      ["maple", "birch", "cedar"],
      "down",
    );
    expect(spaced.map((el) => el.id)).toEqual(["birch", "maple", "cedar"]);
    expect(spaced.find((el) => el.id === "door")).toBeUndefined();
    expect(spaced.find((el) => el.id === "cedar")).toBe(cedar);
    expect(spaced.find((el) => el.id === "birch")).toBe(birch);
    const middle = spaced.find((el) => el.id === "maple")!;
    expect(gapDown(cedar, middle)).toBe(gapDown(middle, birch));
    expect(middle.y).toBe(206);
    expect(middle.x).toBe(maple.x);
    expect(middle.width).toBe(maple.width);
    expect(middle.height).toBe(maple.height);
    expect(middle.content).toBe("Maple");
    expect(cedar.x).toBe(64);
    expect(birch.x).toBe(150);

    const byId = new Map(spaced.map((el) => [el.id, el]));
    const next = stacked.map((el) => byId.get(el.id) ?? el);
    const moved = next.filter((el, index) => el !== stacked[index]);
    expect(moved.map((el) => el.id)).toEqual(["maple"]);
    expect(next.find((el) => el.id === "door")).toBe(door);
  });

  it("leaves two boxes unchanged, including when they overlap", () => {
    const two = spaceBoxesEvenly(elements, ["market", "saturday"], "across");
    expect(two.map((el) => el.id)).toEqual(["market", "saturday"]);
    expect(two[0]).toBe(market);
    expect(two[1]).toBe(saturday);
    expect(two.find((el) => el.id === "door")).toBeUndefined();
    const down = spaceBoxesEvenly(elements, ["notes", "door"], "down");
    expect(down[0]).toBe(door);
    expect(down[1]).toBe(notes);

    const wide = { ...market, id: "wide", x: 20, width: 300 };
    const overlap = { ...saturday, id: "overlap", x: 40, width: 200 };
    const end = { ...notes, id: "end", x: 80, width: 100 };
    const crowded = [wide, overlap, end];
    const spaced = spaceBoxesEvenly(
      crowded,
      ["end", "wide", "overlap"],
      "across",
    );
    expect(spaced.find((el) => el.id === "wide")).toBe(wide);
    expect(spaced.find((el) => el.id === "end")).toBe(end);
    const middle = spaced.find((el) => el.id === "overlap")!;
    expect(gapAcross(wide, middle)).toBe(gapAcross(middle, end));
    expect(gapAcross(wide, middle)).toBeLessThan(0);
    expect(middle.width).toBe(200);
    expect(middle.y).toBe(overlap.y);
  });

  it("spaces four boxes so every gap matches", () => {
    const fourth = {
      id: "fourth",
      type: "text" as const,
      x: 500,
      y: 56,
      width: 40,
      height: 78,
      content: "End",
    };
    const row = [
      { ...market, x: 0, width: 100 },
      { ...saturday, x: 150, width: 50 },
      { ...notes, x: 300, width: 80 },
      fourth,
    ];
    const spaced = spaceBoxesEvenly(
      row,
      ["market", "saturday", "notes", "fourth"],
      "across",
    );
    const [a, b, c, d] = spaced;
    expect(a).toBe(row[0]);
    expect(d).toBe(fourth);
    expect(gapAcross(a, b)).toBe(gapAcross(b, c));
    expect(gapAcross(b, c)).toBe(gapAcross(c, d));
    expect(b.y).toBe(saturday.y);
    expect(c.width).toBe(80);
  });
});
