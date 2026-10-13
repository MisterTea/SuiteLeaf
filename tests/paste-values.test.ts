import { expect, test } from "vitest";

import {
  cellForPasteValues,
  cellsForPasteValues,
  pastedScalar,
} from "../apps/web/src/editors/paste-values";

test("paste values writes the calculated number, not the formula", () => {
  const formula = { formula: "=SUM(B2:B4)", value: 120 };
  const written = cellForPasteValues(formula);
  expect(written).toEqual({ v: 120, f: null, p: null });
  expect(written.v).toBe(120);
  expect(written.v).not.toBe(formula.formula);
  expect(JSON.stringify(written)).not.toContain("SUM");

  const plain = cellForPasteValues({ formula: null, value: 40 });
  expect(plain).toEqual({ v: 40, f: null, p: null });
  expect(plain.v).toBe(40);

  // A zero result must not fall through to the formula string.
  expect(cellForPasteValues({ formula: "=B2-B2", value: 0 })).toEqual({
    v: 0,
    f: null,
    p: null,
  });
});

test("a multi-cell copy pastes each cell's value", () => {
  expect(
    cellsForPasteValues([
      [
        { formula: "=SUM(B2:B4)", value: 120 },
        { formula: null, value: 40 },
      ],
      [
        { formula: "=B2*2", value: 80 },
        { formula: null, value: "rent" },
      ],
    ]),
  ).toEqual([
    [
      { v: 120, f: null, p: null },
      { v: 40, f: null, p: null },
    ],
    [
      { v: 80, f: null, p: null },
      { v: "rent", f: null, p: null, t: 1 },
    ],
  ]);
  expect(pastedScalar(120)).toBe(120);
  expect(pastedScalar(undefined)).toBeNull();
});
