import { readFileSync } from "node:fs";
import { openWorkbook } from "../fixtures";
import { askAgent, beat, caption, describeRun, expect, openApp, test } from "../harness";

const names = [
  "Ada", "Bo", "Cal", "Dee", "Eli", "Fay", "Gil", "Hana", "Ian", "Jo", "Kit", "Lee",
  "Mo", "Nia", "Omar", "Pia", "Quin", "Ray", "Sam", "Tess", "Uma", "Vic", "Wes", "Xia",
  "Yara", "Zed", "Amy", "Ben",
];
const metres = [1520, ...Array(8).fill(1900), 2710, ...Array(18).fill(2195)];
const situps = names.map((_, index) => 20 + (index % 12));

const prompt = [
  "The Year 9 fitness sheet is already open. Leave the names, metres, and sit-ups as they are. Do not type the results 2105, Pass, Not yet, 19, or 698.",
  'Call fill_formula with range "B30" and formula =AVERAGE(B2:B29).',
  'Call fill_formula with range "D2:D29" and formula =IF(B2>2000,"Pass","Not yet").',
  'Call fill_formula with range "D30" and formula =COUNTIF(D2:D29,"Pass").',
  'Call fill_formula with range "C30" and formula =SUM(C2:C29).',
].join(" ");

test("39-insert-a-function-with-help-ai", async ({ page }) => {
  await openApp(page);
  await caption(page, "Ben opens Year 9 fitness. Metres, sit-ups, and an empty Pass column.");
  await openWorkbook(
    page,
    "Year 9 fitness",
    [["Name", "Metres", "Sit-ups", "Pass?"], ...names.map((name, index) => [name, metres[index], situps[index], ""])],
  );
  await caption(page, "He asks SuiteLeaf's on-device assistant for the average, who passed, how many passed, and the sit-up total.", 1600);
  await caption(page, "", 0);

  const run = await askAgent(page, prompt);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await page.getByRole("button", { name: "Close assistant" }).click();
  await beat(page, 400);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(readFileSync((await (await download).path())!, "utf8"));
  const cells = saved.content.workbook.sheets[saved.content.workbook.sheetOrder[0]].cellData;
  const table = JSON.stringify(cells);
  const detail = `${why}\n${table}`;

  expect(cells[29][1].f, detail).toBe("=AVERAGE(B2:B29)");
  expect(cells[29][1].v, detail).toBe(2105);
  expect(cells[1][3].f, detail).toBe('=IF(B2>2000,"Pass","Not yet")');
  const passes = Array.from({ length: 28 }, (_, index) => cells[index + 1][3].v);
  expect(passes.filter((value) => value === "Pass"), detail).toHaveLength(19);
  expect(cells[28][3].v, detail).toBe("Pass");
  expect(cells[29][3].f, detail).toBe('=COUNTIF(D2:D29,"Pass")');
  expect(cells[29][3].v, detail).toBe(19);
  expect(cells[29][2].f, detail).toBe("=SUM(C2:C29)");
  expect(cells[29][2].v, detail).toBe(698);
  expect(cells[1][2].v, detail).toBe(situps[0]);
});
