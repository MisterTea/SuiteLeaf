import { describe, expect, it } from "vitest";
import {
  applyMaster,
  moveReadingOrder,
  readingOrder,
  slideAccessNotes,
  slideAccessWrites,
  slideObjectLines,
  mediaPictureNotes,
  slideChecks,
  titleTextColor,
  type SlidePiece,
} from "../packages/core/src/slide-access";

const pieces: SlidePiece[] = [
  { id: "title", type: "text" },
  { id: "photo", type: "image", alt: "Beds" },
  { id: "logo", type: "image", alt: "Old mark", altOverride: true },
];

describe("slide master and reading order", () => {
  it("leaves a decorative image out of the reading order", () => {
    const slide: SlidePiece[] = [
      { id: "title", type: "text" },
      { id: "photo", type: "image", alt: "secret-value", decorative: true },
    ];
    expect(readingOrder(slide, ["photo", "title"]).ids).toEqual(["title"]);
    expect(readingOrder(slide, ["photo", "title"]).missing).toEqual([]);
    expect(slideAccessNotes(slide)).toEqual([]);
    expect(slideObjectLines(slide)).toEqual([{ id: "title", type: "text", text: "" }]);
    expect(JSON.stringify(slideObjectLines(slide))).not.toContain("secret-value");
    expect(slide[1].alt).toBe("secret-value");
  });

  it("updates inheriting objects and keeps an override", () => {
    const next = applyMaster(pieces, [
      { id: "photo", alt: "North beds" },
      { id: "logo", alt: "New mark" },
    ]);
    expect(next.find((piece) => piece.id === "photo")?.alt).toBe("North beds");
    expect(next.find((piece) => piece.id === "logo")?.alt).toBe("Old mark");
    expect(pieces[1].alt).toBe("Beds");
  });

  it("names the reading order and a missing image description", () => {
    const slide: SlidePiece[] = [
      { id: "title", type: "text" },
      { id: "photo", type: "image" },
    ];
    expect(readingOrder(slide, ["photo", "gone", "title"]).ids).toEqual([
      "photo",
      "title",
    ]);
    expect(slideAccessNotes(slide, ["photo", "gone"])).toEqual([
      {
        id: "photo",
        rule: "missing-alt",
        message: "This image needs alternative text.",
      },
      {
        id: "gone",
        rule: "missing-object",
        message: "Reading order names an object that is not on this slide.",
      },
    ]);
    const saved = JSON.parse(
      JSON.stringify({ pieces: slide, order: ["photo", "title"] }),
    ) as {
      pieces: SlidePiece[];
      order: string[];
    };
    expect(saved.order).toEqual(["photo", "title"]);
    expect(saved.pieces[1].id).toBe("photo");
    const image = slideAccessNotes([{ id: "secret-value", type: "image" }]);
    const missing = slideAccessNotes([{ id: "title", type: "text" }], ["secret-value"]);
    expect(image.map((note) => note.message)).toEqual(["This image needs alternative text."]);
    expect(missing.map((note) => note.message)).toEqual([
      "Reading order names an object that is not on this slide.",
    ]);
    expect(JSON.stringify([...image, ...missing].map((note) => note.message))).not.toContain(
      "secret-value",
    );
  });

  it("asks for a title and refuses a color that does not contrast", () => {
    const blank = slideChecks({ title: "  ", background: "#ffffff", text: "secret-value" });
    expect(blank.map((note) => note.message)).toEqual([
      "This slide needs a title.",
      "The slide colors are not hex colors.",
    ]);
    expect(JSON.stringify(blank)).not.toContain("secret-value");
    const hidden = slideChecks({ title: "\u200b", background: "#ffffff", text: "#000000" });
    expect(hidden.map((note) => note.message)).toEqual(["This slide needs a title."]);
    expect(slideChecks({ title: "\u200bBeds", background: "#ffffff", text: "#000000" })).toEqual([]);
    expect(slideChecks({ title: "Be\u200bds", background: "#ffffff", text: "#000000" })).toEqual([]);
    const pale = slideChecks({ title: "North beds", background: "#ffffff", text: "#ffff00" });
    expect(pale).toEqual([
      {
        rule: "low-contrast",
        message: "The title color does not contrast with the slide background.",
      },
    ]);
    expect(slideChecks({ title: "North beds", background: "#ffffff", text: "#000000" })).toEqual([]);
    expect(slideChecks({ title: "North beds", background: "#fff", text: "#000" })).toEqual([]);
    expect(slideChecks({ title: "North beds", background: "#fff", text: "#eee" })).toEqual([
      {
        rule: "low-contrast",
        message: "The title color does not contrast with the slide background.",
      },
    ]);
  });

  it("uses the title box color, not a fixed black", () => {
    const elements = [
      { type: "text", content: "Beds", color: "#000000", runs: [{ color: "#ffff00" }] },
      { type: "text", content: "North", color: "#000000" },
      { type: "shape", content: "Beds", color: "#00ff00" },
    ];
    expect(titleTextColor(elements, "Beds")).toBe("#ffff00");
    const notes = slideChecks({
      title: "Beds",
      background: "#ffffff",
      text: titleTextColor(elements, "Beds"),
    });
    expect(notes.map((note) => note.message)).toEqual([
      "The title color does not contrast with the slide background.",
    ]);
    expect(titleTextColor([{ type: "text", content: "Beds", color: "secret-value" }], "Beds")).toBe(
      "secret-value",
    );
    const refused = slideChecks({
      title: "Beds",
      background: "#ffffff",
      text: titleTextColor([{ type: "text", content: "Beds", color: "secret-value" }], "Beds"),
    });
    expect(JSON.stringify(refused)).not.toContain("secret-value");
    expect(titleTextColor([], "Beds")).toBe("#111111");
    expect(elements[1].color).toBe("#000000");
  });

  it("skips a decorative box when it reads the title color", () => {
    const decorative = {
      type: "text" as const,
      content: "Beds",
      color: "secret-value",
      decorative: true,
    };
    const elements = [decorative, { type: "text" as const, content: "North", color: "#000000" }];
    expect(titleTextColor(elements, "Beds")).toBe("#000000");
    expect(titleTextColor([decorative], "Beds")).toBe("#111111");
    expect(decorative.color).toBe("secret-value");
    expect(JSON.stringify(titleTextColor([decorative], "Beds"))).not.toContain("secret-value");
  });

  it("moves one object later and leaves an unknown id out", () => {
    const order = ["title", "photo"];
    expect(moveReadingOrder(pieces, order, "title", "later")).toEqual(["photo", "title", "logo"]);
    expect(order).toEqual(["title", "photo"]);
    expect(moveReadingOrder(pieces, order, "title", "earlier")).toEqual(["title", "photo", "logo"]);
    const kept = moveReadingOrder(pieces, ["secret-value", "photo", "title"], "secret-value", "later");
    expect(kept).toEqual(["photo", "title", "logo"]);
    expect(JSON.stringify(kept)).not.toContain("secret-value");
  });

  it("checks a picture on a video or audio clip", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const notes = mediaPictureNotes([
      { type: "video", poster: "secret-value", src: "secret-value", alt: "Beds" },
      { type: "audio", poster: png },
      { type: "video", poster: png, alt: "North beds" },
      { type: "text" },
    ]);
    expect(notes).toEqual([
      "This video's picture is not an embedded image.",
      "This audio's picture needs alternative text.",
    ]);
    expect(JSON.stringify(notes)).not.toContain("secret-value");
    expect(JSON.stringify(notes)).not.toContain(png);
  });

  it("stores a video description and leaves the clip address", () => {
    const stored = [
      { id: "clip", type: "video", alt: "North", src: "secret-value" },
      { id: "sound", type: "audio", alt: "Rain" },
      { id: "title", type: "text", content: "Beds" },
    ];
    const pieces: SlidePiece[] = [
      { id: "clip", type: "video", alt: "Tomato beds" },
      { id: "sound", type: "audio", alt: "Rain" },
      { id: "title", type: "text" },
    ];
    const writes = slideAccessWrites(stored, pieces, { title: "Beds" });
    expect(writes).toEqual([{ id: "clip", alt: "Tomato beds" }]);
    expect(JSON.stringify(writes)).not.toContain("secret-value");
    expect(stored[0].src).toBe("secret-value");
    expect(stored[0].alt).toBe("North");
    const audio = slideAccessWrites(
      [{ id: "sound", alt: "Rain" }],
      [{ id: "sound", type: "audio", alt: "Birds" }],
      {},
    );
    expect(audio).toEqual([{ id: "sound", alt: "Birds" }]);
  });
});
