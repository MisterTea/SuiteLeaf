import { expect, it } from "vitest";
import { pivotSchema } from "../packages/core/src";
import { drillGroupRows, drillPivot, groupedKey, pivotSliceFromForm, slicePivot } from "../packages/core/src/pivot-slicer";

const sales = [
  ["Date", "Team", "Revenue"],
  ["2026-01-15", "North", 10],
  ["2026-03-02", "North", 5],
  ["2026-01-20", "South", 7],
  ["2025-12-01", "North", 4],
];

it("groups dates, keeps the slicer selection, and drills back to the source rows", () => {
  const slice = { dateColumn: 0, dateGroup: "year" as const, slicerColumn: 1, slicerValues: ["North"] };
  const grouped = slicePivot(sales, slice);
  expect(grouped).toEqual([
    ["Date", "Team", "Revenue"],
    ["2026", "North", 10],
    ["2026", "North", 5],
    ["2025", "North", 4],
  ]);
  expect(sales[1][0]).toBe("2026-01-15");
  const drilled = drillPivot(sales, slice, "2026");
  expect(drilled).toEqual([
    ["Date", "Team", "Revenue"],
    ["2026-01-15", "North", 10],
    ["2026-03-02", "North", 5],
  ]);
  const definition = pivotSchema.parse({
    id: "p1",
    title: "Sales",
    source: { sheetId: "s", startRow: 0, endRow: 4, startColumn: 0, endColumn: 2 },
    targetSheetId: "s",
    rows: [0],
    columns: [],
    value: 2,
    aggregate: "SUM",
    dateColumn: 0,
    dateGroup: "year",
    slicerColumn: 1,
    slicerValues: ["North"],
  });
  expect(pivotSchema.parse(JSON.parse(JSON.stringify(definition)))).toEqual(definition);
  expect(slicePivot(sales, { dateColumn: 0, dateGroup: "month" })[1][0]).toBe("2026-01");
  expect(slicePivot(sales, { dateColumn: 0, dateGroup: "quarter" })[1][0]).toBe("2026 Q1");
  expect(groupedKey("2026-12-31", "quarter")).toBe("2026 Q4");
  expect(groupedKey("2026-13-01", "quarter")).toBe("2026-13-01");
  expect(groupedKey("2026-02-31", "quarter")).toBe("2026-02-31");
  expect(groupedKey("2026-01-15T10:00:00", "quarter")).toBe("2026 Q1");
  expect(groupedKey("2026-01-15T23:00:00-05:00", "quarter")).toBe("2026 Q1");
  expect(groupedKey("2026-01-15T10:00:00+05:30", "month")).toBe("2026-01");
  expect(groupedKey("2026-01-15T10:00:00+25:00", "quarter")).toBe("2026-01-15T10:00:00+25:00");
  expect(groupedKey("2026-02-31T00:00:00-05:00", "quarter")).toBe("2026-02-31T00:00:00-05:00");
  expect(groupedKey("secret-value", "quarter")).toBe("secret-value");
  expect(groupedKey(" 2026-01-15 ", "quarter")).toBe("2026 Q1");
  const spaced = [
    ["Date", "Team"],
    [" 2026-01-15 ", "North"],
    ["secret-value", "South"],
  ];
  expect(slicePivot(spaced, { dateColumn: 0, dateGroup: "quarter" })).toEqual([
    ["Date", "Team"],
    ["2026 Q1", "North"],
    ["secret-value", "South"],
  ]);
  expect(spaced[1][0]).toBe(" 2026-01-15 ");
  expect(drillPivot(spaced, { dateColumn: 0, dateGroup: "quarter" }, "2026 Q1")[1][0]).toBe(
    " 2026-01-15 ",
  );
  expect(slicePivot(sales, { slicerColumn: 1, slicerValues: [] })).toHaveLength(sales.length);
  expect(slicePivot([["Date"], ["not-a-date"]], { dateColumn: 0, dateGroup: "year" })[1][0]).toBe(
    "not-a-date",
  );
});

it("lists the source rows for one year and leaves an unmatched secret out", () => {
  const slice = { dateColumn: 0, dateGroup: "year" as const, slicerColumn: 1, slicerValues: ["North"] };
  const table = [...sales, ["2026-06-01", "South", "secret-value"]];
  const shown = drillGroupRows(table, slice, "2026");
  expect(shown.rows.map((row) => row[0])).toEqual(["Date", "2026-01-15", "2026-03-02"]);
  expect(shown.note).toBe("2 source rows.");
  expect(JSON.stringify(shown)).not.toContain("secret-value");
  expect(sales[1][0]).toBe("2026-01-15");
  expect(drillGroupRows(table, slice, "  ").note).toBe("Name the group to show.");
  const missed = drillGroupRows(table, slice, "secret-value");
  expect(missed.note).toBe("That group has no rows.");
  expect(JSON.stringify(missed)).not.toContain("secret-value");
});

it("stores a year group and a slicer from the dialog fields", () => {
  const slice = pivotSliceFromForm({
    dateColumn: 0,
    dateGroup: "year",
    slicerColumn: 1,
    slicerText: "North",
  });
  expect(slice).toEqual({
    dateColumn: 0,
    dateGroup: "year",
    slicerColumn: 1,
    slicerValues: ["North"],
  });
  expect(
    pivotSliceFromForm({ dateColumn: 0, dateGroup: "quarter", slicerColumn: -1, slicerText: "" }),
  ).toEqual({ dateColumn: 0, dateGroup: "quarter" });
  expect(slicePivot(sales, slice).map((row) => row[1])).toEqual(["Team", "North", "North", "North"]);
  expect(
    pivotSliceFromForm({ dateColumn: -1, dateGroup: "", slicerColumn: -1, slicerText: "North" }),
  ).toEqual({});
});
