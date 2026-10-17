import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function snapshot(page: Page) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  return JSON.parse(await readFile((await (await waiting).path())!, "utf8"));
}

async function newSheet(page: Page, rows: string[][]) {
  await page.goto("/");
  await page.getByRole("button", { name: "New spreadsheet" }).click();
  await page.locator("[data-sheet-ready='true']").waitFor();
  await page.getByLabel("File title").fill("Alternating colors");
  const box = page.locator(".sheet-host input.univer-size-full");
  const select = async (ref: string) => {
    await box.fill(ref);
    await box.press("Enter");
  };
  for (const [r, row] of rows.entries()) {
    await select(`A${r + 1}`);
    for (const value of row) {
      await page.keyboard.type(value);
      await page.keyboard.press("Tab");
    }
    await page.keyboard.press("Enter");
  }
  return select;
}

const styleOf = (file: any, cell: { s?: unknown }) =>
  typeof cell.s === "string" ? file.content.workbook.styles[cell.s] : cell.s;
const cellsOf = (file: any) =>
  file.content.workbook.sheets[file.content.workbook.sheetOrder[0]].cellData;

const FILLS = ["#d2e3fc", "#ffffff", "#e8f0fe", "#ffffff", "#e8f0fe"];

function fillOf(file: any, row: number, column: number) {
  const cell = cellsOf(file)[row]?.[column];
  if (!cell?.s) return "";
  const rgb = styleOf(file, cell)?.bg?.rgb;
  return typeof rgb === "string" ? rgb.toLowerCase() : "";
}

function gridOf(file: any) {
  const cells = cellsOf(file);
  return Array.from({ length: 5 }, (_, row) =>
    [0, 1].map((column) => {
      const cell = cells[row]?.[column] ?? {};
      const style = cell.s ? styleOf(file, cell) : null;
      return {
        v: cell.v ?? null,
        f: cell.f ?? null,
        bl: style?.bl ?? 0,
        pattern: style?.n?.pattern ?? null,
        fill: fillOf(file, row, column),
        wrap: style?.tb ?? null,
        rotation: style?.tr ?? null,
      };
    }),
  );
}

function ruleResources(file: any) {
  return (file.content.workbook.resources ?? [])
    .filter((resource: { name?: string }) =>
      /conditional|theme|band/i.test(resource.name ?? ""),
    )
    .map((resource: { name?: string; data?: unknown }) => ({
      name: resource.name,
      data: resource.data,
    }));
}

async function alternatingColors(page: Page) {
  await page.getByRole("button", { name: "Format", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Alternating colors", exact: true })
    .click();
}

test("alternating colors fill the selection and survive reopen", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const select = await newSheet(page, [
    ["Category", "Budget"],
    ["Housing", "1200"],
    ["Food", "500"],
    ["Transport", "300"],
    ["Utilities", "200"],
  ]);

  await select("A1");
  await page.getByRole("button", { name: "Bold (Cmd+B)" }).click();
  await select("B2");
  await page.getByRole("button", { name: "Format as currency" }).click();
  const prepared = await snapshot(page);
  const values = gridOf(prepared).map((row) => row.map((cell) => cell.v));
  expect(styleOf(prepared, cellsOf(prepared)[0][0]).bl).toBe(1);
  expect(styleOf(prepared, cellsOf(prepared)[1][1]).n.pattern).toBe(
    '"$"#,##0.00',
  );

  await select("A1:B5");
  await alternatingColors(page);
  const colored = await snapshot(page);
  const painted = gridOf(colored);
  for (const [row, color] of FILLS.entries()) {
    expect(painted[row][0].fill).toBe(color);
    expect(painted[row][1].fill).toBe(color);
  }
  expect(fillOf(colored, 0, 2)).toBe("");
  expect(painted.map((row) => row.map((cell) => cell.v))).toEqual(values);
  expect(painted[0][0].bl).toBe(1);
  expect(painted[1][1].pattern).toBe('"$"#,##0.00');
  expect(painted[0][0].f).toBeNull();
  expect(painted[1][1].f).toBeNull();
  expect(painted[0][0].wrap).toBeNull();
  expect(painted[0][0].rotation).toBeNull();
  expect(painted[1][1].wrap).toBeNull();
  expect(painted[1][1].rotation).toBeNull();
  const rules = ruleResources(colored);

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Alternating colors" }).click();
  await page.locator("[data-sheet-ready='true']").waitFor();
  const reopened = await snapshot(page);
  expect(gridOf(reopened)).toEqual(painted);
  expect(fillOf(reopened, 0, 2)).toBe("");
  expect(ruleResources(reopened)).toEqual(rules);

  await select("A1:B5");
  await alternatingColors(page);
  const again = await snapshot(page);
  expect(gridOf(again)).toEqual(painted);
  expect(fillOf(again, 0, 2)).toBe("");
  expect(ruleResources(again)).toEqual(rules);
  expect(errors).toEqual([]);
});
