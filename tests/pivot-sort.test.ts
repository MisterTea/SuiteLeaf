import { describe, expect, it } from "vitest";
import { pivotSchema } from "@suiteleaf/core";
import { pivotResult } from "../apps/web/src/analysis";

describe("pivot sort", () => {
  it("orders one row field by its total and leaves the source numbers", () => {
    const data = [
      ["Team", "Revenue"],
      ["North", 70],
      ["South", 50],
      ["West", "secret-value"],
    ];
    const base = { rows: [0], columns: [] as number[], value: 1, aggregate: "SUM" as const };
    const before = JSON.stringify(data);
    const byValue = pivotResult(data, { ...base, sort: { by: "value", direction: "desc" } });
    expect(byValue.slice(1, -1).map((row) => row[0])).toEqual(["North", "South"]);
    expect(byValue[1][1]).toBe(70);
    expect(byValue[2][1]).toBe(50);
    expect(byValue.at(-1)).toEqual(["Grand Total", 120]);
    expect(JSON.stringify(data)).toBe(before);
    expect(JSON.stringify(byValue)).not.toContain("secret-value");
    expect(pivotResult(data, base).slice(1, -1).map((row) => row[0])).toEqual(["North", "South"]);
    expect(
      pivotResult(data, { ...base, sort: { by: "value", direction: "asc" } })
        .slice(1, -1)
        .map((row) => row[0]),
    ).toEqual(["South", "North"]);

    const byLabel = pivotResult(data, { ...base, sort: { by: "label", direction: "desc" } });
    expect(byLabel.slice(1, -1).map((row) => row[0])).toEqual(["South", "North"]);

    const stored = pivotSchema.parse({
      id: "fees",
      title: "Fees",
      source: { sheetId: "s", startRow: 0, startColumn: 0, endRow: 2, endColumn: 1 },
      targetSheetId: "s",
      rows: [0],
      columns: [],
      value: 1,
      aggregate: "SUM",
      sort: { by: "value", direction: "desc" },
    });
    expect(stored.sort).toEqual({ by: "value", direction: "desc" });
  });
});