import { describe, expect, it } from "vitest";
import { averageMatching, averageMatchingMany, countMatchingRows, parseAverageIf, parseAverageIfs, parseCountIf, parseCountIfs, parseSumIf, parseSumIfs, sumMatching } from "../packages/core/src/sheet-countifs";

describe("COUNTIFS", () => {
  it("counts rows that match every condition and refuses a broken formula", () => {
    const parsed = parseCountIfs("=COUNTIFS(A1:A2, D1, B1:B2, E1)");
    expect(parsed?.sheet).toBeNull();
    const values: Record<string, unknown> = { A1: "Beds", B1: "North", A2: "beds", B2: "West", D1: "Beds", E1: "North" };
    expect(
      countMatchingRows(parsed!.pairs, (address) => values[address], (left, right) =>
        typeof left === "string" && typeof right === "string" ? left.toLowerCase() === right.toLowerCase() : left === right,
      ),
    ).toBe(1);
    const other = parseCountIfs("=COUNTIFS(Beds!A1:A2, D1, Beds!B1:B2, E1)");
    expect(other?.sheet).toBe("Beds");
    expect(other?.pairs[0].cells).toEqual(["A1", "A2"]);
    expect(parseCountIfs("=COUNTIFS(A1:A2, D1, B1:B3, E1)")).toBeNull();
    expect(parseCountIfs("=COUNTIFS(A1:A2, D1, Fees!B1:B2, E1)")).toBeNull();
    expect(parseCountIfs("=COUNTIF(A1:A2, D1)")).toBeNull();
    expect(parseCountIfs("=COUNTIFS(secret-value\nA1:A2, D1)")).toBeNull();
    expect(parseCountIfs("=COUNTIFS(A1:A2)")).toBeNull();
    expect(parseCountIfs("=COUNTIFS(A1:A80, D1)")).toBeNull();
    expect(parseCountIfs("=COUNTIFS(A0:A1, D1)")).toBeNull();
    expect(parseCountIfs("=COUNTIFS(A1, D1)")).toBeNull();
    expect(parseCountIfs("=COUNTIFS(''!A1:A2, D1)")).toBeNull();
    expect(parseCountIfs("=COUNTIFS(A1:A2, 1)")).toBeNull();
    const named = parseCountIfs("=COUNTIFS('Garden beds'!A1:A1, D1, 'Garden beds'!B1:B1, E1)");
    expect(named?.sheet).toBe("Garden beds");
    const blanks: Record<string, unknown> = { A1: "", D1: null, B1: 2, E1: 2 };
    const both = parseCountIfs("=COUNTIFS(A1:A1, D1, B1:B1, E1)");
    expect(
      countMatchingRows(both!.pairs, (address) => blanks[address], (left, right) => {
        if (typeof left === "number" && typeof right === "number") return left === right;
        const empty = (value: unknown) => value === undefined || value === null || value === "";
        return empty(left) && empty(right);
      }),
    ).toBe(1);
    expect(countMatchingRows([], () => null, () => false)).toBe(0);
    const averaged = parseAverageIf("=AVERAGEIF(A1:A2, D1, B1:B2)");
    expect(averaged?.sheet).toBeNull();
    const amounts: Record<string, unknown> = { A1: "Beds", B1: 10, A2: "beds", B2: 4, D1: "Beds" };
    expect(
      averageMatching(
        averaged!,
        (address) => amounts[address],
        (left, right) =>
          typeof left === "string" && typeof right === "string" ? left.toLowerCase() === right.toLowerCase() : left === right,
        (value) => (typeof value === "number" ? value : null),
        () => false,
      ),
    ).toBe(7);
    expect(parseAverageIf("=AVERAGEIF(A1:A2, D1, B1:B3)")).toBeNull();
    expect(parseAverageIf("=AVERAGEIF(Beds!A1:A1, D1, Fees!B1:B1, E1)")).toBeNull();
    amounts.B1 = "#DIV/0!";
    expect(
      averageMatching(
        averaged!,
        (address) => amounts[address],
        (left, right) =>
          typeof left === "string" && typeof right === "string" ? left.toLowerCase() === right.toLowerCase() : left === right,
        (value) => (typeof value === "number" ? value : null),
        (value) => value === "#DIV/0!",
      ),
    ).toBe("#DIV/0!");
    amounts.A1 = "North";
    amounts.A2 = "West";
    amounts.B1 = 10;
    expect(
      averageMatching(
        averaged!,
        (address) => amounts[address],
        () => false,
        (value) => (typeof value === "number" ? value : null),
        () => false,
      ),
    ).toBe("#DIV/0!");
    expect(parseAverageIf("=AVERAGEIF(A1)")).toBeNull();
    expect(parseAverageIf("=AVERAGEIF(A1:A1, D1, B1:B1, E1)")).toBeNull();
    expect(parseAverageIf("=AVERAGEIF(nope, D1)")).toBeNull();
    const self = parseAverageIf("=AVERAGEIF(A1:A1, D1)");
    expect(self?.sumCells).toEqual(self?.criteriaCells);
    expect(
      averageMatching(
        averaged!,
        () => ({ bad: true }),
        () => true,
        () => null,
        (value) => typeof value !== "string",
      ),
    ).toBe("#VALUE!");
    expect(
      averageMatching(
        averaged!,
        (address) => (address === "D1" || address.startsWith("A") ? "Beds" : "secret-value"),
        () => true,
        () => null,
        () => false,
      ),
    ).toBe("#DIV/0!");
    const summed = parseSumIfs("=SUMIFS(B1:B2, A1:A2, D1, C1:C2, E1)");
    expect(summed?.sheet).toBeNull();
    const rows: Record<string, unknown> = {
      A1: "Beds",
      B1: 10,
      C1: "North",
      A2: "beds",
      B2: 4,
      C2: "West",
      D1: "Beds",
      E1: "North",
    };
    expect(
      sumMatching(
        summed!,
        (address) => rows[address],
        (left, right) =>
          typeof left === "string" && typeof right === "string" ? left.toLowerCase() === right.toLowerCase() : left === right,
        (value) => (typeof value === "number" ? value : null),
        (value) => value === "#DIV/0!",
      ),
    ).toBe(10);
    const averagedMany = parseAverageIfs("=AVERAGEIFS(B1:B2, A1:A2, D1, C1:C2, E1)");
    expect(averagedMany?.sheet).toBeNull();
    rows.B1 = 10;
    expect(
      averageMatchingMany(
        averagedMany!,
        (address) => rows[address],
        (left, right) =>
          typeof left === "string" && typeof right === "string" ? left.toLowerCase() === right.toLowerCase() : left === right,
        (value) => (typeof value === "number" ? value : null),
        (value) => value === "#DIV/0!",
      ),
    ).toBe(10);
    rows.B1 = "note";
    rows.B2 = "note";
    expect(
      averageMatchingMany(
        averagedMany!,
        (address) => rows[address],
        () => true,
        (value) => (typeof value === "number" ? value : null),
        (value) => value === "#DIV/0!",
      ),
    ).toBe("#DIV/0!");
    expect(parseSumIfs("=SUMIFS(B1:B2, A1:A2)")).toBeNull();
    expect(parseSumIfs("=SUMIFS(B1:B3, A1:A2, D1)")).toBeNull();
    rows.B1 = "#DIV/0!";
    expect(
      sumMatching(
        summed!,
        (address) => rows[address],
        () => true,
        (value) => (typeof value === "number" ? value : null),
        (value) => value === "#DIV/0!",
      ),
    ).toBe("#DIV/0!");
    rows.B1 = 1;
    expect(
      sumMatching(summed!, (address) => rows[address], () => true, () => null, (value) => typeof value === "number"),
    ).toBe("#VALUE!");
    expect(
      averageMatchingMany(
        averagedMany!,
        (address) => rows[address],
        () => true,
        () => null,
        (value) => typeof value === "number",
      ),
    ).toBe("#VALUE!");
    expect(parseAverageIfs("=AVERAGEIFS(Beds!B1:B2, A1:A2, D1)")).toBeNull();
    expect(parseAverageIfs("=AVERAGEIFS(B1:B80, A1:A80, D1)")).toBeNull();
  });

  it("counts and sums a written criterion", () => {
    const counted = parseCountIfs('=COUNTIFS(A1:A3, ">10")');
    const values: Record<string, unknown> = { A1: 12, A2: 10, A3: "secret-value" };
    const same = () => false;
    expect(countMatchingRows(counted!.pairs, (address) => values[address], same)).toBe(1);
    values.A2 = " 12 ";
    expect(countMatchingRows(counted!.pairs, (address) => values[address], same)).toBe(2);
    const named = parseCountIfs('=COUNTIFS(A1:A3, "beds")');
    values.A1 = "Beds";
    values.A2 = "beds";
    expect(countMatchingRows(named!.pairs, (address) => values[address], same)).toBe(2);
    const summed = parseSumIfs('=SUMIFS(B1:B3, A1:A3, "Pass")');
    const rows: Record<string, unknown> = { A1: "Pass", B1: 10, A2: "pass", B2: 4, A3: "secret-value", B3: 9 };
    expect(
      sumMatching(
        summed!,
        (address) => rows[address],
        same,
        (value) => (typeof value === "number" ? value : null),
        () => false,
      ),
    ).toBe(14);
    const averaged = parseAverageIfs('=AVERAGEIFS(B1:B2, A1:A2, ">=10")');
    expect(
      averageMatchingMany(
        averaged!,
        (address) => ({ A1: 10, B1: 6, A2: 4, B2: 1 })[address],
        same,
        (value) => (typeof value === "number" ? value : null),
        () => false,
      ),
    ).toBe(6);
    expect(parseCountIf('=COUNTIF(A1:A3, ">10")')?.pairs[0]?.criteria).toEqual({ kind: "compare", op: ">", number: 10 });
    expect(parseCountIf("=COUNTIF(A1:A3, D1)")).toBeNull();
    expect(parseSumIf("=SUMIF(A1:A3, D1, B1:B3)")).toBeNull();
    expect(parseSumIf('=SUMIF(A1:A3, "Pass", B1:B3)')?.sumCells).toEqual(["B1", "B2", "B3"]);
    expect(parseCountIfs('=COUNTIFS(A1:A2, "")')).toBeNull();
    expect(parseCountIfs('=COUNTIFS(A1:A2, "<>4")')?.pairs[0]?.criteria).toEqual({ kind: "compare", op: "<>", number: 4 });
    expect(countMatchingRows(parseCountIfs('=COUNTIFS(A1:A1, "<=10")')!.pairs, () => 10, same)).toBe(1);
    expect(countMatchingRows(parseCountIfs('=COUNTIFS(A1:A1, "<10")')!.pairs, () => 4, same)).toBe(1);
    expect(countMatchingRows(parseCountIfs('=COUNTIFS(A1:A1, "=10")')!.pairs, () => 10, same)).toBe(1);
  });
});
