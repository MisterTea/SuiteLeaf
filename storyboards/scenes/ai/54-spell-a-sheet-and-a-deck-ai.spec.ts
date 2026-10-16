import type { Page } from "@playwright/test";
import { createFile, serializeFile, type SlideFile } from "@suiteleaf/core";
import { isMisspelling, PERSONAL_DICTIONARY_KEY, type PersonalDictionary } from "../../../apps/web/src/editors/doc-spelling";
import { askAgent, beat, caption, describeRun, expect, openApp, test } from "../harness";

const PROMPT = [
  "Decisions is open. In B2 change only recieve to receive, so the cell reads We will receive the grant. Add Nkrumah to the dictionary and do not change B3. Then go back to the file list and open the presentation Update. In that text box change only recieve to receive, so it reads receive the keys.",
  'Call fix_spelling with word "recieve" and cell "B2".',
  'Call add_to_dictionary with word "Nkrumah".',
  "Call back_to_files.",
  'Call open_file with name "Update".',
  'Call fix_spelling with word "recieve".',
  "Then stop. Do not use set_cells or set_slide_text.",
].join(" ");

function decisionsSheet() {
  const sheet = createFile("sheet", "Decisions");
  if (sheet.kind !== "sheet") throw new Error("Expected a spreadsheet");
  const sheetId = sheet.content.workbook.sheetOrder[0];
  const grid = sheet.content.workbook.sheets[sheetId];
  grid.name = "Decisions";
  grid.cellData = {
    0: { 0: { v: "Decision", t: 1 }, 1: { v: "Note", t: 1 } },
    1: { 0: { v: "Grant", t: 1 }, 1: { v: "We will recieve the grant", t: 1 } },
    2: { 0: { v: "Speaker", t: 1 }, 1: { v: "Nkrumah spoke", t: 1 } },
  };
  grid.columnData = { 0: { w: 120 }, 1: { w: 280 } };
  return sheet;
}

function updateDeck() {
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
  return deck;
}

async function seedFiles(page: Page) {
  const files = [decisionsSheet(), updateDeck()];
  await page.evaluate(
    async ({ records, dictionaryKey }) => {
      localStorage.removeItem(dictionaryKey);
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
    },
    {
      dictionaryKey: PERSONAL_DICTIONARY_KEY,
      records: files.map((file) => ({
        id: file.id,
        title: file.title,
        updatedAt: file.updatedAt,
        native: serializeFile(file),
      })),
    },
  );
  await page.reload();
}

type SavedCell = { v?: unknown };
type SavedSheet = {
  content: {
    workbook: {
      sheetOrder: string[];
      sheets: Record<string, { cellData?: Record<string, Record<string, SavedCell>> }>;
    };
  };
};
type SavedDeck = {
  content: {
    slideOrder: string[];
    slides: Record<string, { elements: { type: string; content?: string }[] }>;
  };
};

async function savedFile<T>(page: Page, title: string): Promise<T | null> {
  return page.evaluate(async (title) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("SuiteLeaf");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
    const rows = await new Promise<{ title?: string; native?: string | Blob }[]>((resolve, reject) => {
      const tx = db.transaction("encoded", "readonly");
      const req = tx.objectStore("encoded").getAll();
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
    const row = rows.find((item) => item.title === title);
    if (!row?.native) return null;
    const text = typeof row.native === "string" ? row.native : await row.native.text();
    return JSON.parse(text) as T;
  }, title);
}

function cellText(cells: Record<string, Record<string, SavedCell>> | undefined, row: number, column: number) {
  const cell = cells?.[row]?.[column] ?? cells?.[String(row)]?.[String(column)];
  if (!cell || cell.v == null) return "";
  return typeof cell.v === "string" ? cell.v : String(cell.v);
}

function deckText(deck: SavedDeck | null) {
  if (!deck) return [];
  return deck.content.slideOrder.flatMap((id) =>
    (deck.content.slides[id]?.elements ?? []).filter((element) => element.type === "text").map((element) => element.content ?? ""),
  );
}

test("54-spell-a-sheet-and-a-deck-ai", async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole("button", { name: "New spreadsheet" })).toBeVisible();
  await seedFiles(page);
  await expect(page.getByRole("link", { name: "Decisions", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Update", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Decisions", exact: true }).click();
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  await caption(page, "Sam asks the on-device assistant to spell the sheet, keep Nkrumah, then spell the deck.");
  await caption(page, "", 0);

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  let sheet: SavedSheet | null = null;
  let deck: SavedDeck | null = null;
  await expect
    .poll(
      async () => {
        sheet = await savedFile<SavedSheet>(page, "Decisions");
        deck = await savedFile<SavedDeck>(page, "Update");
        const id = sheet?.content.workbook.sheetOrder[0];
        const cells = id ? sheet?.content.workbook.sheets[id]?.cellData : undefined;
        const boxes = deckText(deck).map((text) => text.trim()).filter(Boolean);
        return `${cellText(cells, 1, 1)} | ${cellText(cells, 2, 1)} | ${boxes.join(" / ")}`;
      },
      { timeout: 15000 },
    )
    .toBe("We will receive the grant | Nkrumah spoke | Update / receive the keys");

  const sheetId = sheet!.content.workbook.sheetOrder[0];
  const cells = sheet!.content.workbook.sheets[sheetId].cellData;
  expect(cellText(cells, 0, 0), why).toBe("Decision");
  expect(cellText(cells, 0, 1), why).toBe("Note");
  expect(cellText(cells, 1, 0), why).toBe("Grant");
  expect(cellText(cells, 1, 1), why).toBe("We will receive the grant");
  expect(cellText(cells, 2, 0), why).toBe("Speaker");
  expect(cellText(cells, 2, 1), why).toBe("Nkrumah spoke");
  const boxes = deckText(deck).map((text) => text.trim()).filter(Boolean);
  expect(boxes, why).toEqual(["Update", "receive the keys"]);
  expect(boxes.join("\n"), why).not.toMatch(/recieve/);

  const dictionary = await page.evaluate((key) => {
    const raw = JSON.parse(localStorage.getItem(key) || "{}") as Partial<PersonalDictionary>;
    return { added: raw.added ?? [], flagged: raw.flagged ?? [] };
  }, PERSONAL_DICTIONARY_KEY);
  expect(dictionary.added.some((word) => word.toLowerCase() === "nkrumah"), why).toBe(true);
  expect(dictionary.flagged.some((word) => word.toLowerCase() === "nkrumah"), why).toBe(false);
  expect(isMisspelling("Nkrumah", dictionary, []), why).toBe(false);
  expect(isMisspelling("recieve", dictionary, []), why).toBe(true);

  const done = page.getByRole("button", { name: "Done", exact: true });
  if (await done.isVisible().catch(() => false)) await done.click();
  await page.getByRole("button", { name: "Close assistant" }).click();
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Decisions", exact: true }).click();
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  await beat(page, 800);
  await expect(page.locator(".sheet-spell-mark[data-spell-word='Nkrumah']"), why).toHaveCount(0);
  await expect(page.locator(".sheet-spell-mark[data-spell-word='recieve']"), why).toHaveCount(0);
  await caption(page, "B2 says receive, Nkrumah stays, and the deck says receive the keys.", 1600);
});
