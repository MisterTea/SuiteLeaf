import { expect, it } from "vitest";
import { projectValidationRules, shiftValidationJson } from "../apps/web/src/collab/sheet-validation-shift";
import { shiftFormula } from "../apps/web/src/collab/sheet-cells";

const rule = JSON.stringify({
  id: "whole",
  formula1: "=A2",
  formula2: "=B2",
  ranges: [
    { startRow: 1, endRow: 3, startColumn: 0, endColumn: 1 },
    { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
    "skip",
    { startRow: "x", endRow: 1, startColumn: 0, endColumn: 0 },
  ],
});

it("moves a rule and drops a deleted span", () => {
  const inserted = JSON.parse(shiftValidationJson(rule, "row", 1, 1, false, true, ["fees"], shiftFormula)) as {
    formula1: string;
    formula2: string;
    ranges: { startRow: number; endRow?: number }[];
  };
  expect(inserted.formula1).toBe("=A3");
  expect(inserted.formula2).toBe("=B3");
  expect(inserted.ranges[0]).toMatchObject({ startRow: 2, endRow: 4 });
  expect(inserted.ranges[1]).toMatchObject({ startRow: 0, endRow: 0 });
  const deleted = JSON.parse(
    shiftValidationJson(
      JSON.stringify({ ranges: [{ startRow: 1, endRow: 1, startColumn: 0, endColumn: 0 }] }),
      "row",
      1,
      1,
      true,
      true,
      ["fees"],
      shiftFormula,
    ),
  ) as { ranges: unknown[] };
  expect(deleted.ranges).toEqual([]);
  const shrunk = JSON.parse(
    shiftValidationJson(
      JSON.stringify({ ranges: [{ startRow: 0, endRow: 2, startColumn: 0, endColumn: 0 }] }),
      "row",
      1,
      1,
      true,
      true,
      ["fees"],
      shiftFormula,
    ),
  ) as { ranges: { startRow: number; endRow: number }[] };
  expect(shrunk.ranges[0]).toMatchObject({ startRow: 0, endRow: 1 });
  const below = JSON.parse(
    shiftValidationJson(
      JSON.stringify({ ranges: [{ startRow: 4, endRow: 5, startColumn: 0, endColumn: 0 }] }),
      "row",
      1,
      1,
      true,
      true,
      ["fees"],
      shiftFormula,
    ),
  ) as { ranges: { startRow: number }[] };
  expect(below.ranges[0].startRow).toBe(3);
  const column = JSON.parse(
    shiftValidationJson(rule, "column", 0, 1, false, true, ["fees"], shiftFormula),
  ) as { ranges: { startColumn: number; endColumn: number }[] };
  expect(column.ranges[0]).toMatchObject({ startColumn: 1, endColumn: 2 });
  expect(shiftValidationJson("secret-value", "row", 0, 1, false, true, ["fees"], shiftFormula)).toBe("secret-value");
  expect(shiftValidationJson("[]", "row", 0, 1, false, true, ["fees"], shiftFormula)).toBe("[]");
  const offSheet = JSON.parse(
    shiftValidationJson(JSON.stringify({ formula1: "=A2", ranges: [{ startRow: 1, endRow: 1 }] }), "row", 0, 1, false, false, ["fees"], shiftFormula),
  ) as { formula1: string; ranges: { startRow: number }[] };
  expect(offSheet.formula1).toBe("=A2");
  expect(offSheet.ranges[0].startRow).toBe(1);
});

it("drops a sheet's rules and ignores a commenter", () => {
  const rules = new Map([["fees\u001fwhole", rule]]);
  const gone = projectValidationRules(rules, {
    mutations: [{ id: "sheet.mutation.remove-sheet", params: { subUnitId: "fees" } }],
  });
  expect(gone.size).toBe(0);
  const kept = projectValidationRules(rules, {
    role: "commenter",
    mutations: [{ id: "sheet.mutation.remove-sheet", params: { subUnitId: "fees" } }],
  });
  expect(kept.get("fees\u001fwhole")).toBe(rule);
  const moved = projectValidationRules(rules, {
    mutations: [
      { id: "sheet.mutation.set-worksheet-name", params: { subUnitId: "fees", name: "Plots" } },
      { id: "sheet.mutation.insert-row", params: { subUnitId: "fees", range: { startRow: 1 } } },
      { id: "sheet.mutation.insert-col", params: { subUnitId: "nope" } },
      { id: "sheet.mutation.insert-row", params: { subUnitId: "fees", range: { startRow: 0, endRow: 20_000 } } },
    ],
  });
  const parsed = JSON.parse(moved.get("fees\u001fwhole")!) as { formula1: string };
  expect(parsed.formula1).toBe("=A3");
  expect(JSON.stringify([...kept.values()])).not.toContain("secret-value");
});
