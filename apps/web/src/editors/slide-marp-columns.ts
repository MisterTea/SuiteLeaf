import type { Slide, SlideElement, TextRun } from "@suiteleaf/core";

/** A bar, pill, or logo the layout draws from the theme. It is not in the markdown. */
export function isMarpChrome(el: SlideElement): boolean {
  return (el.type === "shape" && !el.marpHtml) || (el.type === "image" && !el.marpLines && el.src === "beam-ut-logo");
}

/** The layout title stays put. Other text and pictures can be reordered around it. */
export function isMarpTitle(el: SlideElement): boolean {
  if (el.type !== "text") return false;
  const placeholder = (el.placeholder ?? "").toLowerCase();
  return placeholder.includes("title") && !placeholder.includes("subtitle");
}

function runsOf(el: SlideElement): TextRun[] {
  if (el.runs?.length) return el.runs.map((run) => ({ ...run }));
  if (!el.content) return [];
  return [
    {
      text: el.content,
      ...(el.bold ? { bold: true } : {}),
      ...(el.italic ? { italic: true } : {}),
      ...(el.underline ? { underline: true } : {}),
    },
  ];
}

function writeRuns(el: SlideElement, runs: TextRun[]) {
  const content = runs.map((run) => run.text).join("");
  const meaningful = runs.filter((run) => run.text.replace(/\n/g, "") !== "");
  const bold = meaningful.length > 0 && meaningful.every((run) => run.bold);
  const italic = meaningful.length > 0 && meaningful.every((run) => run.italic);
  const underline = meaningful.length > 0 && meaningful.every((run) => run.underline);
  const uniform = meaningful.every(
    (run) =>
      !!run.bold === bold && !!run.italic === italic && !!run.underline === underline && !run.color,
  );
  el.content = content;
  if (uniform) {
    delete el.runs;
    if (bold) el.bold = true;
    else delete el.bold;
    if (italic) el.italic = true;
    else delete el.italic;
    if (underline) el.underline = true;
    else delete el.underline;
  } else {
    el.runs = runs;
    delete el.bold;
    delete el.italic;
    delete el.underline;
  }
}

/**
 * A box drawn from the same markdown lines as before keeps its id, so the
 * selection and review comments stay on it after the slide is laid out again.
 */
export function keepElementIds(previous: SlideElement[], next: SlideElement[]): SlideElement[] {
  const ids = new Map<string, string>();
  for (const el of previous) {
    const key = el.marpLines ? `${el.type}:${el.marpLines[0]}` : null;
    if (key && !ids.has(key)) ids.set(key, el.id);
  }
  return next.map((el) => {
    const key = el.marpLines ? `${el.type}:${el.marpLines[0]}` : null;
    const id = key ? ids.get(key) : undefined;
    if (!id) return el;
    ids.delete(key!);
    return { ...el, id };
  });
}

function sameTextStyle(a: SlideElement, b: SlideElement) {
  return (
    (a.fontSize || 20) === (b.fontSize || 20) &&
    (a.color || "") === (b.color || "") &&
    (a.align || "left") === (b.align || "left") &&
    (a.fontFamily || "") === (b.fontFamily || "")
  );
}

/** Stacked body text with nothing between it becomes one box. Titles, code, and math stay separate. */
export function mergeConsecutiveText(elements: SlideElement[]): SlideElement[] {
  const merged: SlideElement[] = [];
  for (const el of elements) {
    const prev = merged[merged.length - 1];
    if (!prev || !canMergeText(prev, el)) {
      merged.push(el);
      continue;
    }
    const rows = textRows(prev) + textRows(el);
    const indent = Math.max(0, el.x - prev.x);
    const spaces =
      indent > (prev.fontSize || 20) * 0.75
        ? "  ".repeat(Math.max(1, Math.round(indent / (prev.fontSize || 20))))
        : "";
    const right = runsOf(el).map((run, index) =>
      index === 0 ? { ...run, text: spaces + run.text } : run,
    );
    const left = runsOf(prev);
    if (left.length && !left[left.length - 1].text.endsWith("\n")) {
      left[left.length - 1] = { ...left[left.length - 1], text: `${left[left.length - 1].text}\n` };
    }
    const rightEdge = Math.max(prev.x + prev.width, el.x + el.width);
    const bottom = Math.max(prev.y + prev.height, el.y + el.height);
    prev.x = Math.min(prev.x, el.x);
    prev.y = Math.min(prev.y, el.y);
    prev.width = rightEdge - prev.x;
    prev.height = bottom - prev.y;
    if (prev.marpLines && el.marpLines)
      prev.marpLines = [
        Math.min(prev.marpLines[0], el.marpLines[0]),
        Math.max(prev.marpLines[1], el.marpLines[1]),
      ];
    else delete prev.marpLines;
    writeRuns(prev, [...left, ...right]);
    const font = prev.fontSize || 20;
    if (rows > 1)
      prev.lineHeight = Math.min(4, Math.round((prev.height / (rows * font)) * 100) / 100);
  }
  return merged;
}

/** Rows a text box shows, counting the ones its words wrap onto. */
function textRows(el: SlideElement) {
  const lines = (el.content ?? "").split("\n").length;
  const row = (el.fontSize || 20) * (el.lineHeight || 1.4);
  return Math.max(lines, Math.round(el.height / row));
}

function canMergeText(a: SlideElement, b: SlideElement) {
  if (a.type !== "text" || b.type !== "text") return false;
  if (a.preformatted || b.preformatted || a.math || b.math || a.fill || b.fill) return false;
  if (isMarpTitle(a) || isMarpTitle(b)) return false;
  if (!sameTextStyle(a, b)) return false;
  // One box has one hanging indent, so list items join only at the same depth and marker width.
  if ((a.hang ?? 0) !== (b.hang ?? 0)) return false;
  if (a.hang && Math.abs(a.x - b.x) > 1) return false;
  const overlap =
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  if (overlap < Math.min(a.width, b.width) * 0.45) return false;
  const gap = b.y - (a.y + a.height);
  const line = (a.fontSize || 20) * (a.lineHeight || 1.4);
  if (b.y + b.height < a.y + 4) return false;
  return gap <= Math.max(line * 1.6, 36);
}

function byReadingOrder(a: SlideElement, b: SlideElement) {
  if (a.y !== b.y) return a.y - b.y;
  return a.x - b.x;
}

function inRightColumn(el: SlideElement, width: number) {
  return el.x + el.width / 2 > width / 2;
}

/** Content under the title, left column then right column, top to bottom. */
export function marpColumns(
  slide: Slide,
  width = 960,
): [SlideElement[], SlideElement[]] {
  const items = slide.elements.filter((el) => !isMarpTitle(el));
  if (slide.layout !== "two-column") return [items.sort(byReadingOrder), []];
  return [
    items.filter((el) => !inRightColumn(el, width)).sort(byReadingOrder),
    items.filter((el) => inRightColumn(el, width)).sort(byReadingOrder),
  ];
}

const MARP_MARGIN = 48;
const MARP_GAP = 12;
const MARP_TITLE_TOP = 36;
const MARP_CONTENT_TOP = 130;

function stacked(items: SlideElement[], x: number, columnWidth: number) {
  let y = MARP_CONTENT_TOP;
  return items.map((el) => {
    const height =
      el.type === "image"
        ? Math.max(64, el.height)
        : Math.max(72, Math.min(el.height || 120, 280));
    const next = { ...el, x, y, width: columnWidth, height };
    y += height + MARP_GAP;
    return next;
  });
}

/** Snap every item into the column flow. Array order within a column is the reading order. */
export function reflowMarp(slide: Slide, width = 960): Slide {
  const title = slide.elements.find(isMarpTitle);
  const items = slide.elements.filter((el) => !isMarpTitle(el));
  const two = slide.layout === "two-column";
  const left = two ? items.filter((el) => !inRightColumn(el, width)) : items;
  const right = two ? items.filter((el) => inRightColumn(el, width)) : [];
  const inner = Math.max(120, width - MARP_MARGIN * 2);
  const columnWidth = two ? Math.round((inner - MARP_GAP) / 2) : inner;
  const elements = [
    ...(title
      ? [
          {
            ...title,
            x: MARP_MARGIN,
            y: MARP_TITLE_TOP,
            width: inner,
            height: Math.max(64, Math.min(title.height || 70, 100)),
          },
        ]
      : []),
    ...stacked(left, MARP_MARGIN, columnWidth),
    ...stacked(right, MARP_MARGIN + columnWidth + MARP_GAP, columnWidth),
  ];
  return { ...slide, elements };
}

/**
 * Move one item to the column and position under the pointer.
 * Returns null when the title was grabbed or the order did not change.
 */
export function reorderMarpItem(
  slide: Slide,
  elementId: string,
  point: { x: number; y: number },
  width = 960,
): Slide | null {
  const dragged = slide.elements.find((el) => el.id === elementId);
  if (!dragged || isMarpTitle(dragged)) return null;
  const [left, right] = marpColumns(slide, width);
  const two = slide.layout === "two-column";
  const targetRight = two && point.x >= width / 2;
  const parked = { ...dragged, x: targetRight ? width : 0 };
  const leftRest = left.filter((el) => el.id !== elementId);
  const rightRest = right.filter((el) => el.id !== elementId);
  const column = targetRight ? rightRest : leftRest;
  let index = column.length;
  for (let i = 0; i < column.length; i++) {
    if (point.y < column[i].y + column[i].height / 2) {
      index = i;
      break;
    }
  }
  const nextLeft = targetRight
    ? leftRest
    : [...column.slice(0, index), parked, ...column.slice(index)];
  const nextRight = targetRight
    ? [...column.slice(0, index), parked, ...column.slice(index)]
    : rightRest;
  const same =
    left.map((el) => el.id).join() === nextLeft.map((el) => el.id).join() &&
    right.map((el) => el.id).join() === nextRight.map((el) => el.id).join();
  if (same) return null;
  const title = slide.elements.find(isMarpTitle);
  return reflowMarp(
    {
      ...slide,
      elements: [...(title ? [title] : []), ...nextLeft, ...nextRight],
    },
    width,
  );
}

/**
 * Change reading order without moving any box. Each item takes the rectangle
 * of the slot it lands in. A drag that only shifts a box, or that would change
 * how many items are in a column, does nothing.
 */
export function reorderFittedMarpItem(
  slide: Slide,
  elementId: string,
  point: { x: number; y: number },
): Slide | null {
  const dragged = slide.elements.find((el) => el.id === elementId);
  if (!dragged || isMarpTitle(dragged) || isMarpChrome(dragged)) return null;
  const items = slide.elements
    .filter((el) => !isMarpTitle(el) && !isMarpChrome(el))
    .sort(byReadingOrder);
  const rest = items.filter((el) => el.id !== elementId);
  let index = rest.length;
  for (let i = 0; i < rest.length; i++) {
    if (point.y < rest[i].y + rest[i].height / 2) {
      index = i;
      break;
    }
  }
  const next = [...rest.slice(0, index), dragged, ...rest.slice(index)];
  if (next.every((el, i) => el.id === items[i].id)) return null;
  const slots = items.map((el) => ({
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
  }));
  const placed = next.map((el, i) => ({ ...el, ...slots[i] }));
  const fixed = slide.elements.filter((el) => isMarpTitle(el) || isMarpChrome(el));
  return { ...slide, elements: [...fixed, ...placed] };
}

function hasColumnContent(el: SlideElement) {
  if (el.type === "image") return !!el.src;
  if (el.type === "text") return !!el.content?.trim();
  return true;
}

/**
 * Single column to two columns leaves every item on the left and adds an empty
 * box on the right. Two columns to one column appends the right-hand items
 * after the left-hand ones.
 */
export function switchMarpLayout(
  slide: Slide,
  layout: "title-body" | "two-column",
  width = 960,
): Slide {
  if (slide.layout === layout) return slide;
  const title = slide.elements.find(isMarpTitle);
  const [left, right] = marpColumns(slide, width);
  if (layout === "two-column") {
    const empty: SlideElement = {
      id: crypto.randomUUID(),
      type: "text",
      x: width,
      y: MARP_CONTENT_TOP,
      width: 200,
      height: 80,
      content: "",
      placeholder: "Click to add text",
      fontSize: 18,
      align: "left",
    };
    return reflowMarp(
      {
        ...slide,
        layout,
        elements: [
          ...(title ? [title] : []),
          ...left.map((el) => ({ ...el, x: 0 })),
          empty,
        ],
      },
      width,
    );
  }
  return reflowMarp(
    {
      ...slide,
      layout: "title-body",
      elements: [
        ...(title ? [title] : []),
        ...[...left, ...right.filter(hasColumnContent)].map((el) => ({ ...el, x: 0 })),
      ],
    },
    width,
  );
}

/** Append a column's text to the other column and clear the one it left. */
export function moveToOtherColumn(slide: Slide, elementId: string): Slide | null {
  if (slide.layout !== "two-column") return null;
  const slots = placeholders(slide);
  const index = slots.findIndex((el) => el.id === elementId);
  if (index < 1 || index > 2 || slots.length < 3) return null;
  const from = slots[index];
  const to = slots[index === 1 ? 2 : 1];
  if (!from.content?.trim()) return slide;
  const content = [to.content?.trim(), from.content.trim()].filter(Boolean).join("\n");
  return {
    ...slide,
    elements: slide.elements.map((el) => {
      if (el.id === to.id) return { ...el, content, bullet: to.bullet || from.bullet };
      if (el.id === from.id) {
        const next = { ...el, content: "" };
        delete next.bullet;
        return next;
      }
      return el;
    }),
  };
}

export function placeholders(slide: Slide): SlideElement[] {
  return slide.elements.filter(
    (el) => el.type === "text" && el.placeholder !== undefined,
  );
}
