import { readFileSync } from "node:fs";
import { createFile, serializeFile } from "../../../packages/core/src";
import { ready } from "../fixtures";
import { askAgent, beat, caption, describeRun, expect, openApp, test } from "../harness";

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const prompt = [
  "The Rent budget sheet is already open. Leave the month names and the 1200 amounts as they are. Do not undo.",
  'Call name_range with name "Rent" and range "C2:C13".',
  'Call fill_formula with range "C14" and formula =SUM(Rent).',
  'Call name_range with name "Rent" and rename_to "MonthlyRent".',
].join(" ");

function budgetFile() {
  const file = createFile("sheet", "Rent budget");
  if (file.kind !== "sheet") throw new Error("Expected a spreadsheet");
  const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  sheet.name = "Budget";
  const cellData: Record<string, Record<string, { v?: string | number; t?: number; f?: string }>> = {
    0: { 0: { v: "Month", t: 1 }, 2: { v: "Rent", t: 1 } },
  };
  months.forEach((month, index) => {
    cellData[index + 1] = { 0: { v: month, t: 1 }, 2: { v: 1200, t: 2 } };
  });
  cellData[13] = { 1: { v: "Total", t: 1 }, 2: { f: "=SUM(C2:C13)", v: 14400 } };
  sheet.cellData = cellData;
  sheet.columnData = { 0: { w: 88 }, 1: { w: 80 }, 2: { w: 96 } };
  return file;
}

test("55-name-a-range-ai", async ({ page }) => {
  await openApp(page);
  await caption(page, "Rosa's rent budget adds the same twelve cells. She wants that range to have a name.");
  await page.locator("input[type=file]").setInputFiles({
    name: "Rent budget.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(budgetFile())),
  });
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  await ready(page);
  await caption(page, "She asks SuiteLeaf's on-device assistant to name the months Rent, sum that name, then rename it MonthlyRent.", 1600);
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
  const cells = book.sheets[book.sheetOrder[0]].cellData;
  const raw = book.resources.find((item: { name: string }) => item.name === "SHEET_DEFINED_NAME_PLUGIN").data as string;
  const names = Object.values(JSON.parse(raw) as Record<string, { name: string; formulaOrRefString: string }>).filter(
    (item) => item.name && !item.name.startsWith("_xlnm."),
  );
  const detail = `${why}\nNames: ${JSON.stringify(names)}\nC14: ${JSON.stringify(cells[13]?.[2])}`;

  expect(names.map((item) => item.name), detail).toEqual(["MonthlyRent"]);
  expect(names[0].formulaOrRefString, detail).toBe("Budget!$C$2:$C$13");
  expect(cells[13][2].f, detail).toBe("=SUM(MonthlyRent)");
  expect(cells[13][2].v, detail).toBe(14400);
});
