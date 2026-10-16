import type { Page } from "@playwright/test";
import { createFile, serializeFile } from "@suiteleaf/core";
import { askAgent, beat, caption, describeRun, expect, openApp, test } from "../harness";

const IGNORED_CELLS_KEY = "suiteleaf.spelling-ignored-cells";

const PROMPT = [
  "Decisions is open. Ignore recieve in B9 so that cell stays recieve. Then change every other recieve to receive. Do not change seperate in B6.",
  'Call ignore_spelling with cell "B9" and word "recieve".',
  'Call fix_spelling_all with word "recieve".',
  "Stop. Do not use set_cells. Do not call fix_spelling. Do not call check_spelling.",
].join(" ");

function decisionsSheet() {
  const sheet = createFile("sheet", "Decisions");
  if (sheet.kind !== "sheet") throw new Error("Expected a spreadsheet");
  const sheetId = sheet.content.workbook.sheetOrder[0];
  const grid = sheet.content.workbook.sheets[sheetId];
  grid.name = "Decisions";
  grid.cellData = {
    0: { 0: { v: "Decision", t: 1 }, 1: { v: "Note", t: 1 } },
    1: { 0: { v: "Grant", t: 1 }, 1: { v: "recieve", t: 1 } },
    2: { 0: { v: "Date", t: 1 }, 1: { v: "Monday", t: 1 } },
    3: { 0: { v: "Keys", t: 1 }, 1: { v: "recieve", t: 1 } },
    4: { 0: { v: "Place", t: 1 }, 1: { v: "Room", t: 1 } },
    5: { 0: { v: "Copies", t: 1 }, 1: { v: "seperate", t: 1 } },
    6: { 0: { v: "Minutes", t: 1 }, 1: { v: "recieve", t: 1 } },
    7: { 0: { v: "Owner", t: 1 }, 1: { v: "Sam", t: 1 } },
    8: { 0: { v: "Guests", t: 1 }, 1: { v: "recieve", t: 1 } },
  };
  grid.columnData = { 0: { w: 120 }, 1: { w: 160 } };
  return sheet;
}

type SavedCell = { v?: unknown };
type SavedSheet = {
  content: {
    workbook: {
      id?: string;
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

test("64-change-every-copy-of-a-typo-ai", async ({ page }) => {
  await openApp(page);
  await caption(page, "Sam's decisions sheet says recieve in four cells, and seperate in one he wants to keep.");
  await page.locator("input[type=file]").setInputFiles({
    name: "Decisions.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(decisionsSheet())),
  });
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  await page.evaluate((key) => {
    localStorage.removeItem(key);
    localStorage.removeItem("suiteleaf.spelling-ignored");
    localStorage.removeItem("suiteleaf.personal-dictionary");
  }, IGNORED_CELLS_KEY);
  await caption(page, "He asks the on-device assistant to leave B9 and change every other recieve.", 1600);
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
        return [cellText(cells, 1, 1), cellText(cells, 3, 1), cellText(cells, 6, 1), cellText(cells, 8, 1), cellText(cells, 5, 1)].join(" | ");
      },
      { timeout: 15000 },
    )
    .toBe("receive | receive | receive | recieve | seperate");

  const sheetId = sheet!.content.workbook.sheetOrder[0];
  const cells = sheet!.content.workbook.sheets[sheetId].cellData;
  expect(cellText(cells, 1, 1), why).toBe("receive");
  expect(cellText(cells, 3, 1), why).toBe("receive");
  expect(cellText(cells, 6, 1), why).toBe("receive");
  expect(cellText(cells, 8, 1), why).toBe("recieve");
  expect(cellText(cells, 5, 1), why).toBe("seperate");

  const ignored = await page.evaluate((key) => {
    const raw = JSON.parse(localStorage.getItem(key) || "{}") as Record<string, IgnoredCell[]>;
    return Object.values(raw).flat();
  }, IGNORED_CELLS_KEY);
  const kept = ignored.filter(
    (cell) => cell.row === 8 && cell.column === 1 && cell.word?.toLowerCase() === "recieve",
  );
  expect(kept.length, `${why}\nIgnored: ${JSON.stringify(ignored)}`).toBeGreaterThan(0);
  expect(
    ignored.some((cell) => cell.word?.toLowerCase() === "seperate"),
    why,
  ).toBe(false);

  const done = page.getByRole("button", { name: "Done", exact: true });
  if (await done.isVisible().catch(() => false)) await done.click();
  await page.getByRole("button", { name: "Close assistant" }).click();
  await beat(page, 800);
  await caption(page, "B2, B4, and B7 say receive. B9 still says recieve. B6 still says seperate.", 1600);
});
