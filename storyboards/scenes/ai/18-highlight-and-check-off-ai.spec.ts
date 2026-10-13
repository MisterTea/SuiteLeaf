import type { Download, Page } from "@playwright/test";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { openWorkbook } from "../fixtures";
import { askAgent, beat, caption, describeRun, electronApps, expect, openApp, test } from "../harness";

const title = "Bake sale prep";
const widths = [70, 190, 90, 100];

/** Screen position of a cell's centre while scrolled to the top (Univer's default grid geometry). */
async function cellPoint(page: Page, ref: string) {
  const box = (await page.locator(".sheet-host").boundingBox())!;
  const column = ref.charCodeAt(0) - 65,
    row = Number(ref.slice(1));
  const width = (i: number) => widths[i] ?? 100;
  const left = 46 + Array.from({ length: column }, (_, i) => width(i)).reduce((a, b) => a + b, 0);
  return { x: box.x + left + width(column) / 2, y: box.y + 58 + 24 * (row - 1), right: box.x + left + width(column) };
}

/** Moves the visible pointer to a cell, then clicks it. */
async function pointAt(page: Page, ref: string) {
  const { x, y } = await cellPoint(page, ref);
  await page.mouse.move(x, y, { steps: 12 });
  await beat(page, 250);
  await page.mouse.click(x, y);
}

/** The colour near the right edge of a cell, above its text and any strikethrough line. */
async function fillOf(page: Page, ref: string) {
  const { right, y } = await cellPoint(page, ref);
  const png = await page.screenshot({ clip: { x: right - 8, y: y - 7, width: 1, height: 1 } });
  return page.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  }, `data:image/png;base64,${png.toString("base64")}`);
}

/**
 * Files the app saves: browser downloads on the web; in the desktop app,
 * what its save dialog writes (answered with a folder standing in for Downloads).
 */
async function collectSaves(page: Page) {
  const dir = mkdtempSync(join(tmpdir(), "storyboard-18-ai-"));
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
  return async (ending: string) => {
    let found: Buffer | undefined;
    await expect
      .poll(async () => {
        if (app) {
          const name = readdirSync(dir).find((n) => n.endsWith(ending));
          found = name ? readFileSync(join(dir, name)) : undefined;
        } else {
          const d = downloads.find((x) => x.suggestedFilename().endsWith(ending));
          found = d ? readFileSync((await d.path())!) : undefined;
        }
        return !!found;
      })
      .toBe(true);
    return found!;
  };
}

test("18-highlight-and-check-off-ai", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openApp(page);
  await caption(page, "Sofia is organizing the school bake sale and wants a to-do list she can tick off.");
  await openWorkbook(
    page,
    title,
    [
      ["Done", "Task", "Owner", "Due"],
      ["", "Book the school hall", "Sofia", "Oct 14"],
      ["", "Order paper bags", "Marco", "Oct 16"],
      ["", "Email bakers a sign-up", "Sofia", "Oct 17"],
      ["", "Print price cards", "Dana", "Oct 21"],
      ["", "Borrow cash boxes", "Marco", "Oct 22"],
    ],
    widths,
  );
  await caption(page, "The Done column is empty. She wants tick boxes there, and finished tasks to fade out of the way.", 2000);
  await caption(page, "She asks SuiteLeaf's on-device assistant to set it up.", 1200);
  await caption(page, "", 0);

  const run = await askAgent(
    page,
    "Can you put tick boxes in the Done column, and set it up so that when I tick a task its whole row turns green and gets crossed out?",
  );
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await page.getByRole("button", { name: "Close assistant" }).click();
  await caption(page, "The hall is booked. Tick!", 900);
  await pointAt(page, "A2");
  await beat(page, 800);
  await caption(page, "Bags are ordered too.", 800);
  await pointAt(page, "A3");
  await beat(page, 600);
  const away = await cellPoint(page, "F12");
  await page.mouse.move(away.x, away.y, { steps: 12 });

  const fills = Object.fromEntries(
    await Promise.all(["C1", "C2", "C3", "C4", "C5", "C6"].map(async (ref) => [ref, await fillOf(page, ref)] as const)),
  );
  const shown = `${why}\nFills: ${JSON.stringify(fills)}`;
  const green = ([r, g, b]: number[]) => g > r + 8 && g > b + 8;
  for (const ref of ["C2", "C3"]) expect(green(fills[ref]), `${shown}\n${ref} should be green`).toBe(true);
  for (const ref of ["C1", "C4", "C5", "C6"]) expect(fills[ref], `${shown}\n${ref} should be plain`).toEqual([255, 255, 255]);
  await caption(page, "Finished rows turn green and cross themselves out; what's left stands out.", 2400);

  const saved = await collectSaves(page);
  await page.getByRole("button", { name: /^(Download|Save As)$/ }).click();
  const file = JSON.parse((await saved(".slsheet")).toString("utf8"));
  const book = file.content.workbook;
  const sheetId = book.sheetOrder[0];
  const cells = book.sheets[sheetId].cellData;
  const resource = (name: string) => {
    const data = book.resources.find((r: { name: string }) => r.name === name)?.data;
    return data ? (JSON.parse(data)[sheetId] ?? []) : [];
  };
  const stored = `${why}\nColumn A: ${JSON.stringify([0, 1, 2, 3, 4, 5].map((r) => cells[r]?.[0]))}`;
  expect(cells[0][0].v, stored).toBe("Done");
  for (const r of [1, 2]) expect(cells[r][0], stored).toMatchObject({ v: 1, t: 3 });
  for (const r of [3, 4, 5]) expect(cells[r][0], stored).toMatchObject({ v: 0, t: 3 });

  const validations = resource("SHEET_DATA_VALIDATION_PLUGIN");
  const checks = `${why}\nValidation: ${JSON.stringify(validations)}`;
  const checkbox = validations.filter((v: { type: string }) => v.type === "checkbox");
  expect(checkbox, checks).toHaveLength(1);
  expect(checkbox[0], checks).toMatchObject({ formula1: "TRUE", formula2: "FALSE", ranges: [{ startRow: 1, endRow: 5, startColumn: 0, endColumn: 0 }] });

  const rules = resource("SHEET_CONDITIONAL_FORMATTING_PLUGIN");
  const ruled = `${why}\nRules: ${JSON.stringify(rules)}`;
  expect(rules, ruled).toHaveLength(1);
  expect(rules[0].ranges, ruled).toEqual([expect.objectContaining({ startRow: 1, endRow: 5, startColumn: 0, endColumn: 3 })]);
  expect(rules[0].rule, ruled).toMatchObject({ type: "highlightCell", subType: "formula" });
  expect(String(rules[0].rule.value).replace(/\s/g, ""), ruled).toMatch(/^=\$A2=TRUE$/i);
  const style = rules[0].rule.style ?? {};
  expect(style.st?.s, ruled).toBeTruthy();
  expect(style.cl, ruled).toBeUndefined();
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(style.bg?.rgb ?? "");
  const bg = hex ? hex.slice(1).map((h) => parseInt(h, 16)) : (String(style.bg?.rgb ?? "").match(/\d+/g) ?? []).map(Number);
  expect(bg.length >= 3 && green(bg), `${ruled}\nThe fill should be green`).toBe(true);
  await caption(page, "She keeps a copy. The tick boxes and the rule are saved with the list.", 1600);

  await caption(page, "The other parents use Excel, so she also sends it with File › Export XLSX.", 1000);
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 700);
  await page.getByRole("menuitem", { name: "Export XLSX" }).click();
  const xlsx = await saved(".xlsx");
  const workbook = XLSX.read(xlsx, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const zip = await JSZip.loadAsync(xlsx);
  const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  const dxf = /<dxfs[^>]*>([^]*)<\/dxfs>/.exec(await zip.file("xl/styles.xml")!.async("string"))?.[1] ?? "";
  const excel = `${why}\n${xml}\n${dxf}`;
  const excelFill = /<fgColor rgb="FF([0-9A-F]{6})"/.exec(dxf)?.[1] ?? "000000";
  expect(dxf, excel).toContain("<strike/>");
  expect(green(excelFill.match(/../g)!.map((h) => parseInt(h, 16))), `${excel}\nThe Excel rule's fill should be green`).toBe(true);
  for (const ref of ["A2", "A3"]) expect(sheet[ref], excel).toMatchObject({ t: "b", v: true });
  for (const ref of ["A4", "A5", "A6"]) expect(sheet[ref], excel).toMatchObject({ t: "b", v: false });
  expect(xml, excel).toMatch(/<dataValidation type="list" sqref="A2:A6"[^>]*><formula1>&quot;TRUE,FALSE&quot;<\/formula1>/);
  expect(xml, excel).toMatch(/<conditionalFormatting sqref="A2:D6"><cfRule [^>]*type="expression"[^>]*><formula>\$A2=TRUE<\/formula>/i);
  expect(errors, why).toEqual([]);
  await caption(page, "Sent to the other parents as an Excel file, the ticks are TRUE and FALSE and the rule comes along.", 2400);
  await caption(page, "A task list that shows progress at a glance.", 1600);
});
