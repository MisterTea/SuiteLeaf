import type { Page } from "@playwright/test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorkbook } from "../fixtures";
import { askAgent, beat, caption, describeRun, electronApps, expect, openApp, selectCells, test, typeSlowly } from "../harness";

type Native = any;
const title = "Household expenses";
const pivotTitle = "October by category";

/** Keeps a copy of the workbook as a person would (Download, or Save As on the desktop) and parses it. */
async function savedCopy(page: Page): Promise<Native> {
  const app = electronApps.get(page);
  if (app) {
    const dir = mkdtempSync(join(tmpdir(), "storyboard-15-ai-"));
    await app.evaluate(({ dialog }, folder) => {
      (dialog as unknown as Record<string, unknown>).showSaveDialog = async (_window: unknown, options: { defaultPath: string }) => ({
        canceled: false,
        filePath: `${folder}/${options.defaultPath.split(/[\\/]/).pop()}`,
      });
    }, dir);
    await page.getByRole("button", { name: "Save As", exact: true }).click();
    const path = join(dir, `${title}.slsheet`);
    await expect.poll(() => existsSync(path) && readFileSync(path, "utf8").length > 0, { timeout: 10000 }).toBe(true);
    return JSON.parse(readFileSync(path, "utf8"));
  }
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  return JSON.parse(readFileSync((await (await download).path())!, "utf8"));
}

const styleOf = (file: Native, cell: { s?: unknown } | undefined) =>
  typeof cell?.s === "string" ? file.content.workbook.styles[cell.s] : cell?.s;
/** A sheet's cells as rows of values, from its first row and column. */
function table(file: Native, sheetId: string) {
  const cells = file.content.workbook.sheets[sheetId]?.cellData ?? {};
  const rows = Object.keys(cells).map(Number);
  const width = Math.max(0, ...rows.map((r) => Math.max(-1, ...Object.keys(cells[r]).map(Number)) + 1));
  return Array.from({ length: Math.max(0, ...rows) + 1 }, (_, r) =>
    Array.from({ length: width }, (_, c) => (cells[r]?.[c]?.v ?? null) as string | number | null),
  );
}
/** Whether a worksheet is locked against editing, as pivot sheets are. */
const isProtected = (file: Native, sheetId: string) =>
  (file.content.workbook.resources as { name: string; data: string }[]).some(
    (r) => r.name === "SHEET_WORKSHEET_PROTECTION_PLUGIN" && r.data.includes(sheetId),
  );

test("15-summarize-with-a-pivot-ai", async ({ page }) => {
  await openApp(page);
  await caption(page, "Ana and Ben log every shared expense. At month's end: who spent what, on what?");
  await openWorkbook(page, title, [
    ["Date", "Category", "Paid by", "Amount"],
    ["Oct 1", "Groceries", "Ana", 84.2],
    ["Oct 2", "Utilities", "Ben", 120],
    ["Oct 3", "Groceries", "Ben", 46.5],
    ["Oct 4", "Transport", "Ana", 35],
    ["Oct 5", "Dining out", "Ana", 38],
    ["Oct 7", "Groceries", "Ana", 102.75],
    ["Oct 8", "Dining out", "Ben", 52.4],
    ["Oct 9", "Transport", "Ben", 60],
    ["Oct 10", "Groceries", "Ben", 71.3],
    ["Oct 11", "Utilities", "Ana", 64.99],
    ["Oct 12", "Dining out", "Ana", 27.5],
    ["Oct 13", "Groceries", "Ana", 58.1],
  ]);
  await caption(page, "Twelve receipts. Rather than write SUMIFS formulas, Ana asks SuiteLeaf's on-device assistant.", 2200);
  await caption(page, "", 0);

  const build = await askAgent(
    page,
    "Can you summarize our October spending by category, split by who paid? Call it October by category, and show the amounts in dollars.",
  );
  let why = describeRun(build);
  expect(build.state, why).toBe("done");
  const tab = (name: string) => page.getByRole("tab", { name, exact: true });
  await expect(tab(pivotTitle), why).toBeVisible();
  await caption(page, "Gemma made a pivot table on its own locked tab: categories down the side, Ana and Ben across the top.", 2600);

  let file = await savedCopy(page);
  const pivot = file.content.pivots?.[0];
  expect(pivot, why).toBeTruthy();
  const shown = (f: Native) => JSON.stringify(table(f, pivot.targetSheetId));
  const grid = table(file, pivot.targetSheetId);
  const row = (f: Native, label: string) => table(f, pivot.targetSheetId).find((r) => r[0] === label);
  expect(grid[0], `${why}\n${shown(file)}`).toEqual(["Category", "Ana", "Ben", "Grand Total"]);
  expect(row(file, "Groceries")?.[1], `${why}\n${shown(file)}`).toBeCloseTo(245.05);
  expect(row(file, "Groceries")?.[2], `${why}\n${shown(file)}`).toBeCloseTo(117.8);
  expect(row(file, "Groceries")?.[3], `${why}\n${shown(file)}`).toBeCloseTo(362.85);
  expect(grid.at(-1)?.[0], `${why}\n${shown(file)}`).toBe("Grand Total");
  expect(grid.at(-1)?.[3], `${why}\n${shown(file)}`).toBeCloseTo(760.74);
  expect(isProtected(file, pivot.targetSheetId), why).toBe(true);
  const groceriesRow = grid.findIndex((r) => r[0] === "Groceries");
  const pivotCells = file.content.workbook.sheets[pivot.targetSheetId].cellData;
  const money = styleOf(file, pivotCells[groceriesRow][1])?.n?.pattern;
  expect(money, `${why}\nGroceries for Ana is not shown in dollars`).toContain("$");
  expect(styleOf(file, pivotCells[grid.length - 1][3])?.n?.pattern, why).toContain("$");
  expect(styleOf(file, pivotCells[0][0])?.bl, why).toBe(1);

  await page.getByRole("button", { name: "Close assistant" }).click();
  await caption(page, "Then Ben spots a typo: the Oct 1 grocery run was $148.20, not $84.20.", 1400);
  await tab("Sheet1").click();
  await beat(page, 500);
  await selectCells(page, "D2");
  await typeSlowly(page, "148.2", 120);
  await page.keyboard.press("Enter");
  await beat(page, 600);
  await caption(page, "Back on the pivot, there's nothing to refresh…", 900);
  await tab(pivotTitle).click();
  await selectCells(page, `B${groceriesRow + 1}`);
  await caption(page, "…Ana's groceries already went from $245.05 to $309.05.", 2400);

  file = await savedCopy(page);
  expect(row(file, "Groceries")?.[1], shown(file)).toBeCloseTo(309.05);
  expect(table(file, pivot.targetSheetId).at(-1)?.[3], shown(file)).toBeCloseTo(824.74);

  await caption(page, "To jot notes beside the numbers, Ana needs a version she can edit.", 1800);
  await caption(page, "", 0);
  const copy = await askAgent(page, "I'd like to add my own notes next to this summary. Can you give me a copy I can edit?");
  why = `${describeRun(build)}\n--- second request ---\n${describeRun(copy)}`;
  expect(copy.state, why).toBe("done");
  const copyTab = tab(`${pivotTitle} (copy)`);
  await expect(copyTab, why).toBeVisible();
  await page.getByRole("button", { name: "Close assistant" }).click();
  await copyTab.click();
  const note = `${"ABCDEFGH"[grid[0].length]}${groceriesRow + 1}`;
  await caption(page, "On the copy, Ana types a note beside Groceries…", 900);
  await selectCells(page, note);
  await typeSlowly(page, "Includes the big Oct 1 shop", 40);
  await page.keyboard.press("Enter");
  await caption(page, "…the copy keeps the totals and dollar format, and she can annotate it freely.", 2200);

  file = await savedCopy(page);
  const order: string[] = file.content.workbook.sheetOrder;
  expect(order, why).toHaveLength(3);
  const copyId = order.find((id) => file.content.workbook.sheets[id].name === `${pivotTitle} (copy)`)!;
  expect(copyId, why).toBeTruthy();
  const copied = table(file, copyId);
  expect(copied[0].slice(0, 4), why).toEqual(["Category", "Ana", "Ben", "Grand Total"]);
  expect(copied[groceriesRow][1], why).toBeCloseTo(309.05);
  expect(copied[groceriesRow][grid[0].length], why).toBe("Includes the big Oct 1 shop");
  expect(isProtected(file, copyId), why).toBe(false);
  const copyCells = file.content.workbook.sheets[copyId].cellData;
  expect(styleOf(file, copyCells[0][0])?.bl, why).toBe(1);
  expect(styleOf(file, copyCells[groceriesRow][1])?.n?.pattern, why).toBe(money);
  await caption(page, "Twelve receipts, one clear summary, and a copy to scribble on.", 1600);
  await beat(page, 600);
});
