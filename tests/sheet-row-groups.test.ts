import { expect, test } from "vitest";

import {
  NOTHING_TO_GROUP,
  collapseAll,
  contiguousRanges,
  expandAll,
  formulaTouchesDetail,
  makeGroup,
  planGroupRows,
  readRowGroups,
  replaceGroups,
  shiftRowGroups,
  showOnly,
  showOnlyLabel,
} from "../apps/web/src/editors/sheet-row-groups";

test("a lone total is not a group, and a summing total is left out of the selection", () => {
  expect(planGroupRows({ startRow: 0, endRow: 0 }, ["=SUM(B2:B13)"])).toEqual({
    ok: false,
    message: NOTHING_TO_GROUP,
  });
  expect(planGroupRows(null, [])).toEqual({
    ok: false,
    message: NOTHING_TO_GROUP,
  });
  expect(
    planGroupRows({ startRow: 0, endRow: 12 }, ["=SUM(B2:B13)", ""]),
  ).toEqual({ ok: true, startRow: 1, endRow: 12, keptTotal: true });
  expect(
    planGroupRows({ startRow: 1, endRow: 12 }, ["", ""]),
  ).toEqual({ ok: true, startRow: 1, endRow: 12, keptTotal: false });
  expect(
    formulaTouchesDetail(["=SUM($B$2:$B$13)"], 0, 12),
  ).toBe(true);
  expect(formulaTouchesDetail(['=SUM("B2:B13")'], 0, 12)).toBe(false);
  expect(formulaTouchesDetail(["=B2*2"], 1, 12)).toBe(false);
});

test("show only keeps one detail row and does not change the span", () => {
  const group = makeGroup(1, 12);
  const only = showOnly(group, 1);
  expect(only.startRow).toBe(1);
  expect(only.endRow).toBe(12);
  expect(only.collapsed).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  expect(expandAll(collapseAll(group)).collapsed).toEqual([]);
  expect(showOnlyLabel("January", 1)).toBe("Show only January");
  expect(showOnlyLabel("", 4)).toBe("Show only row 5");
});

test("inserting a row shifts a nested group and a collapsed week", () => {
  const month = makeGroup(1, 7);
  const week = makeGroup(3, 5);
  const inside = shiftRowGroups([month, week], 4);
  expect(inside.map((group) => [group.startRow, group.endRow, group.collapsed])).toEqual([
    [1, 8, []],
    [3, 6, []],
  ]);
  expect(inside.every((group) => group.startRow > 0)).toBe(true);
  expect(inside.filter((group) => group.startRow <= 4 && group.endRow >= 4)).toHaveLength(2);

  const above = shiftRowGroups(inside, 1);
  expect(above.map((group) => [group.startRow, group.endRow, group.collapsed])).toEqual([
    [2, 9, []],
    [4, 7, []],
  ]);
  expect(above.some((group) => group.startRow <= 1 && group.endRow >= 1)).toBe(false);
  expect(above.every((group) => group.startRow > 0)).toBe(true);

  const collapsed = shiftRowGroups([month, collapseAll(week)], 4);
  expect(collapsed.map((group) => [group.startRow, group.endRow, group.collapsed])).toEqual([
    [1, 8, []],
    [3, 6, [3, 4, 5, 6]],
  ]);
  const stillCollapsed = shiftRowGroups(collapsed, 1);
  expect(stillCollapsed.map((group) => [group.startRow, group.endRow, group.collapsed])).toEqual([
    [2, 9, []],
    [4, 7, [4, 5, 6, 7]],
  ]);
  expect(stillCollapsed.some((group) => group.startRow <= 1 && group.endRow >= 1)).toBe(false);
});

test("stored groups ignore a summary row and survive a round trip", () => {
  const next = replaceGroups(
    [makeGroup(1, 3), makeGroup(8, 10)],
    makeGroup(1, 12),
  );
  expect(next.map((group) => [group.startRow, group.endRow])).toEqual([
    [1, 12],
  ]);
  const custom = { suiteleafTabGroup: "Budget", suiteleafRowGroups: next };
  expect(readRowGroups(custom)).toEqual(next);
  expect(readRowGroups({ suiteleafRowGroups: [{ startRow: 1, endRow: 1, collapsed: [0, 1, 9] }] })).toEqual([
    { id: "rows-2-2", startRow: 1, endRow: 1, collapsed: [1] },
  ]);
  expect(contiguousRanges([1, 2, 3, 5, 6])).toEqual([
    { startRow: 1, endRow: 3, startColumn: 0, endColumn: 0 },
    { startRow: 5, endRow: 6, startColumn: 0, endColumn: 0 },
  ]);
});
