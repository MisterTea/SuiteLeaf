import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createFile, serializeFile, type DocFile } from "../../packages/core/src";
import { PERSONAL_DICTIONARY_KEY } from "../../apps/web/src/editors/doc-spelling";

async function download(page: Page) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  return JSON.parse(await readFile((await (await waiting).path())!, "utf8"));
}

function decisionsSheet() {
  const file = createFile("sheet", "Decisions");
  if (file.kind !== "sheet") throw new Error("Expected a spreadsheet");
  const id = file.content.workbook.sheetOrder[0]!;
  const sheet = file.content.workbook.sheets[id]!;
  sheet.cellData = {
    0: { 0: { v: "Decision", t: 1 }, 1: { v: "Note", t: 1 } },
    1: { 0: { v: "Grant", t: 1 }, 1: { v: "We will receive the grant", t: 1 } },
    2: { 0: { v: "Visit", t: 1 }, 1: { v: "Ask Kwame for kenkey tomorrow", t: 1 } },
    3: { 0: { v: "Keys", t: 1 }, 1: { v: "Please recieve the keys", t: 1 } },
    4: { 0: { v: "Cook", t: 1 }, 1: { v: "Danquah cooked fufu", t: 1 } },
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
        content: [{ type: "text", text: "Kwame asked Danquah to seperate the kenkey from the fufu." }],
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
  return box;
}

async function activeValue(page: Page, ref: string) {
  const box = page.locator(".sheet-host input.univer-size-full");
  await box.fill(ref);
  await box.press("Enter");
  return page.getByLabel("Spreadsheet grid").getAttribute("data-active-value");
}

function spellMenu(page: Page, word: string) {
  return page.getByRole("menu", { name: `Spelling for ${word}` });
}

test("right-clicking a sheet misspelling suggests, replaces, ignores, and shares the Docs dictionary", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await seed(page);
  await page.getByRole("link", { name: "Handover", exact: true }).click();
  const doc = page.getByRole("textbox", { name: "Document content" });
  await expect(doc).toContainText("Kwame asked Danquah");
  // Names are left alone; a word the dictionary does not know is underlined until it is added.
  const kenkey = page.locator(".spelling-misspelling", { hasText: "kenkey" });
  await expect(kenkey).toBeVisible();
  await expect(page.locator(".spelling-misspelling", { hasText: /Kwame|Danquah/ })).toHaveCount(0);
  await kenkey.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add to dictionary" }).click();
  await expect(kenkey).toHaveCount(0);
  await expect(page.locator(".spelling-misspelling", { hasText: "fufu" })).toBeVisible();

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Decisions", exact: true }).click();
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  const recieve = page.locator(".sheet-spell-hit[data-spell-word='recieve']");
  const fufu = page.locator(".sheet-spell-hit[data-spell-word='fufu']");
  const seperate = page.locator(".sheet-spell-hit[data-spell-word='seperate']");
  await expect(recieve).toBeVisible();
  await expect(fufu).toBeVisible();
  await expect(seperate).toBeVisible();
  await expect(page.locator(".sheet-spell-mark[data-spell-word='kenkey']")).toHaveCount(0);
  await expect(page.locator(".sheet-spell-mark[data-spell-word='Kwame']")).toHaveCount(0);
  await expect(page.locator(".sheet-spell-mark[data-spell-word='Danquah']")).toHaveCount(0);
  await expect(page.locator(".sheet-spell-mark[data-spell-word='Please']")).toHaveCount(0);
  await expect(page.locator(".sheet-spell-mark[data-spell-word='keys']")).toHaveCount(0);
  await expect(page.locator(".sheet-spell-mark[data-spell-cell='B4']")).toHaveCount(1);

  const word = await recieve.boundingBox();
  if (!word) throw new Error("Missing recieve");
  await page.mouse.click(word.x + word.width + 36, word.y + word.height / 2, { button: "right" });
  await expect(page.getByRole("menu", { name: /Spelling/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("menuitem", { name: "Spelling", exact: true }).click();
  const spelling = page.getByRole("dialog", { name: "Spelling" });
  await expect(spelling).toContainText("recieve → receive");
  await spelling.getByRole("button", { name: "Close spelling" }).click();

  await rightClick(page, recieve);
  const menu = spellMenu(page, "recieve");
  await expect(menu.getByRole("menuitem").first()).toHaveText("receive");
  await expect(menu.getByRole("menuitem", { name: "Ignore", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Add to dictionary" })).toBeVisible();
  await expect(page.locator("#desktop-context-menu")).toBeHidden();
  await expect
    .poll(async () => {
      const target = await recieve.boundingBox();
      const popup = await menu.boundingBox();
      if (!target || !popup) return "missing";
      const overlaps =
        target.x < popup.x + popup.width &&
        target.x + target.width > popup.x &&
        target.y < popup.y + popup.height &&
        target.y + target.height > popup.y;
      const clear = popup.x >= target.x + target.width - 1 || popup.y >= target.y + target.height - 1;
      return overlaps || !clear ? "covered" : "clear";
    })
    .toBe("clear");

  await menu.getByRole("menuitem", { name: "receive", exact: true }).click();
  await expect(recieve).toHaveCount(0);
  expect(await activeValue(page, "B4")).toBe("Please receive the keys");
  await page.getByRole("button", { name: "Undo (Cmd+Z)" }).click();
  await expect(recieve).toBeVisible();
  expect(await activeValue(page, "B4")).toBe("Please recieve the keys");
  await page.getByRole("button", { name: "Redo (Cmd+Y)" }).click();
  await expect(recieve).toHaveCount(0);
  expect(await activeValue(page, "B4")).toBe("Please receive the keys");

  await rightClick(page, fufu);
  await spellMenu(page, "fufu").getByRole("menuitem", { name: "Add to dictionary" }).click();
  await expect(fufu).toHaveCount(0);
  const taught = await page.evaluate((key) => localStorage.getItem(key), PERSONAL_DICTIONARY_KEY);
  expect(JSON.parse(taught ?? "{}").added).toEqual(expect.arrayContaining(["kenkey", "fufu"]));

  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("menuitem", { name: "Spelling", exact: true }).click();
  await expect(spelling).toContainText("seperate → separate");
  await expect(spelling).not.toContainText("fufu");
  await spelling.getByRole("button", { name: "Close spelling" }).click();

  await rightClick(page, seperate);
  await spellMenu(page, "seperate").getByRole("menuitem", { name: "Ignore", exact: true }).click();
  await expect(seperate).toHaveCount(0);
  expect(await activeValue(page, "B6")).toBe("seperate the copies");
  const afterIgnore = await page.evaluate((key) => localStorage.getItem(key), PERSONAL_DICTIONARY_KEY);
  expect(JSON.parse(afterIgnore ?? "{}").added).not.toContain("seperate");

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Handover", exact: true }).click();
  await expect(doc).toContainText("fufu");
  await expect(page.locator(".spelling-misspelling", { hasText: "fufu" })).toHaveCount(0);
  await expect(page.locator(".spelling-misspelling", { hasText: "kenkey" })).toHaveCount(0);
  await expect(page.locator(".spelling-misspelling", { hasText: "seperate" })).toBeVisible();

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Decisions", exact: true }).click();
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  expect(await activeValue(page, "B4")).toBe("Please receive the keys");
  await expect(page.locator(".sheet-spell-mark[data-spell-word='fufu']")).toHaveCount(0);
  await expect(page.locator(".sheet-spell-mark[data-spell-word='recieve']")).toHaveCount(0);
  await expect(page.locator(".sheet-spell-mark[data-spell-word='seperate']")).toHaveCount(0);
  const saved = await download(page);
  const sheetId = saved.content.workbook.sheetOrder[0];
  expect(saved.content.workbook.sheets[sheetId].cellData[3][1].v).toBe("Please receive the keys");
  expect(saved.content.workbook.sheets[sheetId].cellData[4][1].v).toBe("Danquah cooked fufu");
  expect(saved.content.workbook.sheets[sheetId].cellData[5][1].v).toBe("seperate the copies");
});
