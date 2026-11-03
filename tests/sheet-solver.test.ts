import { expect, it } from "vitest";
import { solveOnSheet } from "../apps/web/src/editors/sheet-solver";
import type { SeekAddress } from "../apps/web/src/editors/sheet-goal-panel";

it("writes two inputs that reach the target and puts them back when it cannot", async () => {
  const cells = new Map<string, { formula: string; value: string | number }>([
    ["0,0", { formula: "", value: 0 }],
    ["0,1", { formula: "", value: 0 }],
    ["0,2", { formula: "=secret-value", value: 0 }],
  ]);
  const key = (cell: SeekAddress) => `${cell.row},${cell.column}`;
  const read = (cell: SeekAddress) => cells.get(key(cell))!;
  const write = (cell: SeekAddress, value: string | number | boolean | null) => {
    const current = cells.get(key(cell))!;
    current.value = typeof value === "number" ? value : 0;
    if (cell.column === 2 && typeof value === "number") return;
    const left = cells.get("0,0")!.value;
    const right = cells.get("0,1")!.value;
    cells.get("0,2")!.value = (typeof left === "number" ? left : 0) + (typeof right === "number" ? right : 0);
  };
  const solved = await solveOnSheet({
    inputs: [
      { row: 0, column: 0 },
      { row: 0, column: 1 },
    ],
    formula: { row: 0, column: 2 },
    target: 10,
    lows: [0, 0],
    highs: [10, 10],
    read,
    write,
    calculate: async () => {},
  });
  expect(solved.wrote).toBe(true);
  expect(solved.message).toBe("The search reached the target.");
  expect(solved.message).not.toContain("secret-value");
  expect(Number(cells.get("0,0")!.value) + Number(cells.get("0,1")!.value)).toBeCloseTo(10, 4);

  cells.get("0,0")!.value = 0;
  cells.get("0,1")!.value = 0;
  const missed = await solveOnSheet({
    inputs: [
      { row: 0, column: 0 },
      { row: 0, column: 1 },
    ],
    formula: { row: 0, column: 2 },
    target: 50,
    lows: [0, 0],
    highs: [10, 10],
    read,
    write,
    calculate: async () => {},
  });
  expect(missed.wrote).toBe(false);
  expect(missed.message).toContain("The inputs were put back.");
  expect(missed.message).not.toContain("secret-value");
  expect(cells.get("0,0")!.value).toBe(0);
  expect(cells.get("0,1")!.value).toBe(0);
});

it("keeps the first input at or below the limit", async () => {
  const cells = new Map<string, { formula: string; value: number }>([
    ["0,0", { formula: "", value: 0 }],
    ["0,1", { formula: "", value: 0 }],
    ["0,2", { formula: "=A1+B1", value: 0 }],
  ]);
  const key = (cell: SeekAddress) => `${cell.row},${cell.column}`;
  const read = (cell: SeekAddress) => cells.get(key(cell))!;
  const write = (cell: SeekAddress, value: string | number | boolean | null) => {
    const current = cells.get(key(cell))!;
    current.value = typeof value === "number" ? value : 0;
    const left = cells.get("0,0")!.value;
    const right = cells.get("0,1")!.value;
    cells.get("0,2")!.value = left + right;
  };
  const solved = await solveOnSheet({
    inputs: [
      { row: 0, column: 0 },
      { row: 0, column: 1 },
    ],
    formula: { row: 0, column: 2 },
    target: 9,
    lows: [0, 0],
    highs: [10, 10],
    atMost: 3,
    read,
    write,
    calculate: async () => {},
  });
  expect(solved.wrote).toBe(true);
  expect(solved.message).toBe("The search reached the target.");
  expect(cells.get("0,0")!.value).toBeLessThanOrEqual(3);
  expect(cells.get("0,0")!.value + cells.get("0,1")!.value).toBeCloseTo(9, 4);
});

it("does not write an input that already has a formula", async () => {
  const read = (cell: SeekAddress) =>
    cell.column === 0
      ? { formula: "=secret-value", value: 1 }
      : cell.column === 1
        ? { formula: "", value: 1 }
        : { formula: "=A1+B1", value: 2 };
  let wrote = false;
  const result = await solveOnSheet({
    inputs: [
      { row: 0, column: 0 },
      { row: 0, column: 1 },
    ],
    formula: { row: 0, column: 2 },
    target: 10,
    lows: [0, 0],
    highs: [10, 10],
    read,
    write: () => {
      wrote = true;
    },
    calculate: async () => {},
  });
  expect(wrote).toBe(false);
  expect(result).toEqual({ message: "That cell has a formula.", wrote: false });
  expect(result.message).not.toContain("secret-value");
});
