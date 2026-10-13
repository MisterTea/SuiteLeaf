import { readFile } from "node:fs/promises";
import { createFile, serializeFile } from "../../packages/core/src";
import { beat, caption, expect, selectCells, test, typeSlowly } from "./harness";

const names = [
  "Ada", "Bo", "Cal", "Dee", "Eli", "Fay", "Gil", "Hana", "Ian", "Jo", "Kit", "Lee",
  "Mo", "Nia", "Omar", "Pia", "Quin", "Ray", "Sam", "Tess", "Uma", "Vic", "Wes", "Xia",
  "Yara", "Zed", "Amy", "Ben",
];
const metres = [1520, ...Array(8).fill(1900), 2710, ...Array(18).fill(2195)];
const situps = names.map((_, index) => 20 + (index % 12));

test("39-insert-a-function-with-help", async ({ page }) => {
  await page.goto("/");
  const file = createFile("sheet", "Year 9 fitness");
  if (file.kind !== "sheet") throw new Error("Expected a workbook");
  const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  sheet.defaultRowHeight = 16;
  const rows: (string | number)[][] = [
    ["Name", "Metres", "Sit-ups", "Pass?"],
    ...names.map((name, index) => [name, metres[index], situps[index], ""]),
  ];
  sheet.cellData = Object.fromEntries(
    rows.map((row, r) => [
      r,
      Object.fromEntries(
        row.flatMap((value, c) =>
          value === "" ? [] : [[c, typeof value === "number" ? { v: value, t: 2 } : { v: value, t: 1 }]],
        ),
      ),
    ]),
  );
  await caption(page, "Ben opens Year 9 fitness. Metres, sit-ups, and an empty Pass column.");
  await page.locator("input[type=file]").setInputFiles({
    name: "Year 9 fitness.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await page.getByRole("button", { name: "Sheet tools", exact: true }).waitFor();
  await beat(page, 800);

  await caption(page, "The selection shows sum, average, min, max, and count. One click inserts the average below.");
  await selectCells(page, "B2:B29");
  const summary = page.getByRole("status", { name: "Selection summary" });
  await expect(summary).toContainText("Sum 58,940");
  await expect(summary).toContainText("Average 2,105");
  await expect(summary).toContainText("Min 1,520");
  await expect(summary).toContainText("Max 2,710");
  await expect(summary).toContainText("Count 28");
  const average = page.locator('[data-stat="average"]');
  await average.hover();
  await beat(page, 700);
  await expect(average).toContainText("Insert below");
  await average.click();
  await beat(page, 900);

  await caption(page, "Insert, Function: common formulas, categories, and search.");
  await selectCells(page, "D2");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: "Function" }).click();
  const menu = page.locator(".function-menu");
  await expect(menu.getByRole("menuitem", { name: "SUM", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "COUNTIF", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "XLOOKUP", exact: true })).toBeVisible();
  for (const category of ["Math", "Statistical", "Logical", "Text", "Date", "Lookup"])
    await expect(menu.getByRole("menuitem", { name: category, exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search functions" })).toBeVisible();
  await beat(page, 600);

  await caption(page, "He searches for what he means: if a condition.");
  await page.getByRole("textbox", { name: "Search functions" }).click();
  await typeSlowly(page, "if a condition", 45);
  const iff = page.locator('[data-function-name="IF"]');
  await expect(iff).toContainText("Returns one value if a condition is true and another if it's false");
  await beat(page, 500);
  await iff.click();
  const help = page.locator("[data-function-help]");
  await expect(help).toBeVisible();
  await expect(help).toHaveAttribute("data-function", "IF");

  await caption(page, "Help stays beside the formula bar. The bold argument moves as he types.");
  await expect(help.locator("[data-current='true']")).toHaveText("logical_expression");
  const panelBox = (await help.boundingBox())!;
  const gridTop = await page.locator(".sheet-host canvas").evaluateAll((nodes) =>
    Math.min(...nodes.map((node) => node.getBoundingClientRect().height > 80 ? node.getBoundingClientRect().top : Infinity)),
  );
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(gridTop + 1);
  await typeSlowly(page, "B2>2000,", 40);
  await expect(help.locator("[data-current='true']")).toHaveText("value_if_true");
  await beat(page, 600);

  await caption(page, "Pass if they ran over 2,000 metres. He fills that down the class.");
  await typeSlowly(page, '"Pass","Not yet")', 35);
  await beat(page, 400);
  await page.keyboard.press("Enter");
  await expect(help).toHaveCount(0);
  await beat(page, 300);
  const host = (await page.locator(".sheet-host").boundingBox())!;
  await page.mouse.click(host.x + 396, host.y + 68);
  const x = host.x + 445;
  const y = host.y + 77;
  await page.mouse.move(x, y, { steps: 10 });
  await beat(page, 200);
  await page.mouse.down();
  await page.mouse.move(x, y + 27 * 16, { steps: 30 });
  await beat(page, 250);
  await page.mouse.up();
  await beat(page, 500);

  await caption(page, "COUNTIF explains range and criterion, with an example, while he counts the passes.");
  await selectCells(page, "D30");
  await typeSlowly(page, "=COUNTIF(", 50);
  await expect(page.locator("[data-function-help]")).toHaveAttribute("data-function", "COUNTIF");
  await expect(page.locator("[data-current='true']")).toHaveText("range");
  await expect(page.locator("[data-function-help]")).toContainText("criterion");
  await expect(page.locator("[data-example]")).toHaveText('COUNTIF(A1:A10, ">20")');
  await beat(page, 500);
  await typeSlowly(page, "D2:D29,", 35);
  await expect(page.locator("[data-current='true']")).toHaveText("criterion");
  await beat(page, 400);
  await typeSlowly(page, '"Pass")', 35);
  await beat(page, 300);
  await page.keyboard.press("Enter");
  await beat(page, 1200);

  await caption(page, "Σ adds the sit-ups below the selection, and does not replace any result.");
  await selectCells(page, "C2:C29");
  await page.getByRole("button", { name: "Functions", exact: true }).click();
  await beat(page, 900);

  await caption(page, "He tucks help away. It stays tucked until Shift+F1, and F1 opens it here.");
  await selectCells(page, "E2");
  await typeSlowly(page, "=MIN(", 50);
  await expect(page.locator("[data-function-help]")).toHaveAttribute("data-collapsed", "false");
  await page.getByRole("button", { name: "Hide function help" }).click();
  await expect(page.locator("[data-function-help]")).toHaveAttribute("data-collapsed", "true");
  await beat(page, 500);
  await page.keyboard.press("Escape");
  await beat(page, 300);
  await selectCells(page, "E3");
  await typeSlowly(page, "=MAX(", 50);
  await expect(page.locator("[data-function-help]")).toHaveAttribute("data-collapsed", "true");
  await beat(page, 400);
  await page.keyboard.press("Shift+F1");
  await expect(page.locator("[data-function-help]")).toHaveAttribute("data-collapsed", "false");
  await beat(page, 400);
  await page.keyboard.press("Shift+F1");
  await expect(page.locator("[data-function-help]")).toHaveAttribute("data-collapsed", "true");
  const before = page.url();
  await page.keyboard.press("F1");
  await expect(page.locator("[data-function-help]")).toHaveAttribute("data-collapsed", "false");
  expect(page.url()).toBe(before);
  await beat(page, 700);
  await page.keyboard.press("Escape");
  await beat(page, 400);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  const cells = saved.content.workbook.sheets[saved.content.workbook.sheetOrder[0]].cellData;
  expect(cells[29][1].f).toBe("=AVERAGE(B2:B29)");
  expect(cells[29][1].v).toBe(2105);
  expect(cells[1][3].f).toBe('=IF(B2>2000,"Pass","Not yet")');
  const passes = Array.from({ length: 28 }, (_, index) => cells[index + 1][3].v);
  expect(passes.filter((value) => value === "Pass")).toHaveLength(19);
  expect(cells[28][3].v).toBe("Pass");
  expect(cells[29][3].f).toBe('=COUNTIF(D2:D29,"Pass")');
  expect(cells[29][3].v).toBe(19);
  expect(cells[29][2].f).toBe("=SUM(C2:C29)");
  expect(cells[1][2].v).toBe(situps[0]);
});
