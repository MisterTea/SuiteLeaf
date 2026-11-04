import { Type } from "@earendil-works/pi-ai";
import { ownUndoSteps } from "../guard";
import { tool, ToolError, type SuiteTool } from "../host";
import type { SheetsAgentContext } from "./sheet-context";
import { a1, cellStates, describeCellChanges, usedRange } from "./sheet-cells";
import {
  excelOutlineExportRequest,
  noteOutlineExported,
  OUTLINE_EXPORT,
  printLayoutRequest,
  refuseColumnGroupDetour,
} from "./sheet-requests";
import { refuseSpellingRetype } from "./sheet-spelling";

const UNDO_LIMIT = 50;

/** Switching sheets and exporting the workbook. */
export function sheetWorkbookTools(ctx: SheetsAgentContext): SuiteTool[] {
  const { book } = ctx;
  return [
    tool({
      name: "switch_sheet",
      label: "Switch sheet",
      description: "Go to another sheet (tab) by name, or add a new sheet with that name if add=true.",
      parameters: Type.Object({ name: Type.String(), add: Type.Optional(Type.Boolean()) }),
      target: ({ name }) => [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.trim() === name),
      execute({ name, add }) {
        const sheets = book.getSheets();
        let found = sheets.find((s: any) => s.getSheetName().toLowerCase() === name.toLowerCase());
        if (!found && add) {
          found = book.create(name, 1000, 26);
        }
        if (!found) throw new ToolError(`No sheet is called "${name}". Sheets: ${sheets.map((s: any) => s.getSheetName()).join(", ")}.`);
        book.setActiveSheet(found.getSheetId());
        ctx.persist();
        return `On sheet "${found.getSheetName()}". Used range ${a1(usedRange(found))}.`;
      },
    }),
    tool({
      name: "export_spreadsheet",
      label: "Export",
      description:
        'Export a copy in another format, for other apps: an Excel workbook (xlsx), or the active sheet as CSV or TSV. Example: {"format":"xlsx"}. An xlsx export writes existing column groups and row groups as an Excel outline, including which columns and rows are collapsed. Do not ungroup, delete groups, or edit cells in order to export. Only when the user asks for one of these; to download or save the SuiteLeaf file itself, use download_file.',
      parameters: Type.Object({ format: Type.String({ enum: ["xlsx", "csv", "tsv"] }) }),
      prepare: (args) => {
        const raw = String(args.format ?? args.type ?? args.file_type ?? "")
          .trim()
          .toLowerCase();
        const format = /xlsx|excel|\.xls\b/.test(raw)
          ? "xlsx"
          : /tsv|tab/.test(raw)
            ? "tsv"
            : /csv|comma/.test(raw)
              ? "csv"
              : excelOutlineExportRequest()
                ? "xlsx"
                : raw;
        return { format };
      },
      target: () => document.querySelector(".workspace-header [aria-haspopup]"),
      async execute({ format }) {
        if (excelOutlineExportRequest() && format !== "xlsx")
          throw new ToolError(`That format is not an Excel workbook. ${OUTLINE_EXPORT}`);
        const saved = await ctx.exportAs(format as "xlsx");
        const name = `"${ctx.title}.${format}"`;
        const what = format === "xlsx" ? "every sheet" : `the sheet "${ctx.book.getActiveSheet().getSheetName()}"`;
        if (saved === null) return `The user closed the save dialog, so ${name} was not exported. Tell them; export again only if they ask.`;
        if (format === "xlsx" && excelOutlineExportRequest()) {
          noteOutlineExported();
          return `Exported ${what} as ${name}${saved ? `; the user saved it as ${saved}` : ""}. The month columns and the expense rows are an Excel outline. Cell values are unchanged and the groups are still there. Stop.`;
        }
        return `Exported ${what} as ${name}${saved ? `; the user saved it as ${saved}` : ""}.`;
      },
    }),
  ];
}

/** Undoing the agent's own changes. */
export function sheetUndoTools(ctx: SheetsAgentContext): SuiteTool[] {
  const { book } = ctx;
  return [
    tool({
      name: "undo",
      label: "Undo",
      description: "Undo your own last change in this request. Changes from before the request are the user's and can't be undone with this.",
      parameters: Type.Object({}),
      target: () => document.querySelector('[aria-label="Undo"]'),
      async execute() {
        refuseColumnGroupDetour("undo");
        refuseSpellingRetype("undo");
        if (printLayoutRequest())
          throw new ToolError(
            "Do not undo a print layout. Call insert_page_break for the row that starts the next page, then repeat_header, then stop. Do not freeze rows or change cell values.",
          );
        const steps = ctx.undoCount();
        const own = ownUndoSteps(book, steps);
        // A full history (Univer keeps 50 steps) can't tell whose the oldest steps are, so it doesn't block.
        if (!own && steps < UNDO_LIMIT)
          throw new ToolError(
            "Nothing you changed in this request is left to undo. Earlier changes in this workbook are the user's, so undo would take away their work.",
          );
        const before = cellStates(book);
        await ctx.api.undo();
        await ctx.settle();
        ctx.persist();
        const change = describeCellChanges(before, cellStates(book));
        return `Undid your last change: ${change || "nothing visible changed (a setting or a style)"}. ${own > 1 ? `${own - 1} more of your changes in this request can be undone.` : "None of your changes in this request are left to undo."}`;
      },
    }),
  ];
}
