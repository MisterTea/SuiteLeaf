import { IUndoRedoService, IUniverInstanceService, LocaleType, Univer, UniverInstanceType, type IWorkbookData, type IWorksheetData } from "@univerjs/core";
import { FUniver } from "@univerjs/core/facade";
import { FormulaCalculationSessionService, UniverFormulaEnginePlugin } from "@univerjs/engine-formula";
import { UniverSheetsPlugin } from "@univerjs/sheets";
import { UniverSheetsNumfmtPlugin } from "@univerjs/sheets-numfmt";
import { UniverDataValidationPlugin } from "@univerjs/data-validation";
import { UniverSheetsDataValidationPlugin } from "@univerjs/sheets-data-validation";
import { UniverSheetsFilterPlugin } from "@univerjs/sheets-filter";
import { UniverSheetsConditionalFormattingPlugin } from "@univerjs/sheets-conditional-formatting";
import { UniverThreadCommentPlugin } from "@univerjs/thread-comment";
import { UniverSheetsThreadCommentPlugin } from "@univerjs/sheets-thread-comment";
import { UniverSheetsNotePlugin } from "@univerjs/sheets-note";
import SheetsEnUS from "@univerjs/sheets/locale/en-US";
import "@univerjs/sheets/facade";
import "@univerjs/engine-formula/facade";
import "@univerjs/sheets-numfmt/facade";
import "@univerjs/sheets-data-validation/facade";
import "@univerjs/sheets-filter/facade";
import "@univerjs/sheets-conditional-formatting/facade";
import "@univerjs/sheets-thread-comment/facade";
import "@univerjs/sheets-note/facade";
import { vi } from "vitest";
import type { SheetFile } from "@suiteleaf/core";
import type { SuiteTool } from "../apps/web/src/ai/host";
import type { SheetsAgentContext } from "../apps/web/src/ai/tools/sheet-context";

export type Cells = (string | number | boolean | null)[][];

/** One sheet of rows, written from A1 (or the given top-left). Strings starting with = are formulas. */
export type SheetSpec = { name: string; rows: Cells; id?: string };

function cellData(rows: Cells) {
  const data: Record<number, Record<number, { v?: unknown; f?: string }>> = {};
  rows.forEach((row, r) =>
    row.forEach((value, c) => {
      if (value === null || value === "") return;
      (data[r] ??= {})[c] = typeof value === "string" && value.startsWith("=") ? { f: value } : { v: value };
    }),
  );
  return data;
}

let live: Univer | null = null;

/**
 * A headless Univer workbook with SuiteLeaf's sheet plugins, for driving the assistant's sheet tools.
 * The previous one is disposed: two live instances stop recalculating formulas.
 */
export function makeWorkbook(sheets: SheetSpec[], bookId = "book-1") {
  live?.dispose();
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: SheetsEnUS as never } });
  live = univer;
  univer.registerPlugin(UniverFormulaEnginePlugin);
  univer.registerPlugin(UniverSheetsPlugin);
  univer.registerPlugin(UniverSheetsNumfmtPlugin);
  univer.registerPlugin(UniverDataValidationPlugin);
  univer.registerPlugin(UniverSheetsDataValidationPlugin);
  univer.registerPlugin(UniverSheetsFilterPlugin);
  univer.registerPlugin(UniverSheetsConditionalFormattingPlugin);
  univer.registerPlugin(UniverThreadCommentPlugin);
  univer.registerPlugin(UniverSheetsThreadCommentPlugin);
  univer.registerPlugin(UniverSheetsNotePlugin);
  const ids = sheets.map((sheet, i) => sheet.id ?? `s${i + 1}`);
  const data: Partial<IWorkbookData> = {
    id: bookId,
    sheetOrder: ids,
    sheets: Object.fromEntries(
      sheets.map((sheet, i) => [
        ids[i],
        { id: ids[i], name: sheet.name, rowCount: 200, columnCount: 26, cellData: cellData(sheet.rows) as IWorksheetData["cellData"] },
      ]),
    ),
  };
  univer.createUnit(UniverInstanceType.UNIVER_SHEET, data);
  const api = FUniver.newAPI(univer);
  const book = api.getActiveWorkbook()!;
  const injector = (univer as unknown as { __getInjector: () => { get: (t: unknown) => any } }).__getInjector();
  // Undo acts on the focused workbook, which the editor's grid would be.
  injector.get(IUniverInstanceService).focusUnit(bookId);
  return { univer, api, book, injector };
}

/** Waits for a recalculation started by the last write, or briefly when none starts. */
export function settleFormulas(injector: { get: (token: unknown) => any }) {
  return () =>
    (injector.get(FormulaCalculationSessionService).waitForLatestApplied(5000, 60) as Promise<void>).catch(() => {});
}

export type Harness = ReturnType<typeof makeHarness>;

/** A workbook plus the context the Sheets editor lends the agent, with the editor's panels stubbed. */
export function makeHarness(sheets: SheetSpec[], options: { content?: Partial<SheetFile["content"]> } = {}) {
  const { univer, api, book, injector } = makeWorkbook(sheets);
  // The note popup and comment card are UI operations; headless Univer has no UI to open.
  const execute = api.executeCommand.bind(api);
  const popups: string[] = [];
  api.executeCommand = ((id: string, ...rest: never[]) => {
    if (/^sheet\.operation\.(add-note-popup|show-comment-modal)$/.test(id)) {
      popups.push(id);
      return Promise.resolve(true);
    }
    return execute(id, ...rest);
  }) as typeof api.executeCommand;
  const content = {
    workbook: { id: "book-1", sheetOrder: [], sheets: {} },
    charts: [],
    pivots: [],
    ...options.content,
  } as unknown as SheetFile["content"];
  const ctx: SheetsAgentContext = {
    api,
    book,
    title: "Budget",
    content: () => content,
    persist: vi.fn(),
    settle: settleFormulas(injector),
    openPanel: vi.fn(),
    submitPanel: vi.fn(async () => {}),
    refreshCharts: vi.fn(),
    copyPivot: vi.fn(),
    showSort: vi.fn(),
    sort: vi.fn(),
    freeze: vi.fn(),
    groupRows: vi.fn(() => ({ ok: false as const, message: "Row groups are not ready." })),
    showOnlyRow: vi.fn(() => ({ ok: false as const, message: "Row groups are not ready." })),
    groupColumns: vi.fn(() => ({ ok: false as const, message: "Column groups are not ready." })),
    showOnlyColumn: vi.fn(() => ({ ok: false as const, message: "Column groups are not ready." })),
    insertCheckbox: vi.fn(),
    exportAs: vi.fn(async () => undefined),
    setAuthor: vi.fn(),
    signature: () => "",
    undoCount: () => injector.get(IUndoRedoService).getUndoRedoStatus(book.getId()).undos ?? 0,
  };
  return { univer, api, book, ctx, content, popups, sheet: () => book.getActiveSheet() };
}

/** Calls a tool the way the agent does: its `prepare` first, then `execute`, returning the text. */
export async function runTool(tools: SuiteTool[], name: string, args: Record<string, unknown> = {}) {
  const found = tools.find((item) => item.name === name);
  if (!found) throw new Error(`No tool ${name}`);
  const prepared = found.prepare ? found.prepare(args) : args;
  const out = await found.execute(prepared as never);
  return typeof out === "string" ? out : out.text;
}

/** A fresh, working localStorage: Node's own global shadows jsdom's and has no storage file. */
export function freshLocalStorage() {
  const store = new Map<string, string>();
  const storage: Storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, String(value)),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  if (typeof window !== "undefined" && window !== (globalThis as unknown))
    Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  return storage;
}

/** The values of a range on the active sheet, as the grid shows them. */
export const valuesOf = (h: { sheet: () => any }, range: string) => h.sheet().getRange(range).getValues() as unknown[][];
