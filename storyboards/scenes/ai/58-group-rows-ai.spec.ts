import { readFileSync } from "node:fs";
import { createFile, serializeFile } from "../../../packages/core/src";
import { ready } from "../fixtures";
import { askAgent, beat, caption, describeRun, expect, openApp, test } from "../harness";

const money = { n: { pattern: '"$"#,##0' } };
const months: [string, number][] = [
  ["January", 120],
  ["February", 95],
  ["March", 110],
  ["April", 80],
  ["May", 140],
  ["June", 100],
  ["July", 130],
  ["August", 90],
  ["September", 150],
  ["October", 105],
  ["November", 115],
  ["December", 165],
];

const prompt = [
  "Donations is open. Row 1 is the total. Group rows 2 through 13, not the total.",
  "Then show only January (row 2) and leave February through December collapsed.",
  "Do not change the total formula =SUM(B2:B13) and do not hide row 1.",
  'Call group_rows with range "2:13", then show_only_row with row 2. Stop.',
].join(" ");

function donationsFile() {
  const file = createFile("sheet", "Donations");
  if (file.kind !== "sheet") throw new Error("Expected a workbook");
  const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  sheet.name = "2024";
  const data: [string, number | string, string?][] = [["Total", 1400, "=SUM(B2:B13)"], ...months];
  sheet.cellData = Object.fromEntries(
    data.map((row, index) => [
      index,
      {
        0: {
          v: row[0],
          t: 1,
          ...(index === 0 ? { s: { bl: 1 } } : {}),
        },
        1: row[2]
          ? { f: row[2], v: row[1], t: 2, s: { ...money, bl: 1 } }
          : { v: row[1], t: 2, s: money },
      },
    ]),
  );
  (sheet as { columnData: Record<number, { w: number }> }).columnData = {
    0: { w: 150 },
    1: { w: 120 },
  };
  return file;
}

test("58-group-rows-ai", async ({ page }) => {
  await openApp(page);
  await caption(page, "Omar’s donations sheet has a total and twelve months under it.");
  await page.locator("input[type=file]").setInputFiles({
    name: "Donations.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(donationsFile())),
  });
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  await page.getByRole("button", { name: "Sheet tools", exact: true }).waitFor();
  await ready(page);
  await caption(
    page,
    "He asks SuiteLeaf's on-device assistant to group the months, then leave only January open.",
    1600,
  );
  await caption(page, "", 0);

  const run = await askAgent(page, prompt);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await page.getByRole("button", { name: "Close assistant" }).click();
  await beat(page, 400);
  await expect(page.getByRole("button", { name: "Collapse rows 2 to 13" }), why).toBeVisible();
  await expect(page.getByRole("button", { name: /Collapse rows 1 to/ }), why).toHaveCount(0);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(readFileSync((await (await download).path())!, "utf8"));
  const book = saved.content.workbook;
  const sheet = book.sheets[book.sheetOrder[0]];
  const groups = (sheet.custom?.suiteleafRowGroups ?? []) as { startRow: number; endRow: number; collapsed: number[] }[];
  const detail = `${why}\nGroups: ${JSON.stringify(groups)}\nB1: ${JSON.stringify(sheet.cellData?.[0]?.[1])}`;
  const summaryInside = groups.some((group) => group.startRow <= 0 && group.endRow >= 0);

  expect(groups, detail).toHaveLength(1);
  expect(groups[0], detail).toMatchObject({ startRow: 1, endRow: 12 });
  expect(summaryInside, detail).toBe(false);
  expect(groups[0].collapsed.includes(0), detail).toBe(false);
  expect([...groups[0].collapsed].sort((a, b) => a - b), detail).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  expect(sheet.rowData?.[0]?.hd ?? 0, detail).not.toBe(1);
  expect(sheet.rowData?.[1]?.hd ?? 0, detail).not.toBe(1);
  for (let row = 2; row <= 12; row++) expect(sheet.rowData?.[row]?.hd, detail).toBe(1);
  expect(sheet.cellData[0][1].f, detail).toBe("=SUM(B2:B13)");
  expect(sheet.cellData[0][1].v, detail).toBe(1400);
  months.forEach(([name, amount], index) => {
    const row = sheet.cellData[index + 1];
    expect(row[0].v, detail).toBe(name);
    expect(row[1].v, detail).toBe(amount);
  });
});
