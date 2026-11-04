import { DataValidationListCacheService } from "@univerjs/sheets-data-validation";
import {
  formatRangeFormula,
  parseA1Ref,
  parseDropdownMeta,
  extendRef,
  reconcileSource,
  type SourceCell,
} from "./sheet-dropdown-source";
import {
  DROPDOWN_COLORS,
  allowedOptionsMessage,
  isRangeFormula,
  storedLabel,
} from "./sheet-dropdowns";
import type { dropdownBook } from "./sheet-dropdown-book";

type CellWrite = { row: number; column: number; label: string; color: string };

/**
 * Follows every range-sourced list to its source cells: the range grows with
 * the column, renamed options carry their colour, and cells that used the old
 * name take the new one.
 */
export async function syncDropdownSources({
  api,
  injector,
  syncing,
  draftRef,
  reader,
  writeCells,
}: {
  api: any;
  injector: { get: (token: any) => any };
  syncing: { current: boolean };
  draftRef: { current: unknown };
  reader: ReturnType<typeof dropdownBook>;
  writeCells: (updates: CellWrite[], target?: { unitId: string; subUnitId: string }) => Promise<void>;
}) {
  const { workbook, sheetByName, readRefCells, isMultiple, readCells } = reader;
  if (syncing.current || draftRef.current) return;
  const book = workbook();
  if (!book) return;
  syncing.current = true;
  try {
    for (const worksheet of book.getSheets?.() ?? []) {
      const rules = worksheet.getDataValidations?.() ?? [];
      const updates: { row: number; column: number; label: string; color: string }[] = [];
      for (const rule of rules) {
        const formula1 = rule.rule?.formula1 as string | undefined;
        if (!isRangeFormula(formula1)) continue;
        let parsed = parseA1Ref(String(formula1));
        if (!parsed) continue;
        const source = sheetByName(parsed.sheet);
        if (!source || parsed.startColumn !== parsed.endColumn) continue;
        for (let step = 0; step < 30; step++) {
          const below = (
            source
              .getRange(parsed.endRow + 1, parsed.startColumn, 1, 1)
              .getValues?.() as unknown[][] | undefined
          )?.[0]?.[0];
          const extended = extendRef(parsed, below);
          if (!extended) break;
          parsed = extended;
        }
        const cells = readRefCells(parsed);
        if (!cells) continue;
        const meta =
          rule.rule?.bizInfo?.suiteleafDropdown ?? parseDropdownMeta(rule.rule?.formula2);
        const previous: SourceCell[] = (meta?.sources ?? []).map((cell: SourceCell) => ({
          row: cell.row,
          column: cell.column,
          label: cell.label,
          color:
            meta?.colors[cell.label] ??
            Object.entries(meta?.colors ?? {}).find(
              ([name]) => name.toLowerCase() === cell.label.toLowerCase(),
            )?.[1] ??
            DROPDOWN_COLORS[0].value,
        }));
        const next = reconcileSource(previous, cells);
        if (!next.options.length) continue;
        const renamedTo = new Set(next.renames.map((item) => item.to.toLowerCase()));
        for (const option of next.options) {
          if (renamedTo.has(option.label.toLowerCase())) continue;
          const hinted =
            meta?.colors?.[option.label] ??
            Object.entries(meta?.colors ?? {}).find(
              ([name]) => name.toLowerCase() === option.label.toLowerCase(),
            )?.[1];
          if (typeof hinted === "string" && /^#[\da-f]{6}$/i.test(hinted)) option.color = hinted;
        }
        for (const cell of next.sources) {
          const match = next.options.find((option) => option.label.toLowerCase() === cell.label.toLowerCase());
          if (match) cell.color = match.color;
        }
        const nextFormula = formatRangeFormula(parsed);
        const nextMeta = {
          colors: Object.fromEntries(
            next.options.map((option) => [option.label, option.color]),
          ),
          sources: next.sources.map(({ row, column, label }) => ({ row, column, label })),
        };
        const nextFormula2 = next.options.map((option) => option.color).join(",");
        const metaChanged = JSON.stringify(nextMeta) !== JSON.stringify(meta ?? {});
        if (nextFormula !== formula1 || nextFormula2 !== rule.rule?.formula2 || metaChanged) {
          const unitId = book.getId();
          const subUnitId = worksheet.getSheetId();
          const labels = next.options.map((option) => option.label);
          await api.executeCommand("sheets.command.update-data-validation-setting", {
            unitId,
            subUnitId,
            ruleId: rule.rule.uid,
            setting: {
              type: rule.rule.type,
              formula1: nextFormula,
              formula2: nextFormula2,
              allowBlank: rule.rule.allowBlank !== false,
            },
          });
          await api.executeCommand("sheets.command.update-data-validation-options", {
            unitId,
            subUnitId,
            ruleId: rule.rule.uid,
            options: {
              error: allowedOptionsMessage(labels),
              showErrorMessage: true,
              showDropDown: true,
              renderMode: rule.rule.renderMode ?? 2,
              bizInfo: { suiteleafDropdown: nextMeta },
            },
          });
          try {
            injector
              .get(DataValidationListCacheService)
              .markRuleDirty?.(unitId, subUnitId, rule.rule.uid);
          } catch {
            /* The list repaints when the rule itself changes. */
          }
        }
        if (!next.renames.length) continue;
        const multiple = isMultiple(rule);
        const targets = (rule.getRanges?.() ?? []).flatMap((range: any) => readCells(range));
        for (const cell of targets) {
          const label = storedLabel(cell.value, next.options, next.renames, multiple);
          if (!label) continue;
          const color = multiple
            ? "#ffffff"
            : (next.options.find((option) => option.label === label)?.color ?? "#ffffff");
          updates.push({ ...cell, label, color });
        }
      }
      if (updates.length)
        await writeCells(updates, { unitId: book.getId(), subUnitId: worksheet.getSheetId() });
    }
  } finally {
    syncing.current = false;
  }
}
