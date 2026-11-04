import { describe, expect, it } from "vitest";
import {
  compareCells,
  compareNote,
  compareResult,
  parseCompareIf,
  settleChoices,
} from "../packages/core/src/sheet-ifs";

describe("IF comparison", () => {
  it("compares a cell with a number, another cell, or text", () => {
    const greater = parseCompareIf("=IF(A1>10, B1, C1)");
    expect(greater?.sheet).toBeNull();
    expect(greater?.op).toBe(">");
    const rows: Record<string, unknown> = { A1: 12, B1: 4, C1: 9 };
    expect(compareResult(greater!, (address) => rows[address])).toEqual({ decided: true, held: true, value: 4 });
    rows.A1 = 10;
    expect(compareResult(greater!, (address) => rows[address]).decided && compareResult(greater!, (address) => rows[address])).toMatchObject({
      held: false,
      value: 9,
    });
    const same = parseCompareIf("=IF(A1>=B1, 1, 0)");
    rows.A1 = 4;
    rows.B1 = 4;
    expect(compareResult(same!, (address) => rows[address])).toMatchObject({ held: true, value: 1 });
    const less = parseCompareIf("=IF(A1<=B1, C1, D1)");
    expect(compareResult(less!, (address) => rows[address])).toMatchObject({ held: true });
    const below = parseCompareIf("=IF(A1<B1, 2, 3)");
    expect(compareResult(below!, (address) => rows[address])).toMatchObject({ held: false, value: 3 });
    const equal = parseCompareIf('=IF(A1="beds", "Yes", "No")');
    rows.A1 = "Beds";
    expect(compareResult(equal!, (address) => rows[address])).toMatchObject({ held: true, value: "Yes" });
    const different = parseCompareIf("=IF(A1<>10, B1, C1)");
    rows.A1 = 10;
    expect(compareResult(different!, (address) => rows[address])).toMatchObject({ held: false, value: 9 });
    rows.A1 = "secret-value";
    expect(compareResult(greater!, (address) => rows[address])).toEqual({ decided: false });
    expect(compareNote(greater!, (address) => rows[address])).toBe("The comparison was not decided.");
    rows.A1 = 12;
    rows.B1 = 4;
    expect(compareNote(greater!, (address) => rows[address])).toBe("The comparison is true. The result is 4.");
    rows.B1 = "secret-value";
    expect(compareNote(greater!, (address) => rows[address])).toBe("The comparison is true. The result is text.");
    rows.B1 = "#DIV/0!";
    expect(compareNote(greater!, (address) => rows[address])).toBe("The comparison is true. The result is an error.");
    rows.A1 = "#DIV/0!";
    expect(compareResult(greater!, (address) => rows[address])).toEqual({ decided: false });
    expect(parseCompareIf("=IF(A1>10, B1)")).toBeNull();
    expect(parseCompareIf("=IF(Beds!A1>10, B1, C1)")).toBeNull();
    expect(parseCompareIf('=IF(A1>"Beds, C1)')).toBeNull();
    expect(parseCompareIf("=IF(10>A1, B1, C1)")).toBeNull();
    expect(parseCompareIf("=IF(A0>10, B1, C1)")).toBeNull();
    expect(parseCompareIf("=IF(Beds!A1>10, Beds!B1, Beds!C1)")?.sheet).toBe("Beds");
    expect(compareCells(parseCompareIf("=IF(Beds!A1>=Beds!B1, 1, Beds!C1)")!)).toEqual(["A1", "B1", "C1"]);
    const settled = settleChoices(
      ["D1"],
      () => "=IF(A1>10, B1, C1)",
      (address) => ({ A1: 3, B1: 4, C1: 9 })[address],
      () => false,
    );
    expect(settled.calculated).toEqual(["D1"]);
    expect(settled.left).toEqual([]);
    const waiting = settleChoices(
      ["B1", "C1"],
      (address) => (address === "C1" ? "=IF(B1>1, A1, A1)" : "=IF(A1>1, D1, D1)"),
      () => 2,
      () => true,
    );
    expect(waiting.calculated).toContain("C1");
  });
});
