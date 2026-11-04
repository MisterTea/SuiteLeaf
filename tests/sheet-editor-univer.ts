import {
  CommandType,
  ICommandService,
  IUniverInstanceService,
  LocaleType,
  Univer,
  UniverInstanceType,
  type IWorkbookData,
} from "@univerjs/core";
import { FUniver } from "@univerjs/core/facade";
import { IRenderManagerService } from "@univerjs/engine-render";
import { Subject } from "rxjs";
import { UniverFormulaEnginePlugin } from "@univerjs/engine-formula";
import "@univerjs/engine-formula/facade";
import { UniverSheetsPlugin } from "@univerjs/sheets";
import "@univerjs/sheets/facade";
import SheetsEnUS from "@univerjs/sheets/locale/en-US";
import { UniverDataValidationPlugin } from "@univerjs/data-validation";
import { UniverSheetsDataValidationPlugin } from "@univerjs/sheets-data-validation";
import "@univerjs/sheets-data-validation/facade";
import { UniverSheetsFilterPlugin } from "@univerjs/sheets-filter";
import "@univerjs/sheets-filter/facade";
import { UniverSheetsNumfmtPlugin } from "@univerjs/sheets-numfmt";
import "@univerjs/sheets-numfmt/facade";
import { UniverSheetsSortPlugin } from "@univerjs/sheets-sort";
import "@univerjs/sheets-sort/facade";

const UI_OPERATIONS = [
  "sheet.operation.set-cell-edit-visible",
  "data-validation.operation.open-validation-panel",
  "sheet.operation.open.conditional.formatting.panel",
  "sheet.operation.toggle-comment-panel",
  "sheet.operation.show-comment-modal",
  "sheet.operation.add-note-popup",
  "sheet.operation.open-filter-panel",
  "sheet.command.numfmt.set.percent",
  "sheet.command.numfmt.add.decimal.command",
  "sheet.command.numfmt.subtract.decimal.command",
];

export type CellSeed = Record<number, Record<number, { v?: unknown; f?: string; s?: unknown; t?: number }>>;

export type SheetSeed = {
  id: string;
  name?: string;
  cells?: CellSeed;
  rowCount?: number;
  columnCount?: number;
  custom?: Record<string, unknown>;
  hidden?: boolean;
};

/** A real headless Univer workbook: commands, undo, validation and filters run, nothing is painted. */
export function headlessWorkbook(sheets: SheetSeed[] = [{ id: "s1" }], id = "book") {
  const univer = new Univer({
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: SheetsEnUS },
  });
  univer.registerPlugin(UniverFormulaEnginePlugin);
  univer.registerPlugin(UniverSheetsPlugin);
  univer.registerPlugin(UniverDataValidationPlugin);
  univer.registerPlugin(UniverSheetsDataValidationPlugin);
  univer.registerPlugin(UniverSheetsFilterPlugin);
  univer.registerPlugin(UniverSheetsNumfmtPlugin);
  univer.registerPlugin(UniverSheetsSortPlugin);
  const data: Partial<IWorkbookData> = {
    id,
    sheetOrder: sheets.map((sheet) => sheet.id),
    sheets: Object.fromEntries(
      sheets.map((sheet, index) => [
        sheet.id,
        {
          id: sheet.id,
          name: sheet.name ?? `Sheet${index + 1}`,
          rowCount: sheet.rowCount ?? 100,
          columnCount: sheet.columnCount ?? 26,
          cellData: structuredClone(sheet.cells ?? {}) as never,
          hidden: sheet.hidden ? 1 : 0,
          ...(sheet.custom ? { custom: structuredClone(sheet.custom) } : {}),
        },
      ]),
    ) as never,
  };
  univer.createUnit(UniverInstanceType.UNIVER_SHEET, data);
  const injector = (univer as unknown as { __getInjector: () => any }).__getInjector();
  injector.get(IUniverInstanceService).focusUnit(id);
  // The sheets-ui facade, once imported, watches for rendered units.
  if (!injector.has(IRenderManagerService))
    injector.add([
      IRenderManagerService,
      { useValue: { created$: new Subject(), disposed$: new Subject(), getRenderById: () => null, getRenderUnitById: () => null } },
    ]);
  const api = FUniver.newAPI(univer) as any;
  const commands = injector.get(ICommandService);
  const ui: { id: string; params: any }[] = [];
  for (const operation of UI_OPERATIONS)
    if (!commands.hasCommand(operation))
      commands.registerCommand({ id: operation, type: CommandType.OPERATION, handler: () => true });
  commands.onCommandExecuted((command: { id: string; params?: unknown }) => {
    if (UI_OPERATIONS.includes(command.id)) ui.push({ id: command.id, params: command.params });
  });
  return {
    univer,
    api,
    injector,
    /** UI operations the editor asked for, which only the painted grid would carry out. */
    ui,
    book: () => api.getActiveWorkbook(),
    sheet: () => api.getActiveWorkbook().getActiveSheet(),
    dispose: () => univer.dispose(),
  };
}

export type Headless = ReturnType<typeof headlessWorkbook>;

/** Selects a block with the active cell at its top-left, as a click and drag would. */
export function select(h: Headless, row: number, column: number, rows = 1, columns = 1) {
  h.sheet().getRange(row, column, rows, columns).activate();
}

export const flush = () => new Promise((done) => setTimeout(done, 0));

const bound = (target: any, key: PropertyKey) => {
  const value = Reflect.get(target, key);
  return typeof value === "function" ? value.bind(target) : value;
};

/** The facade with formula settling answered at once. With nothing to calculate, Univer waits 500ms. */
export function quickApi(h: Headless) {
  return new Proxy(h.api, {
    get(target, key) {
      if (key !== "getFormula") return bound(target, key);
      return () =>
        new Proxy(target.getFormula(), {
          get: (formula, name) => (name === "onCalculationResultApplied" ? async () => {} : bound(formula, name)),
        });
    },
  });
}

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };

/**
 * The render-only facade methods the grid adds once it is painted. Cells are a
 * fixed grid of `width` by `height` scene pixels.
 */
export function stubRenderFacade(h: Headless, { width = 100, height = 20 } = {}) {
  const sheetProto = Object.getPrototypeOf(h.sheet());
  const rangeProto = Object.getPrototypeOf(h.sheet().getRange(0, 0));
  const scrolled: [number, number][] = [];
  const zoomed: number[] = [];
  const added: [object, string, PropertyDescriptor | undefined][] = [];
  const define = (proto: object, name: string, value: unknown) => {
    added.push([proto, name, Object.getOwnPropertyDescriptor(proto, name)]);
    Object.defineProperty(proto, name, { value, configurable: true, writable: true });
  };
  define(sheetProto, "scrollToCell", function (row: number, column: number) {
    scrolled.push([row, column]);
  });
  define(sheetProto, "zoom", function (ratio: number) {
    zoomed.push(ratio);
  });
  define(sheetProto, "getVisibleRange", function () {
    return { startRow: 0, endRow: 30, startColumn: 0, endColumn: 10 };
  });
  define(sheetProto, "getScrollState", function () {
    return { offsetX: 0, offsetY: 0 };
  });
  const floats = new Map<string, { config: any; position: Record<string, number> }>();
  define(sheetProto, "getFloatDomById", function (id: string) {
    return floats.get(id) ?? null;
  });
  define(sheetProto, "addFloatDomToPosition", function (config: any, id: string) {
    const { startX, endX, startY, endY } = config.initPosition;
    floats.set(id, { config, position: { left: startX, top: startY, width: endX - startX, height: endY - startY } });
    return { id };
  });
  define(sheetProto, "removeFloatDom", function (id: string) {
    floats.delete(id);
  });
  define(sheetProto, "getImageById", function () {
    return null;
  });
  define(rangeProto, "getCellRect", function (this: { getRow: () => number; getColumn: () => number }) {
    const left = this.getColumn() * width;
    const top = this.getRow() * height;
    const rect: Rect = { left, top, right: left + width, bottom: top + height, width, height };
    return { ...rect, toJSON: () => JSON.stringify(rect) };
  });
  return {
    scrolled,
    zoomed,
    floats,
    restore: () => {
      for (const [proto, name, original] of added.splice(0).reverse()) {
        if (original) Object.defineProperty(proto, name, original);
        else delete (proto as Record<string, unknown>)[name];
      }
    },
  };
}
