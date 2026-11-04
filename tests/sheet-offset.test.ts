import { describe, expect, it } from "vitest";
import { applyOffset, redirectResult } from "../packages/core/src/sheet-offset";

describe("sheet offset", () => {
  const rows: Record<string, unknown> = { A1: 10, A2: 4, B2: 9, D1: "A2", F1: "secret-value", G1: 1.5 };
  const read = (address: string) => rows[address.split("!").pop() ?? address];

  it("moves from a cell and reads an address stored as text", () => {
    expect(redirectResult("=OFFSET(A1, 1, 0)", read)).toBe(4);
    expect(redirectResult("=OFFSET(A1, 1, 1)", read)).toBe(9);
    expect(redirectResult("=OFFSET(A1, 0, -1)", read)).toBe("#REF!");
    expect(redirectResult("=OFFSET(A1, G1, 0)", read)).toBe("#VALUE!");
    expect(redirectResult("=INDIRECT(D1)", read)).toBe(4);
    expect(redirectResult('=INDIRECT("A1")', read)).toBe(10);
    expect(redirectResult("=INDIRECT(F1)", read)).toBe("#REF!");
    expect(redirectResult("=OFFSET(A1, 1)", read)).toBeNull();
    expect(redirectResult("=SUM(A1)", read)).toBeNull();
    expect(
      redirectResult("=INDIRECT(Beds!D1)", (address) => (address === "Beds!D1" ? "A2" : address === "A2" ? 4 : undefined)),
    ).toBe(4);
    expect(applyOffset({ "0": { "0": { f: "=SUM(A1)", v: "" } } })).toEqual([]);
    expect(redirectResult("=OFFSET(1, 1, 0)", read)).toBe("#REF!");
    expect(redirectResult("=INDIRECT(A1, B1)", read)).toBeNull();
    expect(redirectResult("=INDIRECT(A1)", read)).toBe("#REF!");
    expect(redirectResult('=INDIRECT("Beds!A2")', (address) => (address === "Beds!A2" ? 4 : undefined))).toBe(4);
    const same = { "0": { "1": { f: "=OFFSET(A1, 1, 0)", v: 4 } }, "1": { "0": { v: 4 } } };
    expect(applyOffset(same)).toEqual(["B1"]);
    expect(applyOffset({ "-1": { "0": { f: "=OFFSET(A1, 0, 0)", v: "" } } })).toEqual([]);
    expect(applyOffset({ "0": { "0": { f: "=OFFSET(Beds!A1, 0, 0)", v: "kept" } } })).toEqual(["A1"]);
    expect(redirectResult("=OFFSET('North beds'!A1, 1, 0)", (address) => (address.startsWith("North beds!") ? 4 : undefined))).toBe(
      4,
    );
    const sheet = {
      "0": { "0": { v: 10 }, "1": { f: "=OFFSET(A1, 1, 0)", v: "" }, "2": { v: "secret-value" } },
      "1": { "0": { v: 4 } },
    };
    expect(applyOffset(sheet)).toEqual(["B1"]);
    expect(sheet["0"]["1"].v).toBe(4);
    expect(JSON.stringify(["B1"])).not.toContain("secret-value");
    expect(applyOffset({ "1": undefined, "0": { "0": null } })).toEqual([]);
  });
});
