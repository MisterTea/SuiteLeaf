// Run against the development server: node tests/excel-chart-ui.mjs
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1800, height: 1200 },
  });
  await page.route("**/src/editors/Sheets.tsx*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace(
        "book.current = workbook;",
        "book.current = workbook; window.__chartTest={workbook,content:content.current};",
      ),
    });
  });
  await page.goto("http://127.0.0.1:5173");
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles(
      "datasets/apache-poi/files/test-data/spreadsheet/WithChart.xlsx",
    );
  await page.waitForFunction(
    () => window.__chartTest?.workbook.getSheets().length === 3,
  );
  await page.evaluate(() => {
    const a = window.__chartTest;
    a.workbook.setActiveSheet(a.workbook.getSheets()[1]);
  });
  await page.waitForSelector(".excel-line-chart");
  assert.equal(await page.locator(".excel-line-chart polyline").count(), 2);
  assert.equal(await page.locator(".excel-line-chart rect:not([fill=none])").count(), 7);
  const initial = await page.evaluate(() =>
    structuredClone(window.__chartTest.content.charts[0]),
  );
  // Editing the first data row must update both independently sourced series.
  await page.evaluate(() => {
    const a = window.__chartTest;
    const s = a.workbook.getSheets()[0];
    a.workbook.setActiveSheet(s);
    s.getRange("A1").setValue(7);
    a.workbook.setActiveSheet(a.workbook.getSheets()[1]);
  });
  await page.waitForTimeout(1200);
  const edited = await page
    .locator(".excel-line-chart polyline")
    .first()
    .getAttribute("points");
  assert.notEqual(
    edited.split(" ")[0].split(",")[1],
    edited.split(" ")[1].split(",")[1],
  );
  await page.reload();
  await page.waitForTimeout(700);
  if (!(await page.evaluate(() => !!window.__chartTest))) {
    await page.getByText("WithChart", { exact: false }).first().click();
  }
  await page.waitForFunction(
    () => window.__chartTest?.workbook.getSheets().length === 3,
  );
  await page.evaluate(() => {
    const a = window.__chartTest;
    a.workbook.setActiveSheet(a.workbook.getSheets()[1]);
  });
  await page.waitForSelector(".excel-line-chart");
  const reopened = await page.evaluate(() => ({
    c: structuredClone(window.__chartTest.content.charts[0]),
    v: window.__chartTest.workbook.getSheets()[0].getRange("A1").getValue(),
  }));
  assert.equal(
    reopened.v,
    7,
    "switching sheets must not cancel pending autosave",
  );
  assert.equal(reopened.c.excel.anchorResolved, true);
  assert.ok(Math.abs(reopened.c.width - initial.width) < 0.1);
  assert.ok(Math.abs(reopened.c.y - initial.y) < 0.1);
  assert.equal(await page.locator(".excel-line-chart polyline").count(), 2);
  await page.evaluate(() => {
    const a = window.__chartTest;
    const s = a.workbook.getSheets()[0];
    a.workbook.setActiveSheet(s);
    s.insertRowsBefore(0, 1);
  });
  await page.waitForTimeout(700);
  const refs = await page.evaluate(() => window.__chartTest.content.charts[0].excel.series.map(s => s.values));
  assert.ok(refs.every(r => r.startRow === 1 && r.endRow === 6), 'both independent series must shift with inserted rows');
  console.log(
    "PASS: two series render, first-row edit survives immediate sheet switch and reload, chart anchors do not reset.",
  );
} finally {
  await browser.close();
}
