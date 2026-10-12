import type { Slide, SlideElement } from "@suiteleaf/core";

export type Layout = NonNullable<Slide["layout"]>;

export const sectionBackground = "#1e293b";

type Box = Omit<SlideElement, "id" | "type">;

const title = (y: number): Box => ({
  x: 80,
  y,
  width: 800,
  height: 70,
  placeholder: "Click to add title",
  fontSize: 34,
  bold: true,
  align: "left",
  color: "#0f172a",
});

const templates: Record<Layout, Box[]> = {
  title: [
    {
      x: 100,
      y: 160,
      width: 760,
      height: 100,
      placeholder: "Click to add title",
      fontSize: 44,
      bold: true,
      align: "center",
      color: "#0f172a",
    },
    {
      x: 100,
      y: 280,
      width: 760,
      height: 60,
      placeholder: "Click to add subtitle",
      fontSize: 22,
      align: "center",
      color: "#64748b",
    },
  ],
  "title-body": [
    title(50),
    {
      x: 80,
      y: 150,
      width: 800,
      height: 320,
      placeholder: "Click to add text",
      fontSize: 20,
      bullet: true,
      align: "left",
      color: "#334155",
    },
  ],
  "two-column": [
    title(50),
    ...[80, 500].map((x) => ({
      x,
      y: 150,
      width: 380,
      height: 320,
      placeholder: "Click to add text",
      fontSize: 18,
      align: "left" as const,
      color: "#334155",
    })),
  ],
  section: [
    {
      x: 100,
      y: 200,
      width: 760,
      height: 120,
      placeholder: "Click to add title",
      fontSize: 46,
      bold: true,
      align: "center",
      color: "#f8fafc",
    },
  ],
  blank: [],
};

/** Empty placeholder text boxes for a new slide with this layout. */
export function layoutElements(layout: Layout): SlideElement[] {
  return templates[layout].map((box) => ({
    id: crypto.randomUUID(),
    type: "text",
    content: "",
    ...box,
  }));
}

/** A new slide whose text boxes are empty placeholders. */
export function newSlide(layout: Layout): Slide {
  return {
    id: crypto.randomUUID(),
    layout,
    elements: layoutElements(layout),
    notes: "",
    ...(layout === "section" ? { background: { color: sectionBackground } } : {}),
  };
}

/**
 * Rearrange a slide's text into another layout. The slide's placeholders (or,
 * for slides without any, its text boxes) move into the new layout's slots in
 * order; text that has no slot left is appended to the last slot so nothing
 * is lost. Shapes, images, and plain text boxes stay where they are.
 */
export function applyLayout(slide: Slide, layout: Layout): Slide {
  const slots = templates[layout];
  const hasPlaceholders = slide.elements.some(
    (el) => el.type === "text" && el.placeholder !== undefined,
  );
  const isSlot = (el: SlideElement) =>
    el.type === "text" && (!hasPlaceholders || el.placeholder !== undefined);
  const current = slide.elements.filter(isSlot);
  const moved = new Map<string, SlideElement | null>();

  current.forEach((el, i) => {
    if (i < slots.length) {
      moved.set(el.id, { ...el, ...slots[i], content: el.content ?? "" });
    } else if (!slots.length) {
      moved.set(
        el.id,
        el.content ? { ...el, placeholder: undefined } : null,
      );
    } else {
      moved.set(el.id, null);
      const last = current[slots.length - 1].id;
      const target = moved.get(last)!;
      if (el.content)
        target.content = target.content
          ? `${target.content}\n${el.content}`
          : el.content;
    }
  });

  const added = slots.slice(current.length).map(
    (box): SlideElement => ({
      id: crypto.randomUUID(),
      type: "text",
      content: "",
      ...box,
    }),
  );
  const elements = slide.elements.flatMap((el) => {
    if (!moved.has(el.id)) return [el];
    const next = moved.get(el.id);
    return next ? [next] : [];
  });
  const lastSlot = current.length
    ? elements.findIndex((el) => el.id === current[Math.min(current.length, slots.length) - 1]?.id)
    : -1;
  elements.splice(lastSlot + 1, 0, ...added);

  let background = slide.background;
  if (layout === "section" && (!background?.color || background.color === "#ffffff"))
    background = { ...background, color: sectionBackground };
  else if (layout !== "section" && background?.color === sectionBackground)
    background = { ...background, color: undefined };

  return { ...slide, layout, elements, background };
}

function luminance(color: string) {
  const hex = color.replace("#", "");
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const isDark = (color: string) =>
  /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) && luminance(color) < 0.18;

/**
 * Give every slide this background color. Text that would no longer be
 * readable switches to a light or dark color. With `keepSections`, section
 * header slides keep their dark accent background on light themes.
 */
export function applyBackground(
  slides: Record<string, Slide>,
  color: string,
  keepSections = false,
): Record<string, Slide> {
  const dark = isDark(color);
  return Object.fromEntries(
    Object.entries(slides).map(([id, slide]) => {
      if (keepSections && slide.layout === "section" && !dark)
        return [id, slide];
      const elements = slide.elements.map((el) => {
        if (el.type !== "text" || isDark(el.color || "#1e293b") !== dark)
          return el;
        const heading = el.bold || (el.fontSize ?? 20) >= 30;
        const next = dark
          ? heading ? "#f8fafc" : "#cbd5e1"
          : heading ? "#0f172a" : "#334155";
        return { ...el, color: next };
      });
      return [id, { ...slide, background: { ...slide.background, color }, elements }];
    }),
  );
}

/** Move the item at `from` so it ends up at index `to`. */
export function reorder<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}
