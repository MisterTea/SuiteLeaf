import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { createFile, serializeFile, type SlideFile } from "../../packages/core/src";
import { PERSONAL_DICTIONARY_KEY } from "../../apps/web/src/editors/doc-spelling";

async function download(page: Page) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  return JSON.parse(await readFile((await (await waiting).path())!, "utf8"));
}

async function openNative(page: Page, name: string, file: ReturnType<typeof createFile>) {
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
}

function decisionsSheet() {
  const file = createFile("sheet", "Decisions");
  if (file.kind !== "sheet") throw new Error("Expected a spreadsheet");
  const id = file.content.workbook.sheetOrder[0]!;
  const sheet = file.content.workbook.sheets[id]!;
  sheet.cellData = {
    0: { 0: { v: "Decision", t: 1 }, 1: { v: "Note", t: 1 } },
    1: { 0: { v: "Grant", t: 1 }, 1: { v: "We will recieve the grant", t: 1 } },
    2: { 0: { v: "Speaker", t: 1 }, 1: { v: "Nkrumah spoke", t: 1 } },
  };
  (sheet as { columnData: Record<number, { w: number }> }).columnData = {
    0: { w: 120 },
    1: { w: 280 },
  };
  return file;
}

function updateDeck() {
  const file = createFile("slide", "Update") as SlideFile;
  const slideId = file.content.slideOrder[0]!;
  file.content.slides[slideId]!.elements = [
    {
      id: "title",
      type: "text",
      x: 48,
      y: 64,
      width: 480,
      height: 64,
      content: "Update",
      fontSize: 32,
      bold: true,
      align: "left",
    },
    {
      id: "body",
      type: "text",
      x: 48,
      y: 160,
      width: 560,
      height: 80,
      content: "recieve the keys",
      fontSize: 32,
      italic: true,
      align: "left",
    },
  ];
  return file;
}

test("sheet spelling replaces one word, shares the Docs dictionary, and works offline", async ({
  page,
  context,
}) => {
  const leaks: string[] = [];
  page.on("request", (request) => {
    const body = `${request.url()}\n${request.postData() ?? ""}`;
    if (/recieve|Nkrumah|receive the grant/i.test(body)) leaks.push(request.url());
  });
  await openNative(page, "Decisions.slsheet", decisionsSheet());
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  const recieve = page.locator(".sheet-spell-mark[data-spell-word='recieve']");
  const name = page.locator(".sheet-spell-mark[data-spell-word='Nkrumah']");
  await expect(recieve).toBeVisible();
  await expect(name).toBeVisible();
  await expect(recieve).toHaveAttribute("data-spell-cell", "B2");

  await context.setOffline(true);
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("menuitem", { name: "Spelling", exact: true }).click();
  const spelling = page.getByRole("dialog", { name: "Spelling" });
  await expect(spelling).toContainText("B2 · recieve → receive");
  await expect(spelling.getByRole("button", { name: "receive", exact: true })).toBeVisible();
  await expect(page.locator(".sheet-host input.univer-size-full")).toHaveValue("B2");
  await spelling.getByRole("button", { name: "receive", exact: true }).click();
  await expect(spelling).toContainText("Nkrumah");
  await expect(recieve).toHaveCount(0);
  await spelling.getByRole("button", { name: "Add to dictionary" }).click();
  await expect(name).toHaveCount(0);
  await expect(spelling).toContainText("Spelling check finished");
  await spelling.getByRole("button", { name: "Done" }).click();

  const dictionary = await page.evaluate(
    (key) => localStorage.getItem(key),
    PERSONAL_DICTIONARY_KEY,
  );
  expect(JSON.parse(dictionary ?? "{}").added).toContain("Nkrumah");
  await expect(page.getByRole("status")).toContainText("Saved");
  const saved = await download(page);
  const id = saved.content.workbook.sheetOrder[0];
  const cells = saved.content.workbook.sheets[id].cellData;
  expect(cells[1][1].v).toBe("We will receive the grant");
  expect(cells[2][1].v).toBe("Nkrumah spoke");
  await context.setOffline(false);
  expect(leaks).toEqual([]);

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Decisions" }).click();
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".sheet-spell-mark")).toHaveCount(0);
});

test("a name added in Docs is not flagged in a sheet", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((key) => {
    localStorage.setItem(key, JSON.stringify({ added: ["Nkrumah"], flagged: [] }));
  }, PERSONAL_DICTIONARY_KEY);
  await openNative(page, "Decisions.slsheet", decisionsSheet());
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".sheet-spell-mark[data-spell-word='Nkrumah']")).toHaveCount(0);
  await expect(page.locator(".sheet-spell-mark[data-spell-word='recieve']")).toBeVisible();
});

test("slide spelling replaces one word and keeps the rest of the box", async ({ page, context }) => {
  const leaks: string[] = [];
  page.on("request", (request) => {
    const body = `${request.url()}\n${request.postData() ?? ""}`;
    if (/recieve|the keys/i.test(body)) leaks.push(request.url());
  });
  await openNative(page, "Update.slslides", updateDeck());
  const box = page.locator(".slide-canvas textarea").nth(1);
  await expect(box).toHaveValue("recieve the keys");
  await expect(page.locator(".slide-spell-mirror .spelling-misspelling")).toHaveText("recieve");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("menuitem", { name: "Spelling", exact: true }).click();
  const spelling = page.getByRole("dialog", { name: "Spelling" });
  await expect(spelling).toContainText("recieve → receive");
  await expect(spelling).toContainText("recieve the keys");
  await spelling.getByRole("button", { name: "receive", exact: true }).click();
  await expect(box).toHaveValue("receive the keys");
  await expect(page.locator(".slide-spell-mirror")).toHaveCount(0);
  await expect(spelling).toContainText("Spelling check finished");
  const saved = await download(page);
  const slide = Object.values(saved.content.slides)[0] as {
    elements: { content?: string; italic?: boolean }[];
  };
  expect(slide.elements[1]).toMatchObject({ content: "receive the keys", italic: true });
  expect(slide.elements[0].content).toBe("Update");
  await context.setOffline(false);
  expect(leaks).toEqual([]);
});
