// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { createFile } from "@suiteleaf/core";
import { SlideFace, SlideStill } from "../../apps/web/src/editors/slide-surface";
import { tableCellLayout, tableRowHeightCss } from "../../apps/web/src/editors/slide-table-format";

afterEach(cleanup);

it("sizes a table row from the stored grid, including a collapsed row", () => {
  expect(tableRowHeightCss(0.4, 200, 960)).toBe("calc(80 / 960 * 100cqw)");
  expect(tableRowHeightCss(0, 200, 960)).toBe("0px");
  expect(tableRowHeightCss(0.4, 0, 960)).toBe("0px");

  const file = createFile("slide", "Pitch");
  if (file.kind !== "slide") throw new Error("expected slides");
  const deck = file.content;
  const slide = deck.slides[deck.slideOrder[0]];
  slide.elements.push({
    id: "grid",
    type: "table",
    x: 40,
    y: 40,
    width: 400,
    height: 200,
    rows: [
      ["Header", "Score"],
      ["A wrapped citation that is taller than one line", "1"],
      ["", ""],
    ],
    rowHeights: [0.2, 0.4, 0.4],
    cellMarks: [
      [{ fontSize: 16, valign: "middle" }, { fontSize: 16 }],
      [{ fontSize: 12 }, { fontSize: 12 }],
      [{ fontSize: 12 }, { fontSize: 12 }],
    ],
  });
  render(<SlideFace deck={deck} slide={slide} index={0} />);
  const rows = [...document.querySelectorAll(".slide-table tr")];
  expect(rows).toHaveLength(3);
  expect(rows[1].getAttribute("style")).toContain("cqw");
  const clip = rows[1].querySelector("[data-row-clip]") as HTMLElement | null;
  expect(clip?.style.overflow).toBe("hidden");
  expect(clip?.style.position).toBe("absolute");
  expect(clip?.style.justifyContent).toBe("flex-start");
  const cell = rows[1].querySelector("td") as HTMLElement;
  expect(cell.style.height).toContain("cqw");
  expect(cell.style.boxSizing).toBe("border-box");
  const headerClip = rows[0].querySelector("[data-row-clip]") as HTMLElement | null;
  expect(headerClip?.style.justifyContent).toBe("center");
});

it("leaves an editor table without a row grid on the text", () => {
  const layout = tableCellLayout(undefined, false, { paddingTop: "4px", color: "black" });
  expect(layout.clip).toBeUndefined();
  expect(layout.td.color).toBe("black");
  const spanned = tableCellLayout("20px", true, {
    paddingTop: "2px",
    verticalAlign: "bottom",
    color: "navy",
  });
  expect(spanned.td.height).toBeUndefined();
  expect(spanned.td.color).toBe("navy");
  expect(spanned.clip?.justifyContent).toBe("flex-end");
  expect(spanned.clip?.paddingTop).toBe("2px");
});

it("resolves still-surface row heights against the drawing width, not the print page", () => {
  const file = createFile("slide", "Pitch");
  if (file.kind !== "slide") throw new Error("expected slides");
  const deck = file.content;
  const slide = deck.slides[deck.slideOrder[0]];
  slide.elements.push({
    id: "grid",
    type: "table",
    x: 40,
    y: 40,
    width: 400,
    height: 200,
    rows: [["A"], [""]],
    rowHeights: [0.5, 0.5],
  });
  render(<SlideStill deck={deck} slide={slide} index={0} />);
  const surface = document.querySelector(".slide-still > .slide-surface") as HTMLElement;
  // A print page is 4/3 of the point size. cqw has to be this 960px surface,
  // so a stored half of a 200-unit table is 100/960 of that width.
  expect(surface.style.containerType).toBe("inline-size");
  expect(surface.style.width).toBe("960px");
  const rows = [...document.querySelectorAll(".slide-table tr")] as HTMLElement[];
  expect(rows).toHaveLength(2);
  expect(rows[0].style.height).toBe("calc(10.4166666666667cqw)");
  expect(rows[1].style.height).toBe(rows[0].style.height);
});
