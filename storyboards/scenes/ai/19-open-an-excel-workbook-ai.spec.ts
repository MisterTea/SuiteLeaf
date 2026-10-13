import type { Download, Page } from "@playwright/test";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { askAgent, beat, caption, describeRun, electronApps, expect, openApp, selectCells, test } from "../harness";
import { bakeryWorkbook } from "../fixtures";

/**
 * Files the app exports: browser downloads on the web; in the desktop app,
 * what its save dialog writes (answered with a folder standing in for Downloads).
 */
async function collectExports(page: Page) {
  const dir = mkdtempSync(join(tmpdir(), "storyboard-19-ai-"));
  const downloads: Download[] = [];
  const app = electronApps.get(page);
  if (app)
    await app.evaluate(({ dialog }, dir) => {
      (dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async (_window: unknown, options: { defaultPath?: string }) => ({
        canceled: false,
        filePath: `${dir}/${(options.defaultPath ?? "export").split(/[\\/]/).pop()}`,
      });
    }, dir);
  else page.on("download", (d) => downloads.push(d));
  return async () => {
    if (app) return readdirSync(dir).map((name) => ({ name, data: readFileSync(join(dir, name)) }));
    return Promise.all(downloads.map(async (d) => ({ name: d.suggestedFilename(), data: readFileSync((await d.path())!) })));
  };
}

/** The look of a cell in an exported workbook: bold, fill colour and number format, resolved through styles.xml. */
async function cellStyle(zip: JSZip, sheetXml: string, ref: string) {
  const styles = await zip.file("xl/styles.xml")!.async("string");
  const section = (tag: string) => new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(styles)?.[1] ?? "";
  const items = (tag: string, item: string) => section(tag).match(new RegExp(`<${item}\\b[^>]*?(?:/>|>[\\s\\S]*?</${item}>)`, "g")) ?? [];
  const attr = (xml: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(xml)?.[1];
  const s = Number(attr(new RegExp(`<c r="${ref}"[^>]*>`).exec(sheetXml)?.[0] ?? "", "s") ?? 0);
  const xf = items("cellXfs", "xf")[s] ?? "";
  const font = items("fonts", "font")[Number(attr(xf, "fontId") ?? 0)] ?? "";
  const fill = items("fills", "fill")[Number(attr(xf, "fillId") ?? 0)] ?? "";
  const numFmtId = attr(xf, "numFmtId") ?? "0";
  const custom = items("numFmts", "numFmt").find((f) => attr(f, "numFmtId") === numFmtId);
  return {
    bold: /<b\s*\/>|<b val="(1|true)"\s*\/>/.test(font),
    fill: /fgColor rgb="(\w+)"/.exec(fill)?.[1]?.slice(-6).toUpperCase() ?? "",
    format: (custom ? attr(custom, "formatCode") : numFmtId)?.replace(/&quot;/g, '"') ?? "",
  };
}

test("19-open-an-excel-workbook-ai", async ({ page }) => {
  await openApp(page);
  await caption(page, "Kemi runs a bakery. Her accountant emailed the Q3 sales workbook as an Excel file.");
  await caption(page, "She doesn't have Excel, and one number is wrong. She asks the assistant.", 1800);
  const original = Buffer.from(await bakeryWorkbook());
  const exported = await collectExports(page);
  const run = await askAgent(
    page,
    "Open the Q3 sales Excel file my accountant emailed me. We had a late croissant order, so croissant units sold should be 1020. Then save it as an Excel file again so I can send it back to her.",
    {
      files: [
        {
          name: "Q3 bakery sales.xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: Buffer.from(original),
        },
      ],
    },
  );
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  const files = await exported();
  const file = files.find((f) => f.name.endsWith(".xlsx"));
  expect(file?.name, `${why}\nExported: ${files.map((f) => f.name).join(", ")}`).toBe("Q3 bakery sales.xlsx");
  const zip = await JSZip.loadAsync(file!.data);
  const workbook = await zip.file("xl/workbook.xml")!.async("string");
  const sales = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  const summary = await zip.file("xl/worksheets/sheet2.xml")!.async("string");
  const contents = `${why}\n--- sheet1.xml ---\n${sales}\n--- sheet2.xml ---\n${summary}`;
  expect([...workbook.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]), why).toEqual(["Q3 sales", "Summary"]);
  expect(sales, contents).toContain('<pane xSplit="0" ySplit="1"');
  expect(sales, contents).toMatch(/<c r="B3"[^>]*><v>1020<\/v>/);
  expect(sales, contents).toMatch(/<c r="D3"[^>]*><f>B3\*C3<\/f><v>3315<\/v>/);
  expect(sales, contents).toMatch(/<c r="D6"[^>]*><f>SUM\(D2:D5\)<\/f><v>10331.75<\/v>/);
  expect(summary, contents).toContain("<f>&apos;Q3 sales&apos;!D6</f><v>10331.75</v>");
  const width = (xml: string, column: number) =>
    new RegExp(`<col min="${column}" max="${column}"[^>]*\\bwidth="([^"]+)"`).exec(xml)?.[1];
  expect([1, 2, 3, 4].map((c) => width(sales, c)), contents).toEqual(["22", "14", "14", "14"]);
  expect([1, 2].map((c) => width(summary, c)), contents).toEqual(["24", "14"]);
  const money = '"$"#,##0.00';
  expect(await cellStyle(zip, sales, "A1"), contents).toMatchObject({ bold: true, fill: "FCE4D6" });
  expect(await cellStyle(zip, sales, "D3"), contents).toEqual({ bold: false, fill: "", format: money });
  expect(await cellStyle(zip, sales, "D6"), contents).toEqual({ bold: true, fill: "", format: money });
  expect(await cellStyle(zip, summary, "B1"), contents).toEqual({ bold: true, fill: "", format: money });

  await page.getByRole("button", { name: "Close assistant" }).click();
  if (!(await page.getByLabel("File title").isVisible())) {
    await caption(page, "Gemma went back to the file list at the end, so Kemi opens the workbook again.", 1800);
    await page.getByRole("link", { name: /Q3 bakery sales/ }).click();
  }
  await expect(page.getByLabel("File title")).toHaveValue("Q3 bakery sales");
  await page.getByRole("tab", { name: "Q3 sales" }).click();
  await selectCells(page, "B3");
  await caption(page, "Gemma opened the workbook and corrected the croissants: 958 became 1020.", 2200);
  await selectCells(page, "D3:D6");
  await caption(page, "Revenue is still the formula =B3*C3, so it and the total recalculated: $10,331.75.", 2400);
  await page.getByRole("tab", { name: "Summary" }).click();
  await caption(page, "The Summary tab, which reads the first sheet's total, shows the new $10,331.75 too.", 2200);
  await caption(page, "The Excel file it sent back keeps both tabs, the formulas, the frozen header, the styles and the accountant's column widths.", 2800);
  await beat(page, 600);
});
