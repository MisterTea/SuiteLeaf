import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { askAgent, beat, caption, describeRun, electronApps, electronMode, expect, openApp, test } from "../harness";

const title = "October budget";
type Cell = { v?: unknown; f?: string };

/** Keeps a copy the way Maya would: Download on the web, Save As on the desktop. Returns the parsed file. */
async function keepCopy(page: Page) {
  const dir = mkdtempSync(join(tmpdir(), "storyboard-09-ai-"));
  const saved = join(dir, `${title}.slsheet`);
  if (electronMode) {
    await electronApps.get(page)!.evaluate(({ dialog }, path) => {
      (dialog as unknown as Record<string, unknown>).showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, saved);
    await page.getByRole("button", { name: "Save As", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Saved to file");
  } else {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download", exact: true }).click();
    await (await download).saveAs(saved);
  }
  return JSON.parse(readFileSync(saved, "utf8"));
}

/** Moves the pointer to a cell (0-based row and column) and clicks it, in Univer's default grid geometry. */
async function clickCell(page: Page, row: number, column: number) {
  const box = (await page.locator(".sheet-host").boundingBox())!;
  const x = box.x + 46 + column * 100 + 30,
    y = box.y + 58 + row * 24;
  await page.mouse.move(x, y, { steps: 12 });
  await beat(page, 250);
  await page.mouse.click(x, y);
}

/** The row (0-based) whose first cell matches `label`, and that row's cells. */
function rowLabelled(cells: Record<number, Record<number, Cell>>, label: RegExp) {
  const row = Object.keys(cells)
    .map(Number)
    .find((r) => label.test(String(cells[r]?.[0]?.v ?? "")));
  return row === undefined ? undefined : { row, cells: cells[row] };
}

test("09-household-budget-with-formulas-ai", async ({ page }) => {
  await openApp(page);
  await caption(page, "Maya wants a simple monthly budget: what she planned, what she spent, and what's left. She asks SuiteLeaf's on-device assistant.");
  const build = await askAgent(
    page,
    "Make me a spreadsheet called October budget with columns Category, Planned and Spent. Rent is 1400 planned and 1400 spent, Groceries 450 and 380, Utilities 160 and 142, Transport 120 and 95, Fun money 150 and 60. Add a Total row that adds up both columns, and under it a Left to spend row showing how much of the plan is left.",
  );
  let why = describeRun(build);
  expect(build.state, why).toBe("done");
  await expect(page.getByLabel("File title"), why).toHaveValue(title);
  await caption(page, "Gemma typed the table, the totals and what's left, as formulas.", 2400);

  await caption(page, "After a big grocery run, she tells it what she really spent…");
  await caption(page, "", 0);
  const update = await askAgent(page, "I just did a big grocery run, so Groceries spent is now 455.");
  why = `${describeRun(build)}\n--- second request ---\n${describeRun(update)}`;
  expect(update.state, why).toBe("done");
  await expect(page.getByRole("status"), why).toContainText(electronMode ? "Draft saved" : "Saved on this device");
  await caption(page, "Groceries is now 455, and the Spent total and what's left follow it.", 2400);

  await page.getByRole("button", { name: "Close assistant" }).click();
  await caption(page, electronMode ? "She saves a copy to a file." : "Everything autosaves on this device. Download keeps a copy she can open anywhere.", 1400);
  const file = await keepCopy(page);
  const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  const cells = sheet.cellData as Record<number, Record<number, Cell>>;
  const table = JSON.stringify(cells);
  expect(file.title, why).toBe(title);
  expect([0, 1, 2].map((c) => cells[0]?.[c]?.v), `${why}\n${table}`).toEqual(["Category", "Planned", "Spent"]);
  expect(rowLabelled(cells, /^groceries$/i)?.cells[2]?.v, `${why}\n${table}`).toBe(455);

  const total = rowLabelled(cells, /^total/i);
  expect(total, `${why}\nNo Total row: ${table}`).toBeDefined();
  /** =SUM(B2:B6), or the same cells added one by one. */
  const sumOf = (c: string) => new RegExp(`^=(SUM\\(${c}2:${c}6\\)|${c}2\\+${c}3\\+${c}4\\+${c}5\\+${c}6)$`, "i");
  expect(total!.cells[1], `${why}\n${table}`).toMatchObject({ f: expect.stringMatching(sumOf("B")), v: 2280 });
  expect(total!.cells[2], `${why}\n${table}`).toMatchObject({ f: expect.stringMatching(sumOf("C")), v: 2152 });

  const left = rowLabelled(cells, /left/i);
  expect(left, `${why}\nNo Left to spend row: ${table}`).toBeDefined();
  const leftCell = Object.values(left!.cells).find((c) => typeof c?.v === "number");
  expect(leftCell, `${why}\n${table}`).toMatchObject({ f: expect.stringMatching(/^=.*[A-Z]\$?\d/i), v: 128 });

  const nameBox = page.locator(".sheet-host input.univer-size-full");
  await clickCell(page, total!.row, 2);
  await expect(nameBox).toHaveValue(`C${total!.row + 1}`);
  await caption(page, `She clicks the Spent total: the formula bar shows ${total!.cells[2].f}, now 2152.`, 2200);
  const leftColumn = Number(Object.keys(left!.cells).find((c) => left!.cells[Number(c)] === leftCell));
  await clickCell(page, left!.row, leftColumn);
  await expect(nameBox).toHaveValue(`${"ABCDEFGH"[leftColumn]}${left!.row + 1}`);
  await caption(page, `And what's left is ${leftCell!.f}: 128 to spend this month. A budget that keeps up with her.`, 2600);
  await beat(page, 600);
});
