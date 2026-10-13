import { describe, expect, it } from "vitest";
import {
  createFile,
  parseFile,
  serializeFile,
  type Slide,
  type SlideFile,
} from "../packages/core/src";
import {
  applyBackground,
  applyLayout,
  newSlide,
  reorder,
  sectionBackground,
} from "../apps/web/src/editors/slide-layouts";

const texts = (slide: Slide) => slide.elements.filter((el) => el.type === "text");

describe("slide placeholders", () => {
  it("starts a new deck with empty title and subtitle placeholders", () => {
    const deck = createFile("slide", "Garden Kickoff") as SlideFile;
    const slide = deck.content.slides[deck.content.slideOrder[0]];
    expect(texts(slide).map((el) => [el.content, el.placeholder])).toEqual([
      ["", "Click to add title"],
      ["", "Click to add subtitle"],
    ]);
    const reopened = parseFile(serializeFile(deck)) as SlideFile;
    expect(reopened.content.slides[slide.id].elements[0].placeholder).toBe(
      "Click to add title",
    );
  });

  it("gives new slides placeholders instead of stand-in text", () => {
    for (const layout of ["title", "title-body", "two-column", "section"] as const) {
      const slide = newSlide(layout);
      expect(texts(slide).length).toBeGreaterThan(0);
      for (const el of texts(slide)) {
        expect(el.content).toBe("");
        expect(el.placeholder).toMatch(/^Click to add/);
      }
    }
    expect(newSlide("section").background?.color).toBe(sectionBackground);
    expect(newSlide("blank").elements).toEqual([]);
  });
});

describe("changing a slide's layout", () => {
  it("moves a title slide's text into two columns", () => {
    const slide = newSlide("title");
    slide.elements[0].content = "How you can help";
    slide.elements[1].content = "Saturdays";
    const next = applyLayout(slide, "two-column");
    expect(next.layout).toBe("two-column");
    const [heading, left, right] = texts(next);
    expect(heading).toMatchObject({ content: "How you can help", x: 80, y: 50, align: "left" });
    expect(left).toMatchObject({ content: "Saturdays", x: 80, y: 150, width: 380 });
    expect(right).toMatchObject({ content: "", x: 500, placeholder: "Click to add text" });
  });

  it("keeps text that has no slot by adding it to the last one", () => {
    const slide = newSlide("two-column");
    slide.elements[0].content = "Plan";
    slide.elements[1].content = "Left";
    slide.elements[2].content = "Right";
    const next = applyLayout(slide, "title-body");
    expect(texts(next).map((el) => el.content)).toEqual(["Plan", "Left\nRight"]);
  });

  it("leaves shapes and plain text boxes alone", () => {
    const slide = newSlide("title-body");
    const sun = { id: "sun", type: "shape" as const, x: 700, y: 20, width: 160, height: 160 };
    const note = { id: "note", type: "text" as const, x: 600, y: 480, width: 300, height: 40, content: "Draft" };
    slide.elements.push(sun, note);
    const next = applyLayout(slide, "title");
    expect(next.elements).toContainEqual(sun);
    expect(next.elements).toContainEqual(note);
  });

  it("darkens the background for a section header and restores it after", () => {
    const section = applyLayout(newSlide("title"), "section");
    expect(section.background?.color).toBe(sectionBackground);
    expect(texts(section)[0].color).toBe("#f8fafc");
    expect(applyLayout(section, "title-body").background?.color).toBeUndefined();
  });
});

describe("deck backgrounds and themes", () => {
  const deck = () => {
    const slides = [newSlide("title"), newSlide("title-body"), newSlide("section")];
    return Object.fromEntries(slides.map((s) => [s.id, s]));
  };

  it("applies a background to every slide", () => {
    const slides = applyBackground(deck(), "#e2ece9");
    expect(Object.values(slides).map((s) => s.background?.color)).toEqual([
      "#e2ece9",
      "#e2ece9",
      "#e2ece9",
    ]);
    const section = Object.values(slides).find((s) => s.layout === "section")!;
    expect(texts(section)[0].color).toBe("#0f172a");
  });

  it("keeps section headers dark on a light theme and keeps text readable on a dark one", () => {
    const light = Object.values(applyBackground(deck(), "#fef3c7", true));
    expect(light.find((s) => s.layout === "section")!.background?.color).toBe(sectionBackground);
    const dark = Object.values(applyBackground(deck(), "#0f172a", true));
    for (const slide of dark) {
      expect(slide.background?.color).toBe("#0f172a");
      for (const el of texts(slide)) expect(["#f8fafc", "#cbd5e1"]).toContain(el.color);
    }
  });
});

describe("reordering slides", () => {
  it("moves an item to a new index", () => {
    expect(reorder(["a", "b", "c", "d"], 2, 1)).toEqual(["a", "c", "b", "d"]);
    expect(reorder(["a", "b", "c", "d"], 0, 3)).toEqual(["b", "c", "d", "a"]);
  });
});
