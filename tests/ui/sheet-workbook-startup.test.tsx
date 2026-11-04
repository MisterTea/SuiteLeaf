// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { SheetFile } from "@suiteleaf/core";

const created = vi.hoisted(() => {
  // The filter preset builds its button icons when it loads. jsdom has no canvas paths.
  (globalThis as { Path2D?: unknown }).Path2D ??= class {};
  return { options: null as any };
});
vi.mock("@univerjs/presets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@univerjs/presets")>()),
  createUniver: (options: unknown) => {
    created.options = options;
    return { univer: "univer", univerAPI: "api" };
  },
}));

const {
  addCommentAuthors,
  createSheetUniver,
  hydrateSheetImages,
  keepFieldFocusWhileStarting,
  resolveExcelChartAnchors,
  restoreLocalPermissions,
} = await import("../../apps/web/src/editors/sheet-workbook-startup");
const { headlessWorkbook } = await import("../sheet-editor-univer");

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
});

it("starts Univer on the grid with English strings and SuiteLeaf's clipboard message", () => {
  const container = document.createElement("div");
  expect(createSheetUniver(container, true)).toEqual({ univer: "univer", univerAPI: "api" });
  expect(created.options.darkMode).toBe(true);
  const strings = Object.values(created.options.locales)[0] as any;
  expect(strings.ui.clipboard.authentication.title).toBe("Clipboard access blocked");
  expect(strings.ui.clipboard.authentication.content).toMatch(/copy, cut and paste\.$/);
  expect(created.options.presets.length).toBeGreaterThanOrEqual(9);
});

it("gives focus back to a field the person was typing in while the grid starts", () => {
  const container = document.createElement("div");
  const editor = document.createElement("div");
  editor.dataset.uComp = "editor";
  const inner = document.createElement("textarea");
  editor.append(inner);
  container.append(editor);
  const field = document.createElement("input");
  document.body.append(field, container);
  const startingUp = { current: true };
  const stop = keepFieldFocusWhileStarting(container, startingUp);
  field.focus();
  inner.focus();
  expect(document.activeElement).toBe(field);
  startingUp.current = false;
  inner.focus();
  expect(document.activeElement).toBe(inner);
  startingUp.current = true;
  field.focus();
  container.dispatchEvent(new PointerEvent("pointerdown"));
  inner.focus();
  expect(document.activeElement).toBe(inner);
  stop();
});

it("adds unknown comment authors so their names and replies show", () => {
  const added: unknown[] = [];
  const users = {
    getUser: (id: string) => (id === "known" ? { userID: id } : undefined),
    addUser: (user: unknown) => void added.push(user),
  };
  const comment = (personId: string, authorName = "") => ({ getCommentData: () => ({ personId, authorName }) });
  const workbook = {
    getComments: () => [
      { ...comment("me"), getReplies: () => [comment("ana", "Ana"), comment("known", "K")] },
      { ...comment(""), getReplies: () => undefined },
      { ...comment("ghost"), getReplies: () => [] },
    ],
  };
  addCommentAuthors(workbook as never, users as never, { userID: "me" });
  expect(added).toEqual([
    { userID: "ana", name: "Ana", avatar: "" },
    { userID: "ghost", name: "Anonymous", avatar: "" },
  ]);
});

function imageSheet(existing: string[] = []) {
  const inserted: any[] = [];
  const builds: any[] = [];
  return {
    inserted,
    builds,
    getImageById: (id: string) => (existing.includes(id) ? { id } : null),
    insertImages: (images: unknown[]) => void inserted.push(...images),
    newOverGridImage() {
      const state: Record<string, unknown> = {};
      builds.push(state);
      const builder: any = {};
      for (const name of ["setSource", "setColumn", "setRow", "setColumnOffset", "setRowOffset", "setWidth", "setHeight", "setAnchorType", "setPlacement"])
        builder[name] = (value: unknown) => {
          state[name] = value;
          return builder;
        };
      builder.buildAsync = async () => ({ built: state });
      return builder;
    },
  };
}

it("brings embedded images into the grid with their size, anchors, and markers", async () => {
  const sheet = imageSheet(["already"]);
  const hydrated = new Set<string>();
  const content = {
    current: {
      workbook: {
        sheets: {
          s1: {
            defaultColumnWidth: 100,
            defaultRowHeight: 20,
            columnData: { 1: { w: 50 }, 2: { hd: 1 } },
            rowData: { 1: { h: 40 }, 2: { hd: 1 } },
            rowCount: 10,
            columnCount: 6,
          },
        },
      },
      images: [
        { id: "already", sheetId: "s1" },
        { id: "lost", sheetId: "missing" },
        { id: "fixed", sheetId: "s1", src: "data:a", row: 0, column: 0, offsetX: 1, offsetY: 2, width: 30, height: 40, anchorType: "2" },
        {
          id: "spans",
          sheetId: "s1",
          src: "data:b",
          row: 0,
          column: 0,
          offsetX: 5,
          offsetY: 5,
          anchorType: "1",
          to: { row: 2, column: 2, offsetX: 10, offsetY: 4 },
        },
        { id: "absolute", sheetId: "s1", src: "data:c", row: 0, column: 0, offsetX: 160, offsetY: 30, width: 20, height: 100, anchorType: "1" },
      ],
    } as unknown as SheetFile["content"],
  };
  const univerAPI = { Enum: { ImageSourceType: { BASE64: "base64" }, SheetDrawingAnchorType: { Both: "both" } } };
  await hydrateSheetImages({
    workbook: { getSheetBySheetId: (id: string) => (id === "s1" ? sheet : null) } as never,
    univerAPI: univerAPI as never,
    content,
    hydratedImageIds: hydrated,
    isDisposed: () => false,
  });
  expect([...hydrated]).toEqual(["already", "fixed", "spans", "absolute"]);
  expect(sheet.inserted.map((image) => image.drawingId)).toEqual(["fixed", "spans", "absolute"]);
  const [fixed, spans, absolute] = sheet.builds;
  expect(fixed).toMatchObject({ setSource: "data:a", setWidth: 30, setHeight: 40, setAnchorType: "2" });
  expect(fixed.setPlacement).toBeUndefined();
  expect(spans.setWidth).toBe(100 + 50 + 10 - 5);
  expect(spans.setHeight).toBe(20 + 40 + 4 - 5);
  expect(spans.setPlacement).toEqual({
    kind: "both",
    from: { row: 0, column: 0, rowOffset: 5, columnOffset: 5 },
    to: { row: 2, column: 2, rowOffset: 4, columnOffset: 10 },
  });
  expect(absolute.setPlacement).toEqual({
    kind: "both",
    from: { row: 1, column: 3, rowOffset: 10, columnOffset: 10 },
    to: { row: 6, column: 3, rowOffset: 10, columnOffset: 30 },
  });
});

it("stops bringing in images once the editor closes", async () => {
  const sheet = imageSheet();
  let closed = false;
  const image = { id: "a", sheetId: "s1", src: "x", row: 0, column: 0, offsetX: 0, offsetY: 0, width: 1, height: 1 };
  sheet.newOverGridImage = ((original) =>
    function (this: unknown) {
      closed = true;
      return original.call(sheet);
    })(sheet.newOverGridImage);
  const content = { current: { workbook: { sheets: { s1: {} } }, images: [image, { ...image, id: "b" }] } as never };
  const hydrated = new Set<string>();
  await hydrateSheetImages({
    workbook: { getSheetBySheetId: () => sheet } as never,
    univerAPI: { Enum: { ImageSourceType: {}, SheetDrawingAnchorType: {} } } as never,
    content,
    hydratedImageIds: hydrated,
    isDisposed: () => closed,
  });
  expect(sheet.inserted).toEqual([]);
  expect(hydrated.size).toBe(0);
});

it("restores sheet protection and keeps protected ranges viewable but not editable", async () => {
  const h = headlessWorkbook([
    { id: "s1", custom: { suiteleafProtection: { sheet: true } } },
    { id: "s2" },
  ]);
  dispose = h.dispose;
  const second = h.book().getSheetBySheetId("s2");
  const [rule] = await second
    .getWorksheetPermission()
    .protectRanges([{ ranges: [second.getRange("A1:B2")], options: { name: "Rates" } }]);
  await rule.setPoint(h.api.Enum.RangePermissionPoint.Edit, true);
  await rule.setPoint(h.api.Enum.RangePermissionPoint.View, false);
  await restoreLocalPermissions(h.book(), h.api);
  expect(h.book().getSheetBySheetId("s1").getWorksheetPermission().isProtected()).toBe(true);
  const [restored] = await second.getWorksheetPermission().listRangeProtectionRules({ ignoreCollaborators: true });
  expect(await restored.getPoint(h.api.Enum.RangePermissionPoint.Edit)).toBe(false);
  expect(await restored.getPoint(h.api.Enum.RangePermissionPoint.View)).toBe(true);
  expect(await restored.getPoint(h.api.Enum.RangePermissionPoint.Delete)).toBe(true);
  await restoreLocalPermissions(h.book(), h.api);
  expect(h.book().getSheetBySheetId("s1").getWorksheetPermission().isProtected()).toBe(true);
});

it("places imported Excel charts from their cell anchors once", () => {
  const anchor = { fromColumn: 1, fromColumnOffset: 4, fromRow: 2, fromRowOffset: 3, toColumn: 3, toColumnOffset: 0, toRow: 4, toRowOffset: 6 };
  const content = {
    current: {
      workbook: { sheets: { s1: { columnData: { 0: { w: 60 } }, rowData: { 1: { h: 30 } } }, s2: {} } },
      charts: [
        { id: "a", sheetId: "s1", x: 0, y: 0, width: 1, height: 1, excel: { anchor } },
        { id: "b", sheetId: "s2", x: 0, y: 0, width: 1, height: 1, excel: { anchor } },
        { id: "c", sheetId: "s1", x: 7, y: 7, width: 1, height: 1, excel: { anchor, anchorResolved: true } },
        { id: "d", sheetId: "s1", x: 8, y: 8, width: 1, height: 1 },
      ],
    } as unknown as SheetFile["content"],
  };
  resolveExcelChartAnchors(content);
  const [a, b, c, d] = content.current.charts;
  expect([a.x, a.y, a.width, a.height]).toEqual([64, 24 + 30 + 3, 100 + 100 - 4, 24 + 24 + 6 - 3]);
  expect([b.x, b.y]).toEqual([104, 51]);
  expect(a.excel!.anchorResolved).toBe(true);
  expect([c.x, d.x]).toEqual([7, 8]);
});
