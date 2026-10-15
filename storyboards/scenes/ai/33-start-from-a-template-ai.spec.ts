import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { askAgent, beat, caption, describeRun, expect, openApp, test } from "../harness";

const october = "Invoice · Café Lune · October";
const november = "Invoice · Café Lune · November";

const prompt = [
  "Use templates, not blank files.",
  `First call create_from_template with name "Invoice" and title "${october}".`,
  'Then call set_cells with start "B2" and values [["Hearth & Rye"]].',
  'Then call set_cells with start "A6" and values [["Sourdough", "24", "6.50"], ["Rye", "12", "7"]].',
  "Do not type into column D or the Total. Leave the amount and total formulas in place.",
  'Then call save_as_template with name "Bakery invoice".',
  `Then call create_from_template with name "Bakery invoice" and title "${november}".`,
  'Then call set_cells with start "B6" and values [["40"]]. Do not change any other cell, and do not change the October invoice.',
  'Then call create_from_template with name "Meeting notes" and title "Landlord meeting".',
  'Then call write_text with text "Rent is due Friday." and after "Next steps". Do not set replace_document.',
  'Then call create_from_template with name "Pitch deck" and do not change its title or slides.',
  'Then call remove_template with name "Bakery invoice".',
  `The library must still contain "${october}", "${november}", "Landlord meeting", and "Pitch deck".`,
].join(" ");

type Cell = { v?: unknown; f?: string };
type SheetFile = {
  title: string;
  content: {
    workbook: {
      sheetOrder: string[];
      sheets: Record<string, { cellData?: Record<string, Record<string, Cell>> }>;
    };
  };
};

async function backHome(page: Page) {
  const back = page.getByRole("button", { name: "Back to files" });
  if (await back.isVisible().catch(() => false)) await back.click();
}

async function openLibraryFile(page: Page, name: string) {
  await backHome(page);
  await page.getByRole("link", { name, exact: true }).click();
}

async function downloadSheet(page: Page): Promise<SheetFile> {
  await page.getByRole("button", { name: "Sheet tools", exact: true }).waitFor({ timeout: 60_000 });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const path = await (await download).path();
  if (!path) throw new Error("The spreadsheet download had no file.");
  return JSON.parse(readFileSync(path, "utf8")) as SheetFile;
}

function cell(file: SheetFile, row: number, column: number) {
  const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  return sheet.cellData?.[row]?.[column];
}

test("33-start-from-a-template-ai", async ({ page }) => {
  await openApp(page);
  await caption(
    page,
    "Tomás needs an October invoice, a November copy, landlord notes, and a pitch deck, each started from a template.",
  );
  const run = await askAgent(page, prompt, { allow: /Bakery invoice/ });
  const why = describeRun(run);
  expect(run.state, why).toBe("done");
  const ok = (name: string) => run.items.filter((item) => item.kind === "tool" && item.name === name && item.status === "ok");
  expect(ok("create_from_template").length, why).toBeGreaterThanOrEqual(4);
  expect(ok("save_as_template").length, why).toBeGreaterThanOrEqual(1);
  expect(ok("remove_template").length, why).toBeGreaterThanOrEqual(1);

  await page.getByRole("button", { name: "Close assistant" }).click();
  await backHome(page);
  await expect(page.getByRole("link", { name: october, exact: true }), why).toBeVisible();
  await expect(page.getByRole("link", { name: november, exact: true }), why).toBeVisible();
  await expect(page.getByRole("link", { name: "Landlord meeting", exact: true }), why).toBeVisible();
  await expect(page.getByRole("link", { name: "Pitch deck", exact: true }), why).toBeVisible();
  await expect(page.getByRole("button", { name: "Bakery invoice", exact: true }), why).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Invoice", exact: true }), why).toBeVisible();
  const savedTemplates = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((ok, fail) => {
      const request = indexedDB.open("SuiteLeafTemplates");
      request.onsuccess = () => ok(request.result);
      request.onerror = () => fail(request.error);
    });
    const rows = await new Promise<{ name: string }[]>((ok, fail) => {
      const request = db.transaction("templates", "readonly").objectStore("templates").getAll();
      request.onsuccess = () => ok(request.result as { name: string }[]);
      request.onerror = () => fail(request.error);
    });
    db.close();
    return rows.map((row) => row.name);
  });
  expect(savedTemplates, why).not.toContain("Bakery invoice");

  await openLibraryFile(page, october);
  const octoberFile = await downloadSheet(page);
  expect(octoberFile.title, why).toBe(october);
  expect(cell(octoberFile, 1, 1)?.v, why).toBe("Hearth & Rye");
  expect(cell(octoberFile, 5, 0)?.v, why).toBe("Sourdough");
  expect(cell(octoberFile, 5, 1)?.v, why).toBe(24);
  expect(cell(octoberFile, 5, 2)?.v, why).toBe(6.5);
  expect(cell(octoberFile, 6, 0)?.v, why).toBe("Rye");
  expect(cell(octoberFile, 6, 1)?.v, why).toBe(12);
  expect(cell(octoberFile, 6, 2)?.v, why).toBe(7);
  expect(cell(octoberFile, 5, 3)?.f, why).toContain("B6*C6");
  expect(cell(octoberFile, 6, 3)?.f, why).toContain("B7*C7");
  expect(cell(octoberFile, 8, 3), why).toMatchObject({ f: "=SUM(D6:D8)", v: 240 });

  await openLibraryFile(page, november);
  const novemberFile = await downloadSheet(page);
  expect(novemberFile.title, why).toBe(november);
  expect(cell(novemberFile, 1, 1)?.v, why).toBe("Hearth & Rye");
  expect(cell(novemberFile, 5, 0)?.v, why).toBe("Sourdough");
  expect(cell(novemberFile, 5, 1)?.v, why).toBe(40);
  expect(cell(novemberFile, 5, 2)?.v, why).toBe(6.5);
  expect(cell(novemberFile, 6, 1)?.v, why).toBe(12);
  expect(cell(novemberFile, 6, 2)?.v, why).toBe(7);
  expect(cell(novemberFile, 5, 3)?.f, why).toContain("B6*C6");
  expect(cell(novemberFile, 8, 3), why).toMatchObject({ f: "=SUM(D6:D8)", v: 344 });

  await openLibraryFile(page, "Landlord meeting");
  const notes = page.getByRole("textbox", { name: "Document content" });
  await notes.waitFor();
  await expect(notes, why).toContainText("Next steps");
  await expect(notes, why).toContainText("Rent is due Friday.");
  await expect(notes, why).toContainText("Agenda");
  const noteText = await notes.innerText();
  expect(noteText.indexOf("Rent is due Friday."), why).toBeGreaterThan(noteText.indexOf("Next steps"));

  await openLibraryFile(page, "Pitch deck");
  await expect(page.getByLabel("File title"), why).toHaveValue("Pitch deck");
  await expect(page.locator(".slides-sidebar"), why).toContainText("Slides (3)");
  await expect(page.locator(".slide-canvas"), why).toContainText("Your pitch");
  await caption(page, "October is still $240, November is $344, the notes and the deck are in the library, and Bakery invoice is gone.", 2000);
  await beat(page, 600);
});
