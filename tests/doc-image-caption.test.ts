import { getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { exportDocx } from "../packages/core/src/docx-export";
import { setImageCaption } from "../apps/web/src/editors/doc-image-alt";
import { croppableImage } from "../apps/web/src/editors/doc-image-crop";
import { inlineImage } from "../apps/web/src/editors/doc-image-inline";

const schema = getSchema([StarterKit, croppableImage, inlineImage]);
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const src = `data:image/png;base64,${png}`;
const description = "Fruit on a table.";
const line = "Saturday stall";
const sentence = "We arrived at noon.";

function photo(caption?: string) {
  return {
    type: "image",
    attrs: {
      src,
      alt: description,
      width: 280,
      height: 180,
      wrap: "left",
      cropRight: 12,
      ...(caption === undefined ? {} : { caption }),
    },
  };
}

function market(caption?: string) {
  return {
    type: "doc",
    content: [
      photo(caption),
      { type: "paragraph", content: [{ type: "text", text: sentence }] },
    ],
  };
}

function exportedMarket(caption: string) {
  return {
    type: "doc",
    content: [
      photo(caption),
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

describe("photo captions", () => {
  it("keeps the description when a caption is set and when it is cleared", () => {
    const doc = Node.fromJSON(schema, market());
    const image = doc.firstChild!;
    expect(image.attrs.caption).toBe("");
    expect(image.attrs.alt).toBe(description);
    let state = EditorState.create({ schema, doc });
    state = state.apply(setImageCaption(state, 0, line)!);
    const captioned = state.doc.firstChild!;
    expect(captioned.type.name).toBe("image");
    expect(captioned.attrs.caption).toBe(line);
    expect(captioned.attrs.alt).toBe(description);
    expect(captioned.attrs.src).toBe(src);
    expect(captioned.attrs.width).toBe(280);
    expect(captioned.attrs.height).toBe(180);
    expect(captioned.attrs.wrap).toBe("left");
    expect(captioned.attrs.cropRight).toBe(12);
    expect(state.doc.child(1).textContent).toBe(sentence);
    state = state.apply(setImageCaption(state, 0, "")!);
    const cleared = state.doc.firstChild!;
    expect(cleared.type.name).toBe("image");
    expect(cleared.attrs.caption).toBe("");
    expect(cleared.attrs.alt).toBe(description);
    expect(cleared.attrs.src).toBe(src);
    expect(state.doc.child(1).textContent).toBe(sentence);
    expect(state.doc.childCount).toBe(2);
  });

  it("keeps the description on an in-sentence photo when its caption changes", () => {
    const doc = Node.fromJSON(schema, {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "inlineImage",
              attrs: { src, alt: description, width: 40, height: 20 },
            },
            { type: "text", text: sentence },
          ],
        },
      ],
    });
    let state = EditorState.create({ schema, doc });
    state = state.apply(setImageCaption(state, 1, line)!);
    const image = state.doc.firstChild!.firstChild!;
    expect(image.type.name).toBe("inlineImage");
    expect(image.attrs.caption).toBe(line);
    expect(image.attrs.alt).toBe(description);
    expect(state.doc.textContent).toBe(sentence);
    state = state.apply(setImageCaption(state, 1, "")!);
    const cleared = state.doc.firstChild!.firstChild!;
    expect(cleared.type.name).toBe("inlineImage");
    expect(cleared.attrs.caption).toBe("");
    expect(cleared.attrs.alt).toBe(description);
    expect(state.doc.textContent).toBe(sentence);
  });

  it("writes the caption after the image and keeps the description as alt text", async () => {
    const zip = await JSZip.loadAsync(
      await exportDocx({ title: "Saturday market", content: exportedMarket(line) }),
    );
    const xml = await zip.file("word/document.xml")!.async("string");
    const drawing = xml.indexOf("</w:drawing>");
    const captionAt = xml.indexOf(line);
    const sentenceAt = xml.indexOf("We arrived at");
    expect(xml).toContain(`descr="${description}"`);
    expect(drawing).toBeGreaterThan(-1);
    expect(captionAt).toBeGreaterThan(drawing);
    expect(sentenceAt).toBeGreaterThan(captionAt);
    expect(xml).not.toContain(`<w:t>${description}</w:t>`);
    expect(xml).toContain('w:fill="ffff00"');
    expect(xml).toContain('w:num="2"');
    expect(xml).toContain("Plant sale");
    expect(xml).toContain("Compost workshop");

    const cleared = await JSZip.loadAsync(
      await exportDocx({ title: "Saturday market", content: exportedMarket("") }),
    );
    const empty = await cleared.file("word/document.xml")!.async("string");
    expect(empty).toContain(`descr="${description}"`);
    expect(empty).toContain("</w:drawing>");
    expect(empty).not.toContain(line);
    expect(empty).toContain("We arrived at");
    expect(empty).toContain('w:fill="ffff00"');
    expect(empty).toContain('w:num="2"');
  });
});
