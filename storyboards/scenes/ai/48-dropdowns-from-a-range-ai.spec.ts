import { readFileSync } from "node:fs";
import { createFile, serializeFile } from "../../../packages/core/src";
import { listRuleFields, optionsFromRule } from "../../../apps/web/src/editors/sheet-dropdowns";
import { ready } from "../fixtures";
import { askAgent, beat, caption, describeRun, expect, openApp, test } from "../harness";

const widths = [156, 128, 188, 228];

const names = [
  "Amina Yusuf", "Priya Shah", "Luis Ortega", "Nora Berg", "Helen Cho",
  "Owen Brooks", "Mei Chen", "Sam Whitfield", "Aiko Tanaka", "Femi Adeyemi",
  "Clara Novak", "Raj Mehta", "Elena Petrova", "Tom Gallagher", "Ida Bergstrom",
  "Jonah Ellis", "Leila Haddad", "Marco Silva", "Nina Kovacs", "Omar Farouk",
  "Paula Niemi", "Quinn Adler", "Rosa Delgado", "Sofia Marin", "Tariq Hassan",
  "Uma Iversen", "Victor Lang", "Willa Grant", "Xavier Boyd", "Yara Nasser",
  "Zoe Kaplan", "Ben Okonkwo", "Carmen Diaz", "David Berg", "Esther Cole",
  "Farah Qureshi", "George Hale", "Hana Suzuki", "Ivan Petrov", "Julia Santos",
];

function statusOf(i: number) {
  if (i === 3 || i === 7 || i === 14) return "Maybe";
  if (i === 0) return "Confirmed";
  if (i % 11 === 0) return "Waitlist";
  if (i % 9 === 0) return "Can't make it";
  return "Confirmed";
}

function roleOf(i: number) {
  if (i === 3 || i === 4 || i === 6) return "";
  return ["Helper", "Driver", "Cook"][i % 3];
}

const prompt = [
  "The Volunteer roster sheet is already open.",
  "Leave every name, shift, status, and role exactly as it is.",
  "Do not undo. Do not call set_cells. Do not edit the Statuses sheet.",
  'Call set_dropdown with range "C2:C41", source "Statuses!A2:A5", colors ["Confirmed=green", "Maybe=amber", "Can\'t make it=grey", "Waitlist=blue"], and reject true.',
  "That points the Status column at the Statuses range instead of a fixed list and keeps those chip colors.",
  'Call set_dropdown with range "D2:D41", options ["Helper", "Driver", "Cook"], colors ["green", "amber", "grey"], multiple true, and reject true.',
  "That makes the Roles column a dropdown that allows more than one of Helper, Driver, and Cook.",
  "Then stop.",
].join(" ");

function grid(rows: string[][]) {
  return Object.fromEntries(
    rows.map((row, r) => [
      r,
      Object.fromEntries(row.flatMap((value, c) => (value === "" ? [] : [[c, { v: value, t: 1 }]]))),
    ]),
  );
}

function rosterFile() {
  const file = createFile("sheet", "Volunteer roster");
  if (file.kind !== "sheet") throw new Error("Expected a workbook");
  const rosterId = file.content.workbook.sheetOrder[0];
  const statusesId = crypto.randomUUID();
  const roster = file.content.workbook.sheets[rosterId];
  roster.name = "Volunteer roster";
  const statuses = structuredClone(roster);
  statuses.id = statusesId;
  statuses.name = "Statuses";
  file.content.workbook.sheetOrder.push(statusesId);
  file.content.workbook.sheets[statusesId] = statuses;
  roster.cellData = grid([
    ["Name", "Shift", "Status", "Role"],
    ...names.map((name, i) => [
      name,
      ["Morning", "Afternoon", "Evening"][i % 3],
      statusOf(i),
      roleOf(i),
    ]),
  ]);
  (roster as { columnData: Record<number, { w: number }> }).columnData = Object.fromEntries(
    widths.map((w, i) => [i, { w }]),
  );
  statuses.cellData = grid([["Status"], ["Confirmed"], ["Maybe"], ["Can't make it"], ["Waitlist"]]);
  (statuses as { columnData: Record<number, { w: number }> }).columnData = { 0: { w: 180 } };
  const statusOptions = optionsFromRule(
    JSON.stringify(["Confirmed", "Maybe", "Can't make it", "Waitlist"]),
    "#b7e1cd,#ffe599,#d9d9d9,#c9daf8",
  );
  const shiftOptions = optionsFromRule(
    JSON.stringify(["Morning", "Afternoon", "Evening"]),
    "#c9daf8,#ffe599,#d9d9d9",
  );
  file.content.workbook.resources = [
    {
      name: "SHEET_DATA_VALIDATION_PLUGIN",
      data: JSON.stringify({
        [rosterId]: [
          {
            uid: "status",
            ...listRuleFields(statusOptions, true),
            ranges: [{ startRow: 1, endRow: 40, startColumn: 2, endColumn: 2 }],
          },
          {
            uid: "shift",
            ...listRuleFields(shiftOptions, true),
            ranges: [{ startRow: 1, endRow: 40, startColumn: 1, endColumn: 1 }],
          },
        ],
      }),
    },
  ];
  return file;
}

type Rule = {
  type?: string;
  formula1?: string;
  formula2?: string;
  errorStyle?: number;
  renderMode?: number;
  ranges?: { startRow: number; endRow: number; startColumn: number; endColumn: number }[];
  bizInfo?: { suiteleafDropdown?: { colors?: Record<string, string> } };
};

function chipColor(rule: Rule, label: string, labels: string[]): string {
  const named = rule.bizInfo?.suiteleafDropdown?.colors;
  if (named) {
    const found = Object.entries(named).find(([name]) => name.toLowerCase() === label.toLowerCase());
    if (found) return found[1].toLowerCase();
  }
  const raw = String(rule.formula2 ?? "").trim();
  if (raw.startsWith("{")) {
    const colors = (JSON.parse(raw) as { colors?: Record<string, string> }).colors ?? {};
    const found = Object.entries(colors).find(([name]) => name.toLowerCase() === label.toLowerCase());
    if (found) return found[1].toLowerCase();
  }
  const index = labels.findIndex((item) => item.toLowerCase() === label.toLowerCase());
  return raw.split(",")[index]?.trim().toLowerCase() ?? "";
}

test("48-dropdowns-from-a-range-ai", async ({ page }) => {
  await openApp(page);
  await caption(page, "Lena's Status column is already a dropdown. The official names live on Statuses.");
  await page.locator("input[type=file]").setInputFiles({
    name: "Volunteer roster.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(rosterFile())),
  });
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  await ready(page);
  await caption(
    page,
    "She asks SuiteLeaf's on-device assistant to follow that list and allow more than one role.",
    1600,
  );
  await caption(page, "", 0);

  const run = await askAgent(page, prompt);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await page.getByRole("button", { name: "Close assistant" }).click();
  await beat(page, 400);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(readFileSync((await (await download).path())!, "utf8"));
  const book = saved.content.workbook;
  const rosterId = Object.keys(book.sheets).find((id) => book.sheets[id].name === "Volunteer roster");
  const statusesId = Object.keys(book.sheets).find((id) => book.sheets[id].name === "Statuses");
  const cells = book.sheets[rosterId!].cellData;
  const statuses = book.sheets[statusesId!].cellData;
  const resources = book.resources.find((resource: { name: string }) => resource.name === "SHEET_DATA_VALIDATION_PLUGIN");
  const rules = (resources ? JSON.parse(resources.data)[rosterId!] ?? [] : []) as Rule[];
  const statusRule = rules.find((rule) => String(rule.formula1).includes("Statuses"));
  const roleRule = rules.find((rule) => rule.type === "listMultiple");
  const shiftRule = rules.find((rule) => {
    const formula = String(rule.formula1 ?? "");
    return formula.includes("Morning") && formula.includes("Evening");
  });
  const detail = `${why}\nRules: ${JSON.stringify(rules)}\nRoster: ${JSON.stringify(cells)}\nStatuses: ${JSON.stringify(statuses)}`;

  expect(statusRule, detail).toBeTruthy();
  expect(String(statusRule?.formula1), detail).toBe("=Statuses!$A$2:$A$5");
  expect(statusRule?.type, detail).toBe("list");
  expect(statusRule?.errorStyle, detail).toBe(1);
  expect(statusRule?.renderMode, detail).toBe(2);
  expect(statusRule?.ranges, detail).toEqual([
    expect.objectContaining({ startRow: 1, endRow: 40, startColumn: 2, endColumn: 2 }),
  ]);
  const statusLabels = ["Confirmed", "Maybe", "Can't make it", "Waitlist"];
  const color = (label: string) => chipColor(statusRule!, label, statusLabels);
  expect(color("Confirmed"), detail).toBe("#b7e1cd");
  expect(color("Maybe"), detail).toBe("#ffe599");
  expect(color("Can't make it"), detail).toBe("#d9d9d9");
  expect(color("Waitlist"), detail).toBe("#c9daf8");

  expect(roleRule, detail).toBeTruthy();
  expect(JSON.parse(String(roleRule?.formula1)), detail).toEqual(["Helper", "Driver", "Cook"]);
  expect(roleRule?.formula2, detail).toBe("#b7e1cd,#ffe599,#d9d9d9");
  expect(roleRule?.errorStyle, detail).toBe(1);
  expect(roleRule?.renderMode, detail).toBe(2);
  expect(roleRule?.ranges, detail).toEqual([
    expect.objectContaining({ startRow: 1, endRow: 40, startColumn: 3, endColumn: 3 }),
  ]);

  expect(shiftRule, detail).toBeTruthy();
  expect(JSON.parse(String(shiftRule?.formula1)), detail).toEqual(["Morning", "Afternoon", "Evening"]);

  expect(statuses[0]?.[0]?.v, detail).toBe("Status");
  expect(statuses[1]?.[0]?.v, detail).toBe("Confirmed");
  expect(statuses[2]?.[0]?.v, detail).toBe("Maybe");
  expect(statuses[3]?.[0]?.v, detail).toBe("Can't make it");
  expect(statuses[4]?.[0]?.v, detail).toBe("Waitlist");
  expect(statuses[5], detail).toBeUndefined();

  names.forEach((name, i) => {
    expect(cells[i + 1]?.[0]?.v, `${name}\n${detail}`).toBe(name);
    expect(cells[i + 1]?.[1]?.v, `${name} shift\n${detail}`).toBe(["Morning", "Afternoon", "Evening"][i % 3]);
    expect(cells[i + 1]?.[2]?.v, `${name} status\n${detail}`).toBe(statusOf(i));
    expect(cells[i + 1]?.[3]?.v ?? "", `${name} role\n${detail}`).toBe(roleOf(i));
  });
  expect(cells[0]?.[2]?.v, detail).toBe("Status");
  expect(cells[0]?.[3]?.v, detail).toBe("Role");
  await caption(page, "Status follows Statuses, the chips keep their colors, and a role can be more than one.", 2000);
});
