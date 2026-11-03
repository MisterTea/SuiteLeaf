import { describe, expect, it } from "vitest";
import {
  applyCharacterStyles,
  characterStyleList,
  applyStyleFormats,
  captionReference,
  captionWarnings,
  effectiveFormat,
  importCharacterStyles,
  importParagraphStyles,
  numberCaptions,
  refreshCaptions,
  assignParagraphStyle,
  stylePatchFromMarks,
  updateNamedStyle,
  type StyleDef,
} from "../packages/core/src/doc-styles";

const styles: StyleDef[] = [
  { id: "body", name: "Body", fontSize: 12 },
  { id: "heading", name: "Heading", basedOn: "body", bold: true, fontSize: 18 },
];

describe("document styles and captions", () => {
  it("updates style users and keeps a local override", () => {
    expect(effectiveFormat(styles, "heading")).toEqual({
      bold: true,
      fontSize: 18,
    });
    expect(effectiveFormat(styles, "heading", { bold: false }).bold).toBe(
      false,
    );
    const larger = styles.map((style) =>
      style.id === "heading" ? { ...style, fontSize: 22 } : style,
    );
    expect(effectiveFormat(larger, "heading").fontSize).toBe(22);
    expect(effectiveFormat(larger, "heading", { fontSize: 16 }).fontSize).toBe(
      16,
    );
  });

  it("renumbers after a deletion and warns on a missing target", () => {
    const captions = [
      { id: "fig-a", kind: "figure" as const, label: "Beds" },
      { id: "tab-a", kind: "table" as const, label: "Harvest" },
      { id: "fig-b", kind: "figure" as const, label: "Paths" },
    ];
    expect(numberCaptions(captions).map((item) => item.text)).toEqual([
      "Figure 1",
      "Table 1",
      "Figure 2",
    ]);
    const kept = captions.filter((caption) => caption.id !== "fig-a");
    expect(captionReference(kept, "fig-b")).toEqual({ text: "Figure 1" });
    expect(captionReference(kept, "fig-a")).toEqual({
      warning: "That caption is missing. Update or remove this reference.",
    });
    const saved = JSON.parse(JSON.stringify({ styles, captions: kept })) as {
      styles: StyleDef[];
      captions: typeof kept;
    };
    expect(saved.styles[1].id).toBe("heading");
    expect(saved.captions[1].id).toBe("fig-b");
    const doc = {
      type: "doc",
      content: [
        { type: "figureList", attrs: { kind: "figure" }, content: [] },
        {
          type: "paragraph",
          attrs: { captionId: "fig-a", captionKind: "figure" },
          content: [{ type: "text", text: "Beds" }],
        },
        {
          type: "paragraph",
          attrs: { captionId: "tab-a", captionKind: "table" },
          content: [{ type: "text", text: "Harvest" }],
        },
        {
          type: "paragraph",
          attrs: { captionId: "fig-b", captionKind: "figure" },
          content: [{ type: "text", text: "Paths" }],
        },
        {
          type: "paragraph",
          attrs: { captionTarget: "fig-b" },
          content: [{ type: "text", text: "see Figure 9" }],
        },
        {
          type: "paragraph",
          attrs: { captionTarget: "fig-a" },
          content: [{ type: "text", text: "see Figure 1" }],
        },
      ],
    };
    const withoutBeds = {
      ...doc,
      content: doc.content.filter((node) => node.attrs?.captionId !== "fig-a"),
    };
    const refreshed = refreshCaptions(withoutBeds);
    expect(refreshed.content?.[0].content?.[0].content?.[0].text).toBe("Figure 1 Paths");
    const paged = refreshCaptions(doc, { "fig-a": 2, "fig-b": 4, "tab-a": 3 });
    expect(paged.content?.[0].content?.map((row) => row.content?.[0].text)).toEqual([
      "Figure 1 Beds, 2",
      "Figure 2 Paths, 4",
    ]);
    const unpaged = refreshCaptions(doc, { "fig-a": "secret-value" as never });
    expect(unpaged.content?.[0].content?.[0].content?.[0].text).toBe("Figure 1 Beds");
    expect(JSON.stringify(unpaged.content?.[0])).not.toContain("secret-value");
    expect(refreshed.content?.[0].content).toHaveLength(1);
    expect(refreshed.content?.[3].content?.[0].text).toBe("Figure 1");
    expect(refreshed.content?.[4].content?.[0].text).toBe(
      "That caption is missing. Update or remove this reference.",
    );
    expect(doc.content[4].content?.[0].text).toBe("see Figure 9");
    expect(captionWarnings(withoutBeds)).toEqual([
      {
        path: [4],
        targetId: "fig-a",
        message: "That caption is missing. Update or remove this reference.",
      },
    ]);
    expect(withoutBeds.content[4].content?.[0].text).toBe("see Figure 1");
  });

  it("leaves a caption inside a note out of the figure list", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "figureList", attrs: { kind: "figure" }, content: [] as { content?: { text?: string }[] }[] },
        {
          type: "paragraph",
          attrs: { captionId: "fig-a", captionKind: "figure" },
          content: [{ type: "text", text: "Beds" }],
        },
        {
          type: "note",
          content: [
            {
              type: "paragraph",
              attrs: { captionId: "fig-b", captionKind: "figure" },
              content: [{ type: "text", text: "secret-value" }],
            },
            {
              type: "paragraph",
              attrs: { captionTarget: "fig-a" },
              content: [{ type: "text", text: "see Figure 9" }],
            },
          ],
        },
      ],
    };
    const refreshed = refreshCaptions(doc);
    expect(refreshed.content?.[0].content?.map((row) => row.content?.[0].text)).toEqual(["Figure 1 Beds"]);
    expect(JSON.stringify(refreshed.content?.[0])).not.toContain("secret-value");
    expect(refreshed.content?.[2].content?.[0].content?.[0].text).toBe("secret-value");
    expect(refreshed.content?.[2].content?.[1].content?.[0].text).toBe("Figure 1");
    expect(doc.content[2].content?.[0].content?.[0].text).toBe("secret-value");
  });

  it("does not copy a missing caption id into the warning", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { captionTarget: "secret-value" },
          content: [{ type: "text", text: "see Figure 1" }],
        },
      ],
    };
    const before = JSON.stringify(doc);
    const refreshed = refreshCaptions(doc);
    expect(refreshed.content?.[0].content?.[0].text).toBe(
      "That caption is missing. Update or remove this reference.",
    );
    expect(refreshed.content?.[0].content?.[0].text).not.toContain("secret-value");
    const warnings = captionWarnings(doc);
    expect(warnings[0].targetId).toBe("secret-value");
    expect(warnings[0].message).not.toContain("secret-value");
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("writes a changed style onto its paragraphs and keeps a direct size", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { styleId: "heading" },
          content: [{ type: "text" as const, text: "Beds" }],
        },
        {
          type: "paragraph",
          attrs: { styleId: "heading", direct: { fontSize: 16 } },
          content: [{ type: "text" as const, text: "Note", marks: [{ type: "italic" }] }],
        },
        {
          type: "paragraph",
          content: [{ type: "text" as const, text: "Plain" }],
        },
      ],
    };
    const applied = applyStyleFormats(doc, styles);
    expect(applied.content?.[0].content?.[0].marks).toEqual([
      { type: "textStyle", attrs: { fontSize: "18pt" } },
      { type: "bold" },
    ]);
    const larger = styles.map((style) =>
      style.id === "heading" ? { ...style, fontSize: 22 } : style,
    );
    const updated = applyStyleFormats(doc, larger);
    expect(updated.content?.[0].content?.[0].marks).toEqual([
      { type: "textStyle", attrs: { fontSize: "22pt" } },
      { type: "bold" },
    ]);
    expect(updated.content?.[1].content?.[0].marks).toEqual([
      { type: "italic" },
      { type: "textStyle", attrs: { fontSize: "16pt" } },
      { type: "bold" },
    ]);
    expect(updated.content?.[2].content?.[0].marks).toBeUndefined();
    expect(doc.content[0].content?.[0].marks).toBeUndefined();
  });

  it("stores a larger heading size and leaves a direct size", () => {
    const doc = {
      type: "doc",
      attrs: { paragraphStyles: styles },
      content: [
        {
          type: "paragraph",
          attrs: { styleId: "heading" },
          content: [{ type: "text" as const, text: "Beds" }],
        },
        {
          type: "paragraph",
          attrs: { styleId: "heading", direct: { fontSize: 16 } },
          content: [{ type: "text" as const, text: "Note" }],
        },
      ],
    };
    const updated = updateNamedStyle(doc, "heading", { fontSize: 22 });
    const saved = updated.attrs?.paragraphStyles as StyleDef[];
    expect(saved.find((style) => style.id === "heading")?.fontSize).toBe(22);
    expect(updated.content?.[0].content?.[0].marks).toEqual([
      { type: "textStyle", attrs: { fontSize: "22pt" } },
      { type: "bold" },
    ]);
    expect(updated.content?.[1].content?.[0].marks).toContainEqual({
      type: "textStyle",
      attrs: { fontSize: "16pt" },
    });
    expect(doc.content[0].content[0].marks).toBeUndefined();
    expect((doc.attrs.paragraphStyles as StyleDef[])[1]?.fontSize).toBe(18);
    const missed = updateNamedStyle(doc, "missing", { fontSize: 22 });
    expect((missed.attrs?.paragraphStyles as StyleDef[])[1]?.fontSize).toBe(18);
  });

  it("imports a template style and keeps the local heading", () => {
    const doc = {
      type: "doc",
      attrs: { paragraphStyles: styles },
      content: [
        {
          type: "paragraph",
          attrs: { styleId: "heading" },
          content: [{ type: "text" as const, text: "Beds" }],
        },
        {
          type: "paragraph",
          attrs: { styleId: "note" },
          content: [{ type: "text" as const, text: "Paths" }],
        },
        {
          type: "paragraph",
          attrs: { styleId: "heading", direct: { fontSize: 16 } },
          content: [{ type: "text" as const, text: "Note" }],
        },
      ],
    };
    const template = {
      attrs: {
        paragraphStyles: [
          { id: "heading", name: "Heading", fontSize: 22 },
          { id: "note", name: "Note", basedOn: "heading", fontSize: 14 },
          { id: "secret-value", name: "Dropped", fontSize: 0 },
          { id: "aside", name: "Aside", basedOn: "secret-value", fontSize: 12 },
        ],
      },
    };
    const imported = importParagraphStyles(doc, template);
    const saved = imported.attrs?.paragraphStyles as StyleDef[];
    expect(saved.find((style) => style.id === "heading")?.fontSize).toBe(18);
    expect(saved.find((style) => style.id === "note")).toEqual({
      id: "note",
      name: "Note",
      basedOn: "heading",
      fontSize: 14,
    });
    expect(saved.find((style) => style.id === "aside")?.basedOn).toBeUndefined();
    expect(saved.some((style) => style.id === "secret-value")).toBe(false);
    expect(JSON.stringify(imported)).not.toContain("secret-value");
    expect(imported.content?.[0].content?.[0].marks).toEqual([
      { type: "textStyle", attrs: { fontSize: "18pt" } },
      { type: "bold" },
    ]);
    expect(imported.content?.[1].content?.[0].marks).toEqual([
      { type: "textStyle", attrs: { fontSize: "14pt" } },
      { type: "bold" },
    ]);
    expect(imported.content?.[2].content?.[0].marks).toContainEqual({
      type: "textStyle",
      attrs: { fontSize: "16pt" },
    });
    expect(doc.content[0].content?.[0].marks).toBeUndefined();
    expect((doc.attrs.paragraphStyles as StyleDef[])[1]?.fontSize).toBe(18);
    const same = importParagraphStyles(doc, { attrs: { paragraphStyles: styles } });
    expect((same.attrs?.paragraphStyles as StyleDef[])[1]?.fontSize).toBe(18);
    expect(same.content?.[0].content?.[0].marks).toBeUndefined();
  });

  it("applies a character style and keeps a direct override", () => {
    const doc = {
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "secret-value",
              marks: [{ type: "characterStyle", attrs: { style: "emphasis" } }],
            },
          ],
        },
      ],
    };
    const emphasis = [{ id: "emphasis", name: "Emphasis", bold: true, italic: true }];
    const applied = applyCharacterStyles(doc, emphasis);
    expect(applied.warnings).toEqual([]);
    expect(applied.doc.content?.[0].content?.[0].marks).toEqual([
      { type: "characterStyle", attrs: { style: "emphasis" } },
      { type: "bold" },
      { type: "italic" },
    ]);
    expect(doc.content[0].content[0].marks).toEqual([
      { type: "characterStyle", attrs: { style: "emphasis" } },
    ]);
    const direct = applyCharacterStyles(
      {
        content: [
          {
            type: "text",
            text: "Paths",
            marks: [
              { type: "characterStyle", attrs: { style: "emphasis" } },
              { type: "characterDirect", attrs: { bold: false } },
            ],
          },
        ],
      },
      emphasis,
    );
    expect(direct.doc.content?.[0].marks?.map((mark) => mark.type)).toEqual([
      "characterStyle",
      "characterDirect",
      "italic",
    ]);
    const missing = applyCharacterStyles(
      {
        content: [
          {
            type: "text",
            text: "Paths",
            marks: [{ type: "characterStyle", attrs: { style: "secret-value" } }],
          },
        ],
      },
      emphasis,
    );
    expect(missing.warnings).toEqual([
      { message: "That character style is not in this document." },
    ]);
    expect(JSON.stringify(missing.warnings)).not.toContain("secret-value");
    expect(missing.doc.content?.[0].marks).toEqual([
      { type: "characterStyle", attrs: { style: "secret-value" } },
    ]);
    expect(
      characterStyleList({
        attrs: {
          characterStyles: [
            { id: "emphasis", name: "Emphasis", bold: true, italic: true, basedOn: "strong" },
            { id: "quiet", name: "Quiet", italic: true, basedOn: "secret-value" },
            { id: "secret-value", name: "Hidden", bold: true },
          ],
        },
      }),
    ).toEqual([
      { id: "emphasis", name: "Emphasis", basedOn: "strong", bold: true, italic: true },
      { id: "quiet", name: "Quiet", italic: true },
    ]);
  });

  it("takes bold from the parent character style and lets the child turn it off", () => {
    const styles = [
      { id: "strong", name: "Strong", bold: true },
      { id: "emphasis", name: "Emphasis", basedOn: "strong", italic: true },
    ];
    const doc = {
      content: [
        {
          type: "text",
          text: "secret-value",
          marks: [{ type: "characterStyle", attrs: { style: "emphasis" } }],
        },
      ],
    };
    const applied = applyCharacterStyles(doc, styles);
    expect(applied.warnings).toEqual([]);
    expect(applied.doc.content?.[0].marks?.map((mark) => mark.type)).toEqual([
      "characterStyle",
      "bold",
      "italic",
    ]);
    expect(doc.content[0].text).toBe("secret-value");
    expect(JSON.stringify(applied.doc.content?.[0].marks)).not.toContain("secret-value");
    expect(styles[1].basedOn).toBe("strong");

    const stored = {
      attrs: {
        characterStyles: [
          { id: "strong", name: "Strong", bold: true },
          { id: "emphasis", name: "Emphasis", basedOn: "strong", bold: false, italic: true },
        ],
      },
    };
    const listed = characterStyleList(stored);
    expect(listed[1]).toEqual({
      id: "emphasis",
      name: "Emphasis",
      basedOn: "strong",
      bold: false,
      italic: true,
    });
    const reopened = applyCharacterStyles(doc, listed);
    expect(reopened.doc.content?.[0].marks?.map((mark) => mark.type)).toEqual([
      "characterStyle",
      "italic",
    ]);
    expect(stored.attrs.characterStyles[1].bold).toBe(false);

    const quieter = applyCharacterStyles(doc, [
      { id: "strong", name: "Strong", bold: true },
      { id: "emphasis", name: "Emphasis", basedOn: "strong", bold: false, italic: true },
    ]);
    expect(quieter.doc.content?.[0].marks?.map((mark) => mark.type)).toEqual([
      "characterStyle",
      "italic",
    ]);

    const loop = applyCharacterStyles(doc, [
      { id: "strong", name: "Strong", basedOn: "emphasis", bold: true },
      { id: "emphasis", name: "Emphasis", basedOn: "strong", italic: true },
    ]);
    expect(loop.doc.content?.[0].marks?.map((mark) => mark.type)).toEqual([
      "characterStyle",
      "bold",
      "italic",
    ]);
  });

  it("stops when a style is based on itself", () => {
    const loop: StyleDef[] = [
      { id: "a", name: "A", basedOn: "b", bold: true },
      { id: "b", name: "B", basedOn: "a", fontSize: 14 },
    ];
    expect(effectiveFormat(loop, "a")).toEqual({ bold: true, fontSize: 14 });
  });

  it("adds a character style from a template and leaves the one already stored", () => {
    const doc = {
      attrs: { characterStyles: [{ id: "strong", name: "Strong", bold: true }] },
      content: [{ type: "text", text: "secret-value" }],
    };
    const template = {
      attrs: {
        characterStyles: [
          { id: "strong", name: "Strong", italic: true },
          { id: "emphasis", name: "Emphasis", basedOn: "strong", italic: true },
          { id: "aside", name: "Aside", basedOn: "missing", italic: true },
          { id: "secret-value", name: "Dropped", italic: true },
        ],
      },
    };
    const imported = importCharacterStyles(doc, template);
    const saved = imported.attrs?.characterStyles as { id: string; basedOn?: string; italic?: boolean; bold?: boolean }[];
    expect(saved.find((style) => style.id === "strong")).toEqual({
      id: "strong",
      name: "Strong",
      bold: true,
    });
    expect(saved.find((style) => style.id === "emphasis")).toEqual({
      id: "emphasis",
      name: "Emphasis",
      basedOn: "strong",
      italic: true,
    });
    expect(saved.find((style) => style.id === "aside")?.basedOn).toBeUndefined();
    expect(saved.some((style) => style.id === "secret-value")).toBe(false);
    expect(JSON.stringify(imported.attrs)).not.toContain("secret-value");
    expect(imported.content).toEqual(doc.content);
    expect(doc.attrs.characterStyles).toEqual([{ id: "strong", name: "Strong", bold: true }]);
    expect(template.attrs.characterStyles[0]).toEqual({ id: "strong", name: "Strong", italic: true });
  });

  it("stores the selection's bold and size on the named style", () => {
    const doc = {
      attrs: {
        paragraphStyles: [
          { id: "heading", name: "Heading", bold: true, fontSize: 18 },
          { id: "body", name: "Body", fontSize: 12 },
        ],
      },
      content: [
        {
          type: "paragraph",
          attrs: { styleId: "heading" },
          content: [{ type: "text", text: "Beds", marks: [{ type: "bold" }] }],
        },
        {
          type: "paragraph",
          attrs: { styleId: "heading", direct: { bold: true, fontSize: 16 } },
          content: [
            {
              type: "text",
              text: "Kept",
              marks: [{ type: "bold" }, { type: "textStyle", attrs: { fontSize: "16pt" } }],
            },
          ],
        },
        {
          type: "paragraph",
          attrs: { styleId: "body" },
          content: [{ type: "text", text: "secret-value" }],
        },
      ],
    };
    const patch = stylePatchFromMarks([
      { type: "textStyle", attrs: { fontSize: "22pt" } },
      { type: "textStyle", attrs: { fontSize: "secret-value" } },
    ]);
    expect(patch).toEqual({ bold: false, fontSize: 22 });
    expect(JSON.stringify(patch)).not.toContain("secret-value");
    expect(stylePatchFromMarks(null)).toEqual({ error: "Select the words to match." });
    const next = updateNamedStyle(doc, "heading", patch);
    const heading = next.content?.[0].content?.[0];
    expect(heading?.text).toBe("Beds");
    expect(heading?.marks?.some((mark) => mark.type === "bold")).toBe(false);
    expect(heading?.marks).toContainEqual({ type: "textStyle", attrs: { fontSize: "22pt" } });
    const kept = next.content?.[1].content?.[0];
    expect(kept?.marks?.some((mark) => mark.type === "bold")).toBe(true);
    expect(kept?.marks).toContainEqual({ type: "textStyle", attrs: { fontSize: "16pt" } });
    expect(next.content?.[2].content?.[0].text).toBe("secret-value");
    expect(next.attrs?.paragraphStyles?.[0]).toMatchObject({ bold: false, fontSize: 22 });
    expect(next.attrs?.paragraphStyles?.[1]).toMatchObject({ fontSize: 12 });
    expect(doc.attrs.paragraphStyles[0]).toMatchObject({ bold: true, fontSize: 18 });
    expect(doc.content[0].content[0].marks).toEqual([{ type: "bold" }]);
    const missed = updateNamedStyle(doc, "secret-value", { bold: false });
    expect(missed.attrs?.paragraphStyles?.[0]).toMatchObject({ bold: true, fontSize: 18 });
    expect(JSON.stringify(missed.attrs?.paragraphStyles)).not.toContain("secret-value");
  });

  it("assigns a named style to one paragraph and keeps a direct format", () => {
    const doc = {
      attrs: {
        paragraphStyles: [{ id: "heading", name: "Heading", bold: true, fontSize: 18 }],
      },
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Beds" }] },
        { type: "paragraph", content: [{ type: "text", text: "secret-value" }] },
      ],
    };
    const next = assignParagraphStyle(doc, 0, "heading");
    expect(next.content?.[0].attrs?.styleId).toBe("heading");
    expect(next.content?.[0].content?.[0].marks).toContainEqual({ type: "bold" });
    expect(next.content?.[0].content?.[0].marks).toContainEqual({
      type: "textStyle",
      attrs: { fontSize: "18pt" },
    });
    expect(next.content?.[1].content?.[0].text).toBe("secret-value");
    expect(next.content?.[1].attrs?.styleId).toBeUndefined();
    expect(doc.content[0].attrs).toBeUndefined();
    const missed = assignParagraphStyle(doc, 0, "missing");
    expect(missed.content?.[0].attrs?.styleId).toBeUndefined();
    const direct = assignParagraphStyle(
      {
        attrs: doc.attrs,
        content: [
          {
            type: "paragraph",
            attrs: { direct: { bold: false } },
            content: [{ type: "text", text: "North" }],
          },
        ],
      },
      0,
      "heading",
    );
    expect(direct.content?.[0].attrs?.styleId).toBe("heading");
    expect(direct.content?.[0].content?.[0].marks?.some((mark) => mark.type === "bold")).toBe(false);
  });
});
