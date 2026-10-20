import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import * as XLSX from "xlsx";
import { createFile, serializeFile } from "../../packages/core/src";
import { cellHyperlink } from "../../packages/core/src/sheet-links";
import { beat, caption, expect, selectCells, test, typeSlowly } from "./harness";

const widths = [180];

async function ready(page: Page) {
  await page.getByRole("toolbar", { name: "Spreadsheet formatting" }).waitFor();
  await beat(page, 600);
}

async function openNative(page: Page, title: string, rows: string[][]) {
  const file = createFile("sheet", title);
  if (file.kind !== "sheet") throw new Error("Expected a workbook");
  const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  sheet.cellData = Object.fromEntries(
    rows.map((row, r) => [
      r,
      Object.fromEntries(row.map((value, c) => [c, { v: value, t: 1 }])),
    ]),
  );
  (sheet as { columnData: Record<number, { w: number }> }).columnData = {
    0: { w: widths[0] },
  };
  await page.locator("input[type=file]").setInputFiles({
    name: `${title}.slsheet`,
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await ready(page);
}

async function openLinkDialog(page: Page, name: string) {
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name });
  if ((page.viewportSize()?.width ?? 1280) < 700) {
    try {
      await expect(dialog).toBeVisible({ timeout: 1500 });
    } catch {
      await page.getByRole("button", { name: /Insert link/ }).click();
    }
  }
  await expect(dialog).toBeVisible();
  return dialog;
}

async function clickCell(page: Page, ref: string) {
  const box = (await page.locator(".sheet-host").boundingBox())!;
  const column = ref.charCodeAt(0) - 65;
  const row = Number(ref.slice(1));
  const x = box.x + 46 + widths[column] / 2;
  const y = box.y + 58 + 24 * (row - 1);
  await page.mouse.move(x, y, { steps: 12 });
  await beat(page, 250);
  await page.mouse.click(x, y);
}

function excelSuppliers() {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Supplier"],
    ["Northwind"],
    ["Contoso"],
    ["Fabrikam"],
  ]);
  sheet.A2.l = { Target: "https://example.org/northwind/orders" };
  sheet.A3.l = { Target: "https://example.org/contoso" };
  sheet.A4.l = { Target: "https://example.org/fabrikam" };
  sheet["!cols"] = [{ wpx: 180 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Suppliers");
  return Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
}

test("53-link-a-cell", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Priya keeps the club's supplier list. The names are in column A, and none of them open a page.",
    1800,
  );
  await openNative(page, "Suppliers", [
    ["Supplier"],
    ["Northwind"],
    ["Contoso"],
    ["Fabrikam"],
  ]);
  await caption(page, "She selects Northwind and presses Ctrl/Cmd+K.", 1200);
  await selectCells(page, "A2");
  const dialog = await openLinkDialog(page, "Insert link");
  await expect(dialog.getByLabel("Link text")).toHaveValue("Northwind");
  await expect(dialog.getByLabel("Link address")).toBeFocused();
  await caption(page, "She types the address. The name stays in its own field.", 1000);
  await typeSlowly(page, "example.org/northwind", 40);
  await beat(page, 400);
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(dialog).toBeHidden();
  const link = page.getByRole("link", { name: "https://example.org/northwind" });
  await expect(link).toBeVisible();
  await caption(
    page,
    "Northwind is still the label. A bare domain became https://, shown beside the cell.",
    2000,
  );

  let followed = false;
  page.on("popup", () => {
    followed = true;
  });
  await caption(page, "Clicking the name only selects it. The sheet does not leave.", 1400);
  await clickCell(page, "A2");
  await beat(page, 700);
  expect(followed).toBe(false);
  await expect(page.getByRole("toolbar", { name: "Spreadsheet formatting" })).toBeVisible();
  await expect(link).toBeVisible();

  await caption(page, "She clicks the address. It opens in a new tab, and this sheet stays.", 1400);
  const popupPromise = page.waitForEvent("popup");
  await link.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/example\.org\/northwind/);
  expect(page.url()).not.toContain("example.org");
  await popup.close();
  await beat(page, 800);

  await caption(page, "Insert › Link opens the same dialog, already filled in.", 1200);
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: /^Link\b/ }).click();
  const edit = page.getByRole("dialog", { name: "Edit link" });
  await expect(edit.getByLabel("Link text")).toHaveValue("Northwind");
  await expect(edit.getByLabel("Link address")).toHaveValue("https://example.org/northwind");
  await expect(edit.getByRole("button", { name: "Remove link" })).toBeVisible();
  await caption(page, "She changes only the address, to the orders page.", 1000);
  await edit.getByLabel("Link address").fill("");
  await typeSlowly(page, "example.org/northwind/orders", 30);
  await beat(page, 300);
  await edit.getByRole("button", { name: "Apply" }).click();
  const orders = page.getByRole("link", { name: "https://example.org/northwind/orders" });
  await expect(orders).toBeVisible();
  await caption(page, "The label is still Northwind. The orders address is saved with the sheet.", 1600);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const savedPath = (await (await download).path())!;
  const saved = JSON.parse(await readFile(savedPath, "utf8"));
  const savedCell = saved.content.workbook.sheets[saved.content.workbook.sheetOrder[0]].cellData[1][0];
  expect(savedCell.v).toBe("Northwind");
  expect(cellHyperlink(savedCell)).toBe("https://example.org/northwind/orders");
  await expect(page.getByRole("status")).toContainText("Downloaded");
  await beat(page, 800);

  await caption(page, "She opens that copy. The name is still a link.", 1200);
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "Suppliers.slsheet",
    mimeType: "application/json",
    buffer: await readFile(savedPath),
  });
  await ready(page);
  await selectCells(page, "A2");
  await expect(orders).toBeVisible();
  await beat(page, 900);

  await caption(page, "Remove link drops the address and leaves the word Northwind.", 1400);
  const removing = await openLinkDialog(page, "Edit link");
  await expect(removing.getByLabel("Link text")).toHaveValue("Northwind");
  await removing.getByRole("button", { name: "Remove link" }).click();
  await expect(page.getByRole("group", { name: "Cell link" })).toHaveCount(0);
  await beat(page, 800);

  await caption(page, "She tries an unsafe address. The dialog refuses it.", 1200);
  const refused = await openLinkDialog(page, "Insert link");
  await expect(refused.getByLabel("Link text")).toHaveValue("Northwind");
  await typeSlowly(page, "javascript:alert(1)", 35);
  await beat(page, 300);
  await refused.getByRole("button", { name: "Apply" }).click();
  await expect(refused.getByRole("alert")).toContainText("web address");
  await beat(page, 1400);
  await refused.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("group", { name: "Cell link" })).toHaveCount(0);

  await caption(page, "An Excel workbook already has these links. The addresses come in with the names.", 1600);
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "Suppliers.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: excelSuppliers(),
  });
  await ready(page);
  await expect(page.locator(".import-notes")).not.toContainText("not recreated");
  await selectCells(page, "A2");
  await expect(orders).toBeVisible();
  await selectCells(page, "A3");
  await expect(page.getByRole("link", { name: "https://example.org/contoso" })).toBeVisible();
  await caption(page, "Contoso opens its own page. The sheet stays put.", 1400);
  const contosoPopup = page.waitForEvent("popup");
  await page.getByRole("link", { name: "https://example.org/contoso" }).click();
  const contoso = await contosoPopup;
  await expect(contoso).toHaveURL(/example\.org\/contoso/);
  await contoso.close();
  await beat(page, 600);

  await caption(page, "File › Export XLSX sends the addresses back, not only the names.", 1400);
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 400);
  const exported = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export XLSX", exact: true }).click();
  const xlsx = await readFile((await (await exported).path())!);
  const round = XLSX.read(xlsx, { type: "buffer" });
  const out = round.Sheets[round.SheetNames[0]];
  expect(out.A2.v).toBe("Northwind");
  expect(out.A2.l.Target).toBe("https://example.org/northwind/orders");
  expect(out.A3.l.Target).toBe("https://example.org/contoso");
  await beat(page, 700);

  await caption(page, "She opens the exported workbook. The links are still there.", 1400);
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "Suppliers.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: xlsx,
  });
  await ready(page);
  await selectCells(page, "A2");
  await expect(orders).toBeVisible();
  await selectCells(page, "A4");
  await expect(page.getByRole("link", { name: "https://example.org/fabrikam" })).toBeVisible();
  await caption(page, "Each supplier name kept its address, there and back.", 1800);
});
