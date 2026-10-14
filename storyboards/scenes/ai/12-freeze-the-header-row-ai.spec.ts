import type { Page } from "@playwright/test";
import { mkdtempSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorkbook, ready } from "../fixtures";
import { askAgent, beat, caption, describeRun, electronApps, electronMode, expect, openApp, test } from "../harness";

type Value = string | number;
const title = "Wedding guest list";

async function scrollGrid(page: Page, dy: number, times: number) {
  const box = (await page.locator(".sheet-host").boundingBox())!;
  await page.mouse.move(box.x + 600, box.y + 320, { steps: 8 });
  for (let i = 0; i < times; i++) {
    // The desktop window scrolls twice as far per wheel step as the browser.
    await page.mouse.wheel(0, electronMode ? dy / 2 : dy);
    await beat(page, 180);
  }
}

/** Saves a copy of the workbook (Download, or Save As on the desktop) and parses it. */
async function savedCopy(page: Page) {
  if (electronMode) {
    const dir = mkdtempSync(join(tmpdir(), "storyboard-12-ai-"));
    await electronApps.get(page)!.evaluate(({ dialog }, folder) => {
      (dialog as unknown as Record<string, unknown>).showSaveDialog = async (
        _window: unknown,
        options: { defaultPath: string },
      ) => ({ canceled: false, filePath: `${folder}/${options.defaultPath}` });
    }, dir);
    await page.getByRole("button", { name: "Save As", exact: true }).click();
    const path = join(dir, `${title}.slsheet`);
    await expect.poll(() => readFile(path, "utf8").then(() => true, () => false)).toBe(true);
    return JSON.parse(readFileSync(path, "utf8"));
  }
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  return JSON.parse(await readFile((await (await download).path())!, "utf8"));
}

test("12-freeze-the-header-row-ai", async ({ page }) => {
  const first = ["Amara", "Ben", "Chloe", "Diego", "Elif", "Farah", "George", "Hiro", "Ines", "Jamal", "Keiko", "Liam", "Mina", "Noah", "Olu"];
  const last = ["Okafor", "Novak", "Rossi", "Haddad", "Silva", "Kowalski"];
  const meals = ["Chicken", "Vegetarian", "Fish", "Vegan"];
  const rows: Value[][] = [["Guest", "Party size", "Meal", "RSVP"]];
  for (let i = 0; i < 60; i++)
    rows.push([
      `${first[i % first.length]} ${last[(i * 7) % last.length]}`,
      1 + (i % 3),
      meals[(i * 5) % meals.length],
      i % 9 === 4 ? "Maybe" : i % 7 === 3 ? "No" : "Yes",
    ]);

  await openApp(page);
  await caption(page, "Chris is checking a 60-guest wedding list for the caterer.");
  await openWorkbook(page, title, rows, [160, 100, 110, 90]);

  await caption(page, "Scrolling down, the header row disappears…", 900);
  await scrollGrid(page, 120, 7);
  await caption(page, "…and it's hard to tell which column is Meal and which is RSVP. Chris asks SuiteLeaf's on-device assistant.", 2200);
  await caption(page, "", 0);

  const run = await askAgent(
    page,
    "When I scroll down I can't see the column headings anymore. Can you keep the header row on screen while I scroll?",
  );
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  const file = await savedCopy(page);
  const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  expect(sheet.freeze, why).toMatchObject({ startRow: 1, ySplit: 1 });
  expect(sheet.freeze.xSplit ?? 0, `${why}\nColumns were frozen too`).toBe(0);

  await page.getByRole("button", { name: "Close assistant" }).click();
  await caption(page, "Gemma froze the top row. Chris scrolls down the list again…", 1000);
  await scrollGrid(page, 120, 8);
  await caption(page, "…and Guest, Party size, Meal and RSVP stay in view, right down to the last guest.", 2400);

  await caption(page, "The freeze is saved with the workbook. Chris closes it and opens it again…", 1200);
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 600);
  await page.getByRole("link", { name: title }).click();
  await ready(page);
  await scrollGrid(page, 120, 6);
  await caption(page, "…and the header row is still frozen.", 1600);
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("menuitem", { name: "Freeze" }).hover();
  await expect(page.getByRole("menuitemcheckbox", { name: "1 row", exact: true })).toHaveAttribute("aria-checked", "true");
  await caption(page, "View › Freeze shows the tick next to 1 row, the same as choosing it by hand.", 2000);
  await page.keyboard.press("Escape");
  await beat(page, 600);
});
