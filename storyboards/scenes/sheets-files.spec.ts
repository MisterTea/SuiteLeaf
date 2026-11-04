import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import Papa from "papaparse";
import { beat, caption, expect, selectCells, test, typeSlowly } from "./harness";
import { bakeryWorkbook, ready } from "./fixtures";

test("16-import-and-export-csv", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Rosa got the community garden's member list as a CSV from the old signup site.");
  await caption(page, "Member IDs like 00412 matter: other spreadsheets often strip the leading zeros.", 1800);
  await caption(page, "She opens it with Open / import.", 900);
  await page.getByRole("button", { name: "Open / import" }).hover();
  await beat(page, 600);
  await page.locator("input[type=file]").setInputFiles({
    name: "garden-members.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Member ID,Name,ZIP,Plot,Dues paid\n00412,Rosa Delgado,02139,A3,45\n00977,Tom Okafor,07302,B1,45\n01205,Mei Chen,10001,B4,0\n00038,Luis Ortega,02139,C2,45\n",
    ),
  });
  const dialog = page.getByRole("dialog", { name: "Import garden-members.csv" });
  const summary = dialog.getByRole("status");
  await expect(summary).toHaveText("4 data rows · 5 columns · comma-separated, plus a header row");
  await summary.hover();
  await caption(page, "Before anything lands in a sheet, SuiteLeaf previews it: four members, comma-separated, with a header row.", 2600);

  const zip = dialog.getByRole("columnheader", { name: /^ZIP/ });
  const keep = dialog.getByLabel("Keep code columns as text");
  await expect(dialog).toContainText("Member ID and ZIP have codes with leading zeros");
  await keep.hover();
  await caption(page, "Member ID and ZIP contain codes with leading zeros, so every value in those columns stays text.", 2400);
  await keep.uncheck();
  await expect(zip).toHaveText("ZIPMixed");
  await zip.hover();
  await caption(page, "Without that option, 10001 would turn into a number while 02139 stayed text: a mixed column.", 2400);
  await keep.check();
  await expect(zip).toHaveText("ZIPText");
  await dialog.getByRole("button", { name: "Import", exact: true }).hover();
  await caption(page, "Rosa keeps the codes as text and imports.", 1400);
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await ready(page);

  await selectCells(page, "A2");
  await caption(page, "00412 is still 00412.", 1600);
  await selectCells(page, "C4");
  await caption(page, "And the ZIP column is text all the way down, 10001 included. Dues paid are real numbers.", 2200);

  await caption(page, "Mei paid her dues at the work day. Rosa records it.", 1000);
  await selectCells(page, "E4");
  await typeSlowly(page, "45", 150);
  await page.keyboard.press("Enter");
  await beat(page);

  await caption(page, "File › Export CSV sends the list back in the same plain format.", 1000);
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 700);
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export CSV", exact: true }).click();
  const csv = await readFile((await (await download).path())!, "utf8");
  const rows = Papa.parse<string[]>(csv.trim()).data;
  expect(rows[0]).toEqual(["Member ID", "Name", "ZIP", "Plot", "Dues paid"]);
  expect(rows[1]).toEqual(["00412", "Rosa Delgado", "02139", "A3", "45"]);
  expect(rows[3]).toEqual(["01205", "Mei Chen", "10001", "B4", "45"]);
  expect(rows[4][0]).toBe("00038");
  await caption(page, `The downloaded file keeps every leading zero. Mei's line now reads: ${csv.split(/\r?\n/)[3]}`, 2800);
});

test("19-open-an-excel-workbook", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Kemi runs a bakery. Her accountant emailed the Q3 sales workbook as an Excel file.");
  await caption(page, "She doesn't have Excel. She opens it in SuiteLeaf with Open / import.", 1000);
  await page.getByRole("button", { name: "Open / import" }).hover();
  await beat(page, 600);
  await page.locator("input[type=file]").setInputFiles({
    name: "Q3 bakery sales.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await bakeryWorkbook()),
  });
  await ready(page);
  const notes = page.locator("details.import-notes");
  await expect(notes).toContainText("Imported XLSX: Q3 bakery sales.xlsx");
  await caption(page, "It opens as an editable copy. The original .xlsx is left untouched.", 1600);
  await notes.locator("summary").click();
  await caption(page, "A note explains what was converted: formulas and their results are kept.", 2200);
  await notes.locator("summary").click();

  await caption(page, "The peach header, bold totals, dollar formats and column widths came across.", 1800);
  await selectCells(page, "D3");
  await caption(page, "So did the formulas: Revenue is still =B3*C3.", 1800);

  await caption(page, "The accountant missed a late order of croissants. Kemi corrects the units…", 1000);
  await selectCells(page, "B3");
  await typeSlowly(page, "1020", 120);
  await page.keyboard.press("Enter");
  await selectCells(page, "D3:D6");
  await caption(page, "…and revenue and the total recalculate: $10,331.75.", 2000);

  await caption(page, "The Summary tab, which points at the first sheet, updated too.", 1000);
  await page.getByText("Summary", { exact: true }).click();
  await beat(page, 1600);

  await caption(page, "File › Export XLSX sends a real Excel file back to the accountant.", 1000);
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 700);
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export XLSX" }).click();
  const exported = await readFile((await (await download).path())!);
  const zip = await JSZip.loadAsync(exported);
  const sales = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  const summary = await zip.file("xl/worksheets/sheet2.xml")!.async("string");
  expect(sales).toContain('<pane xSplit="0" ySplit="1"');
  expect(sales).toMatch(/<c r="B3"[^>]*><v>1020<\/v>/);
  expect(sales).toMatch(/<c r="D3"[^>]*><f>B3\*C3<\/f><v>3315<\/v>/);
  expect(sales).toMatch(/<c r="D6"[^>]*><f>SUM\(D2:D5\)<\/f><v>10331.75<\/v>/);
  expect(summary).toContain("<f>&apos;Q3 sales&apos;!D6</f><v>10331.75</v>");
  const width = (xml: string, column: number) =>
    new RegExp(`<col min="${column}" max="${column}"[^>]*\\bwidth="([^"]+)"`).exec(xml)?.[1];
  expect([1, 2, 3, 4].map((c) => width(sales, c))).toEqual(["22", "14", "14", "14"]);
  expect([1, 2].map((c) => width(summary, c))).toEqual(["24", "14"]);
  await caption(page, "Formulas, formatting, column widths, the frozen header and both tabs go back to Excel intact.", 1800);

  await caption(page, "Before sending it, Kemi opens the exported file once more to check.", 1000);
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "Q3 bakery sales (to accountant).xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: exported,
  });
  await ready(page);
  await expect(page.locator("details.import-notes")).toContainText("Q3 bakery sales (to accountant).xlsx");
  await selectCells(page, "D6");
  await caption(page, "Same columns, same frozen header, and the corrected total of $10,331.75.", 2200);
});
