import { expect, test } from "vitest";

import {
  cellForFillDown,
  cellsFilledDown,
  shiftFormulaDown,
} from "../apps/web/src/editors/fill-down";

test("fill down shifts relative rows, keeps absolute refs, and copies numbers", () => {
  const tax = cellsFilledDown([{ formula: "=B2*1.1", value: 44 }], 4);
  // C2:C5 is four rows. Only the three cells below the source are written.
  expect(tax).toHaveLength(3);
  expect(tax.map((row) => row[0].formula)).toEqual([
    "=B3*1.1",
    "=B4*1.1",
    "=B5*1.1",
  ]);
  expect(
    tax.some((row) => row.some((cell) => cell.formula === "=B2*1.1")),
  ).toBe(false);
  expect(shiftFormulaDown("=B2*1.1", 0)).toBe("=B2*1.1");
  expect(cellForFillDown(tax[0][0]).f).toBe("=B3*1.1");

  const locked = cellsFilledDown([{ formula: "=$B$2", value: 40 }], 3);
  expect(locked.map((row) => row[0].formula)).toEqual(["=$B$2", "=$B$2"]);
  expect(locked.map((row) => cellForFillDown(row[0]).f)).toEqual([
    "=$B$2",
    "=$B$2",
  ]);
  expect(JSON.stringify(locked)).not.toContain("$B$3");

  const copies = cellsFilledDown([{ formula: null, value: 7 }], 2);
  expect(copies).toEqual([[{ formula: null, value: 7 }]]);
  const written = cellForFillDown(copies[0][0]);
  expect(written).toEqual({ v: 7, f: null, p: null, si: null });
  expect(written.v).toBe(7);
  expect(written.f).toBeNull();
  expect(String(written.v)).not.toMatch(/^=/);

  // The literal 1.1 is not a row, and a quoted reference stays quoted.
  expect(shiftFormulaDown("=B2*1.1", 1)).toBe("=B3*1.1");
  expect(shiftFormulaDown('=B2&"B2"', 1)).toBe('=B3&"B2"');
  expect(shiftFormulaDown("=$B2", 2)).toBe("=$B4");
  expect(shiftFormulaDown("=B$2", 2)).toBe("=B$2");
});
