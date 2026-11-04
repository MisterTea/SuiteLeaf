import {
  createUniver,
  defaultTheme,
  LocaleType,
  mergeLocales,
  UserManagerService,
  type IWorkbookData,
} from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import CoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import { UniverSheetsDrawingPreset } from "@univerjs/preset-sheets-drawing";
import DrawingEnUS from "@univerjs/preset-sheets-drawing/locales/en-US";
import { UniverSheetsFilterPreset } from "@univerjs/preset-sheets-filter";
import FilterEnUS from "@univerjs/preset-sheets-filter/locales/en-US";
import { UniverSheetsSortPreset } from "@univerjs/preset-sheets-sort";
import SortEnUS from "@univerjs/preset-sheets-sort/locales/en-US";
import { UniverSheetsFindReplacePreset } from "@univerjs/preset-sheets-find-replace";
import FindEnUS from "@univerjs/preset-sheets-find-replace/locales/en-US";
import { UniverSheetsDataValidationPreset } from "@univerjs/preset-sheets-data-validation";
import ValidationEnUS from "@univerjs/preset-sheets-data-validation/locales/en-US";
import { UniverSheetsConditionalFormattingPreset } from "@univerjs/preset-sheets-conditional-formatting";
import ConditionalEnUS from "@univerjs/preset-sheets-conditional-formatting/locales/en-US";
import { UniverSheetsThreadCommentPreset } from "@univerjs/preset-sheets-thread-comment";
import CommentEnUS from "@univerjs/preset-sheets-thread-comment/locales/en-US";
import { UniverSheetsNotePreset } from "@univerjs/preset-sheets-note";
import NoteEnUS from "@univerjs/preset-sheets-note/locales/en-US";
import type { SheetFile } from "@suiteleaf/core";
import { shortcut } from "./sheet-editor-util";

/** Starts Univer on the grid container with the sheet presets and SuiteLeaf's English strings. */
export function createSheetUniver(container: HTMLElement, isDark: boolean) {
  const { univer, univerAPI } = createUniver({
    // The light palette's dark tokens stay dark under univer-dark. The dark
    // palette's gray-900 is near white, which left black text inverted to
    // white on a white grid. Dark mode inverts the default black text to white.
    theme: defaultTheme,
    darkMode: isDark,
    locale: LocaleType.EN_US,
    locales: {
      [LocaleType.EN_US]: mergeLocales(
        CoreEnUS,
        DrawingEnUS,
        FilterEnUS,
        SortEnUS,
        FindEnUS,
        ValidationEnUS,
        ConditionalEnUS,
        CommentEnUS,
        NoteEnUS,
        // mergeLocales only merges top-level keys, so keep the rest of Univer's ui strings.
        {
          ui: {
            ...CoreEnUS.ui,
            clipboard: {
              ...CoreEnUS.ui.clipboard,
              authentication: {
                title: "Clipboard access blocked",
                content: `Use ${shortcut("C")}, ${shortcut("X")} and ${shortcut("V")} to copy, cut and paste.`,
              },
            },
          },
        },
      ),
    },
    presets: [
      UniverSheetsCorePreset({
        container,
        header: true,
        toolbar: false,
      }),
      UniverSheetsDrawingPreset(),
      UniverSheetsFilterPreset(),
      UniverSheetsSortPreset(),
      UniverSheetsFindReplacePreset(),
      UniverSheetsDataValidationPreset(),
      UniverSheetsConditionalFormattingPreset(),
      UniverSheetsThreadCommentPreset(),
      UniverSheetsNotePreset(),
    ],
  });
  return { univer, univerAPI };
}

export type SheetUniver = ReturnType<typeof createSheetUniver>["univer"];
export type SheetUniverAPI = ReturnType<typeof createSheetUniver>["univerAPI"];
export type SheetWorkbook = ReturnType<SheetUniverAPI["createWorkbook"]>;

export function keepFieldFocusWhileStarting(
  container: HTMLElement,
  startingUp: { current: boolean },
) {
  let touched = false;
  const touch = () => {
    touched = true;
  };
  const keep = (e: FocusEvent) => {
    const from = e.relatedTarget,
      to = e.target;
    if (
      startingUp.current &&
      !touched &&
      from instanceof HTMLElement &&
      from.isConnected &&
      !container.contains(from) &&
      from.matches("input, textarea, select, [contenteditable='true']") &&
      to instanceof HTMLElement &&
      !!to.closest('[data-u-comp="editor"]')
    )
      from.focus();
  };
  container.addEventListener("pointerdown", touch, true);
  document.addEventListener("focusin", keep, true);
  return () => {
    container.removeEventListener("pointerdown", touch, true);
    document.removeEventListener("focusin", keep, true);
  };
}

export function addCommentAuthors(
  workbook: SheetWorkbook,
  users: UserManagerService,
  me: { userID: string },
) {
  // Authors from other devices are unknown here; without a profile Univer
  // hides their name and the reply-to button.
  for (const thread of workbook.getComments())
    for (const comment of [thread, ...(thread.getReplies() ?? [])]) {
      const { personId, authorName } = comment.getCommentData();
      if (personId && personId !== me.userID && !users.getUser(personId))
        users.addUser({
          userID: personId,
          name: authorName || "Anonymous",
          avatar: "",
        });
    }
}

export async function hydrateSheetImages({
  workbook,
  univerAPI,
  content,
  hydratedImageIds,
  isDisposed,
}: {
  workbook: SheetWorkbook;
  univerAPI: SheetUniverAPI;
  content: { current: SheetFile["content"] };
  hydratedImageIds: Set<string>;
  isDisposed: () => boolean;
}) {
    for (const image of content.current.images ?? []) {
      if (isDisposed()) return;
      const sheet = workbook.getSheetBySheetId(image.sheetId);
      if (!sheet) continue;
      if (sheet.getImageById(image.id)) {
        hydratedImageIds.add(image.id);
        continue;
      }
      const config = (content.current.workbook as unknown as IWorkbookData)
        .sheets[image.sheetId];
      const span = (axis: "row" | "column", from: number, to: number) => {
        let sum = 0;
        for (let index = from; index < to; index++) {
          if (axis === "column") {
            const column = config.columnData?.[index];
            if (column?.hd === 1) continue;
            sum += column?.w ?? config.defaultColumnWidth ?? 100;
          } else {
            const row = config.rowData?.[index];
            if (row?.hd === 1) continue;
            sum += row?.h ?? config.defaultRowHeight ?? 24;
          }
        }
        return sum;
      };
      const width = image.to
        ? span("column", image.column, image.to.column) +
          image.to.offsetX -
          image.offsetX
        : image.width;
      const height = image.to
        ? span("row", image.row, image.to.row) +
          image.to.offsetY -
          image.offsetY
        : image.height;
      const builder = sheet
        .newOverGridImage()
        .setSource(image.src, univerAPI.Enum.ImageSourceType.BASE64)
        .setColumn(image.column)
        .setRow(image.row)
        .setColumnOffset(image.offsetX)
        .setRowOffset(image.offsetY)
        .setWidth(width)
        .setHeight(height)
        .setAnchorType(image.anchorType as any);
      if (image.to && image.anchorType === "1") {
        builder.setPlacement({
          kind: univerAPI.Enum.SheetDrawingAnchorType.Both,
          from: {
            row: image.row,
            column: image.column,
            rowOffset: image.offsetY,
            columnOffset: image.offsetX,
          },
          to: {
            row: image.to.row,
            column: image.to.column,
            rowOffset: image.to.offsetY,
            columnOffset: image.to.offsetX,
          },
        });
      } else if (image.anchorType === "1") {
        // Grouped VML children use absolute offsets from A1. Normalize
        // those bounds into cell markers before cell sizes can change.
        const markerAt = (axis: "row" | "column", position: number) => {
          let index = 0;
          while (
            index <
            (axis === "row"
              ? (config.rowCount ?? 1000)
              : (config.columnCount ?? 26)) -
              1
          ) {
            const size = span(axis, index, index + 1);
            if (size > 0 && position < size) break;
            position -= size;
            index++;
          }
          return { index, offset: position };
        };
        const left = span("column", 0, image.column) + image.offsetX;
        const top = span("row", 0, image.row) + image.offsetY;
        const fromColumn = markerAt("column", left);
        const fromRow = markerAt("row", top);
        const toColumn = markerAt("column", left + width);
        const toRow = markerAt("row", top + height);
        builder.setPlacement({
          kind: univerAPI.Enum.SheetDrawingAnchorType.Both,
          from: {
            row: fromRow.index,
            column: fromColumn.index,
            rowOffset: fromRow.offset,
            columnOffset: fromColumn.offset,
          },
          to: {
            row: toRow.index,
            column: toColumn.index,
            rowOffset: toRow.offset,
            columnOffset: toColumn.offset,
          },
        });
      }
      const built = await builder.buildAsync();
      if (isDisposed()) return;
      sheet.insertImages([{ ...built, drawingId: image.id }]);
      hydratedImageIds.add(image.id);
    }
}

export async function restoreLocalPermissions(
  workbook: SheetWorkbook,
  univerAPI: SheetUniverAPI,
) {
  for (const sheet of workbook.getSheets()) {
    const permission = sheet.getWorksheetPermission();
    if (sheet.getCustomMetadata()?.suiteleafProtection?.sheet) {
      if (!permission.isProtected()) await permission.protect();
      await permission.setReadOnly();
    }
    const rules = await permission.listRangeProtectionRules({
      ignoreCollaborators: true,
    });
    for (const rule of rules) {
      await rule.setPoint(univerAPI.Enum.RangePermissionPoint.View, true);
      await rule.setPoint(
        univerAPI.Enum.RangePermissionPoint.Delete,
        true,
      );
      await rule.setPoint(
        univerAPI.Enum.RangePermissionPoint.ManageCollaborator,
        true,
      );
      await rule.setPoint(
        univerAPI.Enum.RangePermissionPoint.Edit,
        false,
      );
    }
  }
}

/** Places imported Excel charts from their cell anchors once column widths are known. */
export function resolveExcelChartAnchors(content: { current: SheetFile["content"] }) {
  for (const c of content.current.charts) {
    if (!c.excel || c.excel.anchorResolved) continue;
    const sheet = (content.current.workbook as unknown as IWorkbookData)
      .sheets[c.sheetId];
    const a = c.excel.anchor;
    const x = (column: number, offset: number) =>
      Array.from(
        { length: column },
        (_, i) =>
          sheet.columnData?.[i]?.w ?? sheet.defaultColumnWidth ?? 100,
      ).reduce((sum, v) => sum + v, 0) + offset;
    const y = (row: number, offset: number) =>
      Array.from(
        { length: row },
        (_, i) => sheet.rowData?.[i]?.h ?? sheet.defaultRowHeight ?? 24,
      ).reduce((sum, v) => sum + v, 0) + offset;
    c.x = x(a.fromColumn, a.fromColumnOffset);
    c.y = y(a.fromRow, a.fromRowOffset);
    c.width = x(a.toColumn, a.toColumnOffset) - c.x;
    c.height = y(a.toRow, a.toRowOffset) - c.y;
    c.excel.anchorResolved = true;
  }
}
