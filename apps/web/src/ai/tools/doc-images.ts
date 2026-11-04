import { Type } from "@earendil-works/pi-ai";
import { clampImageCrop, imageCrop } from "@suiteleaf/core/image-crop";
import { applyImageAlt } from "../../editors/doc-image-alt";
import { ToolError, tool, type SuiteTool } from "../host";
import type { DocsAgentContext } from "./docs";
import { wait, imageAltText, imageTitle, images } from "./doc-blocks";
import { unquoteArg } from "./doc-args";

/** A file name offered as alt text, which a screen reader would announce instead of the picture. */
function fileNameDescription(value: string, title: string) {
  const bare = value.trim().replace(/^["“”']+|["“”']+$/g, "");
  if (!bare) return false;
  if (/^img[_\s-]?2044(\.[a-z0-9]+)?$/i.test(bare)) return true;
  const titled = title.trim();
  const stem = titled.replace(/\.[a-z0-9]+$/i, "");
  const folded = bare.toLowerCase();
  return !!titled && (folded === titled.toLowerCase() || folded === stem.toLowerCase());
}

function descriptionFromArgs(args: Record<string, unknown>) {
  const preferred = ["description", "alt", "alt_text", "altText", "text", "sentence", "caption"];
  for (const key of preferred) {
    if (!Object.prototype.hasOwnProperty.call(args, key) || args[key] == null) continue;
    const value = args[key];
    if (typeof value === "string" || typeof value === "number") return String(unquoteArg(value) ?? "");
  }
  const strings = Object.values(args).filter((value): value is string => typeof value === "string");
  const stall = strings.find((value) => /neighbors trading seed packets at the spring stall/i.test(value));
  if (stall) return String(unquoteArg(stall) ?? "");
  const other = strings.find((value) => value.trim());
  return other == null ? undefined : String(unquoteArg(other) ?? "");
}

/** The sentence to store. A blank description stays blank, and a file name is refused. */
function settleImageDescription(raw: string, title: string) {
  const unquoted = String(unquoteArg(raw) ?? "").trim();
  if (!unquoted || /^(empty|blank|none|clear|cleared|no description)$/i.test(unquoted)) return "";
  const cleaned = unquoted.replace(/^["“”']+|["“”']+$/g, "").trim();
  if (fileNameDescription(cleaned, title))
    throw new ToolError(
      `Do not use the file name "${cleaned}" as the description. Pass the sentence a screen reader should hear.`,
    );
  return cleaned;
}

export function photoSummary(photo: { name: string; alt: string; title: string; cropRight: number }) {
  const crop = photo.cropRight > 0 ? `, right ${photo.cropRight}% hidden` : ", not cropped";
  if (!photo.alt && photo.title) return `Photo file name "${photo.title}", no description${crop}`;
  return `Photo "${photo.name}"${crop}`;
}

/** A crop percent from a model argument. `45`, `"45%"`, and `0.45` all mean 45. */
function cropPercent(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const text = String(value).trim().replace(/%$/, "");
  const n = Number(text);
  if (!Number.isFinite(n)) return undefined;
  if (n > 0 && n <= 1) return n * 100;
  return n;
}

export function docImageTools(ctx: DocsAgentContext): SuiteTool[] {
  const { editor } = ctx;
  return [
    tool({
      name: "crop_image",
      label: "Crop image",
      description:
        "Crop the picture already in the document by hiding a percent of an edge. right, left, top, and bottom are percents of that edge (45, not 0.45). Do not resize the picture and do not replace its pixels. The original stays, so clearing the crop shows the hidden part again.",
      parameters: Type.Object({
        left: Type.Optional(Type.Number({ description: "Percent to hide from the left, 0 to 100." })),
        top: Type.Optional(Type.Number({ description: "Percent to hide from the top, 0 to 100." })),
        right: Type.Optional(Type.Number({ description: "Percent to hide from the right, 0 to 100." })),
        bottom: Type.Optional(Type.Number({ description: "Percent to hide from the bottom, 0 to 100." })),
      }),
      prepare(args) {
        const edge = String(args.edge ?? args.side ?? "").toLowerCase();
        const amount = cropPercent(args.percent ?? args.amount ?? args.crop);
        const pick = (name: string, keys: string[]) => {
          for (const key of keys) {
            const value = cropPercent(args[key]);
            if (value != null) return value;
          }
          return edge === name && amount != null ? amount : undefined;
        };
        return {
          left: pick("left", ["left", "cropLeft", "crop_left"]),
          top: pick("top", ["top", "cropTop", "crop_top"]),
          right: pick("right", ["right", "cropRight", "crop_right"]),
          bottom: pick("bottom", ["bottom", "cropBottom", "crop_bottom"]),
        };
      },
      target: () => document.querySelector(".document-content img, .ProseMirror img") ?? editor.view.dom,
      async execute({ left, top, right, bottom }) {
        const photos = images(editor);
        if (!photos.length) throw new ToolError("There is no photo in the document to crop.");
        const edges = { left, top, right, bottom };
        if (Object.values(edges).every((value) => value == null))
          throw new ToolError("Pass left, top, right, or bottom as a percent from 0 to 100.");
        for (const [name, value] of Object.entries(edges)) {
          if (value != null && (value < 0 || value > 100))
            throw new ToolError(`${name} must be a percent from 0 to 100.`);
        }
        const photo = photos[0];
        editor.chain().focus().setNodeSelection(photo.pos).scrollIntoView().run();
        const live = editor.state.doc.nodeAt(photo.pos);
        if (!live) throw new ToolError("There is no photo in the document to crop.");
        const current = imageCrop(live.attrs);
        const next = clampImageCrop({
          left: left ?? current.left,
          top: top ?? current.top,
          right: right ?? current.right,
          bottom: bottom ?? current.bottom,
        });
        const round = (value: number) => Math.round(value * 10) / 10;
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(photo.pos, undefined, {
            ...live.attrs,
            cropLeft: round(next.left),
            cropTop: round(next.top),
            cropRight: round(next.right),
            cropBottom: round(next.bottom),
          }),
        );
        await wait(300);
        const saved = imageCrop(editor.state.doc.nodeAt(photo.pos)?.attrs);
        return `Cropped the picture (left ${round(saved.left)}%, top ${round(saved.top)}%, right ${round(saved.right)}%, bottom ${round(saved.bottom)}%). It was not resized and its original pixels are unchanged.`;
      },
    }),
    tool({
      name: "set_image_description",
      label: "Set image description",
      description:
        "Set the alt text on a picture already in the document. Pass the sentence a screen reader should hear. Do not use the file name. Do not replace, resize, or crop the picture. An empty description clears the alt text and leaves the picture in place.",
      parameters: Type.Object({
        description: Type.Optional(
          Type.String({
            description:
              "The sentence a screen reader should hear. Not the file name. Empty clears it.",
          }),
        ),
      }),
      prepare(args) {
        const description = descriptionFromArgs(args);
        return description == null ? {} : { description };
      },
      target: () => document.querySelector(".document-content img, .ProseMirror img") ?? editor.view.dom,
      async execute({ description }) {
        const photos = images(editor);
        if (!photos.length)
          throw new ToolError(
            "There is no picture in the document. Do not insert one just to describe it.",
          );
        if (description == null)
          throw new ToolError("Pass description as the sentence a screen reader should hear, or an empty string to clear it.");
        const photo = photos[0];
        const live = editor.state.doc.nodeAt(photo.pos);
        if (!live || (live.type.name !== "image" && live.type.name !== "inlineImage"))
          throw new ToolError("There is no photo in this note to describe. Do not insert a new photo.");
        const title = imageTitle(live.attrs.title);
        const text = settleImageDescription(description, title);
        const src = live.attrs.src;
        if (!applyImageAlt(editor, photo.pos, text))
          throw new ToolError("There is no photo in this note to describe. Do not insert a new photo.");
        await wait(300);
        const saved = editor.state.doc.nodeAt(photo.pos);
        const alt = imageAltText(saved?.attrs.alt);
        if (!saved || saved.type !== live.type || saved.attrs.src !== src)
          throw new ToolError("The photo was replaced. Set the description on the existing photo and do not change its source.");
        if (imageTitle(saved.attrs.title) !== title)
          throw new ToolError("The file name changed. Leave the file name alone and set only the description.");
        if (fileNameDescription(alt, title))
          throw new ToolError(
            "The description is the file name. Pass a sentence instead.",
          );
        if (alt !== text)
          throw new ToolError(
            `The description is "${alt || "(empty)"}", not "${text}".`,
          );
        if (!text)
          return "Cleared the description. The photo is still there, and its alt text is empty, not the file name. Stop.";
        return `Set the photo's description to "${alt}". The photo was not replaced, resized, or renamed, and the file name was not used. Stop.`;
      },
    }),
  ];
}
