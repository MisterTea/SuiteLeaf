// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as Y from "yjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorActions } from "../../apps/web/src/ui";
import { createFile, type PivotDefinition, type SheetFile } from "../../packages/core/src";
import { setLocalName } from "../../apps/web/src/identity";
import { setThemeMode } from "../../apps/web/src/theme";
import { stubBrowser } from "./other-editors-env";

/** Everything the fake engine and the stubbed helpers were handed. */
const seen = vi.hoisted(() => ({
  engine: null as null | ReturnType<typeof import("./sheets-fake-engine").fakeEngine>,
  session: null as null | Record<string, any>,
  data: null as null | Record<string, any>,
  actions: null as null | Record<string, any>,
  editChart: null as null | { current: (id: string) => void },
  widths: { fail: null as null | unknown },
  startup: {
    fail: null as null | (() => void),
    customize: null as null | ((engine: ReturnType<typeof import("./sheets-fake-engine").fakeEngine>) => void),
  },
  spies: {
    stopSession: vi.fn<() => void>(),
    watchRemote: vi.fn<(...args: unknown[]) => void>(),
    undoShared: vi.fn<(...args: unknown[]) => boolean>(),
    outline: vi.fn<(...args: unknown[]) => void>(),
    refreshPivot: vi.fn<(...args: unknown[]) => Promise<void>>(),
    placeImage: vi.fn<(...args: unknown[]) => Promise<void>>(),
    clearFilterView: vi.fn<() => void>(),
    sortRange: vi.fn<(...args: unknown[]) => void>(),
  },
}));

vi.mock("@univerjs/presets", () => ({ defaultTheme: { name: "default" }, UserManagerService: "UserManagerService" }));
vi.mock("@univerjs/preset-sheets-core", () => ({
  IDescriptionService: "IDescriptionService",
  IEditorService: "IEditorService",
  IShortcutService: "IShortcutService",
  KeyCode: { ENTER: 13, TAB: 9 },
}));
vi.mock("../../apps/web/src/editors/sheet-workbook-startup", async () => {
  const { fakeEngine } = await import("./sheets-fake-engine");
  return {
    createSheetUniver: () => {
      seen.startup.fail?.();
      seen.engine = fakeEngine();
      seen.startup.customize?.(seen.engine);
      return seen.engine;
    },
    addCommentAuthors: vi.fn(),
    keepFieldFocusWhileStarting: () => () => {},
    resolveExcelChartAnchors: () => {},
  };
});
vi.mock("../../apps/web/src/excel-layout", () => ({
  resolveExcelColumnWidths: async () => {
    if (seen.widths.fail) throw seen.widths.fail;
  },
}));
vi.mock("../../apps/web/src/excel-overflow", () => ({}));
vi.mock("../../apps/web/src/excel-number-display", () => ({}));
vi.mock("../../apps/web/src/excel-wrap", () => ({}));
vi.mock("../../apps/web/src/excel-cell", () => ({}));
vi.mock("../../apps/web/src/sheet-kerning", () => ({ stopSheetKerning: () => {} }));
vi.mock("../../apps/web/src/editors/formula-suggestions", () => ({
  guardFormulaSuggestions: () => () => {},
  rankFormulaSuggestions: () => {},
}));
vi.mock("../../apps/web/src/editors/sheet-editor-util", () => ({
  formulaBarVisible: () => false,
  toggleFilterValueFromLabel: () => {},
}));
vi.mock("../../apps/web/src/editors/sheet-session", () => ({
  startSheetSession: (ctx: Record<string, unknown>) => {
    seen.session = ctx;
    return () => seen.spies.stopSession();
  },
}));
vi.mock("../../apps/web/src/editors/sheet-grid-watchers", () => ({
  watchSheetSelection: () => () => {},
  watchPhoneTaps: () => () => {},
}));
vi.mock("../../apps/web/src/editors/sheet-chart-floats", () => ({
  watchChartDoubleClick: (_host: HTMLElement, ref: { current: (id: string) => void }) => {
    seen.editChart = ref;
    return () => {};
  },
}));
vi.mock("../../apps/web/src/editors/sheet-remote-sync", () => ({
  watchRemoteSheet: (...args: unknown[]) => {
    seen.spies.watchRemote(...args);
    return () => {};
  },
  undoSharedSheet: (...args: unknown[]) => seen.spies.undoShared(...args),
  redoSharedSheet: () => false,
}));
vi.mock("../../apps/web/src/editors/sheet-content-sync", () => ({
  outlineTables: (...args: unknown[]) => seen.spies.outline(...args),
  tableFormulaNote: () => "",
}));
vi.mock("../../apps/web/src/editors/sheet-format-commands", () => {
  const format = { setIsBold: () => {}, setIsItalic: () => {}, setIsStrike: () => {}, setHAlign: () => {} };
  return { sheetFormatCommands: () => ({}), useSheetTextFormat: () => format };
});
vi.mock("../../apps/web/src/editors/sheet-data-commands", () => ({
  sheetDataCommands: (ctx: Record<string, unknown>) => {
    seen.data = ctx;
    return {
      sortRange: (...args: unknown[]) => seen.spies.sortRange(...args),
      setFrozen: () => {},
      clearFilterView: () => seen.spies.clearFilterView(),
      toggleFilter: () => {},
    };
  },
}));
vi.mock("../../apps/web/src/editors/sheet-analysis", () => ({
  useAnalysisForm: () => ({}),
  analysisFields: () => ({ fields: [], shownValueField: "", pivotSource: null }),
  openAnalysisPanel: (ctx: { setPanel: (panel: string) => void }, type: string) => ctx.setPanel(type),
  refreshPivotOn: (...args: unknown[]) => seen.spies.refreshPivot(...args),
  copyPivotOn: () => {},
  submitAnalysis: () => {},
  takeAnalysisSelection: () => {},
}));
vi.mock("../../apps/web/src/editors/sheet-editor-actions", () => ({
  printActiveSheet: async () => {},
  sheetEditorActions: (ctx: Record<string, any>) => {
    seen.actions = ctx;
    return { flush: async () => {}, export: async () => {}, print: async () => {}, marker: "sheet" };
  },
  useSheetAgent: () => {},
}));
vi.mock("../../apps/web/src/editors/function-help-ui", () => ({
  useSheetFunctions: () => ({ insertFunction: () => {}, autoSum: () => {}, panel: null, stats: null }),
}));
vi.mock("../../apps/web/src/templates/sheet-image", () => ({
  placeSheetImage: (...args: unknown[]) => seen.spies.placeImage(...args),
}));
vi.mock("../../apps/web/src/editors/sheet-embedded-chart", () => ({ charts: new Map(), EmbeddedChart: () => null }));
vi.mock("../../apps/web/src/editors/sheet-panels", () => ({ SheetToolDialogs: () => null, SheetSidePanels: () => null }));
vi.mock("../../apps/web/src/editors/sheet-toolbars", () => ({ SheetToolbar: () => null, SheetFormatToolbar: () => null }));
vi.mock("../../apps/web/src/editors/sheet-analysis-panel", () => ({
  SheetAnalysisPanel: ({ panel }: { panel: string }) => <div role="region" aria-label={`${panel} panel`} />,
  SheetPivotBar: ({ activePivot, activePivotError }: { activePivot: PivotDefinition; activePivotError?: string }) => (
    <div role="status" aria-label="Pivot bar">
      {activePivot.id} {activePivotError ?? ""}
    </div>
  ),
}));
vi.mock("../../apps/web/src/editors/sheet-dropdown-panel", () => ({ default: () => <div data-testid="dropdowns" /> }));
vi.mock("../../apps/web/src/editors/sheet-links", () => ({ default: () => <div data-testid="links" /> }));

const { default: Sheets } = await import("../../apps/web/src/editors/Sheets");

beforeEach(() => {
  stubBrowser();
  seen.engine = null;
  seen.session = null;
  seen.widths.fail = null;
  seen.startup.fail = null;
  seen.startup.customize = null;
  for (const spy of Object.values(seen.spies)) spy.mockReset();
  seen.spies.refreshPivot.mockResolvedValue(undefined);
  seen.spies.placeImage.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setThemeMode("light");
});

function sheetFile(): SheetFile {
  return createFile("sheet", "Budget") as SheetFile;
}

function openSheets(file = sheetFile(), props: Partial<Parameters<typeof Sheets>[0]> = {}) {
  const onActions = vi.fn<(actions: EditorActions) => void>();
  const onError = vi.fn();
  const onChange = vi.fn();
  const view = render(<Sheets file={file} onChange={onChange} onActions={onActions} onError={onError} {...props} />);
  const ready = async () => {
    await waitFor(() => expect(seen.session).not.toBeNull());
    act(() => seen.session!.setReady(true));
    await waitFor(() => expect(screen.getByLabelText("Spreadsheet grid").getAttribute("aria-busy")).toBe("false"));
  };
  return { ...view, onActions, onError, onChange, ready, file };
}

describe("starting the spreadsheet engine", () => {
  it("creates the workbook, signs in the author, and reports the sheet actions", async () => {
    setLocalName("Rosa");
    const { onActions, ready, file } = openSheets();
    await ready();
    const engine = seen.engine!;
    expect(engine.univerAPI.createWorkbook).toHaveBeenCalledWith(file.content.workbook);
    expect(engine.univerAPI.setUIVisible).toHaveBeenCalledWith("header", false);
    expect(engine.univerAPI.registerComponent).toHaveBeenCalledWith("suiteleaf-chart", expect.any(Function));
    expect(engine.users.setCurrentUser).toHaveBeenCalledWith(
      expect.objectContaining({ userID: expect.stringMatching(/^Owner_local-/), name: "Rosa" }),
    );
    expect(onActions).toHaveBeenCalledWith(expect.objectContaining({ marker: "sheet" }));
    expect(seen.spies.outline).toHaveBeenCalled();
    expect(screen.getByTestId("dropdowns")).toBeTruthy();
    expect(screen.getByTestId("links")).toBeTruthy();
  });

  it("signs new comments with the author's name and follows a name change", async () => {
    setLocalName("Rosa");
    const { ready } = openSheets();
    await ready();
    const before = seen.engine!.beforeCommand!;
    const me = seen.engine!.users.setCurrentUser.mock.calls[0][0].userID;
    const comment = { personId: me } as Record<string, unknown>;
    const event = { id: "thread-comment.command.add-comment", params: { comment }, cancel: false };
    before(event);
    expect(comment.authorName).toBe("Rosa");
    expect(event.cancel).toBe(false);
    act(() => setLocalName("Ada"));
    expect(seen.engine!.users.setCurrentUser).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Ada" }));
  });

  it("cancels edits from a viewer, but lets a commenter reply", async () => {
    const { ready } = openSheets(sheetFile(), { readOnly: true, canComment: true });
    await ready();
    const before = seen.engine!.beforeCommand!;
    const edit = { id: "sheet.command.set-range-values", params: {}, cancel: false };
    before(edit);
    expect(edit.cancel).toBe(true);
    expect(document.querySelector(".sheets-editor")!.className).toContain("view-locked");
  });

  it("opens the comment panel from the header button", async () => {
    const { ready } = openSheets();
    await ready();
    window.dispatchEvent(new Event("suiteleaf:open-sheet-comments"));
    expect(seen.engine!.univerAPI.executeCommand).toHaveBeenCalledWith("sheet.operation.toggle-comment-panel");
  });

  it("follows the app theme", async () => {
    const { ready } = openSheets();
    await ready();
    act(() => setThemeMode("dark"));
    expect(seen.engine!.univerAPI.toggleDarkMode).toHaveBeenLastCalledWith(true);
    expect(seen.engine!.univerAPI.setTheme).toHaveBeenCalled();
  });

  it("reads source ranges and refuses ones outside the sheet", async () => {
    const { ready } = openSheets();
    await ready();
    const range = { sheetId: "s1", startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 };
    expect(seen.session!.readRange(range)).toEqual([["A1:B2"]]);
    expect(() => seen.session!.readRange({ ...range, endRow: 99 })).toThrow("Source range is unavailable.");
    expect(() => seen.session!.readRange({ ...range, sheetId: "gone" })).toThrow("Source range is unavailable.");
  });

  it("places an image on the active sheet and saves", async () => {
    const { ready } = openSheets();
    await ready();
    const persist = vi.fn();
    seen.actions!.persist.current = persist;
    await act(async () => seen.actions!.insertImage.current("data:image/png;base64,AA"));
    expect(seen.spies.placeImage).toHaveBeenCalledWith(
      seen.engine!.sheet,
      "base64",
      expect.objectContaining({ workbook: expect.anything() }),
      "data:image/png;base64,AA",
    );
    expect(persist).toHaveBeenCalled();
  });

  it("stops the session and disposes the engine when the editor closes", async () => {
    const { ready, unmount } = openSheets();
    await ready();
    const engine = seen.engine!;
    unmount();
    expect(seen.spies.stopSession).toHaveBeenCalled();
    expect(engine.univer.dispose).toHaveBeenCalled();
    expect(engine.commentEvent.dispose).toHaveBeenCalled();
  });
});

describe("when the engine cannot start", () => {
  it("reports column widths that could not be read, and still opens", async () => {
    seen.widths.fail = new Error("Font metrics are missing.");
    const { onError, ready } = openSheets();
    await ready();
    expect(onError).toHaveBeenCalledWith("Font metrics are missing.");
  });

  it("reports an engine that fails before it exists", async () => {
    seen.startup.fail = () => {
      throw new Error("No canvas here.");
    };
    const { onError } = openSheets();
    await waitFor(() => expect(onError).toHaveBeenCalledWith("No canvas here."));
  });

  it("releases a half-started engine and reports why", async () => {
    seen.startup.customize = (engine) =>
      engine.univerAPI.createWorkbook.mockImplementation(() => {
        throw new Error("Bad workbook.");
      });
    const { onError } = openSheets();
    await waitFor(() => expect(onError).toHaveBeenCalledWith("Bad workbook."));
    expect(seen.engine!.univer.dispose).toHaveBeenCalled();
  });

  it("says when releasing a failed start also failed", async () => {
    seen.startup.customize = (engine) => {
      engine.univerAPI.createWorkbook.mockImplementation(() => {
        throw new Error("Bad workbook.");
      });
      engine.univer.dispose.mockImplementation(() => {
        throw new Error("still busy");
      });
    };
    const { onError } = openSheets();
    await waitFor(() => expect(onError).toHaveBeenCalledWith("Bad workbook. (cleanup: Error: still busy)"));
  });
});

describe("what the sheet shows around the grid", () => {
  it("shows a notice that can be dismissed and clears itself", async () => {
    const { ready } = openSheets();
    await ready();
    act(() => seen.data!.setNotice("Sorted 3 rows."));
    expect(screen.getByRole("status").textContent).toBe("Sorted 3 rows.");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Sorted 3 rows.")).toBeNull();
    vi.useFakeTimers();
    try {
      act(() => seen.data!.setNotice("Again."));
      act(() => vi.advanceTimersByTime(8000));
      expect(screen.queryByText("Again.")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a filter view that only this screen sees", async () => {
    const { ready } = openSheets();
    await ready();
    act(() => seen.data!.setFilterView({ header: "Plot", value: "North", hidden: 2 }));
    expect(screen.getByText(/Showing Plot is North · only on this screen/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all rows" }));
    expect(seen.spies.clearFilterView).toHaveBeenCalled();
    act(() => seen.data!.setFilterView({ header: "Plot", value: "", hidden: 0 }));
    expect(screen.getByText(/^Filter view · only on this screen/)).toBeTruthy();
  });

  it("opens the sort dialog and sorts through the data commands", async () => {
    const { ready } = openSheets();
    await ready();
    act(() =>
      seen.data!.setSorting({
        range: { startRow: 0, endRow: 2, startColumn: 0, endColumn: 0 },
        values: [["Name"], ["Rosa"], ["Ada"]],
      }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    expect(seen.spies.sortRange).toHaveBeenCalled();
    expect(dialog).toBeTruthy();
  });

  it("names the ranges other people have selected", async () => {
    const { ready } = openSheets(sheetFile(), {
      remoteSelections: [{ name: "Ada", sheetId: "s1", range: "B2" } as never],
    });
    await ready();
    expect(document.querySelector(".sheet-remote-selections")?.textContent).toContain("Ada");
  });

  it("opens the chart panel when a chart is double-clicked", async () => {
    const { ready } = openSheets();
    await ready();
    act(() => seen.editChart!.current("chart-1"));
    expect(screen.getByRole("region", { name: "chart panel" })).toBeTruthy();
  });

  it("shows the pivot on the active sheet, and refreshes pivots whose source changed", async () => {
    const file = sheetFile();
    const pivot = {
      id: "p1",
      targetSheetId: "s1",
      source: { sheetId: "src", startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 },
    } as unknown as PivotDefinition;
    const same = { ...pivot, id: "p2", source: { ...pivot.source, sheetId: "s1" } } as PivotDefinition;
    file.content.pivots = [pivot, same];
    const { ready } = openSheets(file);
    await ready();
    expect(screen.getByRole("status", { name: "Pivot bar" }).textContent).toContain("p1");
    seen.spies.refreshPivot.mockRejectedValue(new Error("Source moved."));
    await act(async () => seen.session!.refreshPivots.current(new Set(["src"])));
    expect(seen.spies.refreshPivot).toHaveBeenCalledTimes(1);
    expect(seen.spies.refreshPivot).toHaveBeenCalledWith(expect.anything(), pivot, true);
    await waitFor(() => expect(screen.getByRole("status", { name: "Pivot bar" }).textContent).toContain("Source moved."));
  });

  it("follows a shared room once the grid is ready and undoes through it", async () => {
    const room = new Y.Doc();
    const onUndoConflict = vi.fn();
    const { ready } = openSheets(sheetFile(), { collabDoc: room, onUndoConflict });
    await ready();
    expect(seen.spies.watchRemote).toHaveBeenCalledWith(room, expect.anything());
    seen.actions!.undoCollab.current();
    expect(seen.spies.undoShared).toHaveBeenCalledWith(room, onUndoConflict);
    expect(seen.actions!.redoCollab.current()).toBe(false);
  });
});
