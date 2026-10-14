import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import JSZip from "jszip";
import { beat, caption, expect, selectCells, test, typeSlowly } from "./harness";

const grid = (page: Page) => page.locator(".sheet-host");
const sheetZoom = (page: Page) =>
  page
    .getByRole("toolbar", { name: "Spreadsheet formatting" })
    .locator("select.zoom-select");
const docZoom = (page: Page) =>
  page
    .getByRole("toolbar", { name: "Document formatting" })
    .locator("select.zoom-select");

async function ready(page: Page) {
  await page.getByRole("button", { name: "Sheet tools", exact: true }).waitFor();
  await expect(grid(page)).toHaveAttribute("aria-busy", "false");
  await beat(page, 600);
}

async function goHome(page: Page) {
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
}

async function nameFile(page: Page, title: string) {
  const box = page.getByLabel("File title");
  await expect(box).toBeVisible();
  await box.click();
  await box.press("ControlOrMeta+A");
  await typeSlowly(page, title);
}

/** Distance between vertical grid lines, in CSS pixels. */
async function columnPitch(page: Page) {
  const pitch = await grid(page).evaluate((host) => {
    const canvas = [...host.querySelectorAll("canvas")]
      .filter((item) => item.getBoundingClientRect().width > 80)
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return br.width * br.height - ar.width * ar.height;
      })[0];
    if (!canvas) return 0;
    const ctx = canvas.getContext("2d");
    if (!ctx) return 0;
    const scale = canvas.width / canvas.clientWidth || 1;
    const y = Math.min(canvas.height - 1, Math.floor(280 * scale));
    const row = ctx.getImageData(0, y, canvas.width, 1).data;
    const lines: number[] = [];
    let previous = 255;
    for (let x = 0; x < canvas.width; x++) {
      const i = x * 4;
      const lum = (row[i] + row[i + 1] + row[i + 2]) / 3;
      if (previous - lum > 12) lines.push(x);
      previous = lum;
    }
    const gaps: number[] = [];
    for (let i = 1; i < lines.length; i++) {
      const gap = (lines[i] - lines[i - 1]) / scale;
      if (gap > 40 && gap < 400) gaps.push(gap);
    }
    if (!gaps.length) return 0;
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)];
  });
  expect(pitch).toBeGreaterThan(40);
  return pitch;
}

async function expectValue(page: Page, ref: string, value: string) {
  await selectCells(page, ref);
  await expect(grid(page)).toHaveAttribute("data-active-value", value);
  await expect(grid(page)).toHaveAttribute("data-active-display", value);
}

async function expectGroceries(page: Page) {
  await expectValue(page, "A1", "Groceries");
  await expectValue(page, "B1", "Amount");
  await expectValue(page, "A2", "Milk");
  await expectValue(page, "B2", "4");
  await expectValue(page, "A3", "Bread");
  await expectValue(page, "B3", "2");
  await expect(grid(page)).not.toHaveAttribute("data-active-value", "150%");
}

function cellXml(xml: string, ref: string) {
  return (
    xml.match(new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*(?:/>|>[\\s\\S]*?</c>)`))?.[0] ??
    ""
  );
}

function sharedText(shared: string, index: number) {
  const items = [...shared.matchAll(/<si>([\s\S]*?)<\/si>/g)];
  return (items[index]?.[1] ?? "").replace(/<[^>]+>/g, "");
}

function cellValue(sheetXml: string, shared: string, ref: string) {
  const cell = cellXml(sheetXml, ref);
  const raw = /<v>([^<]*)<\/v>/.exec(cell)?.[1] ?? "";
  if (/\bt="s"/.test(cell)) return sharedText(shared, Number(raw));
  return raw;
}

test("168-keep-the-sheet-zoom", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Nia opens the grocery budget. The zoom says 100%. She chooses 150% so the amounts are easy to read.",
  );
  await page.getByRole("button", { name: "New spreadsheet" }).click();
  await ready(page);
  await expect(sheetZoom(page)).toHaveValue("100%");
  const fitted = await columnPitch(page);
  await nameFile(page, "Grocery budget");
  await selectCells(page, "A1");
  await typeSlowly(page, "Groceries", 40);
  await page.keyboard.press("Tab");
  await typeSlowly(page, "Amount", 40);
  await page.keyboard.press("Enter");
  await selectCells(page, "A2");
  await typeSlowly(page, "Milk", 50);
  await page.keyboard.press("Tab");
  await typeSlowly(page, "4", 80);
  await page.keyboard.press("Enter");
  await selectCells(page, "A3");
  await typeSlowly(page, "Bread", 50);
  await page.keyboard.press("Tab");
  await typeSlowly(page, "2", 80);
  await page.keyboard.press("Enter");
  await expectGroceries(page);
  await sheetZoom(page).selectOption("150%");
  await expect(sheetZoom(page)).toHaveValue("150%");
  await expect
    .poll(async () => columnPitch(page), { timeout: 5000 })
    .toBeGreaterThan(fitted * 1.4);
  await expectGroceries(page);
  await beat(page, 1400);

  await caption(
    page,
    "She saves, returns home, and reopens the budget. It is still at 150%.",
  );
  await goHome(page);
  await page.getByRole("link", { name: "Grocery budget", exact: true }).click();
  await ready(page);
  await expect(sheetZoom(page)).toHaveValue("150%");
  expect(await columnPitch(page)).toBeGreaterThan(fitted * 1.4);
  await expectGroceries(page);
  await beat(page, 1400);

  await caption(page, "She creates a new spreadsheet. Its zoom is 100%, not 150%.");
  await goHome(page);
  await page.getByRole("button", { name: "New spreadsheet" }).click();
  await ready(page);
  await expect(sheetZoom(page)).toHaveValue("100%");
  await expect(sheetZoom(page)).not.toHaveValue("150%");
  const fresh = await columnPitch(page);
  expect(fresh).toBeLessThan(fitted * 1.2);
  expect(fresh).toBeGreaterThan(fitted * 0.8);
  await nameFile(page, "Shopping list");
  await selectCells(page, "A1");
  await typeSlowly(page, "Oranges", 40);
  await page.keyboard.press("Enter");
  await expectValue(page, "A1", "Oranges");
  await expect(sheetZoom(page)).toHaveValue("100%");
  await beat(page, 1200);

  await caption(
    page,
    "She opens the minutes, a document she left at 100%. The document zoom stays 100%.",
  );
  await goHome(page);
  await page.getByRole("button", { name: "New document" }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toBeVisible();
  await expect(docZoom(page)).toHaveValue("100%");
  await expect(docZoom(page)).not.toHaveValue("150%");
  await nameFile(page, "Market minutes");
  await editor.click();
  await typeSlowly(page, "The market opens at seven.");
  await expect(editor).toContainText("The market opens at seven.");
  await expect(editor).not.toContainText("150%");
  await expect(docZoom(page)).toHaveValue("100%");
  await beat(page, 1200);

  await caption(page, "She returns to the budget. It is still at 150%.");
  await goHome(page);
  await page.getByRole("link", { name: "Grocery budget", exact: true }).click();
  await ready(page);
  await expect(sheetZoom(page)).toHaveValue("150%");
  expect(await columnPitch(page)).toBeGreaterThan(fitted * 1.4);
  await expectGroceries(page);
  await expectValue(page, "A1", "Groceries");
  await beat(page, 1400);

  await caption(
    page,
    "She downloads Excel. The file has the groceries and does not contain “150%”.",
  );
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 400);
  const item = page.getByRole("menuitem", { name: "Export XLSX", exact: true });
  await expect(item).toBeEnabled();
  const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
  await item.click();
  const download = await downloadPromise;
  const zip = await JSZip.loadAsync(await readFile((await download.path())!));
  const names = Object.values(zip.files).filter((entry) => !entry.dir);
  const xml = (await Promise.all(names.map((entry) => entry.async("string")))).join(
    "\n",
  );
  const sheetXml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  const shared = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
  expect(cellValue(sheetXml, shared, "A1")).toBe("Groceries");
  expect(cellValue(sheetXml, shared, "B1")).toBe("Amount");
  expect(cellValue(sheetXml, shared, "A2")).toBe("Milk");
  expect(cellValue(sheetXml, shared, "B2")).toBe("4");
  expect(cellValue(sheetXml, shared, "A3")).toBe("Bread");
  expect(cellValue(sheetXml, shared, "B3")).toBe("2");
  expect(xml).not.toContain("150%");
  await expect(sheetZoom(page)).toHaveValue("150%");
  await beat(page, 1400);
});
