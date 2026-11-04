import { Type } from "@earendil-works/pi-ai";
import { applyNamedFormat, numberFormatById } from "../../formats";
import { tool, ToolError, type SuiteTool } from "../host";
import { namedRangeError } from "../../editors/named-ranges";
import type { SheetsAgentContext } from "./sheet-context";
import {
  a1,
  absoluteSheetRef,
  cellInput,
  columnLetter,
  definedNameByName,
  definedNames,
  emptyReferences,
  formulaCells,
  formulasUsingName,
  grid,
  hiddenRows,
  NUMBER_FORMATS,
  parseA1,
  parseCell,
  rewriteFormulasUsingName,
  usedRange,
  visibleSums,
  wait,
  withDecimals,
} from "./sheet-cells";
import { refuseColumnGroupDetour, refusePrintCellEdit } from "./sheet-requests";
import { refuseSheetDeckRetype, refuseSpellingRetype } from "./sheet-spelling";
import { restoreRefusedDropdowns } from "./sheet-dropdown-rules";
import type { SheetToolKit } from "./sheet-tool-kit";

/** Reading cells, typing values and formulas, naming ranges, and formatting. */
export function sheetCellTools(ctx: SheetsAgentContext, kit: SheetToolKit): SuiteTool[] {
  const { book } = ctx;
  const { sheet, target, select, writable } = kit;
  return [
    tool({
      name: "read_sheet",
      label: "Read cells",
      description:
        "Read cell values (and formulas) on the active sheet. Without a range, reads the whole used area. Rows are numbered and columns lettered.",
      parameters: Type.Object({ range: Type.Optional(Type.String({ description: "A1 range such as A1:D10" })) }),
      target: ({ range }) => target(range ?? a1(usedRange(sheet()))),
      async execute({ range }) {
        await ctx.settle();
        const r = range ? parseA1(range) : usedRange(sheet());
        const sums = hiddenRows(sheet(), r.startRow, Math.min(r.endRow, usedRange(sheet()).endRow)).length ? visibleSums(sheet(), r) : "";
        return `Sheet "${sheet().getSheetName()}", ${a1(r)}:\n${grid(sheet(), r)}${sums ? `\n${sums}` : ""}`;
      },
    }),
    tool({
      name: "select_range",
      label: "Select cells",
      description: "Select a cell or range, like clicking or dragging over it.",
      parameters: Type.Object({ range: Type.String() }),
      target: ({ range }) => target(range),
      execute({ range }) {
        select(range);
        return `Selected ${a1(parseA1(range))}.`;
      },
    }),
    tool({
      name: "set_cells",
      label: "Type into cells",
      description:
        "Type values or formulas into cells, starting at the top-left cell `start`. `values` is a list of rows, each a list of cell texts, so a row across columns is [[\"Total\", \"=SUM(B2:B5)\", \"=SUM(C2:C5)\"]] and two rows are [[\"Name\", \"Hours\"], [\"Ana\", \"3\"]]. Text starting with '=' is a formula (e.g. =SUM(B2:B5)); formulas recalculate by themselves when the cells they use change, so never type their results over them. Numbers are typed without currency symbols or commas; codes with leading zeros stay as text. To trim spaces, split one column into several, or delete duplicate rows, use trim_whitespace, split_text_to_columns, or remove_duplicates instead of retyping the table. To put a dropdown on a column, use set_dropdown instead of retyping the cells. To link the words already in a cell to a web page, use set_cell_link. Do not type the address over the label. To group columns so they can collapse, use group_columns. To leave one grouped column visible, use show_only_column. Do not delete columns or retype the sheet to hide them. To correct one misspelling, use fix_spelling. To leave one cell and correct every other copy of that word, use ignore_spelling and then fix_spelling_all. Do not retype those cells.",
      parameters: Type.Object({
        start: Type.String({ description: "Top-left cell, e.g. A1" }),
        values: Type.Array(Type.Array(Type.String())),
      }),
      // A flat list is one row (the schema check would make it a column), and a range names its top-left cell.
      // A null cell is a blank one; the schema check would turn it into the text "null".
      prepare: ({ values, ...args }) => {
        const rows = Array.isArray(values) && values.length && values.every((v) => !Array.isArray(v)) ? [values] : values;
        return {
          ...args,
          ...(args.start === undefined && typeof args.range === "string" ? { start: args.range.split(":")[0] } : {}),
          values: Array.isArray(rows) ? rows.map((row) => (Array.isArray(row) ? row.map((v) => v ?? "") : row)) : rows,
        };
      },
      target: ({ start, values }) => {
        const s = parseCell(start);
        return target(
          a1({
            startRow: s.row,
            startColumn: s.column,
            endRow: s.row + Math.max(0, values.length - 1),
            endColumn: s.column + Math.max(0, ...values.map((r) => r.length - 1)),
          }),
        );
      },
      async execute({ start, values }) {
        refusePrintCellEdit();
        refuseColumnGroupDetour("set_cells");
        refuseSpellingRetype("set_cells");
        refuseSheetDeckRetype("set_cells");
        const s = parseCell(start);
        if (!values.length) throw new ToolError("Give at least one row of values.");
        writable();
        await ctx.settle();
        const before = formulaCells(sheet());
        const previousCells = new Map<string, unknown>();
        for (let i = 0; i < values.length; i++) {
          const row = values[i];
          if (!row.length) continue;
          const existing = sheet().getRange(s.row + i, s.column, 1, row.length).getValues() as unknown[][];
          existing[0]?.forEach((value, j) => previousCells.set(`${s.row + i}:${s.column + j}`, value));
          sheet()
            .getRange(s.row + i, s.column, 1, row.length)
            .setValues([row.map(cellInput)]);
          if (values.length < 40) await wait(60);
        }
        const end = {
          startRow: s.row,
          startColumn: s.column,
          endRow: s.row + values.length - 1,
          endColumn: s.column + Math.max(...values.map((r) => r.length)) - 1,
        };
        sheet().getRange(a1(end)).activate();
        ctx.persist();
        await ctx.settle();
        const inside = (row: number, column: number) =>
          row >= end.startRow && row <= end.endRow && column >= end.startColumn && column <= end.endColumn;
        const recalculated = [...formulaCells(sheet())]
          .filter(([cell, now]) => before.get(cell)?.formula === now.formula && before.get(cell)?.value !== now.value)
          .filter(([cell]) => !inside(parseCell(cell).row, parseCell(cell).column))
          .slice(0, 12)
          .map(([cell, now]) => `${cell} ${now.formula}: ${before.get(cell)!.value} → ${now.value}`);
        const after = formulaCells(sheet());
        const lost = [...before]
          .filter(([cell]) => !after.has(cell) && inside(parseCell(cell).row, parseCell(cell).column))
          .map(([cell, was]) => `${cell} was ${was.formula}`);
        const blank = [...after]
          .filter(([cell]) => inside(parseCell(cell).row, parseCell(cell).column))
          .map(([cell, now]) => ({ cell, formula: now.formula, refs: emptyReferences(sheet(), now.formula) }))
          .filter((f) => f.refs.length)
          .map((f) => `${f.cell} ${f.formula} uses only empty cells (${f.refs.join(", ")})`);
        const refused = restoreRefusedDropdowns(book, sheet(), previousCells);
        if (refused.length) ctx.persist();
        return `Wrote ${a1(end)}. Now:\n${grid(sheet(), end, 20, 12)}${recalculated.length ? `\nFormulas that recalculated by themselves: ${recalculated.join("; ")}.` : ""}${lost.length ? `\nThese formulas were replaced by fixed values, which will not update any more: ${lost.join("; ")}. If they should stay live, write the formulas back.` : ""}${blank.length ? `\nCheck these formulas: ${blank.join("; ")}. If they should use other rows or columns, write them again.` : ""}${refused.length ? `\n${refused.join(" ")} Do not write those values again.` : ""}`;
      },
    }),
    tool({
      name: "fill_formula",
      label: "Fill a formula",
      description:
        'Write a formula into one cell, or fill that formula down a single column. formula is the formula for the first cell and must start with =. A one-cell range writes it once: range "B30", formula "=AVERAGE(B2:B29)"; range "C30", formula "=SUM(C2:C29)"; range "D30", formula "=COUNTIF(D2:D29,"Pass")". A column copies it downward and moves relative references, so range "D2:D29" and formula "=IF(B2>2000,"Pass","Not yet")" writes that in D2, =IF(B3>2000,"Pass","Not yet") in D3, and so on. Pass formula as plain text, including its quotation marks. Use this instead of set_cells for formulas.',
      parameters: Type.Object({
        range: Type.String({ description: "A cell (B30) or one column (D2:D29)" }),
        formula: Type.String({ description: "Formula for the first cell, starting with =" }),
      }),
      prepare: (args) => {
        const range = String(args.range ?? args.start ?? args.cell ?? "")
          .trim()
          .replace(/^["']|["']$/g, "");
        let formula = String(args.formula ?? "").trim().replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
        if (formula.startsWith('"') && formula.endsWith('"') && formula.includes("=")) {
          try {
            const parsed = JSON.parse(formula);
            if (typeof parsed === "string") formula = parsed.trim();
          } catch {
            formula = formula.slice(1, -1).replace(/\\"/g, '"').trim();
          }
        }
        formula = formula.replace(/^=+/, "");
        return { range, formula: formula ? `=${formula}` : formula };
      },
      target: ({ range }) => target(range),
      async execute({ range, formula }) {
        refusePrintCellEdit();
        refuseColumnGroupDetour("fill_formula");
        if (!range) throw new ToolError('Give range, such as "B30" or "D2:D29".');
        if (!formula.startsWith("=") || formula === "=") throw new ToolError("Give a formula starting with =, such as =AVERAGE(B2:B29).");
        const r = parseA1(range);
        if (r.startColumn !== r.endColumn)
          throw new ToolError(`fill_formula fills one column. Give D2:D29, not ${range}.`);
        const height = r.endRow - r.startRow + 1;
        if (height > 500) throw new ToolError("That range is too long to fill.");
        writable();
        await ctx.settle();
        const engine = ctx.api.getFormula();
        const rows = Array.from({ length: height }, (_, i) => (i === 0 ? formula : engine.moveFormulaRefOffset(formula, 0, i)));
        sheet()
          .getRange(r.startRow, r.startColumn, height, 1)
          .setValues(rows.map((f) => [f]));
        sheet().getRange(a1(r)).activate();
        ctx.persist();
        await ctx.settle();
        const sample = rows
          .slice(0, 3)
          .map((f, i) => `${columnLetter(r.startColumn)}${r.startRow + i + 1} ${f}`)
          .join("; ");
        return `Filled ${a1(r)} from ${formula}. ${sample}${height > 3 ? `; and so on through row ${r.endRow + 1}` : ""}. Now:\n${grid(sheet(), r, 8, 4)}`;
      },
    }),
    tool({
      name: "name_range",
      label: "Name a range",
      description:
        'Give cells a defined name, or rename one so formulas that use it change in the same step. To create: {"name":"Rent","range":"C2:C13"} defines Rent as those cells. To rename: {"name":"Rent","rename_to":"MonthlyRent"} changes Rent to MonthlyRent and rewrites formulas, so =SUM(Rent) becomes =SUM(MonthlyRent). Names start with a letter, then letters, numbers, or underscores only. No spaces, and not a cell address such as C14. Use this instead of the name box or set_cells.',
      parameters: Type.Object({
        name: Type.String({ description: 'The defined name to create, or the current name when renaming, e.g. "Rent"' }),
        range: Type.Optional(Type.String({ description: 'The cells to name when creating, e.g. "C2:C13". Leave out when renaming.' })),
        rename_to: Type.Optional(Type.String({ description: 'The new name when renaming, e.g. "MonthlyRent"' })),
      }),
      prepare: (args) => {
        const text = (value: unknown) => String(value ?? "").trim().replace(/^["']|["']$/g, "");
        const name = text(args.name ?? args.range_name);
        const range = text(args.range ?? args.ref ?? args.cells).replace(/\s+/g, "");
        const rename = text(args.rename_to ?? args.new_name ?? args.to);
        return { name, ...(range ? { range } : {}), ...(rename ? { rename_to: rename } : {}) };
      },
      target: ({ range }) => (range ? target(range) : undefined),
      async execute({ name, range, rename_to: renameTo }) {
        if (!name) throw new ToolError('Give name, such as {"name":"Rent","range":"C2:C13"}.');
        writable();
        await ctx.settle();
        const existing = definedNames(book);
        const current = definedNameByName(book, name);
        const sheets: string[] = book.getSheets().map((item: { getSheetName: () => string }) => item.getSheetName());
        const reject = (draft: string, editing?: string) => {
          const reason = namedRangeError(draft, {
            names: existing
              .filter((item) => item.name !== editing)
              .map((item) => ({ id: item.name, name: item.name, ref: item.ref })),
            sheetNames: sheets,
            isFunction: () => false,
          });
          if (reason) throw new ToolError(reason);
        };
        if (renameTo) {
          if (!current) {
            const known = existing.map((item) => item.name).join(", ");
            throw new ToolError(
              known
                ? `There is no defined name ${name}. Names already defined: ${known}.`
                : `There is no defined name ${name}. Create it with name and range first, for example {"name":"Rent","range":"C2:C13"}.`,
            );
          }
          const previous = String(current.getName());
          if (renameTo === previous) throw new ToolError(`${previous} already has that name.`);
          reject(renameTo, previous);
          book.updateDefinedNameBuilder(current.toBuilder().setName(renameTo).build());
          const rewritten = rewriteFormulasUsingName(book, previous, renameTo);
          const formulas = formulasUsingName(book, renameTo);
          ctx.persist();
          await ctx.settle();
          ctx.persist();
          const shown = (rewritten.length ? rewritten : formulas).slice(0, 8).join("; ");
          return `Renamed ${previous} to ${renameTo}. Formulas that used ${previous} now use ${renameTo}${shown ? `: ${shown}` : ""}. Named ranges: ${definedNames(book)
            .map((item) => `${item.name} (${item.ref})`)
            .join("; ")}.`;
        }
        if (!range) throw new ToolError(`Give the cells to name, such as {"name":"${name}","range":"C2:C13"}.`);
        if (current) {
          throw new ToolError(
            `${current.getName()} is already a named range (${current.getFormulaOrRefString()}). To change the spelling, call name_range with name "${current.getName()}" and rename_to.`,
          );
        }
        reject(name);
        const parsed = parseA1(range);
        const ref = absoluteSheetRef(sheet().getSheetName(), parsed);
        book.insertDefinedName(name, ref);
        sheet().getRange(a1(parsed)).activate();
        ctx.persist();
        await ctx.settle();
        return `Named ${a1(parsed)} as ${name} (${ref}). Use ${name} in a formula, for example =SUM(${name}).`;
      },
    }),
    tool({
      name: "format_cells",
      label: "Format cells",
      description:
        "Format a range: number_format (currency $1,234.50, accounting, percent 12.5%, percent_whole 13%, number 1,234.50 without a $ sign, date, plain), decimals (how many decimal places to show; leave it out for the usual 2 for currency and number, 1 for percent), bold, italic, text_color and fill_color (#rrggbb), align (left, center, right), borders (true for thin borders on every cell), wrap. Set only what the user asked for on this range; anything you leave out stays as it is (bold=false removes bold). On a pivot table's sheet only number_format applies (to the source numbers the pivot shows).",
      parameters: Type.Object({
        range: Type.String(),
        number_format: Type.Optional(
          Type.String({ enum: ["currency", "accounting", "percent", "percent_whole", "number", "date", "plain"] }),
        ),
        decimals: Type.Optional(Type.Number()),
        bold: Type.Optional(Type.Boolean()),
        italic: Type.Optional(Type.Boolean()),
        text_color: Type.Optional(Type.String()),
        fill_color: Type.Optional(Type.String()),
        align: Type.Optional(Type.String({ enum: ["left", "center", "right"] })),
        borders: Type.Optional(Type.Boolean()),
        wrap: Type.Optional(Type.Boolean()),
      }),
      // Options wrapped in an object ({"style": {"bold": true}}) and CSS-like names are the same request.
      prepare: (args) => {
        const flat: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(args))
          if (key !== "range" && value && typeof value === "object" && !Array.isArray(value)) Object.assign(flat, value);
          else flat[key] = value;
        for (const alias of ["text_align", "alignment", "horizontal_alignment"])
          if (flat[alias] !== undefined && flat.align === undefined) {
            flat.align = flat[alias];
            delete flat[alias];
          }
        return flat;
      },
      target: ({ range }) => target(range),
      async execute(args) {
        const options = ["number_format", "decimals", "bold", "italic", "text_color", "fill_color", "align", "borders", "wrap"];
        const unknown = Object.keys(args).filter((k) => k !== "range" && !options.includes(k));
        if (!options.some((k) => (args as Record<string, unknown>)[k] !== undefined))
          throw new ToolError(
            `Nothing to change${unknown.length ? `: format_cells has no ${unknown.join(", ")} option` : ""}. Give range plus one or more of ${options.join(", ")} as separate arguments, e.g. {"range": "${args.range}", "bold": true}.`,
          );
        const pivot = ctx.content().pivots.find((x) => x.targetSheetId === sheet().getSheetId());
        const { number_format, ...others } = args;
        const onlyFormat = Object.entries(others).every(([k, v]) => k === "range" || v === undefined);
        if (pivot && number_format && onlyFormat) {
          const id = NUMBER_FORMATS[number_format];
          const source = book.getSheetBySheetId(pivot.source.sheetId);
          const values = a1({ ...pivot.source, startRow: pivot.source.startRow + 1, startColumn: pivot.source.startColumn + pivot.value, endColumn: pivot.source.startColumn + pivot.value });
          if (!id || !source || !applyNamedFormat(id, (code) => source.getRange(values).setNumberFormat(code)).ok)
            throw new ToolError(`Unknown number format ${number_format}.`);
          ctx.persist();
          await wait(900);
          await ctx.settle();
          return `"${sheet().getSheetName()}" is a read-only pivot table that shows numbers in its source's format, so the source cells ${values} on sheet "${source.getSheetName()}" were formatted as ${number_format} (${numberFormatById(id)!.code}) and the pivot followed. Shown as:\n${grid(sheet(), usedRange(sheet()), 12, 8)}`;
        }
        writable();
        select(args.range);
        const range = sheet().getRange(a1(parseA1(args.range)));
        const done: string[] = [];
        const places = args.decimals === undefined ? undefined : Math.max(0, Math.min(10, Math.round(args.decimals)));
        if (args.number_format) {
          const named = numberFormatById(NUMBER_FORMATS[args.number_format] ?? "");
          if (!named) throw new ToolError(`Unknown number format ${args.number_format}.`);
          const code = places === undefined ? named.code : withDecimals(named.code, places);
          range.setNumberFormat(code);
          done.push(`${args.number_format}${places === undefined ? "" : ` with ${places} decimal place(s)`} (${code})`);
        } else if (places !== undefined) {
          const codes = (range.getNumberFormats() as string[][]).map((row) => row.map((code) => withDecimals(code ?? "", places)));
          range.setNumberFormats(codes);
          done.push(`${places} decimal place(s) (${[...new Set(codes.flat())].join(", ")})`);
        }
        if (args.bold !== undefined) {
          range.setFontWeight(args.bold ? "bold" : "normal");
          done.push(args.bold ? "bold" : "not bold");
        }
        if (args.italic !== undefined) {
          range.setFontStyle(args.italic ? "italic" : "normal");
          done.push(args.italic ? "italic" : "not italic");
        }
        if (args.text_color) {
          range.setFontColor(args.text_color);
          done.push(`text ${args.text_color}`);
        }
        if (args.fill_color) {
          range.setBackgroundColor(args.fill_color);
          done.push(`fill ${args.fill_color}`);
        }
        if (args.align) {
          // Univer's facade calls right alignment "normal".
          range.setHorizontalAlignment(args.align === "right" ? "normal" : args.align);
          done.push(`aligned ${args.align}`);
        }
        if (args.borders) {
          range.setBorder(ctx.api.Enum.BorderType.ALL, ctx.api.Enum.BorderStyleTypes.THIN, "#000000");
          done.push("borders");
        }
        if (args.wrap !== undefined) {
          range.setWrap(args.wrap);
          done.push(args.wrap ? "wrapped" : "not wrapped");
        }
        if (unknown.length) done.push(`ignored ${unknown.join(", ")} (not an option)`);
        ctx.persist();
        await ctx.settle();
        const sample = range.getRange();
        const cells: { ref: string; bold: boolean }[] = [];
        for (let row = sample.startRow; row <= Math.min(sample.endRow, sample.startRow + 11); row++)
          for (let column = sample.startColumn; column <= Math.min(sample.endColumn, sample.startColumn + 7); column++)
            cells.push({
              ref: a1({ startRow: row, endRow: row, startColumn: column, endColumn: column }),
              bold: sheet().getRange(row, column, 1, 1).getCellStyleData()?.bl === 1,
            });
        const bolded = cells.filter((c) => c.bold);
        const boldText = !bolded.length ? "none of it" : bolded.length === cells.length ? "all of it" : bolded.map((c) => c.ref).join(", ");
        // A number format on part of a column often misses its total just below (or a first value just above).
        const nextTo: string[] = [];
        if (args.number_format)
          for (const row of [sample.startRow - 1, sample.endRow + 1].filter((r) => r >= 0 && r <= usedRange(sheet()).endRow))
            for (let column = sample.startColumn; column <= Math.min(sample.endColumn, sample.startColumn + 7); column++) {
              const cell = sheet().getRange(row, column, 1, 1);
              if (typeof cell.getRawValue() !== "number" || cell.getNumberFormat() === range.getNumberFormat()) continue;
              const formula = cell.getFormula();
              nextTo.push(
                `${a1({ startRow: row, endRow: row, startColumn: column, endColumn: column })}${formula ? ` ${formula}` : ""} → ${cell.getDisplayValue()}`,
              );
            }
        const near = nextTo.length
          ? `\nRight next to ${args.range}, ${nextTo.join("; ")} ${nextTo.length > 1 ? "show" : "shows"} a different number format; if ${nextTo.length > 1 ? "they hold" : "it holds"} the same kind of number (such as a total), format ${nextTo.length > 1 ? "them" : "it"} too.`
          : "";
        return `Formatted ${args.range}: ${done.join(", ") || "nothing changed"}. Bold: ${boldText}. Shown as:\n${grid(sheet(), { ...sample, endRow: Math.min(sample.endRow, sample.startRow + 11) }, 12, 8)}${near}`;
      },
    }),
  ];
}
