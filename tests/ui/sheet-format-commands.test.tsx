// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CommandType, ICommandService } from "@univerjs/core";
import { numberFormatById } from "../../apps/web/src/formats";
import { sheetFormatCommands, useSheetTextFormat } from "../../apps/web/src/editors/sheet-format-commands";
import { headlessWorkbook, select, stubRenderFacade, type CellSeed, type Headless } from "../sheet-editor-univer";

let h: Headless;
let facade: ReturnType<typeof stubRenderFacade>;

function setup(cells: CellSeed = { 0: { 0: { v: 1 } } }) {
  h = headlessWorkbook([{ id: "s1", cells }]);
  facade = stubRenderFacade(h);
  const format = renderHook(() => useSheetTextFormat());
  const calls = { persist: 0, sync: 0, errors: [] as string[], notices: [] as string[] };
  const commands = (book: unknown = h.book()) =>
    sheetFormatCommands({
      book: { current: book },
      api: { current: h.api },
      persist: { current: () => calls.persist++ },
      syncTextStyle: { current: () => calls.sync++ },
      onError: (message) => calls.errors.push(message),
      setNotice: (notice) => calls.notices.push(notice),
      format: format.result.current,
    });
  return { format, calls, commands };
}

afterEach(() => {
  cleanup();
  facade?.restore();
  h?.dispose();
});

const style = (row: number, column: number) => h.sheet().getRange(row, column).getCellStyleData() ?? {};

it("formats the selected cells as currency, percent, and a named format", () => {
  const { calls, commands } = setup({ 0: { 0: { v: 1 }, 1: { v: 2 } } });
  select(h, 0, 0, 1, 2);
  act(() => commands().formatCurrency());
  expect(style(0, 1).n?.pattern).toBe(numberFormatById("currency2")!.code);
  const run = vi.spyOn(h.api, "executeCommand");
  act(() => commands().formatPercent());
  act(() => commands().addDecimal());
  act(() => commands().subtractDecimal());
  expect(run.mock.calls.map(([id]) => id)).toEqual([
    "sheet.command.numfmt.set.percent",
    "sheet.command.numfmt.add.decimal.command",
    "sheet.command.numfmt.subtract.decimal.command",
  ]);
  act(() => commands().applyNamedFormatNow("percent1"));
  expect(style(0, 0).n?.pattern).toBe("0.0%");
  const persisted = calls.persist;
  act(() => commands().applyNamedFormatNow("no-such-format"));
  expect(calls.persist).toBe(persisted);
  act(() => commands({ getActiveRange: () => null, getActiveSheet: () => null }).applyNamedFormatNow("percent1"));
  expect(calls.persist).toBe(persisted);
});

it("toggles bold through the grid command and reports a command that fails", async () => {
  const { calls, commands } = setup();
  select(h, 0, 0);
  h.injector.get(ICommandService).registerCommand({
    id: "sheet.command.set-range-bold",
    type: CommandType.COMMAND,
    handler: () => {
      h.sheet().getRange(0, 0).setFontWeight("bold");
      return true;
    },
  });
  await act(async () => {
    commands().toggleBold();
    await new Promise((done) => setTimeout(done, 0));
  });
  expect(style(0, 0).bl).toBe(1);
  expect([calls.sync, calls.persist]).toEqual([1, 1]);
  await act(async () => {
    commands().toggleItalic();
    commands().toggleStrike();
    await new Promise((done) => setTimeout(done, 0));
  });
  expect(calls.errors).toHaveLength(2);
  expect(calls.errors[0]).toContain("sheet.command.set-range-italic");
});

it("paints text and fill colours, borders, alignment, wrap, rotation, and fonts on the selection", () => {
  const { format, commands } = setup();
  select(h, 0, 0);
  act(() => commands().handleTextColor("#ff0000"));
  act(() => commands().handleFillColor("#00ff00"));
  expect(style(0, 0).cl?.rgb).toBe("#ff0000");
  expect(style(0, 0).bg?.rgb).toBe("#00ff00");
  expect([format.result.current.textColor, format.result.current.fillColor]).toEqual(["#ff0000", "#00ff00"]);
  act(() => commands().applyBorders());
  expect(style(0, 0).bd?.t).toBeTruthy();
  act(() => commands().cycleHorizontalAlign());
  expect(format.result.current.hAlign).toBe("center");
  expect(style(0, 0).ht).toBe(2);
  act(() => commands().cycleHorizontalAlign());
  expect(format.result.current.hAlign).toBe("right");
  expect(style(0, 0).ht).toBe(3);
  act(() => commands().cycleHorizontalAlign());
  expect(format.result.current.hAlign).toBe("left");
  expect(style(0, 0).ht).toBe(1);
  act(() => commands().cycleVerticalAlign());
  expect(format.result.current.vAlign).toBe("bottom");
  act(() => commands().cycleVerticalAlign());
  act(() => commands().cycleVerticalAlign());
  expect(format.result.current.vAlign).toBe("middle");
  act(() => commands().toggleWrap());
  expect(format.result.current.isWrap).toBe(true);
  expect(style(0, 0).tb).toBe(3);
  act(() => commands().rotateText(45));
  expect(style(0, 0).tr).toEqual({ a: 45 });
  act(() => commands().rotateText({ a: 0, v: 1 }));
  expect(style(0, 0).tr?.v).toBe(1);
  act(() => commands().rotateText(null));
  expect(style(0, 0).tr).toBeFalsy();
  act(() => commands().handleFontFamily("Georgia"));
  act(() => commands().handleFontSize(18));
  expect([style(0, 0).ff, style(0, 0).fs]).toEqual(["Georgia", 18]);
  act(() => commands().handleZoom("150%"));
  expect([format.result.current.zoom, facade.zoomed]).toEqual(["150%", [1.5]]);
});

it("does nothing to cells when no range is selected", () => {
  const { format, calls, commands } = setup();
  const empty = commands({ getActiveRange: () => null, getActiveSheet: () => null });
  act(() => {
    empty.handleTextColor("#123456");
    empty.handleFillColor("#123456");
    empty.applyBorders();
    empty.mergeCells();
    empty.unmergeCells();
    empty.cycleHorizontalAlign();
    empty.cycleVerticalAlign();
    empty.toggleWrap();
    empty.rotateText(10);
    empty.handleFontFamily("Arial");
    empty.handleFontSize(9);
    empty.alternatingColors();
    empty.formatCurrency();
    empty.handleZoom("50%");
  });
  expect(format.result.current.textColor).toBe("#123456");
  expect(calls.persist).toBe(1);
  expect(calls.notices).toEqual([]);
});

it("merges a block, explains unmerging cells that are not merged, and breaks merges apart", () => {
  const { calls, commands } = setup({ 0: { 0: { v: "a" }, 1: { v: "" } } });
  select(h, 0, 0, 1, 2);
  act(() => commands().unmergeCells());
  expect(calls.notices).toEqual(["These cells are not merged."]);
  act(() => commands().mergeCells());
  expect(h.sheet().getRange(0, 0, 1, 2).isMerged()).toBe(true);
  act(() => commands().unmergeCells());
  expect(h.sheet().getRange(0, 0, 1, 2).isMerged()).toBe(false);
  expect(calls.notices).toEqual(["These cells are not merged.", ""]);
});

it("bands the used block from one selected cell with a header fill", () => {
  const { commands } = setup({
    0: { 0: { v: "H" }, 1: { v: "H2" } },
    1: { 0: { v: 1 }, 1: { v: 2 } },
    2: { 0: { v: 3 }, 1: { v: 4 } },
  });
  select(h, 1, 1);
  act(() => commands().alternatingColors());
  expect([style(0, 0).bg?.rgb, style(1, 1).bg?.rgb, style(2, 0).bg?.rgb]).toEqual([
    "#d2e3fc",
    "#ffffff",
    "#e8f0fe",
  ]);
  expect(style(3, 0).bg?.rgb).toBeUndefined();
});

it("bands only the selection when it is a block or outside the data", () => {
  const { commands } = setup({ 0: { 0: { v: "H" } }, 1: { 0: { v: 1 } } });
  select(h, 5, 5);
  act(() => commands().alternatingColors());
  expect(style(5, 5).bg?.rgb).toBe("#d2e3fc");
  expect(style(0, 0).bg?.rgb).toBeUndefined();
  select(h, 0, 3, 2, 1);
  act(() => commands().alternatingColors());
  expect(style(1, 3).bg?.rgb).toBe("#ffffff");
});

 it("undoes and redoes the whole alternating-colors block in one step", async () => {
  const { commands } = setup({ 0: { 0: { v: "Header" } }, 1: { 0: { v: 1 } }, 2: { 0: { v: 2 } } });
  select(h, 0, 0, 3, 1);
  commands().alternatingColors();
  await h.api.undo();
  for (let row = 0; row < 3; row++) expect(style(row, 0).bg?.rgb).toBeUndefined();
  await h.api.redo();
  expect([0, 1, 2].map(row => style(row, 0).bg?.rgb)).toEqual(["#d2e3fc", "#ffffff", "#e8f0fe"]);
});
