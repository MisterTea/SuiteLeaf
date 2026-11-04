import { describe, expect, it } from "vitest";
import { pivotSchema } from "@suiteleaf/core";
import { pivotResult } from "../apps/web/src/analysis";
import { orderGroupsByTotal } from "../apps/web/src/pivot-group-sort";

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

  it("orders two row fields by the group subtotal", () => {
    const data = [
      ["Team", "Bed", "Revenue"],
      ["North", "Paths", 30],
      ["South", "Beds", 50],
      ["North", "Beds", 40],
      ["West", "Beds", "secret-value"],
    ];
    const base = { rows: [0, 1], columns: [] as number[], value: 2, aggregate: "SUM" as const };
    const before = JSON.stringify(data);
    const byValue = pivotResult(data, { ...base, sort: { by: "value", direction: "desc" } });
    expect(byValue.slice(1, -1).map((row) => [row[0], row[1], row[2]])).toEqual([
      ["North", "Beds", 40],
      ["North", "Paths", 30],
      ["North", "Subtotal", 70],
      ["South", "Beds", 50],
      ["South", "Subtotal", 50],
    ]);
    expect(byValue.at(-1)).toEqual(["Grand Total", null, 120]);
    expect(JSON.stringify(data)).toBe(before);
    expect(JSON.stringify(byValue)).not.toContain("secret-value");
    expect(
      pivotResult(data, { ...base, sort: { by: "value", direction: "asc" } })
        .slice(1, -1)
        .map((row) => row[0]),
    ).toEqual(["South", "South", "North", "North", "North"]);
  });

  it("breaks a tie by the group label and treats a total that is not a number as zero", () => {
    const ordered = orderGroupsByTotal(
      ["north-a", "south-a", "north-b"],
      (row) => row.slice(0, 5),
      (group) => (group === "north" ? "secret-value" : 0),
      "asc",
      (left, right) => left.localeCompare(right),
    );
    expect(ordered).toEqual(["north-a", "north-b", "south-a"]);
    expect(JSON.stringify(ordered)).not.toContain("secret-value");
    const tied = orderGroupsByTotal(
      ["b-1", "a-1"],
      (row) => row[0],
      () => "secret-value",
      "desc",
      (left, right) => left.localeCompare(right),
    );
    expect(tied).toEqual(["a-1", "b-1"]);
    expect(JSON.stringify(tied)).not.toContain("secret-value");
  });
});