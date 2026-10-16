import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { createFile, serializeFile } from "../../../packages/core/src";
import { askAgent, beat, caption, describeRun, electronApps, electronMode, expect, openApp, test } from "../harness";
import { donationRows, donationWidths, lastYearRows, type DonationValue } from "../donations-q3";

const title = "Donations Q3";

/** One request: trim Donor and Email, split names without overwriting Email, then drop duplicate emails. */
const prompt =
  "Clean up the Donations Q3 sheet only. Trim whitespace in the Donor and Email columns, including ordinary spaces, tabs, and non-breaking spaces. Then split the Donor column on the comma into two columns named Last name and First name, inserting a new column so Email is not overwritten. Then remove duplicate rows matched only on the Email column, keeping the row with the most filled cells (later receipts include Gift Aid). Leave the Last year sheet unchanged.";

function normalizeText(value: string) {
  return value.replace(/[\t\u00A0]/g, " ").replace(/ {2,}/g, " ").trim();
}

type Kept = { date: string; last: string; first: string; email: string; amount: number; gift: string };

/** The row each email should keep: trimmed, split on the comma, and the copy with the most filled cells. */
function expectedKept() {
  const best = new Map<string, Kept & { filled: number }>();
  for (const row of donationRows().slice(1)) {
    const [last = "", first = ""] = normalizeText(String(row[1])).split(",").map((part) => normalizeText(part));
    const email = normalizeText(String(row[2]));
    const gift = row[4] === "" || row[4] == null ? "" : String(row[4]);
    const kept: Kept & { filled: number } = {
      date: String(row[0]),
      last,
      first,
      email,
      amount: row[3] as number,
      gift,
      filled: [row[0], last, first, email, row[3], gift].filter((cell) => cell !== "" && cell != null).length,
    };
    const prev = best.get(email);
    if (!prev || kept.filled > prev.filled) best.set(email, kept);
  }
  return best;
}

function cellData(rows: DonationValue[][]) {
  return Object.fromEntries(
    rows.map((row, r) => [
      r,
      Object.fromEntries(
        row.flatMap((value, c) =>
          value === "" ? [] : [[c, typeof value === "number" ? { v: value, t: 2 } : { v: value, t: 1 }]],
        ),
      ),
    ]),
  );
}

/** Opens Donations Q3 the way the recorded storyboard does, including the Last year sheet. */
async function openDonations(page: Page) {
  const file = createFile("sheet", title);
  if (file.kind !== "sheet") throw new Error("Expected a spreadsheet");
  const firstId = file.content.workbook.sheetOrder[0]!;
  const first = file.content.workbook.sheets[firstId]!;
  first.name = title;
  first.cellData = cellData(donationRows());
  (first as { columnData?: unknown }).columnData = Object.fromEntries(donationWidths.map((w, index) => [index, { w }]));
  const lastId = crypto.randomUUID();
  file.content.workbook.sheetOrder.push(lastId);
  file.content.workbook.sheets[lastId] = {
    ...structuredClone(first),
    id: lastId,
    name: "Last year",
    cellData: cellData(lastYearRows()),
  };
  await page.locator("input[type=file]").setInputFiles({
    name: "Donations Q3.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByLabel("File title")).toHaveValue(title);
}

async function savedCopy(page: Page) {
  if (electronMode) {
    const dir = mkdtempSync(join(tmpdir(), "storyboard-38-ai-"));
    await electronApps.get(page)!.evaluate(({ dialog }, folder) => {
      (dialog as unknown as Record<string, unknown>).showSaveDialog = async (_window: unknown, options: { defaultPath: string }) => ({
        canceled: false,
        filePath: `${folder}/${options.defaultPath.split(/[\\/]/).pop()}`,
      });
    }, dir);
    await page.getByRole("button", { name: "Save As", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Saved to file");
    return JSON.parse(readFileSync(join(dir, `${title}.slsheet`), "utf8"));
  }
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  return JSON.parse(readFileSync((await (await download).path())!, "utf8"));
}

test("38-clean-up-messy-data-ai", async ({ page }) => {
  await openApp(page);
  await caption(page, "Omar pasted three months of donation receipts into one sheet. Names, emails, and repeat gifts are a mess.");
  await openDonations(page);
  await caption(page, "He asks SuiteLeaf's on-device assistant to trim, split the names, and keep one row per email.", 1600);
  await caption(page, "", 0);

  const run = await askAgent(page, prompt, { allow: /duplicate/i });
  const why = describeRun(run);
  expect(run.state, why).toBe("done");
  await caption(page, "One list of donors: last and first name split, spaces gone, and the fuller gift kept.", 2000);

  await page.getByRole("button", { name: "Close assistant" }).click();
  const saved = await savedCopy(page);
  const sheets = saved.content.workbook.sheets;
  const order = saved.content.workbook.sheetOrder as string[];
  const cells = sheets[order[0]].cellData as Record<string, Record<string, { v?: unknown }>>;
  const header = cells[0] ?? {};
  const column = (name: string) => {
    const hit = Object.entries(header).find(([, cell]) => cell?.v === name);
    return hit ? Number(hit[0]) : -1;
  };
  const dateCol = column("Date");
  const lastCol = column("Last name");
  const firstCol = column("First name");
  const emailCol = column("Email");
  const amountCol = column("Amount");
  const giftCol = column("Gift Aid");
  expect([dateCol, lastCol, firstCol, emailCol, amountCol, giftCol], `${why}\n${JSON.stringify(header)}`).toEqual([0, 1, 2, 3, 4, 5]);

  const expected = expectedKept();
  const dataRows = Object.keys(cells)
    .map(Number)
    .filter((row) => row !== 0)
    .sort((a, b) => a - b);
  expect(dataRows, why).toEqual(Array.from({ length: expected.size }, (_, index) => index + 1));

  const dirty: string[] = [];
  const emails: string[] = [];
  for (const rowIndex of dataRows) {
    const row = cells[rowIndex] ?? {};
    for (const cell of Object.values(row)) {
      if (typeof cell?.v === "string" && (cell.v !== normalizeText(cell.v) || /[\u00A0\t]/.test(cell.v))) dirty.push(cell.v);
    }
    const email = row[emailCol]?.v;
    emails.push(String(email ?? ""));
    const want = typeof email === "string" ? expected.get(email) : undefined;
    expect(want, `${why}\n${email} on row ${rowIndex + 1}: ${JSON.stringify(row)}`).toBeDefined();
    expect(row[dateCol]?.v, why).toBe(want!.date);
    expect(row[lastCol]?.v, why).toBe(want!.last);
    expect(row[firstCol]?.v, why).toBe(want!.first);
    expect(row[amountCol]?.v, why).toBe(want!.amount);
    expect(String(row[giftCol]?.v ?? ""), why).toBe(want!.gift);
  }
  expect(dirty, `${why}\n${dirty.join(" | ")}`).toEqual([]);
  expect(new Set(emails).size, why).toBe(emails.length);
  expect(emails, why).toHaveLength(103);
  expect(expected.size, why).toBe(103);

  const last = sheets[order[1]].cellData as Record<string, Record<string, { v?: unknown }>>;
  expect(last[1]?.[1]?.v, why).toBe("Okafor, Ade");
  const lastEmails = [1, 2, 3, 4, 5].map((row) => last[row]?.[2]?.v);
  expect(lastEmails.filter((value) => value === "ada.okafor@harbour.test"), why).toHaveLength(2);
  await caption(page, "103 donors remain, each email once, and last year's sheet was left as it was.", 2200);
  await beat(page, 600);
});
