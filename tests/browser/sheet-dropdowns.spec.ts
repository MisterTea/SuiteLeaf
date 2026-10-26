import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";
import { createFile, serializeFile } from "../../packages/core/src";

async function openRoster(page: Page) {
  const file = createFile("sheet", "Roster");
  if (file.kind !== "sheet") throw new Error();
  const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  const rows = [
    ["Name", "Status"],
    ["Amina", "Confirmed"],
    ["Priya", "Confirmed "],
    ["Luis", "yes"],
  ];
  sheet.cellData = Object.fromEntries(
    rows.map((row, r) => [
      r,
      Object.fromEntries(row.map((v, c) => [c, { v, t: 1 }])),
    ]),
  );
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "Roster.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await page.locator("[data-sheet-ready='true']").waitFor();
}

test("dropdown lists are prefilled, reject bad values, and survive the file", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.stack || e.message));
  await openRoster(page);
  const box = page.locator(".sheet-host input.univer-size-full");
  await box.fill("B2:B4");
  await box.press("Enter");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: "Dropdown", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Dropdown" });
  await expect(panel.getByLabel("Option 1")).toHaveValue("Confirmed");
  await expect(panel.getByLabel("Option 2")).toHaveValue("yes");
  await expect(panel.getByRole("checkbox", { name: "Reject other values" })).toBeChecked();
  await panel.getByRole("button", { name: "Remove yes" }).click();
  await panel.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".dropdown-notice")).toContainText("1 cell doesn't match the list");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByRole("dialog", { name: "Review values" })).toContainText("Confirmed");
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.locator(".dropdown-notice")).toBeHidden();

  await box.fill("B2");
  await box.press("Enter");
  await page.keyboard.type("nope");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alertdialog", { name: "Value not allowed" })).toContainText(
    "Choose Confirmed.",
  );
  await page.getByRole("button", { name: "OK" }).click();

  await page.getByRole("button", { name: "Data", exact: true }).click();
  await page.getByRole("menuitem", { name: "Data validation", exact: true }).click();
  await panel.getByLabel("Option 1").fill("Coming");
  await panel.getByRole("button", { name: "Done", exact: true }).click();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  const rule = JSON.parse(
    saved.content.workbook.resources.find(
      (resource: { name: string }) => resource.name === "SHEET_DATA_VALIDATION_PLUGIN",
    ).data,
  )[saved.content.workbook.sheetOrder[0]][0];
  expect(rule.formula1).toContain("Coming");
  expect(rule.errorStyle).toBe(1);
  expect(rule.error).toBe("Choose Coming.");
  expect(rule.renderMode).toBe(2);
  const values = saved.content.workbook.sheets[saved.content.workbook.sheetOrder[0]].cellData;
  expect(values[1][1].v).toBe("Coming");
  expect(values[2][1].v).toBe("Coming");

  await page.getByRole("button", { name: "File", exact: true }).click();
  const xlsxDownload = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export XLSX", exact: true }).click();
  const xml = await (
    await JSZip.loadAsync(await readFile((await (await xlsxDownload).path())!))
  )
    .file("xl/worksheets/sheet1.xml")!
    .async("string");
  expect(xml).toContain('type="list"');
  expect(xml).toContain('errorStyle="stop"');
  expect(xml).toContain("Coming");
  expect(errors).toEqual([]);
});
