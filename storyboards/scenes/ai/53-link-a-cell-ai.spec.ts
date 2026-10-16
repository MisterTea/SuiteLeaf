import { readFileSync } from "node:fs";
import { cellHyperlink, cellLabel } from "../../../packages/core/src/sheet-links";
import { createFile, serializeFile } from "../../../packages/core/src";
import { ready } from "../fixtures";
import { askAgent, beat, caption, describeRun, expect, openApp, test } from "../harness";

const prompt = [
  "The Suppliers sheet is already open. Northwind, Contoso, and Fabrikam are plain text. Keep each name as the cell label.",
  'Call set_cell_link with cell "Northwind" and address "https://example.org/northwind".',
  'Call set_cell_link with cell "Contoso" and address "https://example.org/contoso".',
  'Call set_cell_link with cell "Fabrikam" and address "https://example.org/fabrikam".',
  "Then stop. Do not use set_cells.",
].join(" ");

const suppliers = [
  ["Supplier"],
  ["Northwind"],
  ["Contoso"],
  ["Fabrikam"],
];

test("53-link-a-cell-ai", async ({ page }) => {
  await openApp(page);
  await caption(page, "Priya opens Suppliers. Northwind, Contoso, and Fabrikam are plain text.");
  const file = createFile("sheet", "Suppliers");
  if (file.kind !== "sheet") throw new Error("Expected a workbook");
  const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  sheet.cellData = Object.fromEntries(
    suppliers.map((row, r) => [r, Object.fromEntries(row.map((value, c) => [c, { v: value, t: 1 }]))]),
  );
  (sheet as { columnData: Record<number, { w: number }> }).columnData = { 0: { w: 180 } };
  await page.locator("input[type=file]").setInputFiles({
    name: "Suppliers.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await ready(page);
  await caption(page, "She asks SuiteLeaf to link each supplier name to its page.", 1600);
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
  const linked = [
    { row: 1, label: "Northwind", href: "https://example.org/northwind" },
    { row: 2, label: "Contoso", href: "https://example.org/contoso" },
    { row: 3, label: "Fabrikam", href: "https://example.org/fabrikam" },
  ];
  const detail = `${why}\n${JSON.stringify(linked.map((item) => cells[item.row]?.[0]))}`;
  for (const item of linked) {
    const cell = cells[item.row][0];
    expect(cellLabel(cell), detail).toBe(item.label);
    expect(cell.v, detail).toBe(item.label);
    expect(cellHyperlink(cell), detail).toBe(item.href);
  }
});
