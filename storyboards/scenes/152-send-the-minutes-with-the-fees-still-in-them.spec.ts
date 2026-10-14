import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import JSZip from "jszip";
import { beat, caption, expect, selectCells, test, typeSlowly } from "./harness";
import { ready } from "./fixtures";

async function saved(page: Page) {
  const status = page.locator(".save-status");
  await expect(status).not.toContainText("Unsaved");
  await expect(status).not.toContainText("Saving");
  await expect(status).toContainText("Saved");
}

async function typeGrid(page: Page, rows: string[][]) {
  await selectCells(page, "A1");
  for (const row of rows) {
    for (const [index, value] of row.entries()) {
      await typeSlowly(page, value, 40);
      await page.keyboard.press(index < row.length - 1 ? "Tab" : "Enter");
    }
  }
}

async function rename(page: Page, title: string) {
  const field = page.getByLabel("File title");
  await field.click();
  await field.press("ControlOrMeta+A");
  await typeSlowly(page, title, 40);
  await expect(field).toHaveValue(title);
}

function wordText(xml: string) {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((match) =>
    match[1]
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">"),
  );
}

test("152-send-the-minutes-with-the-fees-still-in-them", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Maya put the plot-fee chart in the October minutes. She wants those numbers in the Word file.",
  );
  await page.getByRole("button", { name: "New spreadsheet" }).click();
  await ready(page);
  await rename(page, "Plot fees");
  await caption(page, "Plot fees: Fee and Amount. Dues is 40. Compost is 15.", 900);
  await typeGrid(page, [
    ["Fee", "Amount"],
    ["Dues", "40"],
    ["Compost", "15"],
  ]);
  await expect(page.locator(".sheet-host input.univer-size-full")).toHaveValue("A4");
  await selectCells(page, "B2");
  await expect(page.locator(".sheet-host")).toHaveAttribute("data-active-value", "40");
  await selectCells(page, "B3");
  await expect(page.locator(".sheet-host")).toHaveAttribute("data-active-value", "15");
  await saved(page);

  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByRole("button", { name: "New document" })).toBeVisible();
  await page.getByRole("button", { name: "New document" }).click();
  await expect(page.getByRole("textbox", { name: "Document content" })).toBeVisible();
  await rename(page, "October meeting");
  await page.getByRole("textbox", { name: "Document content" }).click({ position: { x: 160, y: 120 } });
  await caption(page, "In October meeting she chooses Insert chart and picks Plot fees.", 800);
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Insert chart", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Insert chart" });
  await expect(dialog.getByRole("radio", { name: "Plot fees" })).toBeVisible();
  await dialog.getByRole("radio", { name: "Plot fees" }).click();
  await beat(page, 700);
  await dialog.getByRole("button", { name: "Insert", exact: true }).click();
  await expect(dialog).toBeHidden();

  const chart = page.locator(".linked-chart");
  await chart.scrollIntoViewIfNeeded();
  await expect(chart).toContainText("Dues");
  await expect(chart).toContainText("40");
  await expect(chart).toContainText("Compost");
  await expect(chart).toContainText("15");
  await expect(chart).toContainText("From Plot fees");
  const duesBar = chart.locator(".linked-chart-row", { hasText: "Dues" }).locator(".linked-chart-bar");
  const compostBar = chart.locator(".linked-chart-row", { hasText: "Compost" }).locator(".linked-chart-bar");
  await expect(duesBar).toHaveAttribute("style", /width:\s*100%/);
  await expect(compostBar).toHaveAttribute("style", /width:\s*37\.5%/);
  await caption(
    page,
    "October meeting shows Dues at 40, Compost at 15, and From Plot fees.",
    1800,
  );
  await saved(page);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 500);
  await caption(
    page,
    "She chooses File, Export DOCX. She does not type the numbers again.",
    1100,
  );
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("October meeting.docx");
  const xml = await JSZip.loadAsync(readFileSync((await download.path())!)).then((zip) =>
    zip.file("word/document.xml")!.async("string"),
  );
  const texts = wordText(xml);
  expect(texts).toContain("Dues");
  expect(texts).toContain("40");
  expect(texts).toContain("Compost");
  expect(texts).toContain("15");
  expect(texts).toContain("From Plot fees");
  expect(texts.indexOf("From Plot fees")).toBeLessThan(texts.indexOf("Dues"));

  await chart.scrollIntoViewIfNeeded();
  await expect(chart).toBeVisible();
  await expect(chart).toContainText("Dues");
  await expect(chart).toContainText("40");
  await expect(chart).toContainText("Compost");
  await expect(chart).toContainText("15");
  await expect(chart).toContainText("From Plot fees");
  await expect(duesBar).toHaveAttribute("style", /width:\s*100%/);
  await expect(compostBar).toHaveAttribute("style", /width:\s*37\.5%/);
  await expect(chart.getByRole("button", { name: "Update chart from Plot fees" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Document content" })).toBeVisible();
  await caption(
    page,
    "The Word file has Dues, 40, Compost, 15, and Plot fees as text. The chart is still on the page.",
    2400,
  );
});
