import type { SlideElement, SlideFile } from "./index";

function scaleFields<T extends object>(
  value: T,
  fields: readonly string[],
  scale: number,
): T {
  const copy = { ...value } as Record<string, unknown>;
  for (const name of fields) {
    if (typeof copy[name] === "number") copy[name] = copy[name] * scale;
  }
  return copy as T;
}

/** Export a normalized canvas at its original physical size without copying media. */
export function physicalExportView(file: SlideFile): SlideFile {
  const deck = file.content;
  const scale = deck.pointWidth ? (deck.pointWidth * 96) / 72 / deck.width : 1;
  if (Math.abs(scale - 1) < 1e-10) return file;
  const elementView = (element: SlideElement): SlideElement => {
    const copy = scaleFields(
      element,
      [
        "x",
        "y",
        "width",
        "height",
        "padLeft",
        "padRight",
        "padBottom",
        "inset",
        "hang",
        "radius",
        "strokeWidth",
        "softEdge",
      ],
      scale,
    );
    if (element.runs)
      copy.runs = element.runs.map((run) =>
        scaleFields(
          run,
          ["paraMargin", "paraHang", "paraFirst", "spaceBefore"],
          scale,
        ),
      );
    if (element.tile)
      copy.tile = scaleFields(
        element.tile,
        ["x", "y", "width", "height"],
        scale,
      );
    // Shadows, like fonts and table paddings, are authored points.
    // Table padding, fonts and borders are authored points, unlike the frame.
    if (element.cellMarks)
      copy.cellMarks = element.cellMarks.map((row) =>
        row.map((cell) => ({
          ...cell,
          ...(cell.runs
            ? {
                runs: cell.runs.map((run) =>
                  scaleFields(
                    run,
                    ["paraMargin", "paraHang", "paraFirst", "spaceBefore"],
                    scale,
                  ),
                ),
              }
            : {}),
        })),
      );
    return copy;
  };
  return {
    ...file,
    content: {
      ...deck,
      width: deck.width * scale,
      height: deck.pointHeight
        ? (deck.pointHeight * 96) / 72
        : deck.height * scale,
      slides: Object.fromEntries(
        Object.entries(deck.slides).map(([id, slide]) => [
          id,
          { ...slide, elements: slide.elements.map(elementView) },
        ]),
      ),
    },
  };
}
