import { describe, expect, it } from "vitest";
import {
  blocksSheetEdit,
  filterViewChoices,
  swallowsSheetEdit,
  valueFilterCriteria,
  type SheetKeyTarget,
} from "../apps/web/src/editors/view-lock";

const plot: string[][] = [
  ["Plot", "Bed", "Gardener"],
  ["1", "North", "Rosa"],
  ["2", "South", "Alex"],
  ["3", "North", "Sam"],
  ["4", "East", "Priya"],
];

const key = (patch: Partial<SheetKeyTarget>): SheetKeyTarget => ({
  key: "a",
  meta: false,
  ctrl: false,
  alt: false,
  kind: "key",
  inNameBox: false,
  inFilter: false,
  inComment: false,
  inSheet: true,
  inOutsideField: false,
  inMenu: false,
  access: "view",
  ...patch,
});

describe("sheet view lock", () => {
  it("cancels cell edits and keeps navigation, filters, and commenter replies", () => {
    expect(blocksSheetEdit("sheet.command.set-range-values", "view")).toBe(true);
    expect(blocksSheetEdit("sheet.command.set-range-bold", "view")).toBe(true);
    expect(blocksSheetEdit("sheet.operation.set-cell-edit-visible", "view")).toBe(true);
    expect(blocksSheetEdit("sheet.command.paste", "comment")).toBe(true);
    expect(blocksSheetEdit("sheet.command.set-range-values", "edit")).toBe(false);
    expect(blocksSheetEdit("sheet.operation.set-selections", "view")).toBe(false);
    expect(blocksSheetEdit("sheet.command.set-filter-range", "view")).toBe(false);
    expect(blocksSheetEdit("sheet.mutation.set-row-hidden", "view")).toBe(false);
    expect(blocksSheetEdit("thread-comment.command.add-comment", "view")).toBe(true);
    expect(blocksSheetEdit("thread-comment.command.add-comment", "comment")).toBe(false);
    expect(blocksSheetEdit("sheet.operation.toggle-comment-panel", "view")).toBe(false);
  });

  it("offers a repeated category in one menu label, not unique names", () => {
    const choices = filterViewChoices(plot);
    expect(choices.map((choice) => choice.label)).toEqual([
      "Bed: North",
      "Bed: South",
      "Bed: East",
    ]);
    expect(filterViewChoices([["Only"], ["one"]])).toEqual([]);
    expect(valueFilterCriteria(1, 0, "North")).toEqual({
      column: 1,
      criteria: { colId: 1, filters: { filters: ["North"] } },
    });
  });

  it("swallows typing in the grid and leaves the name box, filters, and comments", () => {
    expect(swallowsSheetEdit(key({}))).toBe(true);
    expect(swallowsSheetEdit(key({ key: "Delete" }))).toBe(true);
    expect(swallowsSheetEdit(key({ kind: "paste" }))).toBe(true);
    expect(swallowsSheetEdit(key({ key: "ArrowDown" }))).toBe(false);
    expect(swallowsSheetEdit(key({ key: "Enter" }))).toBe(false);
    expect(swallowsSheetEdit(key({ inNameBox: true }))).toBe(false);
    expect(swallowsSheetEdit(key({ inFilter: true }))).toBe(false);
    expect(swallowsSheetEdit(key({ inOutsideField: true, inSheet: false }))).toBe(false);
    expect(swallowsSheetEdit(key({ meta: true, key: "c" }))).toBe(false);
    expect(swallowsSheetEdit(key({ meta: true, key: "v" }))).toBe(true);
    expect(swallowsSheetEdit(key({ inComment: true, access: "comment" }))).toBe(false);
    expect(swallowsSheetEdit(key({ inComment: true, access: "view" }))).toBe(true);
  });
});
