import { Type } from "@earendil-works/pi-ai";
import type { SlideElement } from "@suiteleaf/core";
import { reorder } from "../../editors/slide-layouts";
import { deleteSlides, duplicateSlides, reorderGroup } from "../../editors/slide-editing";
import { ToolError, tool, type SuiteTool } from "../host";
import { REMOVE_INTENT } from "./files";
import type { SlidesAgentContext } from "./slides";
import { titleOf, orderText } from "./slide-describe";
import {
  wait,
  findSlide,
  asWhich,
  stringArgs,
  resolveIds,
  thumbnail,
  canvas,
} from "./slide-targets";

const SHAPE_TYPES: Record<string, NonNullable<SlideElement["shapeType"]>> = {
  rectangle: "rect",
  rect: "rect",
  "rounded rectangle": "roundRect",
  roundrect: "roundRect",
  circle: "ellipse",
  ellipse: "ellipse",
};

export function slideArrangeTools(ctx: SlidesAgentContext): SuiteTool[] {
  return [
    tool({
      name: "move_slide",
      label: "Reorder slides",
      description:
        "Move one slide, by its number or title: to a position (`to`, 1 = first), or `before` / `after` another slide (its title or number). To move two or more slides together and keep their order, use move_slides.",
      parameters: Type.Object({
        slide: Type.String({ description: "Number or title of the slide to move." }),
        to: Type.Optional(Type.Number()),
        before: Type.Optional(Type.String()),
        after: Type.Optional(Type.String()),
      }),
      prepare: stringArgs,
      target: ({ slide }) => {
        try {
          return thumbnail(findSlide(ctx.deck(), asWhich(slide), ctx.activeSlideId).index);
        } catch {
          return undefined;
        }
      },
      async execute({ slide, to, before, after }) {
        const deck = ctx.deck();
        const { id, index } = findSlide(deck, asWhich(slide), ctx.activeSlideId);
        let dest: number;
        if (before !== undefined || after !== undefined) {
          const other = findSlide(deck, (before ?? after)!, ctx.activeSlideId);
          if (other.id === id) throw new ToolError(`Slide ${slide} cannot move ${before !== undefined ? "before" : "after"} itself.`);
          dest = deck.slideOrder.filter((x) => x !== id).indexOf(other.id) + (before !== undefined ? 0 : 1);
        } else if (to !== undefined) dest = Math.max(0, Math.min(deck.slideOrder.length - 1, to - 1));
        else throw new ToolError("Say where the slide goes: `to` a position, or `before` or `after` another slide.");
        const order = reorder(deck.slideOrder, index, dest);
        const name = titleOf(deck.slides[id]);
        const prev = dest > 0 ? `after "${titleOf(deck.slides[order[dest - 1]])}"` : "",
          next = dest < order.length - 1 ? `before "${titleOf(deck.slides[order[dest + 1]])}"` : "";
        const neighbours = prev && next ? `${prev} and ${next}` : prev ? `last, ${prev}` : `first, ${next}`;
        const listing = order.map((x, i) => `${i + 1}. ${titleOf(deck.slides[x])}`).join("; ");
        if (dest === index) return `"${name}" is already slide ${index + 1} (${neighbours}); nothing changed. Order: ${listing}`;
        ctx.commit({ ...deck, slideOrder: order });
        ctx.select(id, null);
        await wait(300);
        return `Moved "${name}" from slide ${index + 1} to slide ${dest + 1}: it now comes ${neighbours}. Order: ${listing}`;
      },
    }),
    tool({
      name: "move_slides",
      label: "Reorder slides",
      description:
        "Move two or more slides together, keeping the order they are in now. `slides` are their numbers or titles. Put the group `after` or `before` another slide (its title or number), or at position `to` (1 = first).",
      parameters: Type.Object({
        slides: Type.Array(Type.String({ description: "Slide number or title." })),
        to: Type.Optional(Type.Number({ description: "Position the group should start at. 1 is first." })),
        before: Type.Optional(Type.String()),
        after: Type.Optional(Type.String()),
      }),
      prepare: stringArgs,
      target: ({ slides }) => {
        try {
          return thumbnail(findSlide(ctx.deck(), asWhich(slides[0]), ctx.activeSlideId).index);
        } catch {
          return undefined;
        }
      },
      async execute({ slides, to, before, after }) {
        const deck = ctx.deck();
        const ids = resolveIds(deck, slides, ctx.activeSlideId);
        let gap: number;
        if (before !== undefined || after !== undefined) {
          const other = findSlide(deck, asWhich(before ?? after), ctx.activeSlideId);
          if (ids.includes(other.id)) throw new ToolError(`Those slides cannot move ${before !== undefined ? "before" : "after"} themselves.`);
          gap = other.index + (before !== undefined ? 0 : 1);
        } else if (to !== undefined) {
          const rest = deck.slideOrder.filter((id) => !ids.includes(id));
          const dest = Math.max(0, Math.min(rest.length, to - 1));
          gap = dest === 0 ? 0 : deck.slideOrder.indexOf(rest[dest - 1]) + 1;
        } else throw new ToolError("Say where the slides go: `to` a position, or `before` or `after` another slide.");
        const order = reorderGroup(deck.slideOrder, ids, gap);
        const names = deck.slideOrder.filter((id) => ids.includes(id)).map((id) => titleOf(deck.slides[id]));
        const listing = orderText({ ...deck, slideOrder: order });
        if (order === deck.slideOrder) return `${names.join(" and ")} already sit there. Order: ${listing}`;
        ctx.commit({ ...deck, slideOrder: order });
        const moving = order.filter((item) => ids.includes(item));
        ctx.select(moving[0], null);
        await wait(300);
        const at = order.indexOf(moving[0]);
        return `Moved ${names.join(" and ")} together. They now start at slide ${at + 1}, still in that order. Order: ${listing}`;
      },
    }),
    tool({
      name: "duplicate_slide",
      label: "Duplicate slide",
      description:
        "Duplicate a whole slide. The copy appears immediately after the original and keeps its text, shapes and pictures. `slide` is its number or title.",
      parameters: Type.Object({
        slide: Type.Optional(Type.String({ description: "Slide number or title. Default: the current slide." })),
      }),
      prepare: stringArgs,
      target: ({ slide }) => {
        try {
          return thumbnail(findSlide(ctx.deck(), asWhich(slide), ctx.activeSlideId).index);
        } catch {
          return undefined;
        }
      },
      execute({ slide }) {
        const deck = ctx.deck();
        const { id } = findSlide(deck, asWhich(slide), ctx.activeSlideId);
        const result = duplicateSlides(deck, [id], () => crypto.randomUUID());
        if (!result.newIds.length) throw new ToolError("That slide could not be duplicated.");
        ctx.commit(result.deck);
        ctx.select(result.newIds[0], null);
        const at = result.deck.slideOrder.indexOf(result.newIds[0]);
        return `Duplicated "${titleOf(deck.slides[id])}". The copy is slide ${at + 1}, right after the original, with the same text and objects. Order: ${orderText(result.deck)}`;
      },
    }),
    tool({
      name: "delete_slide",
      label: "Delete slide",
      description:
        "Delete one slide (`slide`, its number or title) or several at once (`slides`, numbers or titles). Several slides go in one step.",
      parameters: Type.Object({
        slide: Type.Optional(Type.String({ description: "Number or title of one slide." })),
        slides: Type.Optional(Type.Array(Type.String({ description: "Numbers or titles, to delete them together." }))),
      }),
      prepare: stringArgs,
      intent: REMOVE_INTENT,
      confirm: ({ slide, slides }) => {
        const deck = ctx.deck();
        const which = [...(slides ?? []), ...(slide !== undefined ? [slide] : [])];
        if (!which.length) return undefined;
        const names = which.map((item) => {
          try {
            const found = findSlide(deck, asWhich(item), ctx.activeSlideId);
            return `slide ${found.index + 1} (“${titleOf(deck.slides[found.id])}”)`;
          } catch {
            return `"${item}"`;
          }
        });
        return names.length === 1 ? `Delete ${names[0]}?` : `Delete ${names.length} slides (${names.join(" and ")})?`;
      },
      target: ({ slide, slides }) => {
        try {
          return thumbnail(findSlide(ctx.deck(), asWhich(slide ?? slides?.[0]), ctx.activeSlideId).index);
        } catch {
          return undefined;
        }
      },
      execute({ slide, slides: many }) {
        const deck = ctx.deck();
        const which = [...(many ?? []), ...(slide !== undefined ? [slide] : [])];
        if (!which.length) throw new ToolError("Say which slide to delete, by number or title.");
        const ids = resolveIds(deck, which, ctx.activeSlideId);
        const result = deleteSlides(deck, ids);
        if ("error" in result) throw new ToolError(result.error);
        ctx.commit(result.deck);
        ctx.select(result.activeId, null);
        const names = ids.map((id) => titleOf(deck.slides[id]));
        return `Deleted ${names.join(" and ")}. ${result.deck.slideOrder.length} left. Order: ${orderText(result.deck)}`;
      },
    }),
    tool({
      name: "copy_element",
      label: "Copy object",
      description:
        "Copy one object on a slide (a shape or a text box) so paste_element can put it on another slide at the same position. This does not duplicate a slide. `shape` is rectangle, rounded rectangle, or circle when the slide has several objects; otherwise the selected object is copied.",
      parameters: Type.Object({
        slide: Type.Optional(Type.String({ description: "Slide number or title. Default: the current slide." })),
        shape: Type.Optional(Type.String({ description: "rectangle, rounded rectangle, or circle." })),
      }),
      prepare: stringArgs,
      target: () => canvas(),
      execute({ slide, shape }) {
        const { id, index } = findSlide(ctx.deck(), asWhich(slide), ctx.activeSlideId);
        const current = ctx.deck().slides[id];
        const want = shape ? SHAPE_TYPES[shape.toLowerCase()] : undefined;
        if (shape && !want) throw new ToolError(`"${shape}" is not a shape here. Use rectangle, rounded rectangle, or circle.`);
        const matches = current.elements.filter((el) => {
          if (want) return el.type === "shape" && el.shapeType === want;
          return el.type === "shape" || el.type === "image" || el.type === "text";
        });
        const selected = current.elements.find((el) => el.id === ctx.selectedElementId);
        const el = (want ? matches.find((item) => item.id === selected?.id) : selected) ?? matches.at(-1);
        if (!el || (want && el.shapeType !== want)) {
          const present = current.elements.filter((item) => item.type === "shape").map((item) => item.shapeType ?? "shape");
          throw new ToolError(
            shape
              ? `Slide ${index + 1} "${titleOf(current)}" has no ${shape}${present.length ? ` (it has: ${present.join(", ")})` : ""}.`
              : "Nothing is selected to copy. Say which shape, or select an object first.",
          );
        }
        if (!ctx.copyElements(id, [el.id])) throw new ToolError("That object could not be copied.");
        const kind = el.type === "shape" ? `${shape ?? el.shapeType} shape` : el.type === "text" ? `text box "${el.content ?? ""}"` : el.type;
        return `Copied the ${kind} at (${el.x}, ${el.y}) on slide ${index + 1} "${titleOf(current)}". paste_element puts it on another slide at the same position.`;
      },
    }),
    tool({
      name: "paste_element",
      label: "Paste object",
      description:
        "Paste the object copied with copy_element onto a slide, at the same position it had. On a different slide the position stays the same. `slide` is the destination's number or title.",
      parameters: Type.Object({
        slide: Type.String({ description: "Number or title of the slide to paste onto." }),
      }),
      prepare: stringArgs,
      target: ({ slide }) => {
        try {
          return thumbnail(findSlide(ctx.deck(), asWhich(slide), ctx.activeSlideId).index);
        } catch {
          return undefined;
        }
      },
      execute({ slide }) {
        const { id, index } = findSlide(ctx.deck(), asWhich(slide), ctx.activeSlideId);
        const placed = ctx.pasteElements(id);
        if (!placed.length) throw new ToolError("Nothing is copied. Use copy_element first.");
        const el = placed[placed.length - 1];
        return `Pasted the ${el.type === "shape" ? `${el.shapeType ?? "shape"} shape` : el.type} onto slide ${index + 1} "${titleOf(ctx.deck().slides[id])}" at (${el.x}, ${el.y}).`;
      },
    }),
  ];
}
