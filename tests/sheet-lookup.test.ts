import { describe, expect, it } from "vitest";
import { exactLookup, matchXLookup, parseLookup, parseXLookup } from "../packages/core/src/sheet-lookup";

describe("horizontal lookup", () => {
  it("reads the row under the matching header", () => {
    const parsed = parseLookup("=HLOOKUP(A1, B1:C2, 2, FALSE)");
    expect(parsed?.across).toBe("row");
    const rows: Record<string, unknown> = { A1: "North", B1: "Beds", C1: "North", B2: 10, C2: 4 };
    expect(exactLookup(parsed!, (address) => rows[address], (left, right) => left === right)).toBe(4);
    rows.A1 = "Missing";
    expect(exactLookup(parsed!, (address) => rows[address], () => false)).toBe("#N/A");
    expect(parseLookup("=HLOOKUP(A1, B1:C2, 3)")).toBeNull();
    expect(parseLookup("=HLOOKUP(A1, B1:C80, 1)")).toBeNull();
    expect(parseLookup("=VLOOKUP(A1, B1:C2, 2)")?.across).toBe("column");
    expect(parseLookup("=HLOOKUP(A1, B1:C2, 2, TRUE)")).toBeNull();
    expect(parseLookup("=HLOOKUP(A1, A0:B1, 1)")).toBeNull();
    expect(parseLookup("=HLOOKUP(A1, B1:C2, 0)")).toBeNull();
    expect(parseLookup("=HLOOKUP(AA1, AA1:AB2, 2)")?.cells[0]).toBe("AA1");
    const found = parseXLookup("=XLOOKUP(A1, B1:B2, C1:C2, D1)");
    expect(found?.sheet).toBeNull();
    const table: Record<string, unknown> = { A1: "Beds", B1: "beds", C1: 10, B2: "North", C2: "secret-value", D1: 4 };
    expect(
      matchXLookup(found!, (address) => table[address], (left, right) => String(left).toLowerCase() === String(right).toLowerCase()),
    ).toBe(10);
    table.A1 = "Missing";
    expect(
      matchXLookup(found!, (address) => table[address], (left, right) => left === right),
    ).toBe(4);
    expect(parseXLookup("=XLOOKUP(A1, B1:B3, C1:C2)")).toBeNull();
    expect(parseXLookup("=XLOOKUP(A1, B1:B2, C1:C2, secret)")).toBeNull();
    expect(parseXLookup("=XLOOKUP(Beds!A1, A1:A2, B1:B2)")).toBeNull();
    expect(parseXLookup("=XLOOKUP(A1, A0:A2, B1:B2)")).toBeNull();
    expect(parseXLookup("=XLOOKUP(A1, Beds!A1:A2, Beds!B1:B2)")?.sheet).toBe("Beds");
    expect(parseXLookup("=XLOOKUP(A1, B1:B2)")).toBeNull();
    expect(parseXLookup("=XLOOKUP(A1, Beds!A1:A2, Fees!B1:B2)")).toBeNull();
    expect(parseXLookup("=XLOOKUP(A1, Beds!A1:A2, Beds!B1:B2, Fees!D1)")).toBeNull();
    const plain = parseXLookup("=XLOOKUP(A1, B1:B1, C1:C1)");
    expect(matchXLookup(plain!, () => "no", () => false)).toBe("#N/A");
    expect(parseXLookup("=XLOOKUP(A1, 'North beds'!A1:A1, 'North beds'!B1:B1)")?.sheet).toBe("North beds");
  });
});
