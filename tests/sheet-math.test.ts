import { describe, expect, it } from "vitest";
import { applyMath, mathValue, medianOf, parseMath } from "../packages/core/src/sheet-math";

describe("sheet math", () => {
  it("finds the middle number", () => {
    expect(medianOf([10, 4, 30])).toBe(10);
    expect(medianOf([10, 4, 30, 20])).toBe(15);
    expect(medianOf([])).toBe("#NUM!");
  });

  it("rounds down, takes a root, a remainder, and a power", () => {
    const rows: Record<string, unknown> = { A1: 8.9, A2: -1.2, A3: 9, A4: -1, A5: 10, B5: 3, A6: 2, B6: 3 };
    expect(mathValue(parseMath("=INT(A1)")!, (address) => rows[address])).toBe(8);
    expect(mathValue(parseMath("=INT(A2)")!, (address) => rows[address])).toBe(-2);
    expect(mathValue(parseMath("=SQRT(A3)")!, (address) => rows[address])).toBe(3);
    expect(mathValue(parseMath("=SQRT(A4)")!, (address) => rows[address])).toBe("#NUM!");
    expect(mathValue(parseMath("=MOD(A5, B5)")!, (address) => rows[address])).toBe(1);
    rows.A5 = -10;
    expect(mathValue(parseMath("=MOD(A5, B5)")!, (address) => rows[address])).toBe(2);
    rows.B5 = 0;
    expect(mathValue(parseMath("=MOD(A5, B5)")!, (address) => rows[address])).toBe("#DIV/0!");
    rows.B5 = -3;
    rows.A5 = 10;
    expect(mathValue(parseMath("=MOD(A5, B5)")!, (address) => rows[address])).toBe(-2);
    expect(mathValue(parseMath("=POWER(A6, B6)")!, (address) => rows[address])).toBe(8);
    rows.A6 = -2;
    rows.B6 = 0.5;
    expect(mathValue(parseMath("=POWER(A6, B6)")!, (address) => rows[address])).toBe("#NUM!");
    expect(mathValue(parseMath("=INT(A1)")!, () => "secret-value")).toBeNull();
    expect(parseMath("=INT(A1, B1)")).toBeNull();
    expect(parseMath("=MOD(A1)")).toBeNull();
    expect(parseMath("=INT(A0)")).toBeNull();
    expect(parseMath("=MOD(A1, Beds!B1)")).toBeNull();
    expect(parseMath("=INT(Beds!A1)")?.sheet).toBe("Beds");
    expect(parseMath("=SQRT('North beds'!A1)")?.sheet).toBe("North beds");
  });

  it("leaves a result that is already stored", () => {
    const stored: Record<string, unknown> = { A1: 4, B1: 4 };
    const result = applyMath({
      addresses: ["B1"],
      formula: () => "=INT(A1)",
      value: (address) => stored[address],
      write: (address, next) => {
        if (stored[address] === next) return false;
        stored[address] = next;
        return true;
      },
    });
    expect(stored.B1).toBe(4);
    expect(result.calculated).toEqual(["B1"]);
    expect(result.left).toEqual([]);
    const storedChain: Record<string, unknown> = { A1: 8.9, B1: "", C1: "" };
    const chained = applyMath({
      addresses: ["C1", "B1"],
      formula: (address) => (address === "B1" ? "=INT(A1)" : "=INT(B1)"),
      value: (address) => storedChain[address],
      write: (address, next) => {
        storedChain[address] = next;
        return true;
      },
    });
    expect(chained.calculated).toEqual(["B1", "C1"]);
    expect(storedChain.C1).toBe(8);
    expect(
      applyMath({
        addresses: ["B1"],
        formula: () => "=INT(Beds!A1)",
        value: () => 1,
        write: () => true,
      }).left,
    ).toEqual(["B1"]);
    expect(
      applyMath({
        addresses: ["B1"],
        formula: () => "=INT(A1)",
        value: () => "secret-value",
        write: () => true,
      }).left,
    ).toEqual(["B1"]);
  });
});
