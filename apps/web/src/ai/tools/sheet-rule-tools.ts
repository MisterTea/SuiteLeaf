import { Type } from "@earendil-works/pi-ai";
import { tool, ToolError, type SuiteTool } from "../host";
import {
  canonicalOption,
  chipTextColor,
  dropdownTokens,
  isRangeFormula,
  isRejectStyle,
  trimmedText,
} from "../../editors/sheet-dropdowns";
import { displayRangeRef } from "../../editors/sheet-dropdown-source";
import type { SheetsAgentContext } from "./sheet-context";
import { a1, columnLetter, display, parseA1, TEXT, usedRange, wait, type RawCell } from "./sheet-cells";
import {
  assignsFromRequest,
  choicesFromRequest,
  concreteInSentence,
  dropdownColor,
  dropdownColorName,
  isPersonName,
  multipleInSentence,
  normalizeDropdownArgs,
  parseRewrite,
  quotedPairs,
  requestSentences,
  rewritesFromRequest,
  sentenceForCall,
  sourceInSentence,
  splitChoices,
} from "./sheet-dropdown-args";
import {
  applySourceDropdown,
  dropdownOptionsFromRule,
  dropdownTarget,
  groupedCells,
  installDropdown,
  listRuleOn,
  rowsNamed,
} from "./sheet-dropdown-rules";
import type { SheetToolKit } from "./sheet-tool-kit";

/** Checkboxes, dropdown lists, and conditional formatting rules. */
export function sheetRuleTools(ctx: SheetsAgentContext, kit: SheetToolKit): SuiteTool[] {
  const { book } = ctx;
  const { sheet, target, select, ruleResults, writable } = kit;
  return [
    tool({
      name: "insert_checkboxes",
      label: "Checkboxes",
      description: "Turn every cell in a range into a tick box (unticked = FALSE, ticked = TRUE).",
      parameters: Type.Object({ range: Type.String() }),
      target: ({ range }) => target(range),
      async execute({ range }) {
        select(range);
        ctx.insertCheckbox();
        await wait(400);
        const r = parseA1(range);
        const kept: string[] = [];
        (sheet().getRange(a1(r)).getValues() as unknown[][]).forEach((row, i) =>
          row.forEach((v, j) => {
            if (typeof v === "boolean" || v === 0 || v === 1 || v === "" || v == null) return;
            const at = { startRow: r.startRow + i, endRow: r.startRow + i, startColumn: r.startColumn + j, endColumn: r.startColumn + j };
            kept.push(`${a1(at)} "${display(v)}"`);
          }),
        );
        const first = `$${columnLetter(r.startColumn)}${r.startRow + 1}`;
        return `Added unticked checkboxes to ${a1(r)}: each holds FALSE, and ticking one makes it TRUE (so a rule can test =${first}=TRUE).${kept.length ? ` These cells kept their text instead of a tick: ${kept.join(", ")}.` : ""}`;
      },
    }),
    tool({
      name: "set_checkbox",
      label: "Tick box",
      description: "Tick (true) or untick (false) checkbox cells. Only when the user asks to tick or untick something.",
      parameters: Type.Object({ cells: Type.Array(Type.String()), checked: Type.Boolean() }),
      // "When I tick a task…" describes the user's own ticking, not a request to tick one.
      intent: /\b(un)?(tick|check|mark)(ed)?\b[^.?!]{0,40}\b(off|done|complete|completed|finished)\b|\b(untick|uncheck)\b/i,
      confirm: ({ cells, checked }) => `${checked ? "Tick" : "Untick"} ${cells.join(", ")}?`,
      target: ({ cells }) => target(cells[0]),
      async execute({ cells, checked }) {
        for (const cell of cells) {
          sheet().getRange(cell).setValue(checked);
          await wait(150);
        }
        ctx.persist();
        return `${checked ? "Ticked" : "Unticked"} ${cells.join(", ")}.`;
      },
    }),
    tool({
      name: "set_dropdown",
      label: "Dropdown list",
      description:
        'Put a dropdown on one column so those cells only accept the given options, each with a chip colour. options is the labels in order, e.g. ["Confirmed", "Maybe", "Can\'t make it", "Waitlist"]. colors is the same order: green, amber, grey, blue, red, purple, or #rrggbb, or name pairs such as ["Maybe=amber"] so a colour stays with that name. Leave colors out and they are used in that order. reject true (the default) refuses anything else. Cells that match an option except for capitalisation or surrounding spaces are rewritten to it ("Confirmed " and "confirmed" become Confirmed). fixes rewrites other text onto an option, including a rename, e.g. ["yes=Confirmed", "tbc=Confirmed", "Tentative=Maybe"]; matching ignores capitalisation and spaces. assign sets one person\'s row by the name beside it, e.g. ["Priya Shah=Waitlist"]. Pass the full option list each time; it replaces the dropdown on that range. Do not retype the column with set_cells. To follow cells on a sheet, pass source "Statuses!A2:A5": only non-blank cells are options, and colours stay with those names. add "Training" types that value in the cell under the source and extends the range. rename_source "Maybe=Perhaps" renames that source cell and keeps its colour. insert_blank true inserts a blank row inside the source; the blank is not an option. multiple true allows more than one choice in a cell and still rejects a token that is not an option, trimming spaces so "Driver " matches Driver. A bad token such as Boss is left out of the cell.',
      parameters: Type.Object({
        range: Type.String({ description: "Cells, e.g. C2:C41, or the column header such as Status" }),
        options: Type.Optional(Type.Array(Type.String(), { description: "Choice labels in order. Leave out when source is set." })),
        colors: Type.Optional(Type.Array(Type.String(), { description: 'Chip colour for each option, same order, or "Maybe=amber"' })),
        reject: Type.Optional(Type.Boolean({ description: "Refuse any other value. Default true" })),
        fixes: Type.Optional(Type.Array(Type.String(), { description: 'Rewrite existing text, e.g. "yes=Confirmed" or "Tentative=Maybe"' })),
        assign: Type.Optional(Type.Array(Type.String(), { description: 'Set a row by the person\'s name, e.g. "Priya Shah=Waitlist" or "Nora Berg=Driver, Cook"' })),
        source: Type.Optional(Type.String({ description: 'List source range, e.g. "Statuses!A2:A5". Blank cells are not options.' })),
        add: Type.Optional(Type.String({ description: "Value to type in the cell under source, which extends the list" })),
        rename_source: Type.Optional(Type.String({ description: 'Rename a source cell and keep its colour, e.g. "Maybe=Perhaps"' })),
        insert_blank: Type.Optional(Type.Boolean({ description: "Insert a blank row inside the source range. The blank is not an option." })),
        multiple: Type.Optional(Type.Boolean({ description: "Allow more than one choice in each cell" })),
      }),
      prepare: (args) => normalizeDropdownArgs(args),
      target: ({ range }) => target(range),
      async execute({ range, options, colors, reject, fixes, assign, source, add, rename_source, insert_blank, multiple }) {
        writable();
        await ctx.settle();
        const askedRange = String(range ?? "");
        const givenOptions = (options ?? []).map((label) => String(label).trim()).filter(Boolean);
        const sentence = sentenceForCall(askedRange, givenOptions);
        const sentenceSource = sentence ? sourceInSentence(sentence) : "";
        const requestNamesSource = requestSentences().some((item) => sourceInSentence(item));
        // The source written beside these cells wins. When the request names a source for another range, don't copy it here.
        const sourceText = sentenceSource || (!requestNamesSource ? source || "" : "");
        const allowSeveral = sentence ? multipleInSentence(sentence) : Boolean(multiple);
        const pinnedRange = sentence ? concreteInSentence(sentence) : "";
        if (sourceText || add || rename_source || insert_blank) {
          const roster = sheet();
          const box = dropdownTarget(roster, pinnedRange || askedRange, []);
          return applySourceDropdown(ctx, roster, box, {
            source: sourceText,
            add,
            renameSource: rename_source,
            insertBlank: insert_blank,
            colors,
            reject: reject !== false,
            assign,
            multiple: allowSeveral,
          });
        }
        const requestedChoices = choicesFromRequest();
        const listed = requestedChoices.length >= 2 ? requestedChoices : (options ?? []).map((label) => ({ label: label.trim() }));
        let labels = listed.map((item) => item.label.trim()).filter(Boolean);
        let listedColors = requestedChoices.length >= 2 ? requestedChoices.map((item) => item.color ?? "") : colors;
        let allowMultiple = allowSeveral;
        if (!labels.length) {
          const probe = dropdownTarget(sheet(), range, []);
          const existing = listRuleOn(sheet().getRange(a1(probe)));
          const type = existing?.getCriteriaType?.() ?? existing?.rule?.type;
          if (existing && isRangeFormula(existing.rule?.formula1)) {
            return applySourceDropdown(ctx, sheet(), probe, {
              source: displayRangeRef(String(existing.rule.formula1)),
              assign,
              colors,
              reject: reject !== false && isRejectStyle(existing.rule?.errorStyle),
              multiple: type === "listMultiple" || allowSeveral,
            });
          }
          const reused = existing ? dropdownOptionsFromRule(book, existing) : [];
          if (reused.length) {
            labels = reused.map((option) => option.label);
            listedColors = reused.map((option) => option.color);
            if (type === "listMultiple") allowMultiple = true;
          }
        }
        if (!labels.length) throw new ToolError('Give at least one option, for example ["Confirmed", "Maybe", "Can\'t make it"].');
        if (labels.some((label) => label.includes(",")))
          throw new ToolError("An option can't contain a comma. Excel stores the list as comma-separated text.");
        const seen = new Set<string>();
        const dropdownOptions = labels.flatMap((label, index) => {
          const key = label.toLowerCase();
          if (seen.has(key)) return [];
          seen.add(key);
          return [{ id: `opt-${seen.size - 1}`, label, color: dropdownColor(listedColors?.[index], index) }];
        });
        const rewrites = new Map<string, string>();
        const addRewrite = (from: string, to: string) => {
          const label = canonicalOption(to, dropdownOptions);
          if (!label) throw new ToolError(`"${to}" is not a dropdown option (${dropdownOptions.map((option) => option.label).join(", ")}).`);
          rewrites.set(from.trim().toLowerCase(), label);
        };
        for (const job of rewritesFromRequest(dropdownOptions)) addRewrite(job.from, job.to);
        for (const item of fixes ?? []) {
          const parsed = parseRewrite(item);
          if (!parsed) throw new ToolError(`Could not read the rewrite "${item}". Write it as yes=Confirmed or Tentative=Maybe.`);
          const already = canonicalOption(parsed.from, dropdownOptions);
          const target = canonicalOption(parsed.to, dropdownOptions);
          // "confirmed" already is Confirmed. Remapping that choice would change every such cell.
          if (already && target && already !== target) continue;
          addRewrite(parsed.from, parsed.to);
        }
        for (const pair of quotedPairs()) {
          if (isPersonName(pair.from) || !canonicalOption(pair.to, dropdownOptions)) continue;
          const already = canonicalOption(pair.from, dropdownOptions);
          const target = canonicalOption(pair.to, dropdownOptions);
          if (already && target && already !== target) continue;
          if (rewrites.has(pair.from.trim().toLowerCase())) continue;
          addRewrite(pair.from, pair.to);
        }
        const box = dropdownTarget(sheet(), pinnedRange || range, dropdownOptions);
        const height = box.endRow - box.startRow + 1;
        const grid = sheet().getRange(box.startRow, box.startColumn, height, 1).getCellDatas() as RawCell[][];
        const plans = new Map<string, { row: number; column: number; before: string; after: string }>();
        const leftovers: { text: string; cell: string }[] = [];
        const refused: string[] = [];
        const usedFix = new Set<string>();
        for (let i = 0; i < height; i++) {
          const cell = grid[i]?.[0];
          if (cell?.f) continue;
          const before = cell?.v == null ? "" : String(cell.v);
          const key = before.trim().toLowerCase();
          const row = box.startRow + i;
          const at = { startRow: row, endRow: row, startColumn: box.startColumn, endColumn: box.startColumn };
          if (!key) continue;
          if (allowMultiple) {
            const kept: string[] = [];
            const bad: string[] = [];
            for (const token of dropdownTokens(before)) {
              const tokenKey = token.trim().toLowerCase();
              const rewritten = rewrites.get(tokenKey);
              if (rewritten) usedFix.add(tokenKey);
              const canon = rewritten ?? canonicalOption(token, dropdownOptions);
              if (canon) {
                if (!kept.includes(canon)) kept.push(canon);
              } else bad.push(token.trim());
            }
            if (!kept.length) {
              leftovers.push({ text: before.trim(), cell: a1(at) });
              continue;
            }
            if (bad.length) refused.push(...bad);
            plans.set(`${row}:${box.startColumn}`, { row, column: box.startColumn, before, after: kept.join(", ") });
            continue;
          }
          const rewritten = rewrites.get(key);
          if (rewritten) usedFix.add(key);
          const after = rewritten ?? canonicalOption(before, dropdownOptions);
          if (!after) {
            leftovers.push({ text: before.trim(), cell: a1(at) });
            continue;
          }
          plans.set(`${row}:${box.startColumn}`, { row, column: box.startColumn, before, after });
        }
        const jobs: { name: string; label: string }[] = [];
        const assignJobs = [...(assign ?? [])];
        for (const pair of quotedPairs()) {
          if (!isPersonName(pair.from)) continue;
          const item = `${pair.from}=${pair.to}`;
          if (!assignJobs.some((job) => job.toLowerCase() === item.toLowerCase())) assignJobs.push(item);
        }
        for (const item of assignJobs) {
          const parsed = parseRewrite(item);
          if (!parsed) throw new ToolError(`Could not read "${item}". Write it as "Priya Shah=Waitlist".`);
          const kept: string[] = [];
          const bad: string[] = [];
          for (const part of splitChoices(parsed.to, allowMultiple)) {
            const label = canonicalOption(part, dropdownOptions);
            if (label) {
              if (!kept.includes(label)) kept.push(label);
            } else if (trimmedText(part)) bad.push(trimmedText(part));
          }
          const explicit = (assign ?? []).some((job) => job.toLowerCase().includes(parsed.from.toLowerCase()));
          if (!kept.length) {
            if (!explicit) continue;
            if (!allowMultiple) {
              throw new ToolError(
                `"${parsed.to}" is not a dropdown option (${dropdownOptions.map((option) => option.label).join(", ")}).`,
              );
            }
            refused.push(...bad);
            continue;
          }
          if (bad.length) refused.push(...bad);
          jobs.push({ name: parsed.from, label: allowMultiple ? kept.join(", ") : kept[0] });
        }
        for (const job of assignsFromRequest(dropdownOptions)) {
          if (!jobs.some((item) => item.name.toLowerCase() === job.name.toLowerCase())) jobs.push(job);
        }
        const assigned: string[] = [];
        const assignedCells = new Set<string>();
        for (const job of jobs) {
          const rows = rowsNamed(sheet(), job.name, box.startColumn);
          if (!rows.length) {
            const used = usedRange(sheet());
            const names = (sheet().getRange(used.startRow, used.startColumn, used.endRow - used.startRow + 1, 1).getValues() as unknown[][])
              .map((row) => String(row[0] ?? "").trim())
              .filter(Boolean)
              .slice(0, 8);
            throw new ToolError(`No row is named "${job.name}". Names start with ${names.join(", ")}.`);
          }
          for (const row of rows) {
            const key = `${row}:${box.startColumn}`;
            const existing = plans.get(key);
            const before = existing?.before ?? String(sheet().getRange(row, box.startColumn, 1, 1).getValue() ?? "");
            plans.set(key, { row, column: box.startColumn, before, after: job.label });
            const where = a1({ startRow: row, endRow: row, startColumn: box.startColumn, endColumn: box.startColumn });
            assignedCells.add(where);
            assigned.push(`${job.name} is ${job.label} (${where})`);
          }
        }
        const stillOff = leftovers.filter((item) => !assignedCells.has(item.cell));
        const matrix: Record<number, Record<number, unknown>> = {};
        let changed = 0;
        for (const plan of plans.values()) {
          if (plan.before === plan.after) continue;
          changed++;
          (matrix[plan.row] ??= {})[plan.column] = { v: plan.after, t: TEXT };
        }
        select(a1(box));
        installDropdown(ctx.api, sheet().getRange(a1(box)), dropdownOptions, reject !== false, allowMultiple);
        if (Object.keys(matrix).length) await Promise.resolve(sheet().getRange(0, 0).setValues(matrix));
        if (!allowMultiple) {
          for (const plan of plans.values()) {
            const option = dropdownOptions.find((item) => item.label === plan.after);
            if (!option) continue;
            sheet().getRange(plan.row, plan.column, 1, 1).setFontColor(chipTextColor(option.color));
          }
        }
        ctx.persist();
        await ctx.settle();
        const unused = [...(fixes ?? [])].flatMap((item) => {
          const parsed = parseRewrite(item);
          return parsed && !usedFix.has(parsed.from.trim().toLowerCase()) ? [parsed.from] : [];
        });
        const choiceList = dropdownOptions.map((option) => `${option.label} (${dropdownColorName(option.color)})`).join(", ");
        const refuse = reject === false ? "Other values are allowed, with a warning." : "Other values are rejected.";
        const leftover = stillOff.length
          ? ` These cells are still not in the list: ${groupedCells(stillOff)}. Call set_dropdown again with the same range, options, and colors, and fixes for each value the user asked to change.`
          : " Every cell in the dropdown is one of those options.";
        const missed = unused.length ? ` These rewrites matched no cells: ${unused.join(", ")}.` : "";
        const who = assigned.length ? ` ${assigned.join("; ")}.` : "";
        const dropped = refused.length
          ? ` Refused ${[...new Set(refused)].map((item) => `"${item}"`).join(", ")}; that text was not stored.`
          : "";
        const several = allowMultiple ? " More than one choice is allowed." : "";
        return `Dropdown on ${a1(box)}: ${choiceList}. ${refuse}${several} Rewrote ${changed} cell(s), including capitalisation and surrounding spaces.${who}${dropped}${missed}${leftover}`;
      },
    }),
    tool({
      name: "highlight_rule",
      label: "Conditional formatting",
      description:
        "Add a conditional formatting rule: cells in `range` get the style when the custom formula is true for that row, e.g. range A2:C10 with formula =$A2=TRUE, or =$C2>100. Write the formula for the range's first row with $ before the column. Style: fill_color (#rrggbb; light shades such as #d9ead3 green or #fff2cc yellow keep the text readable), text_color, bold, strikethrough. Set only the styles the user asked for; the cells keep their own text colour and weight otherwise.",
      parameters: Type.Object({
        range: Type.String(),
        formula: Type.String(),
        fill_color: Type.Optional(Type.String()),
        text_color: Type.Optional(Type.String({ description: "Only when the user asked for a text colour" })),
        bold: Type.Optional(Type.Boolean({ description: "Only when the user asked for bold" })),
        strikethrough: Type.Optional(Type.Boolean({ description: "Crossed-out text" })),
      }),
      // "$ before the column" sometimes comes back as $=A2 instead of =$A2.
      prepare: (args) =>
        typeof args.formula === "string" ? { ...args, formula: args.formula.trim().replace(/^=?\$=/, "=$") } : args,
      target: ({ range }) => target(range),
      async execute({ range, formula, fill_color, text_color, bold, strikethrough }) {
        const s = sheet();
        const formulaText = formula.startsWith("=") ? formula : `=${formula}`;
        const r = parseA1(range);
        const results = await ruleResults(formulaText, r);
        const broken = results.find((x) => typeof x.value === "string" && x.value.startsWith("#"));
        if (broken)
          throw new ToolError(
            `The formula ${formulaText} gives ${broken.value} on row ${broken.row + 1}, so the rule would never apply. Write it as a true/false test for the range's first row, with $ before the column, e.g. =$A${r.startRow + 1}=TRUE or =$C${r.startRow + 1}>100.`,
          );
        select(range);
        let builder = s
          .newConditionalFormattingRule()
          .whenFormulaSatisfied(formulaText)
          .setRanges([s.getRange(a1(parseA1(range))).getRange()]);
        if (fill_color) builder = builder.setBackground(fill_color);
        if (text_color) builder = builder.setFontColor(text_color);
        if (bold !== undefined) builder = builder.setBold(bold);
        if (strikethrough !== undefined && builder.setStrikethrough) builder = builder.setStrikethrough(strikethrough);
        s.addConditionalFormattingRule(builder.build());
        ctx.persist();
        await wait(300);
        const on = results.filter((x) => x.value === true || x.value === 1).map((x) => x.row + 1);
        const next = results.length > 1 ? ` (${ctx.api.getFormula().moveFormulaRefOffset(formulaText, 0, 1)} on row ${r.startRow + 2}, and so on)` : "";
        const now = !results.length
          ? ""
          : on.length
            ? ` Right now it applies to row(s) ${on.join(", ")}.`
            : " Right now it is not true on any row, so nothing is styled yet; a row is styled as soon as its formula becomes true.";
        return `Added a rule on ${a1(r)}: when ${formulaText}${next}, ${[fill_color && `fill ${fill_color}`, text_color && `text ${text_color}`, bold && "bold", strikethrough && "strikethrough"].filter(Boolean).join(", ")}.${now}`;
      },
    }),
  ];
}
