import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { createFile, serializeFile } from "../../packages/core/src";
import { beat, caption, expect, selectCells, test, typeSlowly } from "./harness";

type Value = string | number;

const rowHeader = 46;
const columnWidth = 100;
const firstRowCenter = 58;
const rowHeight = 24;
const widths = [150, 120, 168];

async function ready(page: import("@playwright/test").Page) {
  await page.getByRole("toolbar", { name: "Spreadsheet formatting" }).waitFor();
  await beat(page, 500);
}

async function openWorkbook(
  page: import("@playwright/test").Page,
  title: string,
  rows: Value[][],
) {
  const file = createFile("sheet", title);
  if (file.kind !== "sheet") throw new Error("Expected a workbook");
  const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  sheet.cellData = Object.fromEntries(
    rows.map((row, r) => [
      r,
      Object.fromEntries(
        row.flatMap((v, c) =>
          v === "" ? [] : [[c, typeof v === "number" ? { v, t: 2 } : { v, t: 1 }]],
        ),
      ),
    ]),
  );
  (sheet as { columnData: Record<number, { w: number }> }).columnData = Object.fromEntries(
    widths.map((w, i) => [i, { w }]),
  );
  await page.locator("input[type=file]").setInputFiles({
    name: `${title}.slsheet`,
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await ready(page);
}

async function cellPoint(
  page: import("@playwright/test").Page,
  ref: string,
  filterButton = false,
) {
  const box = (await page.locator(".sheet-host").boundingBox())!;
  const column = ref.charCodeAt(0) - 65;
  const row = Number(ref.slice(1));
  const width = (i: number) => widths[i] ?? columnWidth;
  const left =
    rowHeader + Array.from({ length: column }, (_, i) => width(i)).reduce((a, b) => a + b, 0);
  return {
    x: box.x + left + (filterButton ? width(column) - 12 : Math.min(28, width(column) / 6)),
    y: box.y + firstRowCenter + rowHeight * (row - 1),
  };
}

async function pointAt(
  page: import("@playwright/test").Page,
  point: { x: number; y: number },
) {
  await page.mouse.move(point.x, point.y, { steps: 12 });
  await beat(page, 200);
  await page.mouse.click(point.x, point.y);
}

const names = [
  "Amina Yusuf", "Priya Shah", "Luis Ortega", "Nora Berg", "Helen Cho",
  "Owen Brooks", "Mei Chen", "Sam Whitfield", "Aiko Tanaka", "Femi Adeyemi",
  "Clara Novak", "Raj Mehta", "Elena Petrova", "Tom Gallagher", "Ida Bergstrom",
  "Jonah Ellis", "Leila Haddad", "Marco Silva", "Nina Kovacs", "Omar Farouk",
  "Paula Niemi", "Quinn Adler", "Rosa Delgado", "Sofia Marin", "Tariq Hassan",
  "Uma Iversen", "Victor Lang", "Willa Grant", "Xavier Boyd", "Yara Nasser",
  "Zoe Kaplan", "Ben Okonkwo", "Carmen Diaz", "David Berg", "Esther Cole",
  "Farah Qureshi", "George Hale", "Hana Suzuki", "Ivan Petrov", "Julia Santos",
];

const status = Array.from({ length: 40 }, (_, i) => {
  if (i === 0) return "Confirmed";
  if ([5, 6, 7, 10].includes(i)) return "yes";
  if ([8, 9].includes(i)) return "tbc";
  if (i === 3) return "Tentative";
  if (i === 1) return "Confirmed ";
  if (i === 2) return "confirmed";
  if (i % 5 === 0) return "Tentative";
  if (i % 7 === 0) return "tentative ";
  return "Confirmed";
});

test("37-dropdown-lists-in-a-sheet", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Lena keeps the food bank's volunteer roster. The Status column is a mess of spellings.",
  );
  await openWorkbook(page, "Volunteer roster", [
    ["Name", "Shift", "Status"],
    ...names.map((name, i) => [name, ["Morning", "Afternoon", "Evening"][i % 3], status[i]]),
  ]);
  await caption(page, "Confirmed, Confirmed with a space, tentative, yes, tbc — she can't filter this.", 1800);

  await caption(page, "She selects the Status column and chooses Insert › Dropdown.", 1100);
  await selectCells(page, "C2:C41");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await beat(page, 500);
  await page.getByRole("menuitem", { name: "Dropdown", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Dropdown" });
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("Option 1")).toHaveValue("Confirmed");
  await expect(panel.getByLabel("Option 2")).toHaveValue("Tentative");
  await expect(panel.getByLabel("Option 3")).toHaveValue("yes");
  await expect(panel.getByLabel("Option 4")).toHaveValue("tbc");
  await expect(panel.getByRole("checkbox", { name: "Reject other values" })).toBeChecked();
  await caption(
    page,
    "Two clicks. The options are already filled in: spaces trimmed, and Confirmed counted once.",
    2200,
  );

  await caption(page, "She drops yes and tbc. Those aren't statuses the committee uses.", 1000);
  await panel.getByRole("button", { name: "Remove yes" }).click();
  await beat(page, 400);
  await panel.getByRole("button", { name: "Remove tbc" }).click();
  await beat(page, 500);
  await caption(page, "And adds Can't make it.", 800);
  await panel.getByRole("button", { name: "Add option" }).click();
  const added = panel.getByLabel("Option 3");
  await added.click();
  await typeSlowly(page, "Can't make it", 40);
  await beat(page, 500);

  await caption(page, "Green, amber, and grey. The chip text stays readable on its own.", 1000);
  const row = (n: number) => panel.locator("li").nth(n);
  await row(0).getByRole("button", { name: "Green", exact: true }).click();
  await beat(page, 350);
  await row(1).getByRole("button", { name: "Amber", exact: true }).click();
  await beat(page, 350);
  await row(2).getByRole("button", { name: "Grey", exact: true }).click();
  await beat(page, 700);
  await caption(page, "Reject other values stays on, so a made-up status can't land in the column.", 1400);
  await panel.getByRole("button", { name: "Done", exact: true }).click();

  const notice = page.locator(".dropdown-notice");
  await expect(notice).toContainText("6 cells don't match the list");
  await caption(page, "Six cells don't match. Review walks through them, one at a time.", 1400);
  await notice.getByRole("button", { name: "Review" }).click();
  const review = page.getByRole("dialog", { name: "Review values" });
  await expect(review).toContainText("yes");
  await expect(review).toContainText("Confirmed");
  await beat(page, 900);
  for (let i = 0; i < 6; i++) {
    await review.getByRole("button", { name: "Accept", exact: true }).click();
    await beat(page, i === 0 ? 700 : 350);
  }
  await expect(notice).toBeHidden();
  await caption(page, "yes and tbc become Confirmed. The column only holds real statuses now.", 1600);

  await caption(page, "In a cell, typing filters the list. Arrow keys and Enter pick one.", 1100);
  await selectCells(page, "C5");
  await page.keyboard.press("m");
  await page.keyboard.press("a");
  const list = page.getByRole("listbox", { name: "Dropdown options" });
  await expect(list).toContainText("Can't make it");
  await expect(list).not.toContainText("Tentative");
  await beat(page, 900);
  await page.keyboard.press("Enter");
  await beat(page, 700);
  await caption(page, "Nora is now Can't make it, grey chip and all.", 1600);

  await caption(page, "maybe isn't on the list. Enter refuses it and names the choices.", 1100);
  await selectCells(page, "C6");
  await typeSlowly(page, "maybe", 70);
  await page.keyboard.press("Enter");
  const refused = page.getByRole("alertdialog", { name: "Value not allowed" });
  await expect(refused).toContainText("Choose Confirmed, Tentative, or Can't make it.");
  await beat(page, 1600);
  await refused.getByRole("button", { name: "OK" }).click();
  await beat(page, 500);
  await caption(page, "Helen stays Confirmed. The typed word never replaced it.", 1400);

  await caption(page, "The committee renames Tentative to Maybe, and adds Waitlist.", 1100);
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Data validation", exact: true }).click();
  await expect(panel.getByLabel("Option 2")).toHaveValue("Tentative");
  await panel.getByLabel("Option 2").fill("");
  await panel.getByLabel("Option 2").click();
  await typeSlowly(page, "Maybe", 60);
  await panel.getByRole("button", { name: "Add option" }).click();
  await panel.getByLabel("Option 4").click();
  await typeSlowly(page, "Waitlist", 50);
  await row(3).getByRole("button", { name: "Blue", exact: true }).click();
  await beat(page, 800);
  await panel.getByRole("button", { name: "Done", exact: true }).click();
  await beat(page, 600);
  await selectCells(page, "C17");
  await beat(page, 500);
  await caption(page, "Every Tentative cell now says Maybe, and keeps its amber chip.", 1800);

  await caption(page, "Priya moves to the waitlist.", 800);
  await selectCells(page, "C3");
  await page.keyboard.type("Wai", { delay: 80 });
  await beat(page, 600);
  await page.keyboard.press("Enter");
  await beat(page, 800);

  await caption(page, "Data › Create a filter. Status lists exactly those four options.", 1100);
  await selectCells(page, "A1:C41");
  await page.getByRole("button", { name: "Create a filter", exact: true }).click();
  await beat(page, 400);
  await selectCells(page, "A1");
  await beat(page, 400);
  await pointAt(page, await cellPoint(page, "C1", true));
  await expect(page.getByText("By Values", { exact: true })).toBeVisible();
  for (const label of ["Confirmed", "Maybe", "Can't make it", "Waitlist"])
    await expect(page.getByText(label, { exact: true }).last()).toBeVisible();
  await expect(page.getByText("Tentative", { exact: true })).toHaveCount(0);
  await expect(page.getByText("yes", { exact: true })).toHaveCount(0);
  await expect(page.getByText("tbc", { exact: true })).toHaveCount(0);
  await beat(page, 1600);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await beat(page, 400);

  await caption(page, "File › Export XLSX. Excel gets the same list, set to reject anything else.", 1100);
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 400);
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export XLSX", exact: true }).click();
  const xlsx = await readFile((await (await download).path())!);
  const xml = await (await JSZip.loadAsync(xlsx)).file("xl/worksheets/sheet1.xml")!.async("string");
  expect(xml).toContain('type="list"');
  expect(xml).toContain('errorStyle="stop"');
  expect(xml).toContain("Confirmed,Maybe,Can&apos;t make it,Waitlist");
  const grid = XLSX.read(xlsx).Sheets.Sheet1;
  expect(grid.C5.v).toBe("Can't make it");
  expect(grid.C6.v).toBe("Confirmed");
  expect(grid.C3.v).toBe("Waitlist");
  expect(grid.C17.v).toBe("Maybe");
  expect(grid.C7.v).toBe("Confirmed");
  await beat(page, 600);

  await caption(page, "Opening that workbook again restores the dropdown.", 1000);
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "Volunteer roster.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: xlsx,
  });
  await ready(page);
  await selectCells(page, "C5");
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Data validation", exact: true }).click();
  await expect(panel.getByLabel("Option 1")).toHaveValue("Confirmed");
  await expect(panel.getByLabel("Option 2")).toHaveValue("Maybe");
  await expect(panel.getByLabel("Option 3")).toHaveValue("Can't make it");
  await expect(panel.getByLabel("Option 4")).toHaveValue("Waitlist");
  await expect(panel.getByRole("checkbox", { name: "Reject other values" })).toBeChecked();
  await caption(
    page,
    "Same four options, still set to reject. Chip colours stay in the SuiteLeaf file; Excel has no place for them.",
    2400,
  );
});
