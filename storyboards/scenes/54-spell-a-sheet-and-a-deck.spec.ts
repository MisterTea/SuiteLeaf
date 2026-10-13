import { createFile, serializeFile, type SlideFile } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { beat, caption, expect, selectCells, test, typeSlowly } from "./harness";

async function seed(page: Page) {
  const sheet = createFile("sheet", "Decisions");
  if (sheet.kind !== "sheet") throw new Error("Expected a spreadsheet");
  const sheetId = sheet.content.workbook.sheetOrder[0]!;
  const grid = sheet.content.workbook.sheets[sheetId]!;
  grid.cellData = {
    0: { 0: { v: "Decision", t: 1 }, 1: { v: "Note", t: 1 } },
    1: { 0: { v: "Grant", t: 1 }, 1: { v: "We will recieve the grant", t: 1 } },
    2: { 0: { v: "Speaker", t: 1 }, 1: { v: "Nkrumah spoke", t: 1 } },
  };
  (grid as { columnData: Record<number, { w: number }> }).columnData = {
    0: { w: 120 },
    1: { w: 280 },
  };

  const deck = createFile("slide", "Update") as SlideFile;
  const slideId = deck.content.slideOrder[0]!;
  deck.content.slides[slideId]!.background = { color: "#ffffff" };
  deck.content.slides[slideId]!.elements = [
    {
      id: "title",
      type: "text",
      x: 48,
      y: 56,
      width: 520,
      height: 70,
      content: "Update",
      fontSize: 36,
      bold: true,
      align: "left",
      color: "#1e293b",
    },
    {
      id: "body",
      type: "text",
      x: 48,
      y: 170,
      width: 640,
      height: 90,
      content: "recieve the keys",
      fontSize: 36,
      align: "left",
      color: "#1e293b",
    },
    {
      id: "again",
      type: "text",
      x: 48,
      y: 280,
      width: 640,
      height: 70,
      content: "",
      placeholder: "Click to add text",
      fontSize: 28,
      align: "left",
      color: "#1e293b",
    },
  ];

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
  }, [sheet, deck].map((file) => ({
    id: file.id,
    title: file.title,
    updatedAt: file.updatedAt,
    native: serializeFile(file),
  })));
  await page.reload();
  await page.getByRole("link", { name: "Decisions", exact: true }).waitFor();
}

async function spell(page: Page) {
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Spelling", exact: true }).click();
  return page.getByRole("dialog", { name: "Spelling" });
}

test("54-spell-a-sheet-and-a-deck", async ({ page, context }) => {
  const leaks: string[] = [];
  page.on("request", (request) => {
    const body = `${request.url()}\n${request.postData() ?? ""}`;
    if (/recieve|Nkrumah/i.test(body)) leaks.push(request.url());
  });
  await seed(page);
  await caption(page, "Sam opens Decisions. “recieve” is underlined in the cell.");
  await page.getByRole("link", { name: "Decisions", exact: true }).click();
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  const recieve = page.locator(".sheet-spell-mark[data-spell-word='recieve']");
  const name = page.locator(".sheet-spell-mark[data-spell-word='Nkrumah']");
  await expect(recieve).toBeVisible();
  await expect(name).toBeVisible();
  await beat(page, 1400);

  await caption(page, "Tools › Spelling keeps the cell in view. One click replaces only that word.");
  const spelling = await spell(page);
  await expect(spelling).toContainText("B2 · recieve → receive");
  await expect(page.locator(".sheet-host input.univer-size-full")).toHaveValue("B2");
  await beat(page, 1400);
  await spelling.getByRole("button", { name: "receive", exact: true }).click();
  await expect(recieve).toHaveCount(0);
  await beat(page, 1200);

  await caption(page, "Nkrumah is a name. Adding it uses the same dictionary as Docs.");
  await expect(spelling).toContainText("Nkrumah spoke");
  await beat(page, 800);
  await spelling.getByRole("button", { name: "Add to dictionary" }).click();
  await expect(name).toHaveCount(0);
  await expect(spelling).toContainText("Spelling check finished");
  await beat(page, 1200);
  await spelling.getByRole("button", { name: "Done" }).click();

  await caption(page, "The deck has the same typo. Accepting “receive” leaves “the keys”.");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Update", exact: true }).click();
  const body = page.locator(".slide-canvas textarea").nth(1);
  await expect(body).toHaveValue("recieve the keys");
  await expect(page.locator(".slide-spell-mirror .spelling-misspelling")).toHaveText("recieve");
  await beat(page, 1200);
  const slideSpelling = await spell(page);
  await expect(slideSpelling).toContainText("recieve → receive");
  await expect(slideSpelling).toContainText("the keys");
  await beat(page, 1200);
  await slideSpelling.getByRole("button", { name: "receive", exact: true }).click();
  await expect(body).toHaveValue("receive the keys");
  await expect(page.locator(".slide-spell-mirror")).toHaveCount(0);
  await beat(page, 1000);
  await slideSpelling.getByRole("button", { name: "Done" }).click();

  await caption(page, "The network is off. Both files still suggest “receive”.");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Decisions", exact: true }).click();
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  await selectCells(page, "B4");
  await typeSlowly(page, "recieve", 70);
  await page.keyboard.press("Enter");
  await expect(page.locator(".sheet-spell-mark[data-spell-word='recieve']")).toBeVisible();
  const offlineSheet = await spell(page);
  await expect(offlineSheet.getByRole("button", { name: "receive", exact: true })).toBeVisible();
  await beat(page, 1000);
  await offlineSheet.getByRole("button", { name: "receive", exact: true }).click();
  await offlineSheet.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Update", exact: true }).click();
  const extra = page.locator(".slide-canvas textarea").nth(2);
  await extra.click();
  await typeSlowly(page, "recieve", 70);
  await expect(page.locator(".slide-spell-mirror .spelling-misspelling")).toHaveText("recieve");
  const offlineSlide = await spell(page);
  await expect(offlineSlide.getByRole("button", { name: "receive", exact: true })).toBeVisible();
  await beat(page, 1000);
  await offlineSlide.getByRole("button", { name: "receive", exact: true }).click();
  await expect(extra).toHaveValue("receive");
  await expect(body).toHaveValue("receive the keys");
  await offlineSlide.getByRole("button", { name: "Done" }).click();

  await caption(page, "He reopens both files. “receive” is saved, and Nkrumah is not flagged.");
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Decisions", exact: true }).click();
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".sheet-spell-mark")).toHaveCount(0);
  await selectCells(page, "B2");
  await beat(page, 800);
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Update", exact: true }).click();
  await expect(body).toHaveValue("receive the keys");
  await expect(page.locator(".slide-spell-mirror")).toHaveCount(0);
  await beat(page, 1400);
  expect(leaks).toEqual([]);
});
