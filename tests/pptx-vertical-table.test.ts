import { expect, it } from "vitest";
import { explicitTableCell, mergeTableCell, tableTextRowEmu } from "../packages/core/src/pptx-table";
import { slideElementSchema } from "../packages/core/src/slide-schema";

it("preserves rotated table text without growing a narrow column into many lines", () => {
  const explicit = explicitTableCell('<a:tc rowSpan="5"><a:tcPr vert="vert270" anchor="ctr"/></a:tc>', [{ text: "Specified Impact", size: 14 }], () => undefined);
  const mark = mergeTableCell(explicit, undefined, undefined);
  expect(mark.textFlow).toBe("up");
  expect(mark.valign).toBe("middle");
  expect(tableTextRowEmu([["Specified Impact"]], [[mark]], [300000])).toEqual([0]);
  const saved = slideElementSchema.parse({ id: "t", type: "table", x: 0, y: 0, width: 100, height: 100, rows: [["Specified Impact"]], cellMarks: [[mark]] });
  expect(saved.cellMarks?.[0][0].textFlow).toBe("up");
  const width = [300000, 1500000];
  const marks = [[{ fontSize: 14, padLeft: 0, padRight: 0 }]];
  const normal = tableTextRowEmu([["Very Low"]], marks, width);
  const underSpan = tableTextRowEmu([["Very Low"]], marks, width, [[1]]);
  expect(underSpan[0]).toBeLessThan(normal[0]);
});
