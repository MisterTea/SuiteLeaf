import { expect, it } from "vitest";
import { parseCellAddress, seekOnSheet, type SeekAddress } from "../apps/web/src/editors/sheet-goal-panel";

it("reads an A1 address", () => {
  expect(parseCellAddress("B2")).toEqual({ row: 1, column: 1 });
  expect(parseCellAddress("not a cell")).toBeNull();
});

it("writes the solved input and puts a text cell back when the target cannot be reached", async () => {
  let input: string | number | boolean | null = 1;
  const formula: SeekAddress = { row: 0, column: 1 };
  const read = (cell: SeekAddress) =>
    cell.column === 0
      ? { formula: "", value: input }
      : { formula: "=A1*2", value: typeof input === "number" ? input * 2 : Number.NaN };
  const write = (cell: SeekAddress, value: string | number | boolean | null) => {
    expect(cell).toEqual({ row: 0, column: 0 });
    input = value;
  };
  const solved = await seekOnSheet({
    input: { row: 0, column: 0 },
    formula,
    target: 10,
    low: 0,
    high: 20,
    read,
    write,
    calculate: async () => {},
  });
  expect(solved.wrote).toBe(true);
  expect(input).toBeCloseTo(5, 4);
  expect(solved.message).toContain("5");
  expect(solved.message).not.toContain("secret");

  input = "secret tomato";
  const missed = await seekOnSheet({
    input: { row: 0, column: 0 },
    formula,
    target: 10,
    low: 0,
    high: 20,
    read: (cell) =>
      cell.column === 0
        ? { formula: "", value: input }
        : { formula: "=1", value: 1 },
    write,
    calculate: async () => {},
  });
  expect(missed.wrote).toBe(false);
  expect(missed.message).toContain("The search tried");
  expect(missed.message).toContain("The input cell was put back.");
  expect(missed.message).not.toContain("secret");
  expect(input).toBe("secret tomato");
});

it("does not write an input cell that already has a formula", async () => {
  let writes = 0;
  const result = await seekOnSheet({
    input: { row: 0, column: 0 },
    formula: { row: 0, column: 1 },
    target: 10,
    low: 0,
    high: 20,
    read: (cell) =>
      cell.column === 0 ? { formula: "=1+1", value: 2 } : { formula: "=A1", value: 2 },
    write: () => {
      writes += 1;
    },
    calculate: async () => {},
  });
  expect(result).toEqual({ message: "The input cell has a formula.", wrote: false });
  expect(writes).toBe(0);
});
