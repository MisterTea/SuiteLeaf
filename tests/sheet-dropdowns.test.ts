import { expect, test } from "vitest";
import { createFile } from "../packages/core/src";
import { excelErrorStyle, univerErrorStyle } from "../packages/core/src/excel-validation";
import { importOffice } from "../packages/core/src/office";
import { exportXlsx } from "../packages/core/src/xlsx-export";
import {
  DROPDOWN_COLORS,
  allowedOptionsMessage,
  canonicalOption,
  chipTextColor,
  contrastRatio,
  filteredOptions,
  findMismatches,
  listRuleFields,
  mismatchNotice,
  mostCommonLabel,
  optionsFromRule,
  optionsFromValues,
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
