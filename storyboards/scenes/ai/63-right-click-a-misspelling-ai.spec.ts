import type { Page } from "@playwright/test";
import { createFile, serializeFile, type DocFile } from "@suiteleaf/core";
import { isMisspelling, PERSONAL_DICTIONARY_KEY, type PersonalDictionary } from "../../../apps/web/src/editors/doc-spelling";
import { askAgent, beat, caption, describeRun, expect, openApp, selectCells, test } from "../harness";

const PROMPT = [
  "Decisions is open. Add Kwame to the shared dictionary so Kwame is not flagged. In B4 change only recieve so the cell reads Please receive the keys. Leave every other cell as it is. Stay in Decisions.",
  'Call add_to_dictionary with word "Kwame".',
  'Call fix_spelling with word "recieve" and cell "B4".',
  "Stop. Do not use set_cells.",
].join(" ");

function decisionsSheet() {
  const file = createFile("sheet", "Decisions");
  if (file.kind !== "sheet") throw new Error("Expected a spreadsheet");
  const id = file.content.workbook.sheetOrder[0]!;
  const sheet = file.content.workbook.sheets[id]!;
  sheet.cellData = {
    0: { 0: { v: "Decision", t: 1 }, 1: { v: "Note", t: 1 } },
    1: { 0: { v: "Grant", t: 1 }, 1: { v: "We will receive the grant", t: 1 } },
    2: { 0: { v: "Visit", t: 1 }, 1: { v: "Ask Kwame tomorrow", t: 1 } },
    // The human scene types this into B4 before the right-click. The assistant starts from that cell.
    3: { 1: { v: "Please recieve the keys", t: 1 } },
    4: { 0: { v: "Speaker", t: 1 }, 1: { v: "Nkrumah spoke", t: 1 } },
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
        content: [{ type: "text", text: "Kwame asked Nkrumah to seperate the keys." }],
      },
    ],
  };
  return file;
}

async function seed(page: Page) {
  await openApp(page);
  await page.getByRole("button", { name: "New document" }).waitFor();
  await page.evaluate(
    async ({ records, dictionaryKey }) => {
      localStorage.removeItem(dictionaryKey);
      localStorage.removeItem("suiteleaf.spelling-ignored");
      localStorage.removeItem("suiteleaf.spelling-ignored-cells");
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
      records: [decisionsSheet(), handoverDoc()].map((file) => ({
        id: file.id,
        title: file.title,
        updatedAt: file.updatedAt,
        native: serializeFile(file),
      })),
    },
  );
  await page.reload();
  await page.getByRole("link", { name: "Decisions", exact: true }).waitFor();
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

async function savedFile(page: Page, title: string): Promise<SavedSheet | null> {
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
    return JSON.parse(text) as SavedSheet;
  }, title);
}

function cellText(cells: Record<string, Record<string, SavedCell>> | undefined, row: number, column: number) {
  const cell = cells?.[row]?.[column] ?? cells?.[String(row)]?.[String(column)];
  if (!cell || cell.v == null) return "";
  return typeof cell.v === "string" ? cell.v : String(cell.v);
}

test("63-right-click-a-misspelling-ai", async ({ page }) => {
  await seed(page);
  await caption(page, "Kwame is underlined in Decisions, and B4 says recieve.");
  await page.getByRole("link", { name: "Decisions", exact: true }).click();
  const grid = page.getByLabel("Spreadsheet grid");
  await expect(grid).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".sheet-spell-mark[data-spell-word='Kwame']")).toBeVisible();
  await expect(page.locator(".sheet-spell-hit[data-spell-word='recieve']")).toBeVisible();
  await expect(page.locator(".sheet-spell-mark[data-spell-word='seperate']")).toBeVisible();
  await caption(page, "He asks the on-device assistant to add Kwame and fix only recieve in B4.", 1600);
  await caption(page, "", 0);

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");
  const retyped = run.items.filter((item) => item.kind === "tool" && item.name === "set_cells" && item.status === "ok");
  expect(retyped, why).toEqual([]);

  let sheet: SavedSheet | null = null;
  await expect
    .poll(
      async () => {
        sheet = await savedFile(page, "Decisions");
        const id = sheet?.content.workbook.sheetOrder[0];
        const cells = id ? sheet?.content.workbook.sheets[id]?.cellData : undefined;
        return [
          cellText(cells, 1, 1),
          cellText(cells, 2, 1),
          cellText(cells, 3, 1),
          cellText(cells, 4, 1),
          cellText(cells, 5, 1),
        ].join(" | ");
      },
      { timeout: 15000 },
    )
    .toBe(
      "We will receive the grant | Ask Kwame tomorrow | Please receive the keys | Nkrumah spoke | seperate the copies",
    );

  const sheetId = sheet!.content.workbook.sheetOrder[0];
  const cells = sheet!.content.workbook.sheets[sheetId].cellData;
  expect(cellText(cells, 0, 0), why).toBe("Decision");
  expect(cellText(cells, 0, 1), why).toBe("Note");
  expect(cellText(cells, 1, 0), why).toBe("Grant");
  expect(cellText(cells, 2, 0), why).toBe("Visit");
  expect(cellText(cells, 3, 1), why).toBe("Please receive the keys");
  expect(cellText(cells, 4, 0), why).toBe("Speaker");
  expect(cellText(cells, 5, 0), why).toBe("Copies");
  expect(cellText(cells, 5, 1), why).toBe("seperate the copies");

  const dictionary = await page.evaluate((key) => {
    const raw = JSON.parse(localStorage.getItem(key) || "{}") as Partial<PersonalDictionary>;
    return { added: raw.added ?? [], flagged: raw.flagged ?? [] };
  }, PERSONAL_DICTIONARY_KEY);
  expect(dictionary.added.some((word) => word.toLowerCase() === "kwame"), why).toBe(true);
  expect(dictionary.flagged.some((word) => word.toLowerCase() === "kwame"), why).toBe(false);
  expect(isMisspelling("Kwame", dictionary, []), why).toBe(false);
  expect(dictionary.added.some((word) => word.toLowerCase() === "seperate"), why).toBe(false);

  const done = page.getByRole("button", { name: "Done", exact: true });
  if (await done.isVisible().catch(() => false)) await done.click();
  await page.getByRole("button", { name: "Close assistant" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await expect(page.locator(".sheet-spell-mark[data-spell-word='Kwame']"), why).toHaveCount(0);
  await expect(page.locator(".sheet-spell-mark[data-spell-word='recieve']"), why).toHaveCount(0);
  await expect(page.locator(".sheet-spell-mark[data-spell-word='seperate']")).toBeVisible();
  await selectCells(page, "B4");
  await expect(grid).toHaveAttribute("data-active-value", "Please receive the keys");

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Handover", exact: true }).click();
  await expect(page.locator(".spelling-misspelling", { hasText: "Kwame" })).toHaveCount(0);
  await expect(page.locator(".spelling-misspelling", { hasText: "seperate" })).toBeVisible();
  await beat(page, 800);

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Decisions", exact: true }).click();
  await expect(grid).toHaveAttribute("aria-busy", "false");
  await selectCells(page, "B4");
  await expect(grid).toHaveAttribute("data-active-value", "Please receive the keys");
  await expect(page.locator(".sheet-spell-mark[data-spell-word='Kwame']")).toHaveCount(0);
  await beat(page, 800);
  await caption(page, "B4 says Please receive the keys. Kwame is not flagged.", 1600);
});
