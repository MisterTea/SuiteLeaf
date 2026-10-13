import { expect, test } from "vitest";

import {
  NOTHING_TO_GROUP_COLUMNS,
  collapseAllColumns,
  columnIsLabel,
  columnName,
  columnSpanLabel,
  contiguousColumnRanges,
  expandAllColumns,
  formulaTouchesEarlierColumns,
  makeColumnGroup,
  planGroupColumns,
  readColumnGroups,
  replaceColumnGroups,
  shiftColumnGroups,
  showOnlyColumn,
  showOnlyColumnLabel,
  withColumnGroups,
} from "../apps/web/src/editors/sheet-column-groups";

const category = { values: ["Category", "Rent", "Food"], formulas: ["", "", ""] };
const january = { values: ["January", 1200, 400], formulas: ["", "", ""] };

test("a lone category is not a group, and the column to its left stays out", () => {
  expect(planGroupColumns({ startColumn: 0, endColumn: 0 }, [])).toEqual({
    ok: false,
    message: NOTHING_TO_GROUP_COLUMNS,
  });
  expect(planGroupColumns(null, [])).toEqual({
    ok: false,
    message: NOTHING_TO_GROUP_COLUMNS,
  });
  expect(
    planGroupColumns({ startColumn: 1, endColumn: 12 }, [], january),
  ).toEqual({
    ok: true,
    startColumn: 1,
    endColumn: 12,
    keptTotal: false,
    keptLabel: false,
  });
  expect(
    planGroupColumns({ startColumn: 0, endColumn: 12 }, [], category).startColumn,
  ).toBe(1);
});

test("a year-total formula stays out of the group, including when the category was selected", () => {
  const total = ["=SUM(B2:M2)", "=SUM($B$3:$M$3)"];
  expect(formulaTouchesEarlierColumns(total, 1, 13)).toBe(true);
  expect(formulaTouchesEarlierColumns(["=SUM(B:M)"], 1, 13)).toBe(true);
  expect(formulaTouchesEarlierColumns(['=SUM("B2:M2")'], 1, 13)).toBe(false);
  expect(formulaTouchesEarlierColumns(["=A2*2"], 1, 13)).toBe(false);
  expect(planGroupColumns({ startColumn: 1, endColumn: 13 }, total, january)).toEqual({
    ok: true,
    startColumn: 1,
    endColumn: 12,
    keptTotal: true,
    keptLabel: false,
  });
  expect(planGroupColumns({ startColumn: 0, endColumn: 13 }, total, category)).toMatchObject({
    ok: true,
    startColumn: 1,
    endColumn: 12,
    keptTotal: true,
    keptLabel: true,
  });
  expect(columnIsLabel(category.values, category.formulas)).toBe(true);
  expect(columnIsLabel(january.values, january.formulas)).toBe(false);
  expect(columnIsLabel(["January", "$1,200"], ["", ""])).toBe(false);
  expect(
    planGroupColumns({ startColumn: 0, endColumn: 1 }, ["=SUM(A2)"], category).ok,
  ).toBe(false);
});

test("show only keeps one month and does not change the span", () => {
  const group = makeColumnGroup(1, 12);
  const only = showOnlyColumn(group, 1);
  expect(only.startColumn).toBe(1);
  expect(only.endColumn).toBe(12);
  expect(only.collapsed).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  expect(expandAllColumns(collapseAllColumns(group)).collapsed).toEqual([]);
  expect(columnSpanLabel(makeColumnGroup(3, 5))).toBe("Columns D–F");
  expect(showOnlyColumnLabel("January", 1)).toBe("Show only January");
  expect(showOnlyColumnLabel("", 4)).toBe("Show only column E");
  expect(columnName(0)).toBe("A");
  expect(columnName(13)).toBe("N");
});

test("inserting a column shifts a nested group and a collapsed week", () => {
  const quarter = makeColumnGroup(1, 7);
  const week = makeColumnGroup(3, 5);
  const spans = (groups: { startColumn: number; endColumn: number; collapsed: number[] }[]) =>
    groups.map((group) => [group.startColumn, group.endColumn, group.collapsed]);

  const inside = shiftColumnGroups([quarter, week], 4);
  expect(spans(inside)).toEqual([
    [1, 8, []],
    [3, 6, []],
  ]);
  expect(columnSpanLabel(inside[0]!)).toBe("Columns B–I");
  expect(columnSpanLabel(inside[1]!)).toBe("Columns D–G");
  expect(inside.filter((group) => group.startColumn <= 4 && group.endColumn >= 4)).toHaveLength(2);
  expect(inside.some((group) => group.startColumn <= 0 && group.endColumn >= 0)).toBe(false);

  const atFirst = shiftColumnGroups(inside, 1);
  expect(spans(atFirst)).toEqual([
    [2, 9, []],
    [4, 7, []],
  ]);
  expect(columnSpanLabel(atFirst[0]!)).toBe("Columns C–J");
  expect(columnSpanLabel(atFirst[1]!)).toBe("Columns E–H");
  expect(atFirst.some((group) => group.startColumn <= 1 && group.endColumn >= 1)).toBe(false);
  expect(atFirst.every((group) => group.startColumn > 0)).toBe(true);

  const collapsed = shiftColumnGroups([quarter, collapseAllColumns(week)], 4);
  expect(spans(collapsed)).toEqual([
    [1, 8, []],
    [3, 6, [3, 4, 5, 6]],
  ]);
  const stillCollapsed = shiftColumnGroups(collapsed, 1);
  expect(spans(stillCollapsed)).toEqual([
    [2, 9, []],
    [4, 7, [4, 5, 6, 7]],
  ]);
  expect(stillCollapsed[1]!.collapsed.length).toBe(
    stillCollapsed[1]!.endColumn - stillCollapsed[1]!.startColumn + 1,
  );
  expect(stillCollapsed.some((group) => group.startColumn <= 1 && group.endColumn >= 1)).toBe(false);
  expect(stillCollapsed.every((group) => group.startColumn > 0)).toBe(true);
});

test("stored column groups keep row groups and survive a round trip", () => {
  const next = replaceColumnGroups(
    [makeColumnGroup(1, 3), makeColumnGroup(8, 10)],
    makeColumnGroup(1, 12),
  );
  expect(next.map((group) => [group.startColumn, group.endColumn])).toEqual([[1, 12]]);
  const rowGroup = { id: "rows-2-13", startRow: 1, endRow: 12, collapsed: [2] };
  const custom = withColumnGroups({ suiteleafRowGroups: [rowGroup] }, next);
  expect(readColumnGroups(custom)).toEqual(next);
  expect(custom).toMatchObject({ suiteleafRowGroups: [rowGroup] });
  expect(withColumnGroups(custom, [])).toEqual({ suiteleafRowGroups: [rowGroup] });
  expect(
    readColumnGroups({
      suiteleafColumnGroups: [{ startColumn: 1, endColumn: 3, collapsed: [0, 2, 9] }],
    }),
  ).toEqual([{ id: "cols-B-D", startColumn: 1, endColumn: 3, collapsed: [2] }]);
  expect(contiguousColumnRanges([1, 2, 3, 5, 6])).toEqual([
    { startRow: 0, endRow: 0, startColumn: 1, endColumn: 3 },
    { startRow: 0, endRow: 0, startColumn: 5, endColumn: 6 },
  ]);
});
