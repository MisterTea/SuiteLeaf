import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { createFile, serializeFile } from "../../packages/core/src";
import { cellHyperlink } from "../../packages/core/src/sheet-links";

async function openSuppliers(page: Page) {
  const file = createFile("sheet", "Suppliers");
  if (file.kind !== "sheet") throw new Error("Expected a workbook");
  const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  const rows = [["Supplier"], ["Northwind"], ["Contoso"], ["Fabrikam"]];
  sheet.cellData = Object.fromEntries(
    rows.map((row, r) => [r, { 0: { v: row[0], t: 1 } }]),
  );
  (sheet as { columnData: Record<number, { w: number }> }).columnData = {
    0: { w: 180 },
  };
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "Suppliers.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await page.locator("[data-sheet-ready='true']").waitFor();
}

async function select(page: Page, ref: string) {
  const box = page.locator(".sheet-host input.univer-size-full");
  await box.fill(ref);
  await box.press("Enter");
}

test("a cell link keeps its label, refuses unsafe addresses, and survives the file", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  await openSuppliers(page);
  await select(page, "A2");
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Insert link" });
  await expect(dialog.getByLabel("Link text")).toHaveValue("Northwind");
  const address = dialog.getByLabel("Link address");
  await expect(address).toBeFocused();
  await address.fill("javascript:alert(1)");
  await address.press("Enter");
  await expect(dialog.getByRole("alert")).toContainText("web address");
  await expect(page.getByRole("link", { name: "https://example.org/northwind" })).toHaveCount(0);

  await address.fill("example.org/northwind");
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(dialog).toBeHidden();
  const link = page.getByRole("link", { name: "https://example.org/northwind" });
  await expect(link).toBeVisible();

  let popped = false;
  page.on("popup", () => {
    popped = true;
  });
  const host = (await page.locator(".sheet-host").boundingBox())!;
  await page.mouse.click(host.x + 46 + 40, host.y + 58 + 24);
  await page.waitForTimeout(300);
  expect(popped).toBe(false);
  await expect(page.getByRole("toolbar", { name: "Spreadsheet formatting" })).toBeVisible();

  const popupPromise = page.waitForEvent("popup");
  await link.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/example\.org\/northwind/);
  expect(page.url()).not.toContain("example.org");
  await popup.close();

  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Link\b/ }).click();
  const edit = page.getByRole("dialog", { name: "Edit link" });
  await expect(edit.getByLabel("Link text")).toHaveValue("Northwind");
  await expect(edit.getByLabel("Link address")).toHaveValue("https://example.org/northwind");
  await edit.getByLabel("Link address").fill("example.org/northwind/orders");
  await edit.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("link", { name: "https://example.org/northwind/orders" })).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  const cells = saved.content.workbook.sheets[saved.content.workbook.sheetOrder[0]].cellData;
  expect(cells[1][0].v).toBe("Northwind");
  expect(cellHyperlink(cells[1][0])).toBe("https://example.org/northwind/orders");

  await select(page, "A2");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("dialog", { name: "Edit link" }).getByRole("button", { name: "Remove link" }).click();
  await expect(page.getByRole("group", { name: "Cell link" })).toHaveCount(0);

  const plain = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const removed = JSON.parse(await readFile((await (await plain).path())!, "utf8"));
  const plainCells = removed.content.workbook.sheets[removed.content.workbook.sheetOrder[0]].cellData;
  expect(plainCells[1][0].v).toBe("Northwind");
  expect(cellHyperlink(plainCells[1][0])).toBeNull();
  expect(errors).toEqual([]);
});
