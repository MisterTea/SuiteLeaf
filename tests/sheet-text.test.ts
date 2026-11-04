import { describe, expect, it } from "vitest";
import { applyText, parseText, textValue } from "../packages/core/src/sheet-text";

describe("sheet text", () => {
  it("takes characters and joins cells", () => {
    const rows: Record<string, unknown> = { A1: "Beds North", B1: 4, C1: "North" };
    expect(textValue(parseText("=LEFT(A1, 4)")!, (address) => rows[address])).toBe("Beds");
    expect(textValue(parseText("=LEFT(A1, B1)")!, (address) => rows[address])).toBe("Beds");
    expect(textValue(parseText("=RIGHT(A1, 5)")!, (address) => rows[address])).toBe("North");
    expect(textValue(parseText("=MID(A1, 6, 5)")!, (address) => rows[address])).toBe("North");
    expect(textValue(parseText("=LEFT(A1, -1)")!, (address) => rows[address])).toBe("#VALUE!");
    expect(textValue(parseText("=MID(A1, 0, 2)")!, (address) => rows[address])).toBe("#VALUE!");
    expect(textValue(parseText("=CONCATENATE(A1, C1)")!, (address) => rows[address])).toBe("Beds NorthNorth");
    expect(textValue(parseText("=LEFT(A1, 1)")!, () => "#DIV/0!")).toBeNull();
    expect(textValue(parseText("=RIGHT(A1, 0)")!, (address) => rows[address])).toBe("");
    expect(textValue(parseText("=CONCATENATE(A1, C1)")!, () => "#DIV/0!")).toBeNull();
    expect(textValue(parseText("=LEFT(A1, 2)")!, () => undefined)).toBe("");
    expect(textValue(parseText("=LEFT(A1, 2)")!, () => 10)).toBe("10");
    expect(textValue(parseText("=LEFT(A1, B1)")!, (address) => (address === "B1" ? 1.5 : "Beds"))).toBe("#VALUE!");
    const stored: Record<string, unknown> = { A1: "Beds", B1: "", C1: "" };
    const chained = applyText({
      addresses: ["C1", "B1"],
      formula: (address) => (address === "B1" ? "=LEFT(A1, 4)" : "=LEFT(B1, 1)"),
      value: (address) => stored[address],
      write: (address, next) => {
        stored[address] = next;
        return true;
      },
    });
    expect(chained.calculated).toEqual(["B1", "C1"]);
    expect(stored.C1).toBe("B");
    expect(
      applyText({
        addresses: ["B1"],
        formula: () => "=LEFT(A1, 1)",
        value: () => "#DIV/0!",
        write: () => true,
      }).left,
    ).toEqual(["B1"]);
    const waiting = applyText({
      addresses: ["C1", "B1"],
      formula: (address) => (address === "B1" ? "=LEFT(A1, 4)" : "=LEFT(Beds!A1, 1)"),
      value: (address) => (address === "A1" ? "Beds North" : ""),
      write: () => true,
    });
    expect(waiting.calculated).toEqual(["B1"]);
    expect(waiting.left).toEqual(["C1"]);
    expect(applyText({ addresses: ["B1"], formula: () => "=NOPE", value: () => "", write: () => true }).left).toEqual([
      "B1",
    ]);
    expect(parseText("=LEFT(A1)")).toBeNull();
    expect(parseText("=CONCATENATE(A1)")).toBeNull();
    expect(parseText("=LEFT(A0, 1)")).toBeNull();
    expect(parseText("=LEFT(A1, Beds!B1)")).toBeNull();
    expect(parseText("=LEFT(Beds!A1, 4)")?.sheet).toBe("Beds");
    expect(textValue(parseText('=TEXT(A1, "0.00")')!, () => 8.9)).toBe("8.90");
    expect(textValue(parseText('=TEXT(A1, "0")')!, () => -1.5)).toBe("-2");
    expect(textValue(parseText('=TEXT(A1, "#,##0")')!, () => 1234)).toBe("1,234");
    expect(textValue(parseText('=TEXT(A1, "0%")')!, () => 0.5)).toBe("50%");
    expect(textValue(parseText('=TEXT(A1, "yyyy")')!, () => 1)).toBeNull();
    expect(textValue(parseText('=TEXT(A1, "0")')!, () => "secret-value")).toBeNull();
    expect(parseText("=TEXT(A1, Beds!B1)")).toBeNull();
    expect(parseText("=RIGHT('North beds'!A1, 1)")?.sheet).toBe("North beds");
  });

  it("leaves text that is already stored", () => {
    const stored: Record<string, unknown> = { A1: "Beds", B1: "Beds" };
    const result = applyText({
      addresses: ["B1"],
      formula: () => "=LEFT(A1, 4)",
      value: (address) => stored[address],
      write: (address, next) => {
        if (stored[address] === next) return false;
        stored[address] = next;
        return true;
      },
    });
    expect(stored.B1).toBe("Beds");
    expect(result.calculated).toEqual(["B1"]);
    expect(result.left).toEqual([]);
  });
});
