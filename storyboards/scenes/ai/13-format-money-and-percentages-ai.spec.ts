import type { Page } from "@playwright/test";
import { mkdtempSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ready } from "../fixtures";
import {
  askAgent,
  beat,
  caption,
  describeRun,
  electronApps,
  electronMode,
  expect,
  openApp,
  selectCells,
  test,
  typeSlowly,
} from "../harness";

const title = "September invoice";

/** Types one row starting at `ref`, moving across with Tab like a person would. */
async function typeRow(page: Page, ref: string, values: string[], delay = 25) {
  await selectCells(page, ref);
  for (const value of values) {
    if (value) await typeSlowly(page, value, delay);
    await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Enter");
}

/** Saves a copy of the workbook (Download, or Save As on the desktop) and parses it. */
async function savedCopy(page: Page) {
  if (electronMode) {
    const dir = mkdtempSync(join(tmpdir(), "storyboard-13-ai-"));
    await electronApps.get(page)!.evaluate(({ dialog }, folder) => {
      (dialog as unknown as Record<string, unknown>).showSaveDialog = async (
        _window: unknown,
        options: { defaultPath: string },
      ) => ({ canceled: false, filePath: `${folder}/${options.defaultPath}` });
    }, dir);
    await page.getByRole("button", { name: "Save As", exact: true }).click();
    const path = join(dir, `${title}.slsheet`);
    await expect.poll(() => readFile(path, "utf8").then(() => true, () => false)).toBe(true);
    return JSON.parse(readFileSync(path, "utf8"));
  }
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  return JSON.parse(await readFile((await (await download).path())!, "utf8"));
}

test("13-format-money-and-percentages-ai", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openApp(page);
  await caption(page, "Jess, a freelance designer, is turning last month's hours into an invoice summary.");
  await page.getByRole("button", { name: "New spreadsheet" }).click();
  await ready(page);
  const name = page.getByLabel("File title");
  await name.click();
  await name.press("ControlOrMeta+A");
  await typeSlowly(page, title);

  await caption(page, "She types each service's hours and rate. Amount and Share are formulas.", 900);
  await typeRow(page, "A1", ["Service", "Hours", "Rate", "Amount", "Share"]);
  await typeRow(page, "A5", ["Total", "", "", "=SUM(D2:D4)", "=SUM(E2:E4)"], 20);
  await typeRow(page, "A2", ["Logo design", "12", "85", "=B2*C2", "=D2/D$5"], 20);
  await typeRow(page, "A3", ["Website copy", "8", "70", "=B3*C3", "=D3/D$5"], 20);
  await typeRow(page, "A4", ["Photo edits", "5", "60", "=B4*C4", "=D4/D$5"], 20);
  await selectCells(page, "G1");
  await caption(page, "The numbers are right, but they don't look like money: 85, 1020, 0.5425531915…", 2000);
  await caption(page, "She asks SuiteLeaf's on-device assistant to tidy it up.", 1400);
  await caption(page, "", 0);

  const run = await askAgent(
    page,
    "Can you make this look like a proper invoice? Show the rates and amounts as dollars, the shares as percentages with one decimal, and make the header and total rows bold with the headings centered.",
  );
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await page.getByRole("button", { name: "Close assistant" }).click();
  await selectCells(page, "G1");
  const file = await savedCopy(page);
  const book = file.content.workbook;
  const cells = book.sheets[book.sheetOrder[0]].cellData;
  /** "D2" → its saved cell and resolved style, plus a message showing both. */
  const cell = (ref: string) => {
    const c = cells[Number(ref.slice(1)) - 1]?.["ABCDE".indexOf(ref[0])] ?? {};
    const style = (typeof c.s === "string" ? book.styles[c.s] : c.s) ?? {};
    return { ...c, style, why: `${why}\n${ref}: ${JSON.stringify(c)} style ${JSON.stringify(style)}` };
  };

  const formulas: Record<string, [string, number]> = {
    D2: ["=B2*C2", 1020],
    D3: ["=B3*C3", 560],
    D4: ["=B4*C4", 300],
    D5: ["=SUM(D2:D4)", 1880],
    E2: ["=D2/D$5", 1020 / 1880],
    E5: ["=SUM(E2:E4)", 1],
  };
  for (const [ref, [f, v]] of Object.entries(formulas)) {
    expect(cell(ref).f, cell(ref).why).toBe(f);
    expect(cell(ref).v, cell(ref).why).toBeCloseTo(v, 6);
  }
  for (const ref of ["C2", "C3", "C4", "D2", "D3", "D4", "D5"])
    expect(cell(ref).style.n?.pattern, cell(ref).why).toBe('"$"#,##0.00');
  for (const ref of ["E2", "E3", "E4", "E5"]) expect(cell(ref).style.n?.pattern, cell(ref).why).toBe("0.0%");
  for (const ref of ["A1", "B1", "C1", "D1", "E1"]) expect(cell(ref).style, cell(ref).why).toMatchObject({ bl: 1, ht: 2 });
  for (const ref of ["A5", "D5", "E5"]) expect(cell(ref).style.bl, cell(ref).why).toBe(1);
  await caption(page, "Now it reads like an invoice: $1,880.00 total, and each service's share of it.", 2400);

  const bold = page.getByRole("button", { name: "Bold (Cmd+B)" });
  await selectCells(page, "D2");
  await expect(bold, why).toHaveAttribute("aria-pressed", "false");
  await caption(page, "Formatting only changes how numbers look — D2 still holds =B2*C2, which is 1020.", 2200);
  expect(errors, why).toEqual([]);
  await caption(page, "Ready to send.", 1400);
});
