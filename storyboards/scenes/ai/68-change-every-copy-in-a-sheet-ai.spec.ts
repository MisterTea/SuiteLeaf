import type { Page } from "@playwright/test";
import { createFile, serializeFile } from "@suiteleaf/core";
import { askAgent, beat, caption, describeRun, expect, openApp, selectCells, test } from "../harness";

const IGNORED_CELLS_KEY = "suiteleaf.spelling-ignored-cells";

const PROMPT = [
  "Decisions is open. Ignore recieve in B9 so that cell stays recieve and is not underlined. Then change every other recieve to receive. Do not change seperate in B6. Only that misspelled word changes. Leave the rest of each cell.",
  'Call ignore_spelling with cell "B9" and word "recieve".',
  'Call fix_spelling_all with word "recieve".',
  "Stop. Do not use set_cells. Do not call fix_spelling. Do not call check_spelling.",
].join(" ");

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
  await openApp(page);
  await page.getByRole("button", { name: "New document" }).waitFor();
  const file = decisionsSheet();
  await page.evaluate(
    async ({ record, ignoredKey }) => {
      localStorage.removeItem(ignoredKey);
      localStorage.removeItem("suiteleaf.spelling-ignored");
      localStorage.removeItem("suiteleaf.personal-dictionary");
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
    },
    {
      ignoredKey: IGNORED_CELLS_KEY,
      record: {
        id: file.id,
        title: file.title,
        updatedAt: file.updatedAt,
        native: serializeFile(file),
      },
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

type IgnoredCell = { sheetId?: string; row?: number; column?: number; word?: string };

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

test("68-change-every-copy-in-a-sheet-ai", async ({ page }) => {
  await seed(page);
  await caption(page, "Four cells say recieve. Sam wants to keep seperate in B6, and leave B9.");
  await page.getByRole("link", { name: "Decisions", exact: true }).click();
  const grid = page.getByLabel("Spreadsheet grid");
  await expect(grid).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".sheet-spell-hit[data-spell-word='recieve']")).toHaveCount(4);
  await expect(page.locator(".sheet-spell-hit[data-spell-cell='B6']")).toBeVisible();
  await caption(page, "He asks the on-device assistant to ignore B9 and change every other recieve.", 1600);
  await caption(page, "", 0);

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  let sheet: SavedSheet | null = null;
  await expect
    .poll(
      async () => {
        sheet = await savedFile(page, "Decisions");
        const id = sheet?.content.workbook.sheetOrder[0];
        const cells = id ? sheet?.content.workbook.sheets[id]?.cellData : undefined;
        return [
          cellText(cells, 1, 1),
          cellText(cells, 3, 1),
          cellText(cells, 6, 1),
          cellText(cells, 8, 1),
          cellText(cells, 5, 1),
        ].join(" | ");
      },
      { timeout: 15000 },
    )
    .toBe(
      "We will receive the grant | Please receive the keys | They receive the minutes | Guests recieve a note | seperate the copies",
    );

  const sheetId = sheet!.content.workbook.sheetOrder[0];
  const cells = sheet!.content.workbook.sheets[sheetId].cellData;
  expect(cellText(cells, 0, 0), why).toBe("Decision");
  expect(cellText(cells, 0, 1), why).toBe("Note");
  expect(cellText(cells, 1, 0), why).toBe("Grant");
  expect(cellText(cells, 1, 1), why).toBe("We will receive the grant");
  expect(cellText(cells, 3, 0), why).toBe("Keys");
  expect(cellText(cells, 3, 1), why).toBe("Please receive the keys");
  expect(cellText(cells, 5, 0), why).toBe("Copies");
  expect(cellText(cells, 5, 1), why).toBe("seperate the copies");
  expect(cellText(cells, 6, 0), why).toBe("Minutes");
  expect(cellText(cells, 6, 1), why).toBe("They receive the minutes");
  expect(cellText(cells, 8, 0), why).toBe("Guests");
  expect(cellText(cells, 8, 1), why).toBe("Guests recieve a note");

  const ignored = await page.evaluate((key) => {
    const raw = JSON.parse(localStorage.getItem(key) || "{}") as Record<string, IgnoredCell[]>;
    return Object.values(raw).flat();
  }, IGNORED_CELLS_KEY);
  const kept = ignored.filter((cell) => cell.row === 8 && cell.column === 1 && cell.word?.toLowerCase() === "recieve");
  expect(kept.length, `${why}\nIgnored: ${JSON.stringify(ignored)}`).toBeGreaterThan(0);
  expect(
    ignored.some((cell) => cell.word?.toLowerCase() === "seperate"),
    why,
  ).toBe(false);

  const done = page.getByRole("button", { name: "Done", exact: true });
  if (await done.isVisible().catch(() => false)) await done.click();
  await page.getByRole("button", { name: "Close assistant" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Decisions", exact: true }).click();
  await expect(grid).toHaveAttribute("aria-busy", "false");
  await selectCells(page, "B2");
  await expect(grid).toHaveAttribute("data-active-value", "We will receive the grant");
  await selectCells(page, "B4");
  await expect(grid).toHaveAttribute("data-active-value", "Please receive the keys");
  await selectCells(page, "B7");
  await expect(grid).toHaveAttribute("data-active-value", "They receive the minutes");
  await selectCells(page, "B9");
  await expect(grid).toHaveAttribute("data-active-value", "Guests recieve a note");
  await selectCells(page, "B6");
  await expect(grid).toHaveAttribute("data-active-value", "seperate the copies");
  await expect(page.locator(".sheet-spell-mark[data-spell-word='recieve']")).toHaveCount(0);
  await expect(page.locator(".sheet-spell-mark[data-spell-cell='B9']")).toHaveCount(0);
  await expect(page.locator(".sheet-spell-mark[data-spell-word='seperate']")).toBeVisible();
  await beat(page, 800);
  await caption(page, "B2, B4, and B7 say receive. B9 still says recieve and is not underlined. B6 still says seperate.", 1600);
});
