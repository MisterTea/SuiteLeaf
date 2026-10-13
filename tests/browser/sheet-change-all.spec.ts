import { expect, test, type Locator, type Page } from "@playwright/test";
import { createFile, serializeFile } from "../../packages/core/src";

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
  await page.getByRole("link", { name: "Decisions", exact: true }).click();
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
}

async function rightClick(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Missing spelling target");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
}

async function expectCell(page: Page, ref: string, value: string) {
  const box = page.locator(".sheet-host input.univer-size-full");
  await box.fill(ref);
  await box.press("Enter");
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("data-active-value", value);
}

function changeAllDialog(page: Page) {
  return page.getByRole("dialog", { name: "Change all to receive" });
}

test("change all previews the same misspelling, undoes in one step, and skips an ignored cell", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await seed(page);
  await expect(page.locator(".sheet-spell-hit[data-spell-word='recieve']")).toHaveCount(4);
  await expect(page.locator(".sheet-spell-hit[data-spell-word='seperate']")).toHaveCount(1);

  await rightClick(page, page.locator(".sheet-spell-hit[data-spell-cell='B2']"));
  const menu = page.getByRole("menu", { name: "Spelling for recieve" });
  await expect(menu.getByRole("menuitem", { name: "receive", exact: true })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Change all to receive" }).click();
  const preview = changeAllDialog(page);
  await expect(preview).toContainText("4 cells will change");
  await expect(preview.locator("[data-change-cell='B2']")).toBeVisible();
  await expect(preview.locator("[data-change-cell='B4']")).toBeVisible();
  await expect(preview.locator("[data-change-cell='B7']")).toBeVisible();
  await expect(preview.locator("[data-change-cell='B9']")).toBeVisible();
  await expect(preview.locator("[data-change-cell='B6']")).toHaveCount(0);
  await expect(preview).not.toContainText("seperate");
  await preview.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expectCell(page, "B2", "We will recieve the grant");
  await expectCell(page, "B9", "Guests recieve a note");

  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("menuitem", { name: "Spelling", exact: true }).click();
  const spelling = page.getByRole("dialog", { name: "Spelling" });
  await spelling.getByRole("button", { name: "Change all", exact: true }).click();
  await expect(changeAllDialog(page)).toContainText("4 cells will change");
  await changeAllDialog(page).getByRole("button", { name: "Change all", exact: true }).click();
  await expectCell(page, "B2", "We will receive the grant");
  await expectCell(page, "B4", "Please receive the keys");
  await expectCell(page, "B7", "They receive the minutes");
  await expectCell(page, "B9", "Guests receive a note");
  await expectCell(page, "B6", "seperate the copies");
  await spelling.getByRole("button", { name: "Close spelling" }).click();

  await page.getByRole("button", { name: "Undo (Cmd+Z)" }).click();
  await expectCell(page, "B2", "We will recieve the grant");
  await expectCell(page, "B4", "Please recieve the keys");
  await expectCell(page, "B7", "They recieve the minutes");
  await expectCell(page, "B9", "Guests recieve a note");
  await page.getByRole("button", { name: "Redo (Cmd+Y)" }).click();
  await expectCell(page, "B2", "We will receive the grant");
  await expectCell(page, "B9", "Guests receive a note");
  await page.getByRole("button", { name: "Undo (Cmd+Z)" }).click();

  await rightClick(page, page.locator(".sheet-spell-hit[data-spell-cell='B9']"));
  await page
    .getByRole("menu", { name: "Spelling for recieve" })
    .getByRole("menuitem", { name: "Ignore this cell" })
    .click();
  await expect(page.locator(".sheet-spell-hit[data-spell-cell='B9']")).toHaveCount(0);
  await expect(page.locator(".sheet-spell-hit[data-spell-cell='B2']")).toBeVisible();
  await expect(page.locator(".sheet-spell-hit[data-spell-word='seperate']")).toBeVisible();

  await rightClick(page, page.locator(".sheet-spell-hit[data-spell-cell='B2']"));
  await page
    .getByRole("menu", { name: "Spelling for recieve" })
    .getByRole("menuitem", { name: "Change all to receive" })
    .click();
  await expect(changeAllDialog(page)).toContainText("3 cells will change");
  await expect(changeAllDialog(page).locator("[data-change-cell='B9']")).toHaveCount(0);
  await expect(changeAllDialog(page).locator("[data-change-cell='B6']")).toHaveCount(0);
  await changeAllDialog(page).getByRole("button", { name: "Change all", exact: true }).click();
  await expectCell(page, "B2", "We will receive the grant");
  await expectCell(page, "B4", "Please receive the keys");
  await expectCell(page, "B7", "They receive the minutes");
  await expectCell(page, "B9", "Guests recieve a note");
  await expectCell(page, "B6", "seperate the copies");
  await expect(page.locator(".sheet-spell-mark[data-spell-cell='B9']")).toHaveCount(0);

  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Decisions", exact: true }).click();
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  await expectCell(page, "B2", "We will receive the grant");
  await expectCell(page, "B9", "Guests recieve a note");
  await expect(page.locator(".sheet-spell-mark[data-spell-cell='B9']")).toHaveCount(0);
  await expect(page.locator(".sheet-spell-mark[data-spell-word='recieve']")).toHaveCount(0);
  await expect(page.locator(".sheet-spell-mark[data-spell-word='seperate']")).toBeVisible();
});
