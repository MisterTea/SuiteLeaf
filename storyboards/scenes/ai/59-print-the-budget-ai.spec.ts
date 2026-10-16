import { readFileSync } from "node:fs";
import { createFile, serializeFile } from "../../../packages/core/src";
import { ready } from "../fixtures";
import { askAgent, beat, caption, describeRun, expect, openApp, test } from "../harness";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function monthLabel(index: number) {
  return `${MONTHS[index % 12]} ${2024 + Math.floor(index / 12)}`;
}

const rows: (string | number)[][] = [["Month", "Rent", "Paid"]];
for (let i = 0; i < 29; i++) rows.push([monthLabel(i), 1450, i % 4 === 3 ? "No" : "Yes"]);

const prompt = [
  "Rent budget is open. Put a page break above row 16 so March 2025 starts the next page and stays whole.",
  "Repeat row 1 (Month, Rent, Paid) on each printed page.",
  "Do not freeze any rows and do not change cell values.",
  "Call insert_page_break with row 16, then call repeat_header. Stop.",
].join(" ");

function budgetFile() {
  const file = createFile("sheet", "Rent budget");
  if (file.kind !== "sheet") throw new Error("Expected a spreadsheet");
  const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]!]!;
  sheet.name = "Rent budget";
  (file.content.workbook as { styles?: unknown }).styles = {
    header: { bl: 1, bg: { rgb: "#d2e3fc" }, n: { pattern: "@" } },
    month: { n: { pattern: "@" } },
  };
  sheet.cellData = Object.fromEntries(
    rows.map((row, r) => [
      r,
      Object.fromEntries(
        row.map((value, c) => [
          c,
          typeof value === "number"
            ? { v: value, t: 2 }
            : { v: value, t: 1, s: r === 0 ? "header" : c === 0 ? "month" : undefined },
        ]),
      ),
    ]),
  );
  (sheet as { columnData?: unknown }).columnData = {
    0: { w: 160 },
    1: { w: 100 },
    2: { w: 90 },
  };
  return file;
}

type SavedCell = { v?: unknown; f?: string | null };

function shownValue(cell: SavedCell | undefined) {
  const value = cell?.v;
  return value == null ? "" : value;
}

function shownFormula(cell: SavedCell | undefined) {
  const formula = cell?.f;
  return formula == null || formula === "" ? "" : formula;
}

test("59-print-the-budget-ai", async ({ page }) => {
  await openApp(page);
  await caption(page, "Rosa needs a paper copy of the rent budget. Row 1 is Month, Rent, and Paid, and it is not frozen.");
  await page.locator("input[type=file]").setInputFiles({
    name: "Rent budget.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(budgetFile())),
  });
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  await page.getByRole("button", { name: "Sheet tools", exact: true }).waitFor();
  await ready(page);
  await caption(
    page,
    "She asks SuiteLeaf's on-device assistant for a page break above March 2025 and the header on every printed page.",
    1600,
  );
  await caption(page, "", 0);

  const run = await askAgent(page, prompt);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await page.getByRole("button", { name: "Close assistant" }).click();
  await beat(page, 400);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(readFileSync((await (await download).path())!, "utf8"));
  const book = saved.content.workbook;
  const sheetId = book.sheetOrder[0] as string;
  const sheet = book.sheets[sheetId];
  const print = saved.content.print?.sheets?.[sheetId] as
    | { breaksAbove?: number[]; repeatFirstRow?: boolean }
    | undefined;
  const freeze = sheet.freeze as { ySplit?: number; startRow?: number } | undefined;
  const frozenRows = freeze?.ySplit ? (freeze.startRow ?? 0) : 0;
  const detail = `${why}\nPrint: ${JSON.stringify(print)}\nFreeze: ${JSON.stringify(sheet.freeze)}\nA16: ${JSON.stringify(sheet.cellData?.[15]?.[0])}`;

  expect(print?.breaksAbove, detail).toEqual([15]);
  expect(sheet.cellData[15][0].v, detail).toBe("March 2025");
  expect(print?.repeatFirstRow, detail).toBe(true);
  expect(frozenRows, detail).toBe(0);

  rows.forEach((row, r) => {
    row.forEach((value, c) => {
      const cell = sheet.cellData?.[r]?.[c] as SavedCell | undefined;
      const where = `${String.fromCharCode(65 + c)}${r + 1}`;
      expect(shownValue(cell), `${detail}\n${where}`).toBe(value);
      expect(shownFormula(cell), `${detail}\n${where}`).toBe("");
    });
  });
  for (const [rowKey, row] of Object.entries(sheet.cellData ?? {}) as [string, Record<string, SavedCell>][]) {
    for (const [colKey, cell] of Object.entries(row)) {
      const r = Number(rowKey);
      const c = Number(colKey);
      const expected = rows[r]?.[c] ?? "";
      const where = `${String.fromCharCode(65 + c)}${r + 1}`;
      expect(shownValue(cell), `${detail}\nextra ${where}`).toBe(expected);
      expect(shownFormula(cell), `${detail}\nextra ${where}`).toBe("");
    }
  }
});
