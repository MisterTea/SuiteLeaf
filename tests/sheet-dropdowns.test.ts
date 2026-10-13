import { expect, test } from "vitest";
import { createFile } from "../packages/core/src";
import { excelErrorStyle, univerErrorStyle } from "../packages/core/src/excel-validation";
import { importOffice } from "../packages/core/src/office";
import { exportXlsx } from "../packages/core/src/xlsx-export";
import {
  displayRangeRef,
  extendRef,
  formatRangeFormula,
  parseA1Ref,
  reconcileSource,
} from "../apps/web/src/editors/sheet-dropdown-source";
import {
  DROPDOWN_COLORS,
  allowedOptionsMessage,
  canonicalOption,
  chipTextColor,
  contrastRatio,
  dropdownTokens,
  filteredOptions,
  findMismatches,
  isRangeFormula,
  listRuleFields,
  mismatchNotice,
  mostCommonLabel,
  optionsFromRule,
  optionsFromValues,
  rejectionMessage,
  renamedOptions,
  rewriteListValues,
  storedLabel,
  suggestOption,
  type DropdownOption,
} from "../apps/web/src/editors/sheet-dropdowns";

const roster = [
  "Confirmed",
  "confirmed",
  "Confirmed ",
  "Tentative",
  "tentative ",
  "yes",
  "yes",
  "tbc",
  "",
  "  ",
];

test("options from a column are trimmed and grouped ignoring case", () => {
  const options = optionsFromValues(roster);
  expect(options.map((option) => option.label)).toEqual([
    "Confirmed",
    "Tentative",
    "yes",
    "tbc",
  ]);
  expect(new Set(options.map((option) => option.color)).size).toBe(4);
});

test("the most common spelling wins, and capitals break a tie", () => {
  expect(optionsFromValues(["yes", "Yes", "yes"]).map((o) => o.label)).toEqual(["yes"]);
  expect(optionsFromValues(["yes", "Yes"]).map((o) => o.label)).toEqual(["Yes"]);
});

test("matching ignores surrounding spaces and letter case", () => {
  const options = [{ label: "Confirmed" }];
  expect(canonicalOption("Confirmed ", options)).toBe("Confirmed");
  expect(canonicalOption("  confirmed", options)).toBe("Confirmed");
  expect(canonicalOption("yes", options)).toBeNull();
  expect(canonicalOption("", options)).toBeNull();
  expect(canonicalOption(null, options)).toBeNull();
});

test("every chip color has readable text without a chosen text color", () => {
  for (const color of DROPDOWN_COLORS) {
    const text = chipTextColor(color.value);
    expect(contrastRatio(color.value, text)).toBeGreaterThanOrEqual(4.5);
  }
  expect(chipTextColor("#111111")).toBe("#ffffff");
});

test("renaming an option is tracked by id and rewrites the old label", () => {
  const before = optionsFromValues(["Tentative", "Confirmed"]);
  const after = before.map((option) =>
    option.label === "Tentative" ? { ...option, label: "Maybe" } : option,
  );
  expect(renamedOptions(before, after)).toEqual([{ from: "Tentative", to: "Maybe" }]);
  expect(storedLabel("tentative ", after, renamedOptions(before, after))).toBe("Maybe");
  expect(storedLabel("Confirmed ", after, [])).toBe("Confirmed");
  expect(storedLabel("Confirmed", after, [])).toBeUndefined();
});

test("leftovers are counted and a weak match suggests the most common status", () => {
  const options = optionsFromValues(["Confirmed", "Confirmed", "Tentative", "yes"]);
  const kept = options.filter((option) => option.label !== "yes");
  const popular = mostCommonLabel(
    ["Confirmed", "Confirmed", "Tentative", "yes"],
    kept,
  );
  expect(popular).toBe("Confirmed");
  const mismatches = findMismatches(
    [{ row: 4, column: 2, value: "yes" }],
    kept,
    popular,
  );
  expect(mismatches).toEqual([
    { row: 4, column: 2, value: "yes", suggestion: "Confirmed" },
  ]);
  expect(mismatchNotice(6)).toBe("6 cells don't match the list");
  expect(mismatchNotice(1)).toBe("1 cell doesn't match the list");
  expect(suggestOption("Can", ["Confirmed", "Can't make it"])).toBe("Can't make it");
});

test("the refusal message names the options", () => {
  expect(allowedOptionsMessage(["Confirmed", "Tentative", "Can't make it"])).toBe(
    "Choose Confirmed, Tentative, or Can't make it.",
  );
});

test("typing filters options and a spaced value is stored as the option", () => {
  const options = optionsFromValues(["Confirmed", "Tentative", "Can't make it"]);
  expect(filteredOptions(options, "ma").map((option) => option.label)).toEqual([
    "Can't make it",
  ]);
  const params = {
    range: { startRow: 4, endRow: 4, startColumn: 2, endColumn: 2 },
    value: { v: "Confirmed " },
  };
  expect(rewriteListValues(params, () => options)).toBe(true);
  expect(params.value.v).toBe("Confirmed");
  const invalid = {
    range: { startRow: 5, endRow: 5, startColumn: 2, endColumn: 2 },
    value: { v: "maybe" },
  };
  expect(rewriteListValues(invalid, () => options)).toBe(false);
  expect(invalid.value.v).toBe("maybe");
});

test("a pasted block tidies every matching cell and leaves the rest", () => {
  const options: DropdownOption[] = [
    { id: "a", label: "Confirmed", color: "#b7e1cd" },
  ];
  const params = {
    value: {
      1: { 2: { v: "Confirmed " } },
      2: { 2: { v: "nope" } },
      3: { 2: { v: "confirmed" } },
    },
  };
  expect(rewriteListValues(params, (row) => (row === 2 ? null : options))).toBe(true);
  expect(params.value[1][2].v).toBe("Confirmed");
  expect(params.value[2][2].v).toBe("nope");
  expect(params.value[3][2].v).toBe("Confirmed");
});

test("list rules round-trip through Excel with the same options and reject setting", async () => {
  const file = createFile("sheet", "Volunteer roster");
  if (file.kind !== "sheet") throw new Error();
  const id = file.content.workbook.sheetOrder[0];
  const options = optionsFromRule(
    JSON.stringify(["Confirmed", "Maybe", "Can't make it", "Waitlist"]),
    "#b7e1cd,#ffe599,#d9d9d9,#c9daf8",
  );
  const rule = listRuleFields(options, true);
  file.content.workbook.resources = [
    {
      name: "SHEET_DATA_VALIDATION_PLUGIN",
      data: JSON.stringify({
        [id]: [
          {
            uid: "status",
            ...rule,
            ranges: [{ startRow: 1, endRow: 40, startColumn: 2, endColumn: 2 }],
          },
        ],
      }),
    },
  ];
  const bytes = await exportXlsx(file);
  const xml = await (
    await import("jszip").then((m) => m.default.loadAsync(bytes))
  )
    .file("xl/worksheets/sheet1.xml")!
    .async("string");
  expect(xml).toContain('type="list"');
  expect(xml).toContain('errorStyle="stop"');
  expect(xml).toContain("showErrorMessage=\"1\"");
  expect(xml).toContain("Confirmed,Maybe,Can&apos;t make it,Waitlist");
  expect(xml).toContain("Choose Confirmed, Maybe, Can&apos;t make it, or Waitlist.");
  const imported = await importOffice(bytes, "xlsx", "roster.xlsx");
  if (imported.file.kind !== "sheet") throw new Error();
  const saved = imported.file.content.workbook.resources?.find(
    (resource) => resource.name === "SHEET_DATA_VALIDATION_PLUGIN",
  );
  const [restored] = JSON.parse(saved?.data ?? "{}")[
    imported.file.content.workbook.sheetOrder[0]
  ];
  expect(optionsFromRule(restored.formula1, restored.formula2).map((o) => o.label)).toEqual([
    "Confirmed",
    "Maybe",
    "Can't make it",
    "Waitlist",
  ]);
  expect(restored.errorStyle).toBe(1);
  expect(restored.showErrorMessage).toBe(true);
  expect(univerErrorStyle("warning")).toBe(2);
  expect(excelErrorStyle(2)).toBe("warning");
});

test("a range reference is not read as a list of labels", () => {
  const formula = formatRangeFormula(parseA1Ref("Statuses!A2:A5")!);
  expect(formula).toBe("=Statuses!$A$2:$A$5");
  expect(displayRangeRef(formula)).toBe("Statuses!A2:A5");
  expect(isRangeFormula(formula)).toBe(true);
  expect(optionsFromRule(formula, "#b7e1cd")).toEqual([]);
  expect(parseA1Ref("'Food bank'!$B$2:$B$4")?.sheet).toBe("Food bank");
  expect(
    displayRangeRef("=[e129dafd-1a9f-43ea-bca8-69153e5cace1]Statuses!$A$2:$A$6"),
  ).toBe("Statuses!A2:A6");
});

test("renaming a source cell keeps its colour and a blank is not an option", () => {
  const previous = reconcileSource(
    [],
    [
      { row: 1, column: 0, value: "Confirmed" },
      { row: 2, column: 0, value: "Maybe" },
      { row: 3, column: 0, value: "Can't make it" },
      { row: 4, column: 0, value: "Waitlist" },
    ],
  ).sources;
  const renamed = reconcileSource(previous, [
    { row: 1, column: 0, value: "Confirmed" },
    { row: 2, column: 0, value: "Perhaps" },
    { row: 3, column: 0, value: "" },
    { row: 4, column: 0, value: "Can't make it" },
    { row: 5, column: 0, value: "Waitlist" },
    { row: 6, column: 0, value: "Training" },
  ]);
  expect(renamed.options.map((option) => option.label)).toEqual([
    "Confirmed",
    "Perhaps",
    "Can't make it",
    "Waitlist",
    "Training",
  ]);
  expect(renamed.renames).toEqual([{ from: "Maybe", to: "Perhaps" }]);
  const maybe = previous.find((cell) => cell.label === "Maybe")!;
  const perhaps = renamed.options.find((option) => option.label === "Perhaps")!;
  expect(perhaps.color).toBe(maybe.color);
  expect(renamed.options.find((option) => option.label === "Confirmed")?.color).toBe(
    previous.find((cell) => cell.label === "Confirmed")?.color,
  );
  expect(extendRef(parseA1Ref("Statuses!A2:A5")!, "Training")?.endRow).toBe(5);
  expect(extendRef(parseA1Ref("Statuses!A2:A5")!, "  ")).toBeNull();
});

test("a bad token is refused and a trailing space still matches", () => {
  const options: DropdownOption[] = [
    { id: "h", label: "Helper", color: "#b7e1cd" },
    { id: "d", label: "Driver", color: "#ffe599" },
    { id: "c", label: "Cook", color: "#d9d9d9" },
  ];
  const params = {
    range: { startRow: 5, endRow: 5, startColumn: 3, endColumn: 3 },
    value: { v: "Driver, Cook, Boss" },
  };
  const rejected: string[] = [];
  expect(
    rewriteListValues(
      params,
      () => ({ options, multiple: true, reject: true }),
      (rejection) => rejected.push(...rejection.rejected),
    ),
  ).toBe(true);
  expect(params.value.v).toBe("Driver, Cook");
  expect(rejected).toEqual(["Boss"]);
  expect(rejectionMessage(rejected, options.map((option) => option.label))).toBe(
    "Boss isn't an option. Choose Helper, Driver, or Cook.",
  );
  const spaced = {
    range: { startRow: 6, endRow: 6, startColumn: 3, endColumn: 3 },
    value: { v: "Driver " },
  };
  expect(rewriteListValues(spaced, () => ({ options, multiple: true, reject: true }))).toBe(
    true,
  );
  expect(spaced.value.v).toBe("Driver");
  expect(dropdownTokens('["Driver","Cook"]')).toEqual(["Driver", "Cook"]);
  expect(storedLabel("Driver, Cook", options, [{ from: "Cook", to: "Chef" }], true)).toBe(
    "Driver, Chef",
  );
  expect(findMismatches([{ row: 5, column: 3, value: "Driver, Boss" }], options, undefined, true)).toHaveLength(1);
});

test("a from-a-range rule round-trips through Excel as that range", async () => {
  const file = createFile("sheet", "Volunteer roster");
  if (file.kind !== "sheet") throw new Error();
  const rosterId = file.content.workbook.sheetOrder[0];
  const statusesId = crypto.randomUUID();
  const roster = file.content.workbook.sheets[rosterId];
  roster.name = "Volunteer roster";
  file.content.workbook.sheetOrder.push(statusesId);
  file.content.workbook.sheets[statusesId] = {
    ...structuredClone(roster),
    id: statusesId,
    name: "Statuses",
    cellData: {
      1: { 0: { v: "Confirmed", t: 1 } },
      2: { 0: { v: "Perhaps", t: 1 } },
      3: { 0: { v: "Can't make it", t: 1 } },
      4: { 0: { v: "Waitlist", t: 1 } },
      5: { 0: { v: "Training", t: 1 } },
    },
  };
  file.content.workbook.resources = [
    {
      name: "SHEET_DATA_VALIDATION_PLUGIN",
      data: JSON.stringify({
        [rosterId]: [
          {
            uid: "status",
            ...listRuleFields(
              optionsFromRule(
                JSON.stringify(["Confirmed", "Perhaps"]),
                "#b7e1cd,#ffe599",
              ),
              true,
            ),
            formula1: "=Statuses!$A$2:$A$6",
            formula2: JSON.stringify({
              colors: { Confirmed: "#b7e1cd", Perhaps: "#ffe599" },
              sources: [],
            }),
            ranges: [{ startRow: 1, endRow: 40, startColumn: 2, endColumn: 2 }],
          },
          {
            uid: "roles",
            type: "listMultiple",
            formula1: JSON.stringify(["Helper", "Driver", "Cook"]),
            formula2: "#b7e1cd,#ffe599,#d9d9d9",
            allowBlank: true,
            showErrorMessage: true,
            showDropDown: true,
            errorStyle: 1,
            renderMode: 2,
            error: "Choose Helper, Driver, or Cook.",
            ranges: [{ startRow: 1, endRow: 40, startColumn: 3, endColumn: 3 }],
          },
        ],
      }),
    },
  ];
  const bytes = await exportXlsx(file);
  const zip = await import("jszip").then((m) => m.default.loadAsync(bytes));
  const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  expect(xml).toContain("Statuses!$A$2:$A$6");
  expect(xml).not.toContain("&quot;Statuses!");
  const imported = await importOffice(bytes, "xlsx", "roster.xlsx");
  if (imported.file.kind !== "sheet") throw new Error();
  const saved = imported.file.content.workbook.resources?.find(
    (resource) => resource.name === "SHEET_DATA_VALIDATION_PLUGIN",
  );
  const rules = JSON.parse(saved?.data ?? "{}")[
    imported.file.content.workbook.sheetOrder[0]
  ] as { formula1: string; type: string }[];
  const status = rules.find((rule) => String(rule.formula1).includes("Statuses"));
  expect(status?.formula1).toBe("=Statuses!$A$2:$A$6");
  expect(status?.type).toBe("list");
});
