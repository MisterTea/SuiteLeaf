import { createFile, serializeFile, type DocFile } from "@suiteleaf/core";
import type { Locator, Page } from "@playwright/test";
import { beat, caption, expect, selectCells, test, typeSlowly } from "./harness";

function decisionsSheet() {
  const file = createFile("sheet", "Decisions");
  if (file.kind !== "sheet") throw new Error("Expected a spreadsheet");
  const id = file.content.workbook.sheetOrder[0]!;
  const sheet = file.content.workbook.sheets[id]!;
  sheet.cellData = {
    0: { 0: { v: "Decision", t: 1 }, 1: { v: "Note", t: 1 } },
    1: { 0: { v: "Grant", t: 1 }, 1: { v: "We will receive the grant", t: 1 } },
    2: { 0: { v: "Visit", t: 1 }, 1: { v: "Ask Kwame tomorrow", t: 1 } },
    4: { 0: { v: "Speaker", t: 1 }, 1: { v: "Danquah spoke", t: 1 } },
    5: { 0: { v: "Copies", t: 1 }, 1: { v: "seperate the copies", t: 1 } },
  };
  (sheet as { columnData: Record<number, { w: number }> }).columnData = {
    0: { w: 110 },
    1: { w: 280 },
  };
  return file;
}

function handoverDoc() {
  const file = createFile("doc", "Handover") as DocFile;
  file.content = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Kwame asked Danquah to seperate the keys." }],
      },
    ],
  };
  return file;
}

async function seed(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).waitFor();
  await page.evaluate(async (records) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("SuiteLeaf");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("encoded", "readwrite");
        for (const record of records) tx.objectStore("encoded").put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  }, [decisionsSheet(), handoverDoc()].map((file) => ({
    id: file.id,
    title: file.title,
    updatedAt: file.updatedAt,
    native: serializeFile(file),
  })));
  await page.reload();
  await page.getByRole("link", { name: "Decisions", exact: true }).waitFor();
}

async function rightClick(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Missing spelling target");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
}

function spellMenu(page: Page, word: string) {
  return page.getByRole("menu", { name: `Spelling for ${word}` });
}

async function expectClearOfWord(page: Page, word: Locator, menu: Locator) {
  await expect
    .poll(async () => {
      const target = await word.boundingBox();
      const popup = await menu.boundingBox();
      if (!target || !popup) return "missing";
      const overlaps =
        target.x < popup.x + popup.width &&
        target.x + target.width > popup.x &&
        target.y < popup.y + popup.height &&
        target.y + target.height > popup.y;
      const beside = popup.x >= target.x + target.width - 1 || popup.y >= target.y + target.height - 1;
      return overlaps || !beside ? "covered" : "clear";
    })
    .toBe("clear");
}

test("63-right-click-a-misspelling", async ({ page }) => {
  await seed(page);
  await caption(page, "Sam adds Kwame from a document. Sheets uses that same dictionary.");
  await page.getByRole("link", { name: "Handover", exact: true }).click();
  const kwame = page.locator(".spelling-misspelling", { hasText: "Kwame" });
  await expect(kwame).toBeVisible();
  await beat(page, 900);
  await kwame.click({ button: "right" });
  const docMenu = page.getByRole("menu", { name: "Spelling for Kwame" });
  await expect(docMenu.getByRole("menuitem", { name: "Add to dictionary" })).toBeVisible();
  await beat(page, 800);
  await docMenu.getByRole("menuitem", { name: "Add to dictionary" }).click();
  await expect(kwame).toHaveCount(0);
  await expect(page.locator(".spelling-misspelling", { hasText: "Danquah" })).toBeVisible();
  await beat(page, 1000);

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Decisions", exact: true }).click();
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".sheet-spell-mark[data-spell-word='Danquah']")).toBeVisible();
  await expect(page.locator(".sheet-spell-mark[data-spell-word='Kwame']")).toHaveCount(0);
  await caption(page, "He types the next row. After he leaves the cell, only recieve is underlined.");
  await selectCells(page, "B4");
  await typeSlowly(page, "Please recieve the keys", 55);
  await page.keyboard.press("Enter");
  const recieve = page.locator(".sheet-spell-hit[data-spell-word='recieve']");
  await expect(recieve).toBeVisible();
  await expect(page.locator(".sheet-spell-mark[data-spell-cell='B4']")).toHaveCount(1);
  await expect(page.locator(".sheet-spell-mark[data-spell-word='Please']")).toHaveCount(0);
  await expect(page.locator(".sheet-spell-mark[data-spell-word='keys']")).toHaveCount(0);
  await beat(page, 1400);

  await caption(page, "Right-clicking the underline opens receive beside the cell, not over the word.");
  await rightClick(page, recieve);
  const menu = spellMenu(page, "recieve");
  await expect(menu.getByRole("menuitem").first()).toHaveText("receive");
  await expect(menu.getByRole("menuitem", { name: "Ignore", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Add to dictionary" })).toBeVisible();
  await expectClearOfWord(page, recieve, menu);
  await beat(page, 1400);

  await caption(page, "receive replaces only that word. Undo brings recieve back, and redo restores it.");
  await menu.getByRole("menuitem", { name: "receive", exact: true }).click();
  await expect(recieve).toHaveCount(0);
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute(
    "data-active-value",
    "Please receive the keys",
  );
  await beat(page, 1000);
  await page.getByRole("button", { name: "Undo (Cmd+Z)" }).click();
  await expect(recieve).toBeVisible();
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute(
    "data-active-value",
    "Please recieve the keys",
  );
  await beat(page, 1400);
  await page.getByRole("button", { name: "Redo (Cmd+Y)" }).click();
  await expect(recieve).toHaveCount(0);
  await beat(page, 900);

  await caption(page, "Danquah is a name. Spelling no longer stops on that cell.");
  const name = page.locator(".sheet-spell-hit[data-spell-word='Danquah']");
  await rightClick(page, name);
  await beat(page, 700);
  await spellMenu(page, "Danquah").getByRole("menuitem", { name: "Add to dictionary" }).click();
  await expect(name).toHaveCount(0);
  await beat(page, 700);
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await beat(page, 300);
  await page.getByRole("menuitem", { name: "Spelling", exact: true }).click();
  const spelling = page.getByRole("dialog", { name: "Spelling" });
  await expect(spelling).toContainText("seperate → separate");
  await expect(spelling).not.toContainText("Danquah");
  await beat(page, 1200);
  await spelling.getByRole("button", { name: "Close spelling" }).click();

  await caption(page, "Ignore leaves seperate in the cell. It does not join the dictionary.");
  const seperate = page.locator(".sheet-spell-hit[data-spell-word='seperate']");
  await rightClick(page, seperate);
  await beat(page, 700);
  await spellMenu(page, "seperate").getByRole("menuitem", { name: "Ignore", exact: true }).click();
  await expect(seperate).toHaveCount(0);
  await selectCells(page, "B6");
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute(
    "data-active-value",
    "seperate the copies",
  );
  await beat(page, 1000);

  await caption(page, "Danquah is not flagged in the document. seperate still is.");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Handover", exact: true }).click();
  await expect(page.locator(".spelling-misspelling", { hasText: "Danquah" })).toHaveCount(0);
  await expect(page.locator(".spelling-misspelling", { hasText: "Kwame" })).toHaveCount(0);
  await expect(page.locator(".spelling-misspelling", { hasText: "seperate" })).toBeVisible();
  await beat(page, 1400);

  await caption(page, "He reopens Decisions. receive is saved, and Danquah is not underlined.");
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Decisions", exact: true }).click();
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  await selectCells(page, "B4");
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute(
    "data-active-value",
    "Please receive the keys",
  );
  await expect(page.locator(".sheet-spell-mark")).toHaveCount(0);
  await beat(page, 1600);
});
