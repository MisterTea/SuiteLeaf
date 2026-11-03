import { describe, expect, it } from "vitest";
import { slideElementSchema } from "../packages/core/src";
import {
  alignObjectToSlide,
  alignSelection,
  alignSlideObjects,
  distributeSlideObjects,
  groupSlideObjects,
  orderSlideObjects,
  placeSlideGroup,
  nudgeSlideObject,
  nudgeSlideSelection,
  placeSlideObject,
  snapSlideBox,
  ungroupSlideObjects,
} from "../packages/core/src/slide-align";

const boxes = [
  { id: "title", x: 10, y: 20, width: 100, height: 40 },
  { id: "photo", x: 40, y: 80, width: 80, height: 60 },
  { id: "note", x: 200, y: 30, width: 20, height: 20 },
];

describe("slide alignment", () => {
  it("lines up the selected boxes and spaces three of them", () => {
    const left = alignSlideObjects(boxes, ["title", "photo"], "left");
    expect(left.map((box) => box.x)).toEqual([10, 10, 200]);
    expect(boxes[1].x).toBe(40);
    const locked = alignSlideObjects(
      [{ ...boxes[1], locked: true }, boxes[0]],
      ["photo", "title"],
      "left",
    );
    expect(locked.find((box) => box.id === "photo")?.x).toBe(40);
    expect(alignSlideObjects(boxes, ["title"], "left")[0].x).toBe(10);

    const spaced = [
      { id: "title", x: 0, y: 0, width: 20, height: 10 },
      { id: "photo", x: 30, y: 0, width: 20, height: 10 },
      { id: "note", x: 100, y: 0, width: 20, height: 10 },
    ];
    const distributed = distributeSlideObjects(spaced, ["title", "photo", "note"], "horizontal");
    expect(distributed.map((box) => box.x)).toEqual([0, 50, 100]);
    expect(spaced[1].x).toBe(30);

    const centered = alignObjectToSlide(boxes[0], { width: 960, height: 540 }, "center");
    expect(centered.x).toBe(430);
    expect(alignObjectToSlide({ ...boxes[0], locked: true }, { width: 960, height: 540 }, "right").x).toBe(10);

    const title = slideElementSchema.parse({
      id: "title",
      type: "text",
      x: 10,
      y: 20,
      width: 100,
      height: 40,
      locked: true,
      content: "Beds",
    });
    const kept = placeSlideObject(title, { x: 80, content: "North" });
    expect(kept.x).toBe(10);
    expect(kept.content).toBe("North");
    expect(title.x).toBe(10);
    expect(placeSlideObject(title, { locked: false, x: 80 }).x).toBe(80);
    expect(slideElementSchema.parse(kept).locked).toBe(true);

    const stack = [{ id: "title" }, { id: "photo" }, { id: "note" }];
    expect(orderSlideObjects(stack, "photo", "forward").map((item) => item.id)).toEqual([
      "title",
      "note",
      "photo",
    ]);
    expect(orderSlideObjects(stack, "photo", "back").map((item) => item.id)).toEqual([
      "photo",
      "title",
      "note",
    ]);
    expect(orderSlideObjects(stack, "title", "front").map((item) => item.id)).toEqual([
      "photo",
      "note",
      "title",
    ]);
    expect(stack.map((item) => item.id)).toEqual(["title", "photo", "note"]);

    const titleBox = boxes[0];
    const near = snapSlideBox({ id: "photo", x: 14, y: 80, width: 80, height: 60 }, [titleBox], {
      width: 960,
      height: 540,
    });
    expect(near.x).toBe(10);
    expect(near.guideX).toBe(10);
    expect(titleBox.x).toBe(10);
    const far = snapSlideBox({ id: "photo", x: 40, y: 80, width: 80, height: 60 }, [titleBox], {
      width: 960,
      height: 540,
    });
    expect(far.x).toBe(40);
    expect(far.guideX).toBeNull();
    const centeredSnap = snapSlideBox(
      { id: "title", x: 426, y: 20, width: 100, height: 40 },
      [],
      { width: 960, height: 540 },
    );
    expect(centeredSnap.x).toBe(430);
    expect(centeredSnap.guideX).toBe(480);

    const grouped = groupSlideObjects(boxes, ["title", "photo"], "beds");
    expect(grouped.find((box) => box.id === "title")?.groupId).toBe("beds");
    expect(grouped.find((box) => box.id === "note")?.groupId).toBeUndefined();
    expect(boxes[0]).not.toHaveProperty("groupId");
    expect(groupSlideObjects(boxes, ["title"], "beds")[0]).not.toHaveProperty("groupId");
    const moved = placeSlideGroup(
      grouped,
      [
        { id: "title", x: 10, y: 20 },
        { id: "photo", x: 40, y: 80 },
      ],
      12,
      0,
    );
    expect(moved.find((box) => box.id === "title")?.x).toBe(22);
    expect(moved.find((box) => box.id === "photo")?.x).toBe(52);
    const held = placeSlideGroup(
      [{ ...grouped[1], locked: true }, grouped[0]],
      [
        { id: "title", x: 10, y: 20 },
        { id: "photo", x: 40, y: 80 },
      ],
      12,
      0,
    );
    expect(held.find((box) => box.id === "photo")?.x).toBe(40);
    expect(grouped.find((box) => box.id === "title")?.x).toBe(10);
    const released = ungroupSlideObjects(grouped, ["photo"]);
    expect(released.find((box) => box.id === "title")?.groupId).toBeUndefined();
    expect(released.find((box) => box.id === "photo")?.groupId).toBeUndefined();
    const parsed = slideElementSchema.parse({
      id: "title",
      type: "text",
      x: 10,
      y: 20,
      width: 100,
      height: 40,
      groupId: "beds",
    });
    expect(parsed.groupId).toBe("beds");
  });

  it("aligns one box to the slide and two boxes to each other", () => {
    const slide = { width: 960, height: 540 };
    const before = JSON.stringify(boxes);
    const one = alignSelection(boxes, ["title"], slide, "left");
    expect(one.find((box) => box.id === "title")?.x).toBe(0);
    expect(one.find((box) => box.id === "photo")?.x).toBe(40);
    const shared = alignSelection(boxes, ["title", "photo"], slide, "left");
    expect(shared.map((box) => box.x)).toEqual([10, 10, 200]);
    expect(JSON.stringify(boxes)).toBe(before);
    const spaced = [
      { id: "title", x: 0, y: 0, width: 20, height: 10 },
      { id: "photo", x: 30, y: 0, width: 20, height: 10 },
      { id: "note", x: 100, y: 0, width: 20, height: 10 },
    ];
    expect(distributeSlideObjects(spaced, ["title", "photo", "note"], "horizontal").map((box) => box.x)).toEqual([
      0, 50, 100,
    ]);
  });

  it("moves an unlocked box by a whole step and leaves a locked box", () => {
    const box = { id: "secret-value", x: 10, y: 20, width: 30, height: 40 };
    const moved = nudgeSlideObject(box, "right", 10);
    expect(moved).toEqual({ ...box, x: 20 });
    expect(box.x).toBe(10);
    expect(nudgeSlideObject({ ...box, locked: true }, "left").x).toBe(10);
    expect(nudgeSlideObject({ ...box, x: 0 }, "left").x).toBe(0);
    expect(nudgeSlideObject({ ...box, x: Number.NaN }, "right").x).toBeNaN();
  });

  it("moves every unlocked box in the selected group", () => {
    const boxes = [
      { id: "title", x: 10, y: 20, width: 30, height: 40, groupId: "beds" },
      { id: "photo", x: 40, y: 20, width: 30, height: 40, groupId: "beds", locked: true },
      { id: "secret-value", x: 80, y: 20, width: 30, height: 40 },
    ];
    const before = JSON.stringify(boxes);
    const moved = nudgeSlideSelection(boxes, "title", "right", 10);
    expect(moved.map((box) => box.x)).toEqual([20, 40, 80]);
    expect(JSON.stringify(boxes)).toBe(before);
    expect(JSON.stringify(moved.map((box) => box.id))).toContain("secret-value");
    expect(nudgeSlideSelection(boxes, "photo", "left", 10).map((box) => box.x)).toEqual([10, 40, 80]);
    const loose = [
      { id: "title", x: 10, y: 20, width: 30, height: 40, groupId: " " },
      { id: "note", x: 40, y: 20, width: 30, height: 40, groupId: " " },
    ];
    expect(nudgeSlideSelection(loose, "title", "right", 10).map((box) => box.x)).toEqual([20, 40]);
  });
});
