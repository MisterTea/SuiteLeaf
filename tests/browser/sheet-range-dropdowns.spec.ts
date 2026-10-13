import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { createFile, serializeFile } from "../../packages/core/src";

async function openRoster(page: Page) {
  const file = createFile("sheet", "Volunteer roster");
  if (file.kind !== "sheet") throw new Error();
  const rosterId = file.content.workbook.sheetOrder[0];
  const statusesId = crypto.randomUUID();
  const roster = file.content.workbook.sheets[rosterId];
  roster.name = "Volunteer roster";
  const statuses = structuredClone(roster);
  statuses.id = statusesId;
  statuses.name = "Statuses";
  file.content.workbook.sheetOrder.push(statusesId);
  file.content.workbook.sheets[statusesId] = statuses;
  const cells = (rows: string[][]) =>
    Object.fromEntries(
      rows.map((row, r) => [
        r,
        Object.fromEntries(
          row.flatMap((value, c) => (value === "" ? [] : [[c, { v: value, t: 1 }]])),
        ),
      ]),
    );
  roster.cellData = cells([
    ["Name", "Status", "Role"],
    ["Priya", "Confirmed", "Helper"],
    ["Luis", "Maybe", "Driver"],
    ["Nora", "Maybe", ""],
  ]);
  statuses.cellData = cells([
    ["Status"],
    ["Confirmed"],
    ["Maybe"],
    [""],
    ["Waitlist"],
  ]);
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Volunteer roster.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await page.getByRole("button", { name: "Sheet tools", exact: true }).waitFor();
}

test("dropdowns can read a range and accept more than one choice", async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  await openRoster(page);
  const box = page.locator(".sheet-host input.univer-size-full");
  await box.fill("B2:B4");
  await box.press("Enter");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: "Dropdown", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Dropdown" });
  await panel.getByRole("radio", { name: "From a range" }).click();
  await panel.getByRole("textbox", { name: "Source range" }).fill("Statuses!A2:A4");
  await expect(panel.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(panel.getByText("Maybe", { exact: true })).toBeVisible();
  await expect(panel.getByText("Waitlist", { exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "Done", exact: true }).click();
  await expect(panel).toBeHidden();

  await page.getByText("Statuses", { exact: true }).click();
  await box.fill("A5");
  await box.press("Enter");
  await page.keyboard.type("Training");
  await page.keyboard.press("Enter");
  await page.getByText("Volunteer roster", { exact: true }).last().click();
  await box.fill("B2");
  await box.press("Enter");
  await page.keyboard.type("tr");
  const list = page.getByRole("listbox", { name: "Dropdown options" });
  await expect(list).toContainText("Training");
  await expect(list).not.toContainText("Waitlist");
  await page.keyboard.press("Escape");

  await box.fill("C2:C4");
  await box.press("Enter");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: "Dropdown", exact: true }).click();
  await panel.getByRole("checkbox", { name: "Allow more than one" }).check();
  await expect(panel.getByRole("checkbox", { name: "Reject other values" })).toBeChecked();
  await panel.getByRole("button", { name: "Done", exact: true }).click();

  await box.fill("C4");
  await box.press("Enter");
  await page.keyboard.type("dr");
  await expect(list).toContainText("Driver");
  await page.keyboard.press("Enter");
  await expect(list).toBeVisible();
  await page.keyboard.type("he");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  const rules = JSON.parse(
    saved.content.workbook.resources.find(
      (resource: { name: string }) => resource.name === "SHEET_DATA_VALIDATION_PLUGIN",
    ).data,
  )[saved.content.workbook.sheetOrder[0]];
  const status = rules.find((rule: { formula1?: string }) =>
    String(rule.formula1).includes("Statuses"),
  );
  expect(status.formula1).toContain("Statuses");
  expect(status.formula1).toContain("$A$");
  expect(status.type).toBe("list");
  const roles = rules.find((rule: { type?: string }) => rule.type === "listMultiple");
  expect(roles.formula1).toContain("Helper");
  expect(roles.formula1).toContain("Driver");
  const grid = saved.content.workbook.sheets[saved.content.workbook.sheetOrder[0]].cellData;
  expect(grid[3][2].v).toContain("Driver");
  expect(grid[3][2].v).toContain("Helper");
  expect(errors).toEqual([]);
});
