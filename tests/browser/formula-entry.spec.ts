import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function native(page: Page) {
  const promise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  return JSON.parse(await readFile((await (await promise).path())!, "utf8"));
}

test("formula suggestions never replace a formula typed past them", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.stack || e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "New spreadsheet" }).click();
  const host = page.locator(".sheet-host");
  await host.waitFor();
  const before = (await host.boundingBox())!.y;
  await page.getByRole("toolbar", { name: "Spreadsheet formatting" }).waitFor();
  expect((await host.boundingBox())!.y).toBe(before);

  const box = page.locator(".sheet-host input.univer-size-full");
  const suggestions = page.locator('ul[data-u-comp="sheets-formula-editor"] li');
  await box.fill("B1");
  await box.press("Enter");
  for (const value of ["5", "7"]) {
    await page.keyboard.type(value);
    await page.keyboard.press("Enter");
  }

  // Pause on "B" until its suggestions open, then finish the formula and commit at once.
  await page.keyboard.type("=SUM(B1:B");
  await expect(suggestions.first()).toBeVisible();
  await page.keyboard.type("2)");
  await page.keyboard.press("Tab");
  await expect(box).toHaveValue("C3");
  await page.keyboard.type("=SUM(B1:B");
  await expect(suggestions.first()).toBeVisible();
  await page.keyboard.type("2)");
  await page.keyboard.press("Enter");
  await expect(box).toHaveValue("B4");

  // Accepting a suggestion that matches what is typed still works, with SUM first.
  await box.fill("D3");
  await box.press("Enter");
  await page.keyboard.type("=su");
  await expect(suggestions.first()).toContainText("SUM");
  await page.keyboard.press("Tab");
  // Univer moves the caret inside "SUM(" 30 ms after accepting; a person never types sooner.
  await page.waitForTimeout(150);
  await page.keyboard.type("B1:B2)");
  await page.keyboard.press("Enter");
  await expect(box).toHaveValue("D4");

  const file = await native(page);
  const cells = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]].cellData;
  for (const column of [1, 2, 3])
    expect(cells[2][column]).toMatchObject({ f: "=SUM(B1:B2)", v: 12 });
  expect(errors).toEqual([]);
});
