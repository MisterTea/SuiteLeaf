// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import type { Presentation, SlideElement } from "../packages/core/src";
import {
  applySlidePictureEdit,
  docPictureChange,
  docPictureToEdit,
  slidePictureToEdit,
  type SlidePictureEdit,
} from "../apps/web/src/editors/svg-picture-edit";
import { svgDataUri, svgFromDataUri } from "../apps/web/src/editors/svg-data";

const wide = (fill: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="50" height="50" fill="${fill}"/></svg>`;
const BLUE = wide("blue");
const RED = wide("red");
const TALL = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="200"/>';

const picture = (id: string, src: string): SlideElement => ({ id, type: "image", src, x: 10, y: 10, width: 300, height: 150 });

function deck(elements: SlideElement[], extra: Partial<Presentation> = {}): Presentation {
  return { id: "d", width: 960, height: 540, slideOrder: ["s1"], slides: { s1: { id: "s1", elements } }, ...extra };
}

describe("an SVG picture on a slide", () => {
  it("opens its own SVG", () => {
    const opened = slidePictureToEdit(deck([]), "s1", picture("p", svgDataUri(BLUE)));
    expect(opened).toEqual({ edit: { slideId: "s1", id: "p", svg: BLUE, asset: null } });
  });

  it("leaves other pictures and boxes alone", () => {
    expect(slidePictureToEdit(deck([]), "s1", picture("p", "data:image/png;base64,AAAA"))).toBeNull();
    expect(slidePictureToEdit(deck([]), "s1", { id: "t", type: "text", x: 0, y: 0, width: 1, height: 1 })).toBeNull();
  });

  it("says when the SVG cannot be read", () => {
    expect(slidePictureToEdit(deck([]), "s1", picture("p", "data:image/svg+xml;base64,%%%"))).toEqual({ unreadable: true });
  });

  it("takes the new SVG, keeping its width and following the drawing's new shape", () => {
    const before = deck([picture("p", svgDataUri(BLUE)), picture("q", svgDataUri(BLUE))]);
    const edit: SlidePictureEdit = { slideId: "s1", id: "p", svg: BLUE, asset: null };
    const same = applySlidePictureEdit(before, edit, RED);
    if ("error" in same) throw new Error(same.error);
    const [p, q] = same.deck.slides.s1.elements;
    expect(svgFromDataUri(p.src!)).toBe(RED);
    expect([p.width, p.height]).toEqual([300, 150]);
    expect(q).toBe(before.slides.s1.elements[1]);
    const tall = applySlidePictureEdit(before, edit, TALL);
    if ("error" in tall) throw new Error(tall.error);
    expect([tall.deck.slides.s1.elements[0].width, tall.deck.slides.s1.elements[0].height]).toEqual([300, 600]);
    expect(before.slides.s1.elements[0].src).toBe(svgDataUri(BLUE));
  });

  it("says so when the picture went away while it was open", () => {
    const edit: SlidePictureEdit = { slideId: "s1", id: "gone", svg: BLUE, asset: null };
    expect(applySlidePictureEdit(deck([]), edit, RED)).toEqual({
      error: "The picture was removed while it was open in Drawing.",
    });
  });
});

describe("an SVG file in a MARP deck", () => {
  const assets = { "media/logo.svg": svgDataUri(BLUE), "media/photo.png": "data:image/png;base64,AAAA" };
  const marp = (elements: SlideElement[]) => deck(elements, { marp: true, marpSource: "![](media/logo.svg)\n", marpAssets: assets });

  it("opens the file the markdown names", () => {
    expect(slidePictureToEdit(marp([]), "s1", picture("p", "media/logo.svg"))).toEqual({
      edit: { slideId: "s1", id: "p", svg: BLUE, asset: "media/logo.svg" },
    });
  });

  it("finds the file for a picture that still holds its data", () => {
    const opened = slidePictureToEdit(marp([]), "s1", picture("p", svgDataUri(BLUE)));
    expect(opened).toMatchObject({ edit: { asset: "media/logo.svg" } });
  });

  it("names an SVG file the deck does not have", () => {
    expect(slidePictureToEdit(marp([]), "s1", picture("p", "media/missing.svg"))).toEqual({ missing: "media/missing.svg" });
    expect(slidePictureToEdit(marp([]), "s1", picture("p", "media/photo.png"))).toBeNull();
  });

  it("changes the file for every picture of it and leaves the markdown and boxes as they were", () => {
    const before = marp([picture("p", "media/logo.svg"), picture("q", "media/logo.svg")]);
    const applied = applySlidePictureEdit(before, { slideId: "s1", id: "p", svg: BLUE, asset: "media/logo.svg" }, TALL);
    if ("error" in applied) throw new Error(applied.error);
    expect(svgFromDataUri(applied.deck.marpAssets!["media/logo.svg"])).toBe(TALL);
    expect(applied.deck.marpAssets!["media/photo.png"]).toBe(assets["media/photo.png"]);
    expect(applied.deck.marpSource).toBe(before.marpSource);
    expect(applied.deck.slides).toBe(before.slides);
  });

  it("does not resize a picture the markdown lays out", () => {
    const before = deck([picture("p", svgDataUri(BLUE))], { marp: true });
    const applied = applySlidePictureEdit(before, { slideId: "s1", id: "p", svg: BLUE, asset: null }, TALL);
    if ("error" in applied) throw new Error(applied.error);
    expect(applied.deck.slides.s1.elements[0].height).toBe(150);
  });

  it("says so when the file went away while it was open", () => {
    const applied = applySlidePictureEdit(marp([]), { slideId: "s1", id: "p", svg: BLUE, asset: "media/gone.svg" }, RED);
    expect(applied).toEqual({ error: "media/gone.svg was removed while it was open in Drawing." });
  });
});

describe("an SVG picture in a document", () => {
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { group: "block", content: "inline*" },
      text: { group: "inline" },
      image: { group: "block", attrs: { src: {}, width: { default: null }, height: { default: null } } },
      inlineImage: { group: "inline", inline: true, attrs: { src: {}, width: { default: null }, height: { default: null } } },
    },
  });
  const blue = svgDataUri(BLUE);
  const make = () =>
    schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("Logo "), schema.node("inlineImage", { src: blue })]),
      schema.node("image", { src: blue, width: 300, height: 150 }),
    ]);
  const positions = (doc: ReturnType<typeof make>) => {
    const found: number[] = [];
    doc.descendants((node, pos) => {
      if (node.attrs.src) found.push(pos);
    });
    return found;
  };

  it("opens block and inline SVG pictures, and nothing else", () => {
    const doc = make();
    const [inline, block] = positions(doc);
    expect(docPictureToEdit(doc.nodeAt(inline)!, inline)).toEqual({ pos: inline, src: blue, svg: BLUE });
    expect(docPictureToEdit(doc.nodeAt(block)!, block)?.pos).toBe(block);
    expect(docPictureToEdit(schema.node("image", { src: "data:image/png;base64,AAAA" }), 0)).toBeNull();
    expect(docPictureToEdit(doc.child(0), 0)).toBeNull();
  });

  it("changes the picture that was opened, not another copy of the same SVG", () => {
    const doc = make();
    const [inline, block] = positions(doc);
    const change = docPictureChange(doc, { pos: block, src: blue, svg: BLUE }, RED)!;
    expect(change.pos).toBe(block);
    expect(svgFromDataUri(String(change.attrs.src))).toBe(RED);
    expect(docPictureChange(doc, { pos: inline, src: blue, svg: BLUE }, RED)!.pos).toBe(inline);
  });

  it("keeps the width and follows the drawing's new shape when the picture has a size", () => {
    const doc = make();
    const [inline, block] = positions(doc);
    expect(docPictureChange(doc, { pos: block, src: blue, svg: BLUE }, TALL)!.attrs).toMatchObject({ width: 300, height: 600 });
    expect(docPictureChange(doc, { pos: inline, src: blue, svg: BLUE }, TALL)!.attrs).toMatchObject({ width: null, height: null });
  });

  it("finds a picture that moved while it was open, and says when it is gone", () => {
    const doc = make();
    const [, block] = positions(doc);
    const moved = schema.node("doc", null, [schema.node("paragraph", null, [schema.text("New first line")]), doc.child(1)]);
    const change = docPictureChange(moved, { pos: block, src: blue, svg: BLUE }, RED)!;
    expect(moved.nodeAt(change.pos)?.type.name).toBe("image");
    expect(docPictureChange(schema.node("doc", null, [schema.node("paragraph")]), { pos: block, src: blue, svg: BLUE }, RED)).toBeNull();
  });
});
