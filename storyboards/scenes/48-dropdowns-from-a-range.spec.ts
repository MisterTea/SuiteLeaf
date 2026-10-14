import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import JSZip from "jszip";
import { createFile, serializeFile } from "../../packages/core/src";
import { listRuleFields, optionsFromRule } from "../../apps/web/src/editors/sheet-dropdowns";
import { beat, caption, expect, selectCells, test, typeSlowly } from "./harness";

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

async function ready(page: Page) {
  await page.getByRole("toolbar", { name: "Spreadsheet formatting" }).waitFor();
  await beat(page, 600);
}

async function backHome(page: Page) {
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("heading", { name: "Good ideas start here." }).waitFor();
  await beat(page, 400);
}

async function openSheet(page: Page, name: string) {
  await page.getByRole("tab", { name, exact: true }).click();
  await beat(page, 500);
}

test("48-dropdowns-from-a-range", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Lena's Status column is already a dropdown. The official names live on a Statuses sheet.",
    1600,
  );

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
  const grid = (rows: string[][]) =>
    Object.fromEntries(
      rows.map((row, r) => [
        r,
        Object.fromEntries(
          row.flatMap((value, c) => (value === "" ? [] : [[c, { v: value, t: 1 }]])),
        ),
      ]),
    );
  const statusOf = (i: number) => {
    if (i === 3 || i === 7 || i === 14) return "Maybe";
    if (i === 0) return "Confirmed";
    if (i % 11 === 0) return "Waitlist";
    if (i % 9 === 0) return "Can't make it";
    return "Confirmed";
  };
  roster.cellData = grid([
    ["Name", "Shift", "Status", "Role"],
    ...names.map((name, i) => [
      name,
      ["Morning", "Afternoon", "Evening"][i % 3],
      statusOf(i),
      i === 3 || i === 4 || i === 6 ? "" : ["Helper", "Driver", "Cook"][i % 3],
    ]),
  ]);
  (roster as { columnData: Record<number, { w: number }> }).columnData = Object.fromEntries(
    widths.map((w, i) => [i, { w }]),
  );
  statuses.cellData = grid([
    ["Status"],
    ["Confirmed"],
    ["Maybe"],
    ["Can't make it"],
    ["Waitlist"],
  ]);
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
  await page.locator("input[type=file]").setInputFiles({
    name: "Volunteer roster.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await ready(page);
  await caption(page, "Statuses holds Confirmed, Maybe, Can't make it, and Waitlist. No blanks.", 1400);
  await openSheet(page, "Statuses");
  await beat(page, 900);
  await caption(page, "Volunteer roster, column C, is the old fixed dropdown. Maybe is amber.", 1500);
  await openSheet(page, "Volunteer roster");
  await beat(page, 700);

  await caption(page, "She selects the Status column and switches the dropdown to From a range.", 1200);
  await selectCells(page, "C2:C41");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Dropdown", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Dropdown" });
  await panel.getByRole("radio", { name: "From a range" }).click();
  await beat(page, 400);
  const range = panel.getByRole("textbox", { name: "Source range" });
  await range.click();
  await typeSlowly(page, "Statuses!A2:A5", 45);
  await expect(panel.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(panel.getByText("Maybe", { exact: true })).toBeVisible();
  await expect(panel.getByText("Can't make it", { exact: true })).toBeVisible();
  await expect(panel.getByText("Waitlist", { exact: true })).toBeVisible();
  const maybeRow = panel.locator("li").filter({ hasText: "Maybe" });
  await expect(maybeRow.getByRole("button", { name: "Amber", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await beat(page, 800);
  await panel.getByRole("button", { name: "Done", exact: true }).click();
  await beat(page, 800);
  await caption(page, "Same four colours. Nora in C5 still says Maybe.", 1600);

  await caption(page, "On Statuses she types Training in the next cell. The dropdown follows.", 1200);
  await openSheet(page, "Statuses");
  await selectCells(page, "A6");
  await typeSlowly(page, "Training", 50);
  await page.keyboard.press("Enter");
  await beat(page, 700);
  await openSheet(page, "Volunteer roster");
  await selectCells(page, "C3");
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await beat(page, 300);
  await page.getByRole("menuitem", { name: "Data validation", exact: true }).click();
  await expect(panel.getByRole("textbox", { name: "Source range" })).toHaveValue(/Statuses!A2:A6/);
  const training = panel.locator("li").filter({ hasText: "Training" });
  await training.getByRole("button", { name: "Purple", exact: true }).click();
  await beat(page, 500);
  await panel.getByRole("button", { name: "Done", exact: true }).click();
  await beat(page, 400);
  await selectCells(page, "C3");
  await typeSlowly(page, "tr", 80);
  const choices = page.getByRole("listbox", { name: "Dropdown options" });
  await expect(choices).toContainText("Training");
  await expect(choices.getByRole("option")).toHaveCount(1);
  await beat(page, 700);
  await page.keyboard.press("Enter");
  await beat(page, 600);
  await caption(page, "Priya is Training, in purple. Maybe is still amber.", 1600);

  await caption(page, "She renames Maybe to Perhaps on the source sheet. The colour stays.", 1200);
  await openSheet(page, "Statuses");
  await selectCells(page, "A3");
  await typeSlowly(page, "Perhaps", 55);
  await page.keyboard.press("Enter");
  await beat(page, 800);
  await openSheet(page, "Volunteer roster");
  await selectCells(page, "C5");
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await beat(page, 300);
  await page.getByRole("menuitem", { name: "Data validation", exact: true }).click();
  const perhaps = panel.locator("li").filter({ hasText: "Perhaps" });
  await expect(perhaps.getByRole("button", { name: "Amber", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(panel.getByText("Maybe", { exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await beat(page, 500);

  await caption(page, "A blank inserted in the range is not an option.", 1100);
  await openSheet(page, "Statuses");
  await selectCells(page, "A4");
  const host = page.locator(".sheet-host");
  const hostBox = (await host.boundingBox())!;
  await page.mouse.click(hostBox.x + 20, hostBox.y + 46 + 24 * 3 + 12, { button: "right" });
  await beat(page, 500);
  const insertAbove = page.locator("button").filter({ hasText: "rows above" });
  await insertAbove.click({ position: { x: 16, y: 14 } });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await beat(page, 700);
  await openSheet(page, "Volunteer roster");
  await selectCells(page, "C5");
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await beat(page, 300);
  await page.getByRole("menuitem", { name: "Data validation", exact: true }).click();
  await expect(panel.locator("li")).toHaveCount(5);
  await expect(panel.getByText("Perhaps", { exact: true })).toBeVisible();
  await expect(panel.getByText("Training", { exact: true })).toBeVisible();
  await expect(panel.getByText("Option", { exact: true })).toHaveCount(0);
  await beat(page, 1000);
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await beat(page, 400);

  await caption(page, "Roles can be more than one. Helper, Driver, and Cook, and nothing else.", 1200);
  await selectCells(page, "D2:D41");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await beat(page, 350);
  await page.getByRole("menuitem", { name: "Dropdown", exact: true }).click();
  await expect(panel.getByLabel("Option 1")).toHaveValue("Helper");
  await expect(panel.getByLabel("Option 2")).toHaveValue("Driver");
  await expect(panel.getByLabel("Option 3")).toHaveValue("Cook");
  await panel.getByRole("checkbox", { name: "Allow more than one" }).check();
  await expect(panel.getByRole("checkbox", { name: "Reject other values" })).toBeChecked();
  await beat(page, 700);
  await panel.getByRole("button", { name: "Done", exact: true }).click();
  await beat(page, 500);

  await caption(page, "In D5 she types dr. Enter adds Driver and leaves the list open.", 1100);
  await selectCells(page, "D5");
  await typeSlowly(page, "dr", 80);
  await expect(choices).toContainText("Driver");
  await expect(choices).not.toContainText("Helper");
  await beat(page, 600);
  await page.keyboard.press("Enter");
  await expect(choices).toBeVisible();
  await beat(page, 500);
  await caption(page, "She adds Cook. Escape closes the list. Both chips stay.", 1000);
  await typeSlowly(page, "co", 80);
  await expect(choices).toContainText("Cook");
  await beat(page, 500);
  await page.keyboard.press("Enter");
  await beat(page, 400);
  await page.keyboard.press("Escape");
  await expect(choices).toBeHidden();
  await beat(page, 800);

  await caption(page, "She pastes Driver, Cook, Boss. Boss is not a role.", 1100);
  await selectCells(page, "D6");
  await page.keyboard.press("F2");
  await page.keyboard.insertText("Driver, Cook, Boss");
  await beat(page, 500);
  await page.keyboard.press("Enter");
  const refused = page.getByRole("alertdialog", { name: "Value not allowed" });
  await expect(refused).toContainText("Boss isn't an option");
  await expect(refused).toContainText("Choose Helper, Driver, or Cook.");
  await beat(page, 1600);
  await refused.getByRole("button", { name: "OK" }).click();
  await beat(page, 400);
  await caption(page, "A trailing space still matches Driver, and the chip keeps its colour.", 1100);
  await selectCells(page, "D8");
  await typeSlowly(page, "Driver ", 70);
  await page.keyboard.press("Enter");
  await beat(page, 800);

  await caption(page, "The Shift dropdown from before still renames cells and rejects anything else.", 1200);
  await page.keyboard.press("Escape");
  await selectCells(page, "B4");
  await expect(page.locator(".sheet-host input.univer-size-full")).toHaveValue(/B4/);
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await beat(page, 300);
  await page.getByRole("menuitem", { name: "Data validation", exact: true }).click();
  await expect(panel.getByLabel("Option 3")).toHaveValue("Evening");
  await panel.getByLabel("Option 3").fill("");
  await panel.getByLabel("Option 3").click();
  await typeSlowly(page, "Night", 60);
  await beat(page, 400);
  await panel.getByRole("button", { name: "Done", exact: true }).click();
  await beat(page, 600);
  await selectCells(page, "B4");
  await typeSlowly(page, "nope", 70);
  await page.keyboard.press("Enter");
  await expect(refused).toContainText("Choose Morning, Afternoon, or Night.");
  await beat(page, 1400);
  await refused.getByRole("button", { name: "OK" }).click();
  await beat(page, 400);

  await caption(page, "The SuiteLeaf file keeps the colours, the range, and Allow more than one.", 1200);
  const nativeDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const nativeBytes = await readFile((await (await nativeDownload).path())!);
  const native = JSON.parse(nativeBytes.toString("utf8"));
  const nativeRules = JSON.parse(
    native.content.workbook.resources.find(
      (resource: { name: string }) => resource.name === "SHEET_DATA_VALIDATION_PLUGIN",
    ).data,
  )[native.content.workbook.sheetOrder[0]];
  const statusRule = nativeRules.find((rule: { formula1?: string }) =>
    String(rule.formula1).includes("Statuses"),
  );
  expect(String(statusRule.formula1)).toContain("Statuses");
  expect(JSON.stringify(statusRule.bizInfo)).toContain("Perhaps");
  expect(JSON.stringify(statusRule.bizInfo)).toContain("#ffe599");
  const roleRule = nativeRules.find((rule: { type?: string }) => rule.type === "listMultiple");
  expect(roleRule).toBeTruthy();
  await beat(page, 500);

  await caption(page, "File › Export XLSX. Excel keeps the Statuses range. Roles are text there.", 1200);
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 350);
  const xlsxDownload = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export XLSX", exact: true }).click();
  const xlsx = await readFile((await (await xlsxDownload).path())!);
  const xml = await (await JSZip.loadAsync(xlsx)).file("xl/worksheets/sheet1.xml")!.async("string");
  expect(xml).toContain("Statuses!");
  expect(xml).toContain('type="list"');
  await beat(page, 500);

  await caption(page, "Opening that workbook restores From a range.", 1100);
  await backHome(page);
  await page.locator("input[type=file]").setInputFiles({
    name: "Volunteer roster.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: xlsx,
  });
  await ready(page);
  await selectCells(page, "C5");
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await beat(page, 300);
  await page.getByRole("menuitem", { name: "Data validation", exact: true }).click();
  await expect(panel.getByRole("radio", { name: "From a range" })).toBeChecked();
  await expect(panel.getByRole("textbox", { name: "Source range" })).toHaveValue(/Statuses!/);
  await beat(page, 1200);
  await panel.getByRole("button", { name: "Close", exact: true }).click();

  await caption(page, "The SuiteLeaf file still allows more than one role, and Perhaps is still amber.", 1200);
  await backHome(page);
  await page.locator("input[type=file]").setInputFiles({
    name: "Volunteer roster.slsheet",
    mimeType: "application/json",
    buffer: nativeBytes,
  });
  // An identical copy opens directly. A changed copy asks before replacing.
  const replace = page.getByRole("button", { name: "Replace", exact: true });
  const opened = page.getByRole("toolbar", { name: "Spreadsheet formatting" });
  await expect(replace.or(opened)).toBeVisible();
  if (await replace.isVisible()) await replace.click();
  await ready(page);
  await selectCells(page, "D5");
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await beat(page, 300);
  await page.getByRole("menuitem", { name: "Data validation", exact: true }).click();
  await expect(panel.getByRole("checkbox", { name: "Allow more than one" })).toBeChecked();
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await beat(page, 300);
  await selectCells(page, "C5");
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await beat(page, 300);
  await page.getByRole("menuitem", { name: "Data validation", exact: true }).click();
  await expect(panel.getByRole("radio", { name: "From a range" })).toBeChecked();
  await expect(
    panel.locator("li").filter({ hasText: "Perhaps" }).getByRole("button", { name: "Amber", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await caption(page, "From a range, several roles, and the amber chip — all still here.", 2000);
});
