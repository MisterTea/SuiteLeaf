import { DataValidatorRegistryService } from "@univerjs/data-validation";
import { DataValidationListCacheService } from "@univerjs/sheets-data-validation";
import { colorsForLabels } from "./sheet-dropdown-source";
import {
  canonicalOption,
  dropdownTokens,
  isRangeFormula,
  optionsFromRule,
  trimmedText,
  type DropdownOption,
} from "./sheet-dropdowns";

/**
 * Lets Univer's list validator accept SuiteLeaf's tidied options, and keeps its
 * cached list unique and painted with the rule's colours.
 */
export function patchListValidation(
  injector: { get: (token: any) => any },
  optionsFromMeta: (formula1: string | undefined, formula2: string | undefined) => DropdownOption[],
  sheet: () => any,
) {
  const registry = injector.get(DataValidatorRegistryService);
  const patchValidator = (id: string) => {
    const item = registry.getValidatorItem(id) as
      | { isValidType: (...args: any[]) => Promise<boolean>; __suiteleaf?: boolean }
      | undefined;
    if (!item || item.__suiteleaf) return;
    const original = item.isValidType.bind(item);
    item.isValidType = async (cellInfo: any, formula: any, rule: any) => {
      const options = isRangeFormula(rule?.formula1)
        ? optionsFromMeta(rule.formula1, rule.formula2)
        : optionsFromRule(rule?.formula1, rule?.formula2);
      const multiple = rule?.type === "listMultiple";
      if (options.length) {
        const tokens = multiple ? dropdownTokens(cellInfo?.value) : [cellInfo?.value];
        const meaningful = tokens.filter((token) => trimmedText(token));
        if (
          meaningful.length &&
          meaningful.every((token) => canonicalOption(token, options))
        )
          return true;
      }
      return original(cellInfo, formula, rule);
    };
    item.__suiteleaf = true;
  };
  patchValidator("list");
  patchValidator("listMultiple");
  const cache = injector.get(DataValidationListCacheService) as {
    computeAndCache: (...args: any[]) => any;
    setCache: (...args: any[]) => void;
    clear?: () => void;
    __suiteleaf?: boolean;
  };
  if (cache && !cache.__suiteleaf) {
    const original = cache.computeAndCache.bind(cache);
    cache.computeAndCache = (
      unitId: string,
      subUnitId: string,
      rule: any,
      formulaResult: unknown,
    ) => {
      const item = original(unitId, subUnitId, rule, formulaResult);
      if (rule?.type !== "list" && rule?.type !== "listMultiple") return item;
      const seen = new Set<string>();
      const unique = (item.list as string[])
        .map((label) => String(label).trim())
        .filter((label) => {
          if (!label) return false;
          const key = label.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      const painted = colorsForLabels(
        unique,
        rule.formula2,
        rule.bizInfo?.suiteleafDropdown ?? null,
      );
      const listWithColor = unique.map((label) => ({
        label,
        color: painted[label] || "",
      }));
      const colorMap: Record<string, string> = {};
      for (const entry of listWithColor)
        if (entry.color) colorMap[entry.label] = entry.color;
      const next = {
        list: unique,
        listWithColor,
        colorMap,
        set: new Set(unique),
      };
      cache.setCache(unitId, subUnitId, rule.uid, next);
      return next;
    };
    cache.__suiteleaf = true;
    cache.clear?.();
    sheet()?.refreshCanvas?.();
  }
}
