import { describe, expect, it } from "vitest";
import { conditionOf, firstMatching, parseIfs } from "../packages/core/src/sheet-ifs";

describe("IFS", () => {
  it("uses the first number that is not zero", () => {
    const parsed = parseIfs("=IFS(A1, B1, C1, D1)");
    expect(parsed?.sheet).toBeNull();
    const rows: Record<string, unknown> = { A1: 0, B1: "secret-value", C1: " 2 ", D1: 4 };
    expect(firstMatching(parsed!, (address) => rows[address])).toBe(4);
    rows.A1 = 0;
    rows.C1 = 0;
    expect(firstMatching(parsed!, (address) => rows[address])).toBe("#N/A");
    rows.A1 = "#DIV/0!";
    expect(firstMatching(parsed!, (address) => rows[address])).toBeNull();
    rows.A1 = "Beds";
    expect(firstMatching(parsed!, (address) => rows[address])).toBeNull();
    expect(conditionOf("")).toBe(0);
    expect(conditionOf(1)).toBe(1);
    expect(parseIfs("=IFS(A1, B1)")).toBeNull();
    expect(parseIfs("=IFS(Beds!A1, B1, C1, D1)")).toBeNull();
    expect(parseIfs("=IFS(A0, B1, C1, D1)")).toBeNull();
    expect(parseIfs("=IFS(Beds!A1, Beds!B1, Beds!C1, Beds!D1)")?.sheet).toBe("Beds");
    expect(parseIfs("=IFS('North beds'!A1, 'North beds'!B1, 'North beds'!C1, 'North beds'!D1)")?.sheet).toBe(
      "North beds",
    );
  });
});
