import { Type } from "@earendil-works/pi-ai";
import { cellHyperlink, cellLabel as linkCellLabel, linkedCell, linkTarget } from "@suiteleaf/core";
import { currentRequest } from "../guard";
import { tool, ToolError, type SuiteTool } from "../host";
import type { SheetsAgentContext } from "./sheet-context";
import { a1, columnLetter, parseA1, parseCell, usedRange } from "./sheet-cells";
import type { SheetToolKit } from "./sheet-tool-kit";

function linkArg(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

/** A cell address, or the label already in the cell (such as Northwind). */
function resolveLinkCell(sheet: any, query: string) {
  const text = linkArg(query).replace(/^.*!/, "");
  if (!text) throw new ToolError('Give cell, such as "Northwind" or "A2".');
  if (/^\$?[A-Za-z]{1,3}\$?\d+$/.test(text)) {
    const { row, column } = parseCell(text);
    return { row, column, range: sheet.getRange(row, column, 1, 1) };
  }
  if (text.includes(":")) {
    const span = parseA1(text);
    if (span.startRow !== span.endRow || span.startColumn !== span.endColumn)
      throw new ToolError(`Link one cell, not ${text}. Give A2 or the words in the cell.`);
    return { row: span.startRow, column: span.startColumn, range: sheet.getRange(span.startRow, span.startColumn, 1, 1) };
  }
  const used = usedRange(sheet);
  const height = used.endRow - used.startRow + 1;
  const width = used.endColumn - used.startColumn + 1;
  if (height < 1 || width < 1) throw new ToolError(`No cell says "${text}".`);
  const values = sheet.getRange(used.startRow, used.startColumn, height, width).getValues() as unknown[][];
  const datas = (sheet.getRange(used.startRow, used.startColumn, height, width).getCellDatas?.() ?? []) as { v?: unknown }[][];
  const want = text.toLowerCase();
  const hits: { row: number; column: number; exact: boolean }[] = [];
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const fromValue = values[r]?.[c] == null ? "" : String(values[r][c]).trim();
      const fromCell = linkCellLabel(datas[r]?.[c]).trim();
      const label = fromCell || fromValue;
      if (!label) continue;
      if (label === text || label.toLowerCase() === want)
        hits.push({ row: used.startRow + r, column: used.startColumn + c, exact: label === text });
    }
  }
  const exact = hits.filter((hit) => hit.exact);
  const chosen = exact.length ? exact : hits;
  if (!chosen.length) throw new ToolError(`No cell says "${text}".`);
  if (chosen.length > 1) throw new ToolError(`More than one cell says "${text}". Give the cell address, such as A2.`);
  const hit = chosen[0];
  return { row: hit.row, column: hit.column, range: sheet.getRange(hit.row, hit.column, 1, 1) };
}

/** Web addresses the user asked to put on named cells that are still missing. */
export function linkRequestNotes(ctx: SheetsAgentContext): string[] {
  const text = currentRequest().text;
  const wanted = new Map<string, { name: string; href: string }>();
  const remember = (label: string, address: string) => {
    const name = label.trim();
    const href = linkTarget(address);
    if (!name || !href) return;
    wanted.set(name.toLowerCase(), { name, href });
  };
  for (const match of text.matchAll(/set_cell_link\s+with\s+cell\s+"([^"]+)"\s+and\s+address\s+"([^"]+)"/gi))
    remember(match[1], match[2]);
  for (const match of text.matchAll(/\blink\s+([A-Za-z][\w-]*)\s+to\s+(https?:\/\/\S+|[\w.-]+\.[a-z]{2,}(?:\/\S*)?)/gi))
    remember(match[1], match[2].replace(/[.,;]+$/, ""));
  if (!wanted.size) return [];
  const grid = ctx.book.getActiveSheet();
  const notes: string[] = [];
  for (const { name, href } of wanted.values()) {
    let found: ReturnType<typeof resolveLinkCell>;
    try {
      found = resolveLinkCell(grid, name);
    } catch {
      notes.push(
        `No cell says "${name}". Restore that label, then call set_cell_link with cell "${name}" and address "${href}". Do not type the address over the label.`,
      );
      continue;
    }
    const data = found.range.getCellData?.() ?? {};
    if (linkCellLabel(data).trim() === name && cellHyperlink(data) === href) continue;
    const where = `${columnLetter(found.column)}${found.row + 1}`;
    notes.push(
      `${where} should say "${name}" and link to ${href}. Call set_cell_link with cell "${name}" and address "${href}". Leave the label as ${name}.`,
    );
  }
  return notes.slice(0, 6);
}

/** Web links on cells. */
export function sheetLinkTools(ctx: SheetsAgentContext, kit: SheetToolKit): SuiteTool[] {
  const { sheet, target, writable } = kit;
  return [
    tool({
      name: "set_cell_link",
      label: "Link a cell",
      description:
        'Link the words already in a cell to a web address. cell is the cell (A2) or the label in it, such as "Northwind". address is the page, such as "example.org/northwind". The cell text stays that label. A bare domain is stored as https://. Call set_cell_link again on the same cell to change only the address. javascript: and any address that is not a web, email, mailto:, or tel: link is refused and the cell stays plain text. Use this instead of set_cells.',
      parameters: Type.Object({
        cell: Type.String({ description: 'Cell address such as A2, or the label in that cell such as "Northwind"' }),
        address: Type.String({ description: 'Web address, such as example.org/northwind' }),
      }),
      prepare: (args) => ({
        cell: linkArg(args.cell ?? args.label ?? args.name ?? args.range),
        address: linkArg(args.address ?? args.url ?? args.href ?? args.link),
      }),
      target: ({ cell }) => {
        try {
          const found = resolveLinkCell(sheet(), cell);
          return target(a1({ startRow: found.row, endRow: found.row, startColumn: found.column, endColumn: found.column }));
        } catch {
          return undefined;
        }
      },
      async execute({ cell, address }) {
        if (!cell) throw new ToolError('Give cell, such as {"cell":"Northwind","address":"example.org/northwind"}.');
        if (!address) throw new ToolError('Give address, such as "example.org/northwind".');
        writable();
        await ctx.settle();
        const found = resolveLinkCell(sheet(), cell);
        const data = found.range.getCellData?.() ?? {};
        const where = `${columnLetter(found.column)}${found.row + 1}`;
        const label = linkCellLabel(data).trim();
        if (typeof data.f === "string" && data.f)
          throw new ToolError(`${where} is a formula. Link a cell that holds words. Nothing was changed.`);
        const href = linkTarget(address);
        if (!href) {
          return `Refused "${address}". It is not a web address. ${where} still says "${label}" and has no new address. Leave it as plain text. Do not type the address into the cell.`;
        }
        const shown = label || href;
        found.range.setValueForCell(linkedCell(shown, href));
        found.range.setFontColor("#1a73e8");
        found.range.setFontLine("underline");
        found.range.activate?.();
        ctx.persist();
        await ctx.settle();
        return `Linked ${where}. The cell still says "${shown}". Its address is ${href}.`;
      },
    }),
    tool({
      name: "remove_cell_link",
      label: "Remove a cell link",
      description:
        'Drop the address on a linked cell and keep the label. cell is the cell (A3) or the label in it, such as "Contoso". The cell stays plain text that still says that label and has no address.',
      parameters: Type.Object({
        cell: Type.String({ description: 'Cell address or the label in that cell, such as "Contoso"' }),
      }),
      prepare: (args) => ({ cell: linkArg(args.cell ?? args.label ?? args.name ?? args.range) }),
      target: ({ cell }) => {
        try {
          const found = resolveLinkCell(sheet(), cell);
          return target(a1({ startRow: found.row, endRow: found.row, startColumn: found.column, endColumn: found.column }));
        } catch {
          return undefined;
        }
      },
      async execute({ cell }) {
        if (!cell) throw new ToolError('Give cell, such as {"cell":"Contoso"}.');
        writable();
        await ctx.settle();
        const found = resolveLinkCell(sheet(), cell);
        const data = found.range.getCellData?.() ?? {};
        const where = `${columnLetter(found.column)}${found.row + 1}`;
        const label = linkCellLabel(data).trim();
        if (typeof data.f === "string" && data.f)
          throw new ToolError(`${where} is a formula. Nothing was changed.`);
        found.range.setValueForCell({ v: label, t: 1, p: null });
        found.range.setFontColor(null);
        found.range.setFontLine(null);
        found.range.activate?.();
        ctx.persist();
        await ctx.settle();
        return `Removed the link from ${where}. It still says "${label}" and has no address.`;
      },
    }),
  ];
}
