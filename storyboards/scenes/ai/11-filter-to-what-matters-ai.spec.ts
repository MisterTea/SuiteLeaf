import type { Page } from "@playwright/test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorkbook } from "../fixtures";
import { askAgent, beat, caption, describeRun, electronApps, expect, openApp, selectCells, test } from "../harness";

type Native = any;

/** Keeps a copy of the workbook as a person would (Download, or Save As on the desktop) and parses it. */
async function savedCopy(page: Page): Promise<Native> {
  const app = electronApps.get(page);
  if (app) {
    const dir = mkdtempSync(join(tmpdir(), "storyboard-11-ai-"));
    await app.evaluate(({ dialog }, folder) => {
      (dialog as unknown as Record<string, unknown>).showSaveDialog = async (_window: unknown, options: { defaultPath: string }) => ({
        canceled: false,
        filePath: `${folder}/${options.defaultPath.split(/[\\/]/).pop()}`,
      });
    }, dir);
    await page.getByRole("button", { name: "Save As", exact: true }).click();
    const path = join(dir, "Shop orders.slsheet");
    await expect.poll(() => existsSync(path) && readFileSync(path, "utf8").length > 0, { timeout: 10000 }).toBe(true);
    return JSON.parse(readFileSync(path, "utf8"));
  }
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  return JSON.parse(readFileSync((await (await download).path())!, "utf8"));
}

const filterOf = (file: Native) =>
  JSON.parse(file.content.workbook.resources.find((r: { name: string }) => r.name === "SHEET_FILTER_PLUGIN")?.data || "{}");

test("11-filter-to-what-matters-ai", async ({ page }) => {
  await openApp(page);
  await caption(page, "Jo runs a small online shop. Each morning she only needs the orders still waiting to ship.");
  await openWorkbook(
    page,
    "Shop orders",
    [
      ["Order", "Customer", "Status", "Total"],
      ["#1041", "Nadia Haddad", "Shipped", 48],
      ["#1042", "Owen Brooks", "Pending", 112.5],
      ["#1043", "Lucía Romero", "Shipped", 26],
      ["#1044", "Sam Whitfield", "Cancelled", 64],
      ["#1045", "Aiko Tanaka", "Pending", 39.99],
      ["#1046", "Femi Adeyemi", "Shipped", 85],
      ["#1047", "Clara Novak", "Pending", 18.75],
      ["#1048", "Raj Mehta", "Shipped", 142],
      ["#1049", "Elena Petrova", "Cancelled", 22],
      ["#1050", "Tom Gallagher", "Pending", 57.2],
    ],
    [90, 150, 110, 100],
  );
  await caption(page, "She asks SuiteLeaf's on-device assistant to hide everything else for now.");

  const narrow = await askAgent(page, "Show me only the orders that are still waiting to ship. What do they add up to?");
  let why = describeRun(narrow);
  expect(narrow.state, why).toBe("done");
  expect(narrow.items.filter((i) => i.kind === "assistant").at(-1)?.text, why).toContain("228.44");
  const sum = page.getByText(/^Sum:/);
  await selectCells(page, "D2:D11");
  await expect(sum, why).toHaveText("Sum: 228.44");
  await caption(page, "Only the four Pending orders show. Row numbers skip: the others are hidden, not deleted.", 2400);
  await caption(page, "Selecting the totals, the status bar counts only what's showing: 228.44 still to ship, as Gemma said.", 2400);

  const filtered = Object.values(filterOf(await savedCopy(page)))[0] as Native;
  expect(filtered, why).toBeTruthy();
  expect(filtered.filterColumns, why).toHaveLength(1);
  expect(JSON.stringify(filtered.filterColumns), why).toContain("Pending");
  expect([...filtered.cachedFilteredOut].sort((a: number, b: number) => a - b), why).toEqual([1, 3, 4, 6, 8, 9]);

  await caption(page, "Once they're packed, she asks for the whole list back.");
  const reset = await askAgent(page, "All packed, thanks. Show me all the orders again and take the filter off.");
  why = describeRun(reset);
  expect(reset.state, why).toBe("done");
  await expect(page.getByRole("button", { name: "Create a filter", exact: true }), why).toHaveAttribute("aria-pressed", "false");
  await expect(sum, why).toHaveText("Sum: 615.44");
  await caption(page, "All ten orders are back, the sum is the full 615.44, and the filter buttons are gone.", 2400);

  const cleared = await savedCopy(page);
  expect(Object.keys(filterOf(cleared)), why).toHaveLength(0);
  await caption(page, "A quick, reversible view of just what matters today.", 1600);
  await beat(page, 600);
});
