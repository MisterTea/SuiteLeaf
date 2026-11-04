import { describe, expect, it } from "vitest";
import { applyPairs } from "../packages/core/src/sheet-finish";

describe("sheet finish", () => {
  it("waits for the other pair and copies a cell", () => {
    const stored: Record<string, unknown> = { A1: 1, B1: 0, C1: "", D1: 4, E1: "" };
    const result = applyPairs({
      boths: ["C1", "missing"],
      targets: ["E1"],
      formula: (address) => (address === "E1" ? "=D1" : address === "C1" ? "=AND(A1, B1)" : "=NOPE"),
      value: (address) => stored[address],
      write: (address, next) => {
        if (stored[address] === next) return false;
        stored[address] = next;
        return true;
      },
      pair: (formula) => (formula.startsWith("=AND") ? { op: "and", left: "A1", right: "B1" } : null),
      ref: (formula) => (formula === "=D1" ? "D1" : null),
      numberOf: (value) => (typeof value === "number" ? value : null),
    });
    expect(stored.C1).toBe(0);
    expect(stored.E1).toBe(4);
    expect(result.left).toEqual(["missing"]);
    expect(result.calculated).toContain("E1");
    const either = applyPairs({
      boths: ["C1", "D1"],
      targets: ["F1"],
      formula: (address) => (address === "D1" ? "=OR(A1, B1)" : address === "C1" ? "=AND(D1, A1)" : "=NOPE"),
      value: (address) => (address === "A1" ? 1 : address === "B1" ? 0 : address === "D1" ? stored.D1 : "secret-value"),
      write: (address, next) => {
        stored[address] = next;
        return address !== "F1";
      },
      pair: (formula) =>
        formula.startsWith("=OR")
          ? { op: "or", left: "A1", right: "B1" }
          : formula.startsWith("=AND")
            ? { op: "and", left: "D1", right: "A1" }
            : null,
      ref: () => null,
      numberOf: (value) => (typeof value === "number" ? value : null),
    });
    expect(stored.D1).toBe(1);
    expect(stored.C1).toBe(1);
    expect(either.calculated).toContain("F1");
    const text = applyPairs({
      boths: ["C1"],
      targets: [],
      formula: () => "=AND(A1, B1)",
      value: () => "secret-value",
      write: () => false,
      pair: () => ({ op: "and", left: "A1", right: "B1" }),
      ref: () => null,
      numberOf: () => null,
    });
    expect(text.left).toEqual(["C1"]);
    expect(JSON.stringify(text)).not.toContain("secret-value");
  });
});
