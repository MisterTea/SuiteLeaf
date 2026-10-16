import { describe, expect, it } from "vitest";
import type { Slide } from "@suiteleaf/core";
import { slideDrawOps } from "../apps/web/src/editors/slide-record";

describe("slideshow recording", () => {
  it("draws the background, master text, and the slide title", () => {
    const slide: Slide = {
      id: "s",
      elements: [
        { id: "title", type: "text", x: 40, y: 40, width: 400, height: 80, content: "Welcome", fontSize: 32 },
      ],
      background: { color: "#111111" },
    };
    const ops = slideDrawOps(
      slide,
      960,
      540,
      960,
      540,
      [{ id: "foot", type: "text", x: 40, y: 480, width: 200, height: 32, content: "Club" }],
    );
    expect(ops[0]).toEqual({ kind: "fill", color: "#111111" });
    expect(ops.filter((op) => op.kind === "text").map((op) => (op.kind === "text" ? op.text : ""))).toEqual([
      "Club",
      "Welcome",
    ]);
  });

  it("draws a shape and a picture after the master", () => {
    const slide: Slide = {
      id: "s",
      background: { color: "#ffffff" },
      elements: [
        { id: "box", type: "shape", x: 10, y: 10, width: 40, height: 20, fill: "#2563eb" },
        {
          id: "logo",
          type: "image",
          x: 80,
          y: 10,
          width: 30,
          height: 30,
          src: "data:image/png;base64,aaaa",
        },
      ],
    };
    const ops = slideDrawOps(slide, 100, 50, 100, 50, [
      { id: "foot", type: "text", x: 0, y: 40, width: 20, height: 10, content: "Club" },
    ]);
    expect(ops.map((op) => op.kind)).toEqual(["fill", "text", "rect", "image"]);
    expect(ops.find((op) => op.kind === "rect")).toMatchObject({ color: "#2563eb" });
    expect(ops.find((op) => op.kind === "image")).toMatchObject({
      src: "data:image/png;base64,aaaa",
    });
  });
});