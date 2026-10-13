import { createFile, serializeFile } from "@suiteleaf/core";
import type { Locator, Page } from "@playwright/test";
import { beat, caption, expect, selectCells, test } from "./harness";

function decisionsSheet() {
  const file = createFile("sheet", "Decisions");
  if (file.kind !== "sheet") throw new Error("Expected a spreadsheet");
  const id = file.content.workbook.sheetOrder[0]!;
  const sheet = file.content.workbook.sheets[id]!;
  sheet.cellData = {
    0: { 0: { v: "Decision", t: 1 }, 1: { v: "Note", t: 1 } },
    1: { 0: { v: "Grant", t: 1 }, 1: { v: "We will recieve the grant", t: 1 } },
    3: { 0: { v: "Keys", t: 1 }, 1: { v: "Please recieve the keys", t: 1 } },
    5: { 0: { v: "Copies", t: 1 }, 1: { v: "seperate the copies", t: 1 } },
    6: { 0: { v: "Minutes", t: 1 }, 1: { v: "They recieve the minutes", t: 1 } },
    8: { 0: { v: "Guests", t: 1 }, 1: { v: "Guests recieve a note", t: 1 } },
  };
  (sheet as { columnData: Record<number, { w: number }> }).columnData = {
    0: { w: 110 },
    1: { w: 280 },
  };
  return file;
}

async function seed(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).waitFor();
  const file = decisionsSheet();
  await page.evaluate(async (record) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("SuiteLeaf");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("encoded", "readwrite");
        tx.objectStore("encoded").put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  }, {
    id: file.id,
    title: file.title,
    updatedAt: file.updatedAt,
    native: serializeFile(file),
  });
  await page.reload();
  await page.getByRole("link", { name: "Decisions", exact: true }).waitFor();
}

async function rightClick(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Missing spelling target");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
}

function spellMenu(page: Page) {
  return page.getByRole("menu", { name: "Spelling for recieve" });
}

function changeAll(page: Page) {
  return page.getByRole("dialog", { name: "Change all to receive" });
}

test("64-change-every-copy-of-a-typo", async ({ page }) => {
  await seed(page);
  await caption(page, "Four cells say recieve. Sam wants to keep seperate in B6.");
  await page.getByRole("link", { name: "Decisions", exact: true }).click();
  const grid = page.getByLabel("Spreadsheet grid");
  await expect(grid).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".sheet-spell-hit[data-spell-word='recieve']")).toHaveCount(4);
  await expect(page.locator(".sheet-spell-hit[data-spell-cell='B6']")).toBeVisible();
  await beat(page, 1400);

  await caption(page, "Right-click offers receive, and Change all to receive.");
  await rightClick(page, page.locator(".sheet-spell-hit[data-spell-cell='B2']"));
  const menu = spellMenu(page);
  await expect(menu.getByRole("menuitem", { name: "receive", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Change all to receive" })).toBeVisible();
  await beat(page, 1400);

  await caption(page, "Change all lists the four cells first. seperate is not there. He can cancel.");
  await menu.getByRole("menuitem", { name: "Change all to receive" }).click();
  const preview = changeAll(page);
  await expect(preview).toContainText("4 cells will change");
  await expect(preview.locator("[data-change-cell='B2']")).toBeVisible();
  await expect(preview.locator("[data-change-cell='B4']")).toBeVisible();
  await expect(preview.locator("[data-change-cell='B7']")).toBeVisible();
  await expect(preview.locator("[data-change-cell='B9']")).toBeVisible();
  await expect(preview.locator("[data-change-cell='B6']")).toHaveCount(0);
  await expect(page.locator(".sheet-spell-preview")).toHaveCount(4);
  await beat(page, 1800);
  await preview.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(preview).toHaveCount(0);
  await selectCells(page, "B2");
  await expect(grid).toHaveAttribute("data-active-value", "We will recieve the grant");
  await beat(page, 900);

  await caption(page, "Tools › Spelling has the same Change all. He confirms.");
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Spelling", exact: true }).click();
  const spelling = page.getByRole("dialog", { name: "Spelling" });
  await expect(spelling.getByRole("button", { name: "Change all", exact: true })).toBeVisible();
  await beat(page, 900);
  await spelling.getByRole("button", { name: "Change all", exact: true }).click();
  await expect(changeAll(page)).toContainText("4 cells will change");
  await beat(page, 1200);
  await changeAll(page).getByRole("button", { name: "Change all", exact: true }).click();
  await expect(spelling).toContainText("seperate");
  await selectCells(page, "B2");
  await expect(grid).toHaveAttribute("data-active-value", "We will receive the grant");
  await selectCells(page, "B9");
  await expect(grid).toHaveAttribute("data-active-value", "Guests receive a note");
  await selectCells(page, "B6");
  await expect(grid).toHaveAttribute("data-active-value", "seperate the copies");
  await beat(page, 1200);
  await spelling.getByRole("button", { name: "Close spelling" }).click();

  await caption(page, "One undo restores every cell. Redo fixes them again.");
  await page.getByRole("button", { name: "Undo (Cmd+Z)" }).click();
  await selectCells(page, "B2");
  await expect(grid).toHaveAttribute("data-active-value", "We will recieve the grant");
  await selectCells(page, "B4");
  await expect(grid).toHaveAttribute("data-active-value", "Please recieve the keys");
  await selectCells(page, "B7");
  await expect(grid).toHaveAttribute("data-active-value", "They recieve the minutes");
  await selectCells(page, "B9");
  await expect(grid).toHaveAttribute("data-active-value", "Guests recieve a note");
  await beat(page, 1400);
  await page.getByRole("button", { name: "Redo (Cmd+Y)" }).click();
  await selectCells(page, "B2");
  await expect(grid).toHaveAttribute("data-active-value", "We will receive the grant");
  await selectCells(page, "B9");
  await expect(grid).toHaveAttribute("data-active-value", "Guests receive a note");
  await beat(page, 1200);

  await caption(page, "He undoes that, then ignores B9. The other copies stay underlined.");
  await page.getByRole("button", { name: "Undo (Cmd+Z)" }).click();
  await expect(page.locator(".sheet-spell-hit[data-spell-cell='B9']")).toBeVisible();
  await rightClick(page, page.locator(".sheet-spell-hit[data-spell-cell='B9']"));
  await beat(page, 700);
  await spellMenu(page).getByRole("menuitem", { name: "Ignore this cell" }).click();
  await expect(page.locator(".sheet-spell-hit[data-spell-cell='B9']")).toHaveCount(0);
  await expect(page.locator(".sheet-spell-hit[data-spell-cell='B2']")).toBeVisible();
  await expect(page.locator(".sheet-spell-hit[data-spell-cell='B4']")).toBeVisible();
  await expect(page.locator(".sheet-spell-hit[data-spell-cell='B7']")).toBeVisible();
  await expect(page.locator(".sheet-spell-hit[data-spell-word='seperate']")).toBeVisible();
  await beat(page, 1200);

  await caption(page, "Change all from B2 fixes the others and leaves B9.");
  await rightClick(page, page.locator(".sheet-spell-hit[data-spell-cell='B2']"));
  await beat(page, 600);
  await spellMenu(page).getByRole("menuitem", { name: "Change all to receive" }).click();
  await expect(changeAll(page)).toContainText("3 cells will change");
  await expect(changeAll(page).locator("[data-change-cell='B9']")).toHaveCount(0);
  await expect(changeAll(page).locator("[data-change-cell='B6']")).toHaveCount(0);
  await expect(page.locator(".sheet-spell-preview")).toHaveCount(3);
  await beat(page, 1600);
  await changeAll(page).getByRole("button", { name: "Change all", exact: true }).click();
  await selectCells(page, "B2");
  await expect(grid).toHaveAttribute("data-active-value", "We will receive the grant");
  await selectCells(page, "B7");
  await expect(grid).toHaveAttribute("data-active-value", "They receive the minutes");
  await selectCells(page, "B9");
  await expect(grid).toHaveAttribute("data-active-value", "Guests recieve a note");
  await expect(page.locator(".sheet-spell-mark[data-spell-cell='B9']")).toHaveCount(0);
  await beat(page, 1400);

  await caption(page, "He reopens the file. Three corrections remain, and B9 is still recieve, not underlined.");
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Decisions", exact: true }).click();
  await expect(grid).toHaveAttribute("aria-busy", "false");
  await selectCells(page, "B4");
  await expect(grid).toHaveAttribute("data-active-value", "Please receive the keys");
  await selectCells(page, "B9");
  await expect(grid).toHaveAttribute("data-active-value", "Guests recieve a note");
  await expect(page.locator(".sheet-spell-mark[data-spell-word='recieve']")).toHaveCount(0);
  await expect(page.locator(".sheet-spell-mark[data-spell-cell='B9']")).toHaveCount(0);
  await expect(page.locator(".sheet-spell-mark[data-spell-word='seperate']")).toBeVisible();
  await beat(page, 1600);
});
