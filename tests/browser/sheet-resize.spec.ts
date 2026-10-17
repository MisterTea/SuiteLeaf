import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function snapshot(page: Page) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  return JSON.parse(await readFile((await (await waiting).path())!, "utf8"));
}

async function newSheet(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New spreadsheet" }).click();
  await page.locator("[data-sheet-ready='true']").waitFor();
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.getByLabel("File title").fill("Resize columns and rows");
  const box = page.locator(".sheet-host input.univer-size-full");
  const select = async (ref: string) => {
    await box.fill(ref);
    await box.press("Enter");
  };
  await select("A1");
  await page.keyboard.type("Category");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Budget");
  await page.keyboard.press("Enter");
  return select;
}

const sheetOf = (file: any) =>
  file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];

function columnWidth(sheet: any, index: number) {
  const width = sheet.columnData?.[index]?.w;
  return typeof width === "number" ? width : (sheet.defaultColumnWidth ?? 100);
}

function rowHeight(sheet: any, index: number) {
  const height = sheet.rowData?.[index]?.h;
  return typeof height === "number" ? height : (sheet.defaultRowHeight ?? 24);
}

/** Univer paints headers on the grid canvas and only shows a resize cursor on the boundary. */
async function cursorAt(page: Page, x: number, y: number) {
  await page.mouse.move(x, y);
  return page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    const host = el instanceof Element ? el.closest(".sheet-host") : null;
    const nodes = [
      el instanceof Element ? el : null,
      host?.querySelector("canvas") ?? null,
    ];
    return nodes
      .filter((node): node is Element => !!node)
      .map((node) => getComputedStyle(node).cursor)
      .join(" ");
  }, [x, y] as const);
}

async function findBoundary(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  axis: "column" | "row",
) {
  const wanted = axis === "column" ? "col-resize" : "row-resize";
  const samples =
    axis === "column"
      ? Array.from({ length: 140 }, (_, i) => ({
          x: box.x + 60 + i * 2,
          y: box.y + 10,
        }))
      : Array.from({ length: 70 }, (_, i) => ({
          x: box.x + 16,
          y: box.y + 22 + i * 2,
        }));
  let run: { x: number; y: number } | null = null;
  for (const point of samples) {
    const cursor = await cursorAt(page, point.x, point.y);
    if (cursor.includes(wanted)) {
      run ??= point;
    } else if (run) {
      return { x: (run.x + point.x) / 2, y: axis === "column" ? point.y : (run.y + point.y) / 2 };
    }
  }
  throw new Error(`No ${wanted} boundary on the sheet header.`);
}

async function drag(page: Page, from: { x: number; y: number }, by: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + by.x, from.y + by.y, { steps: 12 });
  await page.mouse.up();
}

test("dragging column and row headers changes the saved size and keeps it on reopen", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await newSheet(page);

  const canvas = page.locator('.sheet-host canvas[id^="univer-sheet-main-canvas"]');
  const box = (await canvas.boundingBox())!;
  const before = sheetOf(await snapshot(page));
  const startWidth = columnWidth(before, 0);
  const startNeighbor = columnWidth(before, 1);

  const columnEdge = await findBoundary(page, box, "column");
  await drag(page, columnEdge, { x: 72, y: 0 });

  const widened = await snapshot(page);
  const wideSheet = sheetOf(widened);
  expect(columnWidth(wideSheet, 0)).toBeGreaterThanOrEqual(startWidth + 40);
  expect(columnWidth(wideSheet, 1)).toBeLessThan(startNeighbor + 20);
  expect(wideSheet.cellData[0][0].v).toBe("Category");
  expect(wideSheet.cellData[0][1].v).toBe("Budget");

  const startHeight = rowHeight(wideSheet, 0);
  const rowEdge = await findBoundary(page, box, "row");
  await drag(page, rowEdge, { x: 0, y: 40 });

  const saved = await snapshot(page);
  const sheet = sheetOf(saved);
  const savedWidth = columnWidth(sheet, 0);
  const savedHeight = rowHeight(sheet, 0);
  expect(savedWidth).toBeGreaterThanOrEqual(startWidth + 40);
  expect(columnWidth(sheet, 1)).toBeLessThan(startNeighbor + 20);
  expect(savedHeight).toBeGreaterThanOrEqual(startHeight + 20);
  expect(savedHeight).toBeGreaterThanOrEqual((sheet.defaultRowHeight ?? 24) + 20);

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Resize columns and rows" }).click();
  await page.locator("[data-sheet-ready='true']").waitFor();
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const reopened = sheetOf(await snapshot(page));
  expect(columnWidth(reopened, 0)).toBe(savedWidth);
  expect(rowHeight(reopened, 0)).toBe(savedHeight);
  expect(columnWidth(reopened, 1)).toBe(columnWidth(sheet, 1));
  expect(reopened.cellData[0][0].v).toBe("Category");
  expect(reopened.cellData[0][1].v).toBe("Budget");
  expect(errors).toEqual([]);
});
