import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { beat, selectCells, typeSlowly } from "./harness";

export type Value = string | number;
export type Native = any;

/** Univer's default grid geometry, relative to the sheet host. */
export const rowHeader = 46,
  columnWidth = 100,
  firstRowCenter = 58,
  rowHeight = 24;

/** Downloads the native file, as a person keeping a copy would, and parses it. */
export async function native(page: Page): Promise<Native> {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  return JSON.parse(await readFile((await (await download).path())!, "utf8"));
}

export const sheetOf = (file: Native, index = 0) =>
  file.content.workbook.sheets[file.content.workbook.sheetOrder[index]];
export const cellsOf = (file: Native, index = 0) => sheetOf(file, index).cellData;
export const styleOf = (file: Native, cell: { s?: unknown }) =>
  typeof cell.s === "string" ? file.content.workbook.styles[cell.s] : cell.s;
export const resource = (file: Native, name: string): string =>
  file.content.workbook.resources.find((r: { name: string }) => r.name === name)?.data ?? "";

/** Types one row starting at `ref`, moving across with Tab like a person would. */
export async function typeRow(page: Page, ref: string, values: string[], delay = 25) {
  await selectCells(page, ref);
  for (const value of values) {
    if (value) await typeSlowly(page, value, delay);
    await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Enter");
}

/** Screen position of a cell (or of the filter button in a header cell) while scrolled to the top. */
export async function cellPoint(page: Page, ref: string, widths: number[] = [], filterButton = false) {
  const box = (await page.locator(".sheet-host").boundingBox())!;
  const column = ref.charCodeAt(0) - 65,
    row = Number(ref.slice(1));
  const width = (i: number) => widths[i] ?? columnWidth;
  const left = rowHeader + Array.from({ length: column }, (_, i) => width(i)).reduce((a, b) => a + b, 0);
  return {
    x: box.x + left + (filterButton ? width(column) - 10 : width(column) / 2),
    y: box.y + firstRowCenter + rowHeight * (row - 1),
  };
}

/** Moves the visible pointer to a cell, then clicks it. */
export async function pointAt(page: Page, point: { x: number; y: number }, button: "left" | "right" = "left") {
  await page.mouse.move(point.x, point.y, { steps: 12 });
  await beat(page, 250);
  await page.mouse.click(point.x, point.y, { button });
}

/** Selects a range by dragging across it, which also gives the grid keyboard focus. */
export async function dragSelect(page: Page, from: string, to: string, widths: number[] = []) {
  const host = (await page.locator(".sheet-host").boundingBox())!;
  const start = await cellPoint(page, from, widths),
    end = await cellPoint(page, to, widths);
  // A phone is narrower than the table. The name box selects the same cells
  // and scrolls them into view; a drag would start off the edge of the screen.
  const offScreen = [start, end].some(
    (point) => point.x < host.x + 4 || point.x > host.x + host.width - 4,
  );
  if (offScreen) {
    await selectCells(page, from === to ? from : `${from}:${to}`);
    return;
  }
  await page.mouse.move(start.x, start.y, { steps: 10 });
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 15 });
  await page.mouse.up();
  await beat(page, 300);
}

export async function scrollGrid(page: Page, dy: number, times: number) {
  const box = (await page.locator(".sheet-host").boundingBox())!;
  await page.mouse.move(box.x + 600, box.y + 320, { steps: 8 });
  for (let i = 0; i < times; i++) {
    await page.mouse.wheel(0, dy);
    await beat(page, 180);
  }
}
