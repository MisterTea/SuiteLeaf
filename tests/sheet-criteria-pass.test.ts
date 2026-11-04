import { describe, expect, it } from "vitest";
import { applySameSheetCriteria } from "../packages/core/src/sheet-criteria-pass";

const same = (left: unknown, right: unknown) => left === right;

function run(formulas: Record<string, string>, values: Record<string, unknown>, lists: Partial<{
  countIfsMany: string[];
  averageIfs: string[];
  sumIfsMany: string[];
  averageIfsMany: string[];
}>) {
  const stored = { ...values };
  return {
    stored,
    result: applySameSheetCriteria({
      countIfsMany: lists.countIfsMany ?? [],
      averageIfs: lists.averageIfs ?? [],
      sumIfsMany: lists.sumIfsMany ?? [],
      averageIfsMany: lists.averageIfsMany ?? [],
      formula: (address) => formulas[address] ?? "",
      value: (address) => stored[address],
      write: (address, next) => {
        if (stored[address] === next) return false;
        stored[address] = next;
        return true;
      },
      same,
      numberOf: (value) => (typeof value === "number" ? value : null),
      isError: (value) => value === "#DIV/0!",
    }),
  };
}

describe("same-sheet criteria formulas", () => {
  it("leaves a formula that names another sheet", () => {
    const { result, stored } = run(
      { D1: "=SUMIFS(Beds!B1:B2, Beds!A1:A2, E1)" },
      { D1: "" },
      { sumIfsMany: ["D1"] },
    );
    expect(result.left).toContain("D1");
    expect(stored.D1).toBe("");
  });

  it("waits until the formula it reads has a value", () => {
    const { result, stored } = run(
      {
        D1: "=COUNTIFS(A1:A1, C1)",
        E1: "=COUNTIFS(D1:D1, F1)",
      },
      { A1: "Beds", C1: "Beds", D1: "", E1: "", F1: 1 },
      { countIfsMany: ["E1", "D1"] },
    );
    expect(stored.D1).toBe(1);
    expect(stored.E1).toBe(1);
    expect(result.calculated).toEqual(["D1", "E1"]);
  });

  it("keeps a sum that is already stored", () => {
    const { result, stored } = run(
      { D1: "=SUMIFS(B1:B1, A1:A1, C1)" },
      { A1: "Beds", B1: 4, C1: "Beds", D1: 4 },
      { sumIfsMany: ["D1"] },
    );
    expect(stored.D1).toBe(4);
    expect(result.calculated).toEqual(["D1"]);
    expect(result.left).toEqual([]);
  });

  it("skips a blank amount", () => {
    const { stored } = run(
      { D1: "=AVERAGEIFS(B1:B2, A1:A2, C1)" },
      { A1: "Beds", A2: "Beds", B1: "", B2: 4, C1: "Beds", D1: "" },
      { averageIfsMany: ["D1"] },
    );
    expect(stored.D1).toBe(4);
  });

  it("stops when a ready formula did not change and another is still waiting", () => {
    const { result } = run(
      {
        D1: "=COUNTIFS(A1:A1, C1)",
        E1: "=COUNTIFS(Beds!A1:A1, C1)",
      },
      { A1: "Beds", C1: "Beds", D1: 1, E1: "" },
      { countIfsMany: ["D1", "E1"] },
    );
    expect(result.calculated).toEqual(["D1"]);
    expect(result.left).toEqual(["E1"]);
  });

  it("leaves a formula that is not a count", () => {
    const { result } = run({ D1: "=NOPE" }, { D1: "" }, { countIfsMany: ["D1"] });
    expect(result.left).toEqual(["D1"]);
  });

  it("leaves an average that still depends on another average", () => {
    const { result } = run(
      {
        D1: "=AVERAGEIF(A1:A1, C1, B1:B1)",
        E1: "=AVERAGEIF(D1:D1, F1, B1:B1)",
      },
      { A1: "Beds", B1: 4, C1: "Beds", D1: "", E1: "", F1: 4 },
      { averageIfs: ["E1", "D1"] },
    );
    expect(result.calculated).toContain("D1");
    expect(result.calculated).toContain("E1");
  });
});
