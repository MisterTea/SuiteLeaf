import { expect, it } from "vitest";
import { mergeSheetCellPatch } from "../apps/web/src/collab/sheet-cell-patch";

it("preserves cell properties and merges style patches", () => {
  const previous = JSON.stringify({ v: 42, s: { bl: 1 } });
  expect(JSON.parse(mergeSheetCellPatch(previous, '{"s":{"bg":{"rgb":"red"}}}', false)))
    .toEqual({ v: 42, s: { bl: 1, bg: { rgb: "red" } } });
  expect(JSON.parse(mergeSheetCellPatch(previous, '{"s":{"it":1}}', true)))
    .toEqual({ v: 42, s: { it: 1 } });
  expect(JSON.parse(mergeSheetCellPatch(previous, '{"s":null}', false))).toEqual({ v: 42, s: null });
  expect(JSON.parse(mergeSheetCellPatch(previous, '{"v":7}', false))).toEqual({ v: 7, s: { bl: 1 } });
  expect(mergeSheetCellPatch(undefined, '{"v":1}', false)).toBe('{"v":1}');
  expect(mergeSheetCellPatch(previous, 'null', false)).toBe('null');
  expect(mergeSheetCellPatch(previous, '4', false)).toBe('4');
  expect(JSON.parse(mergeSheetCellPatch('{"v":1}', '{"s":{"bl":1}}', false)))
    .toEqual({ v: 1, s: { bl: 1 } });
});
