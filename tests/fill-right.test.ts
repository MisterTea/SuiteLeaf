import { expect, test } from "vitest";

import { cellsFilledDown, shiftFormulaDown } from "../apps/web/src/editors/fill-down";
import {
  cellForFillRight,
  cellsFilledRight,
  shiftFormulaRight,
} from "../apps/web/src/editors/fill-right";

test("fill right shifts relative columns, keeps absolute refs, and copies numbers", () => {
  const tax = cellsFilledRight([{ formula: "=B2*1.1", value: 44 }], 3);
  // C2:E2 is three columns. Only the two cells to the right of the source are written.
  expect(tax).toHaveLength(1);
  expect(tax[0]).toHaveLength(2);
  expect(tax[0].map((cell) => cell.formula)).toEqual(["=C2*1.1", "=D2*1.1"]);
  expect(tax[0].some((cell) => cell.formula === "=B2*1.1")).toBe(false);
  expect(shiftFormulaRight("=B2*1.1", 0)).toBe("=B2*1.1");
  expect(cellForFillRight(tax[0][0]).f).toBe("=C2*1.1");
  expect(cellForFillRight(tax[0][1]).f).toBe("=D2*1.1");

  const locked = cellsFilledRight([{ formula: "=$B$2", value: 40 }], 3);
  expect(locked[0].map((cell) => cell.formula)).toEqual(["=$B$2", "=$B$2"]);
  expect(locked[0].map((cell) => cellForFillRight(cell).f)).toEqual([
    "=$B$2",
    "=$B$2",
  ]);
  expect(JSON.stringify(locked)).not.toContain("$C$2");
  expect(shiftFormulaRight("=$B$2", 2)).toBe("=$B$2");

  const copies = cellsFilledRight([{ formula: null, value: 7 }], 2);
  expect(copies).toEqual([[{ formula: null, value: 7 }]]);
  const written = cellForFillRight(copies[0][0]);
  expect(written).toEqual({ v: 7, f: null, p: null, si: null });
  expect(written.v).toBe(7);
  expect(written.f).toBeNull();
  expect(String(written.v)).not.toMatch(/^=/);

  // The literal 1.1 is not a column, a quoted reference stays quoted, and row numbers stay put.
  expect(shiftFormulaRight("=B2*1.1", 1)).toBe("=C2*1.1");
  expect(shiftFormulaRight("=B2*1.1", 2)).toBe("=D2*1.1");
  expect(shiftFormulaRight('=B2&"B2"', 1)).toBe('=C2&"B2"');
  expect(shiftFormulaRight("=$B2", 2)).toBe("=$B2");
  expect(shiftFormulaRight("=B$2", 2)).toBe("=D$2");
  expect(shiftFormulaRight("=Z2", 1)).toBe("=AA2");

  // Another row keeps its own source. It does not receive the formula from the row above.
  const rows = cellsFilledRight(
    [
      { formula: "=B2*1.1", value: 44 },
      { formula: null, value: null },
    ],
    3,
  );
  expect(rows[1]).toEqual([
    { formula: null, value: null },
    { formula: null, value: null },
  ]);
  expect(JSON.stringify(rows[1])).not.toContain("*1.1");
});

test("fill down still shifts rows", () => {
  const tax = cellsFilledDown([{ formula: "=B2*1.1", value: 44 }], 4);
  expect(tax.map((row) => row[0].formula)).toEqual([
    "=B3*1.1",
    "=B4*1.1",
    "=B5*1.1",
  ]);
  expect(shiftFormulaDown("=B2*1.1", 1)).toBe("=B3*1.1");
  expect(shiftFormulaDown("=$B$2", 1)).toBe("=$B$2");
});
