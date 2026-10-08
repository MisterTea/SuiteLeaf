import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const source = resolve(
  "datasets/apache-poi/files/test-data/spreadsheet/45540_form_Footer.xlsx",
);
const output = resolve(
  "datasets/validation/excel-visual-parity/pilot/image-footer-final/image-persistence.suiteleaf",
);
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1800, height: 1200 },
  });
  const page = await context.newPage();
  await page.route("**/src/editors/Sheets.tsx*", async (route) => {
    const r = await route.fetch();
    const body = await r.text();
    await route.fulfill({
      response: r,
      body: body.replace(
        "book.current = workbook;",
        "book.current = workbook; window.__suiteleafImageTest = {workbook, content:content.current};",
      ),
    });
  });
  const open = async (path) => {
    await page.goto("http://127.0.0.1:5173", { waitUntil: "networkidle" });
    await page.locator("input[type=file]").first().setInputFiles(path);
    await page.waitForFunction(
      () =>
        window.__suiteleafImageTest?.workbook.getActiveSheet().getImages()
          .length === 41,
      { timeout: 20000 },
    );
  };
  await open(source);
  const state = await page.evaluate(async () => {
    const { workbook, content } = window.__suiteleafImageTest,
      sheet = workbook.getActiveSheet();
    const logo = content.images.find((x) =>
      x.src.startsWith("data:image/jpeg"),
    );
    const image = sheet.getImageById(logo.id);
    const moved = await image.setPositionAsync(4, 2, 7, 11);
    const resized = await sheet.getImageById(logo.id).setSizeAsync(220, 55);
    sheet.setColumnWidth(0, 180);
    sheet.zoom(1.5);
    return {
      id: logo.id,
      moved,
      resized,
      before: await sheet.getImageById(logo.id).toBuilder().buildAsync(),
      count: sheet.getImages().length,
    };
  });
  await page.waitForTimeout(300);
  const snapshot = await page.evaluate(() => {
    const { workbook, content } = window.__suiteleafImageTest;
    return {
      format: "suiteleaf",
      version: 1,
      kind: "sheet",
      id: "image-persistence-test",
      title: "Image persistence test",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      content: { ...content, workbook: workbook.save() },
    };
  });
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, JSON.stringify(snapshot));
  await open(output);
  const restored = await page.evaluate(async (id) => {
    const s = window.__suiteleafImageTest.workbook.getActiveSheet();
    return {
      count: s.getImages().length,
      after: await s.getImageById(id).toBuilder().buildAsync(),
    };
  }, state.id);
  const pick = (x) => ({
    sheetTransform: x.sheetTransform,
    source: x.source,
    drawingId: x.drawingId,
  });
  if (
    restored.count !== 41 ||
    JSON.stringify(pick(state.before)) !== JSON.stringify(pick(restored.after))
  )
    throw Error("Image move/resize or resource identity changed on reopen");
  console.log(
    JSON.stringify({
      count: restored.count,
      move_resize_reopen: true,
      column_resize_before_save: true,
      zoom_before_save: 150,
    }),
  );
} finally {
  await browser.close();
}
