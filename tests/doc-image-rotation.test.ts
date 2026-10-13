import { getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { exportDocx } from "../packages/core/src/docx-export";
import { displayedImageBox } from "../packages/core/src/image-rotation";
import { turnImage } from "../apps/web/src/editors/doc-image-alt";
import { croppableImage } from "../apps/web/src/editors/doc-image-crop";
import { inlineImage } from "../apps/web/src/editors/doc-image-inline";

const schema = getSchema([StarterKit, croppableImage, inlineImage]);
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const src = `data:image/png;base64,${png}`;
const description = "Fruit on a table.";
const line = "Saturday stall";
const sentence = "We arrived at noon.";

function photo(rotation?: number) {
  return {
    type: "image",
    attrs: {
      src,
      alt: description,
      caption: line,
      width: 280,
      height: 180,
      wrap: "left",
      cropRight: 12,
      ...(rotation === undefined ? {} : { rotation }),
    },
  };
}

function market(rotation?: number) {
  return {
    type: "doc",
    content: [
      photo(rotation),
      { type: "paragraph", content: [{ type: "text", text: sentence }] },
    ],
  };
}

function exportedMarket(rotation: number) {
  return {
    type: "doc",
    content: [
      photo(rotation),
      {
        type: "paragraph",
        content: [
          { type: "text", text: "We arrived at " },
          {
            type: "text",
            text: "noon",
            marks: [{ type: "highlight", attrs: { color: "#ffff00" } }],
          },
          { type: "text", text: "." },
        ],
      },
      {
        type: "columnLayout",
        attrs: { columns: 2 },
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Plant sale" }] },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Compost workshop" }],
          },
        ],
      },
    ],
  };
}

describe("photo rotation", () => {
  it("turns by quarter steps and swaps the box without changing the stored size", () => {
    const doc = Node.fromJSON(schema, market());
    const image = doc.firstChild!;
    expect(image.attrs.rotation).toBe(0);
    let state = EditorState.create({ schema, doc });

    const box = () => {
      const photo = state.doc.firstChild!;
      return displayedImageBox(
        { width: photo.attrs.width, height: photo.attrs.height },
        photo.attrs.rotation,
      );
    };
    const expectKept = () => {
      const photo = state.doc.firstChild!;
      expect(photo.attrs.width).toBe(280);
      expect(photo.attrs.height).toBe(180);
      expect(photo.attrs.caption).toBe(line);
      expect(photo.attrs.alt).toBe(description);
      expect(photo.attrs.wrap).toBe("left");
      expect(photo.attrs.cropRight).toBe(12);
      expect(state.doc.child(1).textContent).toBe(sentence);
    };

    expect(box()).toEqual({ width: 280, height: 180 });
    state = state.apply(turnImage(state, 0, "right")!);
    expect(state.doc.firstChild!.attrs.rotation).toBe(90);
    expect(box()).toEqual({ width: 180, height: 280 });
    expectKept();

    state = state.apply(turnImage(state, 0, "left")!);
    expect(state.doc.firstChild!.attrs.rotation).toBe(0);
    expect(box()).toEqual({ width: 280, height: 180 });
    expectKept();

    state = state.apply(turnImage(state, 0, "right")!);
    state = state.apply(turnImage(state, 0, "right")!);
    expect(state.doc.firstChild!.attrs.rotation).toBe(180);
    expect(box()).toEqual({ width: 280, height: 180 });
    expectKept();

    state = state.apply(turnImage(state, 0, "right")!);
    expect(state.doc.firstChild!.attrs.rotation).toBe(270);
    expect(box()).toEqual({ width: 180, height: 280 });
    expectKept();

    state = state.apply(turnImage(state, 0, "right")!);
    expect(state.doc.firstChild!.attrs.rotation).toBe(0);
    expect(box()).toEqual({ width: 280, height: 180 });
    expectKept();

    for (let step = 0; step < 4; step++) state = state.apply(turnImage(state, 0, "right")!);
    expect(state.doc.firstChild!.attrs.rotation).toBe(0);
    expect(box()).toEqual({ width: 280, height: 180 });
    expectKept();
  });

  it("writes a 90 degree turn as rot=5400000 and keeps the caption", async () => {
    const zip = await JSZip.loadAsync(
      await exportDocx({ title: "Saturday market", content: exportedMarket(90) }),
    );
    const xml = await zip.file("word/document.xml")!.async("string");
    const drawing = xml.indexOf("</w:drawing>");
    const captionAt = xml.indexOf(line);
    expect(xml).toContain('rot="5400000"');
    expect(xml).toContain(`descr="${description}"`);
    expect(drawing).toBeGreaterThan(-1);
    expect(captionAt).toBeGreaterThan(drawing);
    expect(xml.indexOf("We arrived at")).toBeGreaterThan(captionAt);
    expect(xml).not.toContain(`<w:t>${description}</w:t>`);
    expect(xml).toContain('w:fill="ffff00"');
    expect(xml).toContain('w:num="2"');
    expect(xml).toContain("Plant sale");
    expect(xml).toContain("Compost workshop");

    const upright = await JSZip.loadAsync(
      await exportDocx({ title: "Saturday market", content: exportedMarket(0) }),
    );
    const plain = await upright.file("word/document.xml")!.async("string");
    expect(plain).not.toContain('rot="5400000"');
    expect(plain).toContain(`descr="${description}"`);
    expect(plain).toContain(line);
    expect(plain).toContain('w:fill="ffff00"');
    expect(plain).toContain('w:num="2"');
  });
});
