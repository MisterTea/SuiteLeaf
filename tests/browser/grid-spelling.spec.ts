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
    2: { 0: { v: "Speaker", t: 1 }, 1: { v: "Danquah spoke", t: 1 } },
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
    if (/recieve|Danquah|receive the grant/i.test(body)) leaks.push(request.url());
  });
  await openNative(page, "Decisions.slsheet", decisionsSheet());
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  const recieve = page.locator(".sheet-spell-mark[data-spell-word='recieve']");
  const name = page.locator(".sheet-spell-mark[data-spell-word='Danquah']");
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
  await expect(spelling).toContainText("Danquah");
  await expect(recieve).toHaveCount(0);
  await spelling.getByRole("button", { name: "Add to dictionary" }).click();
  await expect(name).toHaveCount(0);
  await expect(spelling).toContainText("Spelling check finished");
  await spelling.getByRole("button", { name: "Done" }).click();

  const dictionary = await page.evaluate(
    (key) => localStorage.getItem(key),
    PERSONAL_DICTIONARY_KEY,
  );
  expect(JSON.parse(dictionary ?? "{}").added).toContain("Danquah");
  await expect(page.getByRole("status")).toContainText("Saved");
  const saved = await download(page);
  const id = saved.content.workbook.sheetOrder[0];
  const cells = saved.content.workbook.sheets[id].cellData;
  expect(cells[1][1].v).toBe("We will receive the grant");
  expect(cells[2][1].v).toBe("Danquah spoke");
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
    localStorage.setItem(key, JSON.stringify({ added: ["Danquah"], flagged: [] }));
  }, PERSONAL_DICTIONARY_KEY);
  await openNative(page, "Decisions.slsheet", decisionsSheet());
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".sheet-spell-mark[data-spell-word='Danquah']")).toHaveCount(0);
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

const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/** Two sheets. The first wraps long notes in column B; row 2 is tall, row 3 is not. */
async function wrappedWorkbook() {
  const { default: JSZip } = await import("jszip");
  const z = new JSZip();
  const sheetPart = (n: number) =>
    `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  z.file(
    "[Content_Types].xml",
    `${xmlHeader}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetPart(1)}${sheetPart(2)}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  );
  z.file(
    "_rels/.rels",
    `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  z.file(
    "xl/workbook.xml",
    `${xmlHeader}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Units" sheetId="1" r:id="s1"/><sheet name="Goods" sheetId="2" r:id="s2"/></sheets></workbook>`,
  );
  z.file(
    "xl/_rels/workbook.xml.rels",
    `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="s1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="s2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  z.file(
    "xl/styles.xml",
    `${xmlHeader}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><name val="Arial"/><sz val="10"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment wrapText="1"/></xf></cellXfs></styleSheet>`,
  );
  const cell = (ref: string, text: string, style = 0) =>
    `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${text}</t></is></c>`;
  z.file(
    "xl/worksheets/sheet1.xml",
    `${xmlHeader}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="2" max="2" width="18" customWidth="1"/></cols><sheetData><row r="1">${cell("A1", "Name")}${cell("B1", "Description")}</row><row r="2" ht="90" customHeight="1">${cell("A2", "Food")}${cell("B2", "Eatz too much and quikly becomes very tired", 1)}</row><row r="3">${cell("A3", "Robot")}${cell("B3", "Robotz can only work by hand when the power is out and the lights in the whole workshop are off", 1)}</row></sheetData></worksheet>`,
  );
  z.file(
    "xl/worksheets/sheet2.xml",
    `${xmlHeader}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${cell("A1", "Name")}</row><row r="2">${cell("A2", "Fod")}</row></sheetData></worksheet>`,
  );
  return z.generateAsync({ type: "uint8array" });
}

test("sheet underlines sit under wrapped words and follow the sheet on screen", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "Game data.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await wrappedWorkbook()),
  });
  await page.locator('[data-sheet-ready="true"]').waitFor({ timeout: 40000 });
  const marks = () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".sheet-spell-mark")].map((mark) => {
        const box = mark.getBoundingClientRect();
        return { word: mark.dataset.spellWord, cell: mark.dataset.spellCell, left: box.left, top: box.top };
      }),
    );
  await expect.poll(async () => (await marks()).map((mark) => mark.word).sort()).toEqual(["Eatz", "quikly"]);
  const [first, second] = ["Eatz", "quikly"].map((word) => marks().then((all) => all.find((mark) => mark.word === word)!));
  const [eatz, quikly] = [await first, await second];
  expect(Math.abs(quikly.left - eatz.left)).toBeLessThan(1.5);
  expect(quikly.top - eatz.top).toBeGreaterThan(10);
  expect(quikly.top - eatz.top).toBeLessThan(22);

  await page.getByText("Goods", { exact: true }).click();
  await expect.poll(async () => (await marks()).map((mark) => mark.cell)).toEqual(["Goods!A2"]);
});
