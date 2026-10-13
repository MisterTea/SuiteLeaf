import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, extname, sep } from "node:path";
async function exported(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const d = await download;
  return JSON.parse(await readFile((await d.path())!, "utf8"));
}
test("document edit → formatting → autosave → reopen → native export", async ({
  page,
  isMobile,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  await page.getByLabel("File title").fill("Field notes");
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.fill("A working idea");
  // Playwright's WebKit sends Ctrl+A with the macOS "move to paragraph start"
  // command, which iPhone emulation on Linux applies after the select-all.
  if (isMobile) await editor.selectText();
  else await editor.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Field notes" }).click();
  await expect(editor).toContainText("A working idea");
  await expect(editor.locator("strong")).toContainText("A working idea");
  const file = await exported(page);
  expect(file.title).toBe("Field notes");
  expect(file.content.content[0].content[0].marks).toContainEqual({
    type: "bold",
  });
  await page.screenshot({ path: "test-results/docs.png", fullPage: true });
  expect(errors).toEqual([]);
});
test("spreadsheet formulas → embedded chart → pivot worksheet → save and reopen", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Sample budget" }).click();
  await page.getByRole("button", { name: "Insert chart", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Source range", exact: true })
    .fill("A1:C5");
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Studio costs");
  await page.getByRole("button", { name: "Create chart", exact: true }).click();
  await expect(page.getByLabel("Chart: Studio costs")).toBeVisible();
  await page.getByRole("button", { name: "Pivot table", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Source range", exact: true })
    .fill("A1:C5");
  await page.getByRole("button", { name: "Create pivot", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".analysis-panel")).toHaveCount(0);
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save now" }).click();
  const file = await exported(page);
  expect(file.content.charts).toHaveLength(1);
  expect(file.content.pivots).toHaveLength(1);
  const source =
    file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  expect(source.cellData["1"]["3"].v).toBe(800);
  expect(source.cellData["5"]["1"].v).toBe(23000);
  const pivot =
    file.content.workbook.sheets[file.content.pivots[0].targetSheetId];
  expect(pivot.cellData["1"]["1"].v).toBe(6000);
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Quarterly studio budget" }).click();
  await page
    .getByRole("button", { name: "Insert chart", exact: true })
    .waitFor();
  await expect(page.getByRole("alert")).toHaveCount(0);
  const reopened = await exported(page);
  expect(reopened.content.charts[0].title).toBe("Studio costs");
  await expect(page.getByLabel("Chart: Studio costs")).toBeVisible();
  await page.screenshot({ path: "test-results/sheets.png", fullPage: true });
  const nameBox = page.locator(".sheet-host input.univer-size-full");
  await nameBox.fill("B2");
  await nameBox.press("Enter");
  await page.keyboard.type("7000");
  await page.keyboard.press("Enter");
  const edited = await exported(page);
  expect(
    edited.content.workbook.sheets[edited.content.workbook.sheetOrder[0]]
      .cellData[1][3].v,
  ).toBe(1800);
  const pivotCell = async (row: number) =>
    (await exported(page)).content.workbook.sheets[
      file.content.pivots[0].targetSheetId
    ].cellData[row][1].v;
  await expect.poll(() => pivotCell(1)).toBe(7000);
  expect(await pivotCell(5)).toBe(24000);
  const undo = page.getByRole("button", { name: /^Undo/ }).first();
  if (!(await undo.isVisible()))
    await page.getByRole("button", { name: "More tools" }).click();
  await undo.click();
  await expect.poll(() => pivotCell(1)).toBe(6000);
  expect(await pivotCell(5)).toBe(23000);
  await page.getByText("Charts & pivots (2)", { exact: true }).click();
  await page
    .getByRole("button", { name: "Delete Studio costs", exact: true })
    .click();
  await expect(page.getByLabel("Chart: Studio costs")).toHaveCount(0);
  expect((await exported(page)).content.charts).toHaveLength(0);
  expect(errors).toEqual([]);
});
test("safe HTML import and malformed native files", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Imported.html",
    mimeType: "text/html",
    buffer: Buffer.from(
      '<h1>A safe heading</h1><p>Hello<script>window.pwned=true</script><a href="javascript:alert(1)">unsafe link</a></p>',
    ),
  });
  await expect(
    page.getByRole("textbox", { name: "Document content" }),
  ).toContainText("A safe heading");
  expect(await page.evaluate(() => "pwned" in window)).toBe(false);
  await expect(
    page.locator('.document-content a[href^="javascript:"]'),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("button", { name: "Open / import" }).waitFor();
  await page.locator("input[type=file]").setInputFiles({
    name: "Broken.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":9}'),
  });
  await expect(page.getByRole("alert")).toContainText("version");
  await expect(
    page.getByRole("link", { name: "Imported", exact: true }),
  ).toBeVisible();
});
test("a downloaded native file says what it is and reopens over its library copy only when asked", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  await page.getByLabel("File title").fill("Packing list");
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.fill("Passport");
  await expect(page.getByRole("status")).toContainText("Saved");
  const button = page.getByRole("button", { name: "Download", exact: true });
  await expect(button).toHaveAttribute("title", /Packing list\.sldoc/);
  await page.getByRole("button", { name: "File", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "Download SuiteLeaf file (.sldoc)" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Export native copy" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  const downloading = page.waitForEvent("download");
  await button.click();
  const path = (await (await downloading).path())!;
  await expect(page.getByRole("status")).toHaveText(
    "Downloaded “Packing list.sldoc”",
  );
  const chooseDownloaded = () =>
    page.locator("input[type=file]").setInputFiles({
      name: "Packing list.sldoc",
      mimeType: "application/json",
      buffer: readFileSync(path),
    });
  const back = async () => {
    await page.getByRole("button", { name: "Back to files" }).click();
    await page.getByRole("button", { name: "Open / import" }).waitFor();
  };
  const rows = page.locator(".file-row");

  await back();
  await chooseDownloaded();
  await expect(page.getByRole("status")).toContainText(
    "“Packing list.sldoc” matches the copy here",
  );
  await back();
  await expect(rows).toHaveCount(1);

  await page.getByRole("link", { name: "Packing list" }).click();
  await editor.press("ControlOrMeta+End");
  await editor.pressSequentially(" and shoes");
  await expect(page.getByRole("status")).toContainText("Saved");
  await back();
  await chooseDownloaded();
  const dialog = page.getByRole("dialog", {
    name: "“Packing list” is already in this browser",
  });
  await expect(dialog).toContainText("The one here has newer changes.");
  await dialog.getByRole("button", { name: "Keep both" }).click();
  await expect(page.getByLabel("File title")).toHaveValue("Packing list copy");
  await expect(editor).toContainText("Passport");
  await expect(editor).not.toContainText("shoes");
  await back();
  await expect(rows).toHaveCount(2);

  await chooseDownloaded();
  await dialog.getByRole("button", { name: "Replace" }).click();
  await expect(page.getByLabel("File title")).toHaveValue("Packing list");
  await expect(editor).toContainText("Passport");
  await expect(editor).not.toContainText("shoes");
  await expect(page.getByRole("status")).toContainText(
    "Replaced with “Packing list.sldoc”",
  );
  await back();
  await expect(rows).toHaveCount(2);

  await page
    .getByRole("button", { name: "Move Packing list to Trash", exact: true })
    .click();
  await expect(page.locator(".trash-toast")).toContainText(
    "Moved “Packing list” to Trash",
  );
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete Packing list forever", exact: true })
    .click();
  const confirm = page.getByRole("dialog", {
    name: "Delete “Packing list” forever?",
  });
  await expect(confirm).toContainText(
    "“Packing list” will be deleted from this browser forever. This can't be undone.",
  );
  await expect(confirm).toContainText("open it again with Open / import");
  await confirm.getByRole("button", { name: "Delete forever" }).click();
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await expect(rows).toHaveCount(1);
});
test("cached application and local files work offline", async ({ page }) => {
  // Stop a real origin: WebKit's setOffline emulation blocks even SW responses.
  const root = resolve("apps/web/dist");
  const server = createServer(async (req, res) => {
    const relative = new URL(req.url ?? "/", "http://localhost").pathname;
    const path = resolve(
      root,
      `.${relative === "/" ? "/index.html" : relative}`,
    );
    if (!path.startsWith(root + sep)) {
      res.writeHead(404).end();
      return;
    }
    try {
      const bytes = await readFile(path);
      res.setHeader(
        "content-type",
        (
          {
            ".js": "text/javascript",
            ".css": "text/css",
            ".html": "text/html",
            ".svg": "image/svg+xml",
          } as Record<string, string>
        )[extname(path)] ?? "text/plain",
      );
      res.end(bytes);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No offline test origin");
  try {
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.getByRole("button", { name: "New document" }).click();
    await page
      .getByRole("textbox", { name: "Document content" })
      .fill("Offline notebook");
    await expect(page.getByRole("status")).toContainText("Saved");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller)
        await new Promise<void>((done) =>
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            () => done(),
            { once: true },
          ),
        );
    });
    const closed = new Promise<void>((done) => server.close(() => done()));
    server.closeAllConnections();
    await closed;
    expect(
      await page.evaluate(() =>
        fetch("/uncached-network-probe")
          .then(() => false)
          .catch(() => true),
      ),
    ).toBe(true);
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "Document content" }),
    ).toContainText("Offline notebook");
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
test("a second browser tab cannot edit the same file concurrently", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  await expect(
    page.getByRole("textbox", { name: "Document content" }),
  ).toBeVisible();
  const second = await context.newPage();
  await second.goto(page.url());
  await expect(
    second.getByRole("heading", { name: "Already open in another tab" }),
  ).toBeVisible();
  await second.close();
});

test("common formula categories and cross-sheet calculations survive native round trips", async ({
  page,
}) => {
  const { createFile, serializeFile } = await import("../../packages/core/src");
  const file = createFile("sheet", "Formula reference");
  if (file.kind !== "sheet") throw new Error("Expected workbook");
  const first = file.content.workbook.sheetOrder[0],
    second = "lookup-sheet";
  file.content.workbook.sheetOrder.push(second);
  file.content.workbook.sheets[second] = {
    id: second,
    name: "Sheet2",
    rowCount: 1000,
    columnCount: 26,
    cellData: { 0: { 0: { v: 3, t: 2 } }, 1: { 0: { v: 4, t: 2 } } },
  };
  const formulas = [
    "=SUM(1,2,3)",
    "=ROUND(AVERAGE(1,2,3),1)",
    "=IF(2>1,42,0)",
    '=CONCATENATE("Suite","Leaf")',
    '=LEN("SuiteLeaf")',
    "=DATE(2026,10,7)",
    '=VLOOKUP("North",D1:E2,2,FALSE)',
    "=SUM(Sheet2!A1:A2)",
    '=COUNT(1,2,"text")',
    "=1/0",
  ];
  file.content.workbook.sheets[first].cellData = Object.fromEntries(
    formulas.map((f, i) => [i, { 0: { f } }]),
  );
  const cells = file.content.workbook.sheets[first].cellData!;
  cells["0"]["3"] = { v: "North", t: 1 };
  cells["0"]["4"] = { v: 10, t: 2 };
  cells["1"]["3"] = { v: "South", t: 1 };
  cells["1"]["4"] = { v: 20, t: 2 };
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "formulas.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await page.getByText("Sheet1", { exact: true }).first().waitFor();
  await expect(page.getByRole("status")).toContainText("Saved");
  const saved = await exported(page);
  const actual = formulas.map(
    (_, i) => saved.content.workbook.sheets[first].cellData[i][0].v,
  );
  const serial = (Date.UTC(2026, 9, 7) - Date.UTC(1899, 11, 30)) / 86400000;
  expect(actual).toEqual([
    6,
    2,
    42,
    "SuiteLeaf",
    9,
    serial,
    10,
    7,
    2,
    "#DIV/0!",
  ]);
});

test("CSV import preview preserves identifiers and formula-looking text, and exports calculated values", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "sales.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      'Item,Amount,Identifier,Literal\n"North, studio",12.5,00123,=SUM(A1:A2)\nSouth,20,00999,hello',
    ),
  });
  const dialog = page.getByRole("dialog", { name: "Import sales.csv" });
  await expect(dialog.getByRole("status")).toHaveText(
    "2 data rows · 4 columns · comma-separated, plus a header row",
  );
  await expect(dialog).toContainText("Formulas are not run");
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByText("Sheet1", { exact: true }).first().waitFor();
  const saved = await exported(page);
  const cells =
    saved.content.workbook.sheets[saved.content.workbook.sheetOrder[0]]
      .cellData;
  expect(cells[1][0].v).toBe("North, studio");
  expect(cells[1][1].v).toBe(12.5);
  expect(cells[1][2].v).toBe("00123");
  expect(cells[1][3].v).toBe("=SUM(A1:A2)");
  expect(cells[1][3].f).toBeUndefined();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export CSV", exact: true }).click();
  const d = await download;
  const csv = await readFile((await d.path())!, "utf8");
  const Papa = await import("papaparse");
  expect(Papa.default.parse<string[]>(csv).data[1]).toEqual([
    "North, studio",
    "12.5",
    "00123",
    "'=SUM(A1:A2)",
  ]);
});

test("CSV import dialog chooses the separator, header row, and code columns", async ({
  page,
}) => {
  await page.goto("/");
  const pick = () =>
    page.locator("input[type=file]").setInputFiles({
      name: "members.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "Member ID;Name;ZIP;Dues\n00412;Rosa;02139;45\n01205;Mei;10001;0\n00038;Luis;07302;45\n",
      ),
    });
  await pick();
  const dialog = page.getByRole("dialog", { name: "Import members.csv" });
  const summary = dialog.getByRole("status");
  const zip = dialog.getByRole("columnheader", { name: /^ZIP/ });
  await expect(summary).toHaveText(
    "3 data rows · 4 columns · semicolon-separated, plus a header row",
  );
  await expect(dialog.getByLabel("Separator")).toHaveValue(";");
  await expect(dialog).toContainText(
    "Member ID and ZIP have codes with leading zeros",
  );
  await expect(zip).toHaveText("ZIPText");
  await dialog.getByLabel("Keep code columns as text").uncheck();
  await expect(zip).toHaveText("ZIPMixed");
  await dialog.getByLabel("Keep code columns as text").check();
  await dialog.getByLabel("First row is a header").uncheck();
  await expect(summary).toHaveText(
    "4 data rows · 4 columns · semicolon-separated",
  );
  await dialog.getByLabel("First row is a header").check();
  await dialog.getByLabel("Separator").selectOption(",");
  await expect(summary).toContainText("1 column · comma-separated");
  await dialog.getByLabel("Separator").selectOption(";");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".error")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open / import" }),
  ).toBeEnabled();

  await pick();
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByText("Sheet1", { exact: true }).first().waitFor();
  const saved = await exported(page);
  const cells =
    saved.content.workbook.sheets[saved.content.workbook.sheetOrder[0]]
      .cellData;
  expect(cells[1][0]).toMatchObject({ v: "00412", t: 1 });
  expect(cells[2][2]).toMatchObject({ v: "10001", t: 1 });
  expect(cells[2][3]).toMatchObject({ v: 0, t: 2 });
});
test("document outline, images, tables, find/replace, and print layout", async ({
  page,
  browserName,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sample document" }).click();
  await expect(page.locator(".outline")).toContainText("Make yourself at home");
  await expect(page.locator(".editor-status")).not.toContainText(/^0 words/);
  await page.getByRole("textbox", { name: "Document content" }).click();
  await page.getByRole("button", { name: "Insert table", exact: true }).click();
  await page.getByRole("button", { name: "Create table", exact: true }).click();
  await expect(page.locator(".document-content table")).toBeVisible();
  await page.locator("input[type=file]").setInputFiles({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8H8AAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.locator(".document-content img")).toBeVisible();
  await page
    .getByRole("button", { name: "Find and replace", exact: true })
    .click();
  await page.getByLabel("Find text").fill("SuiteLeaf");
  await page.getByLabel("Replacement text").fill("My workspace");
  await page.getByRole("button", { name: "Replace all", exact: true }).click();
  await expect(page.locator(".document-content")).toContainText("My workspace");
  await page.getByRole("button", { name: "Close find", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".document-content")).toContainText(
    "Welcome to SuiteLeaf",
  );
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".workspace-header")).toBeHidden();
  await expect(page.locator(".document-content")).toBeVisible();
  if (browserName === "chromium")
    await page.pdf({ path: "test-results/document-print.pdf" });
});

test("find and replace keeps the current match in view and reports what is left", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "the dialog fills the width of a phone screen");
  const overlaps = (
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
  ) =>
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height;
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click();
  await page.keyboard.type("We were happy to recieve so many seed donations.");
  await page.keyboard.press("Enter");
  await page.keyboard.type(
    "Ruth keeps spare gloves at the shed for any volunteer who did not recieve",
  );
  const find = page.getByRole("search", { name: "Find and replace" });
  await page.keyboard.press("ControlOrMeta+f");
  const usual = (await find.boundingBox())!;
  await page.keyboard.press("Escape");
  await expect(find).toBeHidden();
  await expect(editor).toBeFocused();

  // The selected word fills Find; its match sits where the dialog usually is.
  for (let i = 0; i < "recieve".length; i++)
    await page.keyboard.press("Shift+ArrowLeft");
  await expect
    .poll(() =>
      editor.evaluate((el: any) => {
        const { from, to } = el.editor.state.selection;
        return el.editor.state.doc.textBetween(from, to);
      }),
    )
    .toBe("recieve");
  await page.keyboard.press("ControlOrMeta+f");
  await expect(find.getByLabel("Find text")).toHaveValue("recieve");
  const counter = find.locator(".match-counter");
  await expect(counter).toHaveText("2 of 2");
  const match = (await page.locator(".doc-search-current").boundingBox())!;
  expect(overlaps(match, usual)).toBe(true);
  expect(overlaps(match, (await find.boundingBox())!)).toBe(false);

  await find.getByLabel("Find text").press("Shift+Enter");
  await expect(counter).toHaveText("1 of 2");
  await find.getByLabel("Find text").press("Enter");
  await expect(counter).toHaveText("2 of 2");

  const before = (await find.boundingBox())!;
  const title = (await find.getByRole("heading").boundingBox())!;
  await page.mouse.move(title.x + 20, title.y + title.height / 2);
  await page.mouse.down();
  await page.mouse.move(title.x - 280, title.y + title.height / 2 + 60, {
    steps: 5,
  });
  await page.mouse.up();
  const after = (await find.boundingBox())!;
  expect(after.x).toBeCloseTo(before.x - 300, 0);
  expect(after.y).toBeCloseTo(before.y + 60, 0);

  await find.getByLabel("Replacement text").fill("receive");
  await find.getByRole("button", { name: "Replace all", exact: true }).click();
  await expect(counter).toHaveText("No results");
  await expect(find).toContainText(
    "Replaced 2 instances of “recieve” with “receive”.",
  );
  await expect(editor).not.toContainText("recieve");
});

test("presentation lifecycle → slide creation, editing, thumbnail selection, presentation mode, notes, and native export", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");

  // 1. Create a new presentation
  await page.getByRole("button", { name: "New presentation" }).click();
  await page.getByLabel("File title").fill("Quarterly Product Pitch");

  // 2. Edit slide 1 title
  const slide1Text = page.locator(".slide-element textarea").first();
  await slide1Text.fill("Welcome to SuiteLeaf Slides");

  // 3. Add a new slide with Title & Body layout
  await page.getByRole("button", { name: "+ New slide" }).click();
  await page.getByRole("menuitem", { name: "Title & body" }).click();
  await expect(page.locator(".thumbnail-card")).toHaveCount(2);

  // Select slide 2 and edit text
  await page.locator(".thumbnail-row").nth(1).click();
  const slide2Texts = page.locator(".slide-element textarea");
  await slide2Texts.first().fill("Key Features");
  if ((await slide2Texts.count()) > 1) {
    await slide2Texts
      .nth(1)
      .fill(
        "1. Native PPTX/PPT import\n2. Interactive editor\n3. Slide show mode",
      );
  }

  // 4. Edit speaker notes
  const notesArea = page.getByPlaceholder(/Click to add speaker notes/);
  await notesArea.fill("Remember to emphasize zero cloud telemetry.");

  // 5. Test Presentation mode (fullscreen slide show)
  await page.getByRole("button", { name: "Slideshow", exact: true }).click();
  await expect(page.locator(".presenter-overlay")).toBeVisible();
  await expect(page.locator(".presenter-overlay")).toContainText(
    "Key Features",
  );

  // Navigate back to slide 1 with left arrow key
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".presenter-overlay")).toContainText(
    "Welcome to SuiteLeaf Slides",
  );

  // Exit presentation mode
  await page.getByRole("button", { name: "Exit" }).click();
  await expect(page.locator(".presenter-overlay")).toHaveCount(0);

  // 6. Autosave check & Reopen from home
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Quarterly Product Pitch" }).click();

  // Confirm content preserved
  await expect(page.locator(".slide-canvas")).toContainText(
    "Welcome to SuiteLeaf Slides",
  );
  await page.locator(".thumbnail-row").nth(1).click();
  await expect(page.locator(".slide-canvas")).toContainText("Key Features");
  await expect(notesArea).toHaveValue(
    "Remember to emphasize zero cloud telemetry.",
  );

  // 7. Native export validation
  const exportedFile = await exported(page);
  expect(exportedFile.kind).toBe("slide");
  expect(exportedFile.title).toBe("Quarterly Product Pitch");
  expect(exportedFile.content.slideOrder).toHaveLength(2);
  const slide1 =
    exportedFile.content.slides[exportedFile.content.slideOrder[0]];
  expect(slide1.elements[0].content).toContain("Welcome to SuiteLeaf Slides");
  const slide2 =
    exportedFile.content.slides[exportedFile.content.slideOrder[1]];
  expect(slide2.notes).toBe("Remember to emphasize zero cloud telemetry.");

  expect(errors).toEqual([]);
});

test("slides use placeholders, re-apply layouts, and reorder by dragging thumbnails", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "New presentation" }).click();

  const boxes = page.locator(".slide-canvas .slide-element textarea");
  await expect(boxes).toHaveCount(2);
  await expect(boxes.nth(0)).toHaveValue("");
  await expect(boxes.nth(0)).toHaveAttribute(
    "placeholder",
    "Click to add title",
  );
  await expect(boxes.nth(1)).toHaveAttribute(
    "placeholder",
    "Click to add subtitle",
  );
  await boxes.nth(0).click();
  await page.keyboard.type("Kickoff");
  await expect(boxes.nth(0)).toHaveValue("Kickoff");

  for (const label of ["Line", "Grid view", "Zoom"])
    await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
  for (const text of ["Transition", "Menus"])
    await expect(
      page.getByRole("button", { name: text, exact: true }),
    ).toHaveCount(0);

  // Layout on an existing slide moves its text into the new arrangement.
  await page.locator(".slide-canvas").click({ position: { x: 10, y: 10 } });
  await page.getByRole("button", { name: "Layout" }).click();
  await page.getByRole("menuitem", { name: "Two columns" }).click();
  await expect(boxes).toHaveCount(3);
  await expect(boxes.nth(0)).toHaveValue("Kickoff");
  await expect(boxes.nth(2)).toHaveAttribute(
    "placeholder",
    "Click to add text",
  );
  const title = (await boxes.nth(0).boundingBox())!;
  const canvas = (await page.locator(".slide-canvas").boundingBox())!;
  expect(title.y - canvas.y).toBeLessThan(canvas.height * 0.2);

  for (const name of ["Title & body", "Section header"]) {
    await page.getByRole("button", { name: "+ New slide" }).click();
    await page.getByRole("menuitem", { name }).click();
  }
  await boxes.nth(0).fill("Questions?");
  const rows = page.locator(".thumbnail-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2)).toContainText("Questions?");

  // Drag the last thumbnail above the first.
  const from = (await rows.nth(2).boundingBox())!;
  const to = (await rows.nth(0).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + 4, { steps: 10 });
  await page.mouse.up();
  await expect(rows.nth(0)).toContainText("Questions?");
  await expect(rows.nth(1)).toContainText("Kickoff");
  await expect(rows.nth(0)).toHaveAttribute("aria-selected", "true");

  // Ctrl/Cmd+Down moves the selected slide back down.
  await page.getByRole("listbox", { name: "Slides" }).focus();
  await page.keyboard.press("ControlOrMeta+ArrowDown");
  await expect(rows.nth(1)).toContainText("Questions?");
  await expect(rows.nth(0)).toContainText("Kickoff");

  const file = await exported(page);
  const first = file.content.slides[file.content.slideOrder[0]];
  expect(first.layout).toBe("two-column");
  expect(first.elements.map((el: { content: string }) => el.content)).toEqual([
    "Kickoff",
    "",
    "",
  ]);
  expect(errors).toEqual([]);
});

test("PowerPoint presentation import via drag/upload into workspace", async ({
  page,
}) => {
  const samplePath = resolve(
    process.cwd(),
    "datasets/apache-poi/files/test-data/slideshow/sample.pptx",
  );
  test.skip(!existsSync(samplePath), "Downloaded corpus is local-only.");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");

  const sampleBuf = await readFile(samplePath);

  await page.locator('input[type="file"]').setInputFiles({
    name: "sample.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: sampleBuf,
  });

  // Verify it opened the presentation
  await expect(page.locator(".slides-editor")).toBeVisible();
  await expect(page.locator(".thumbnail-card")).not.toHaveCount(0);

  // Verify slide elements are rendered on canvas
  await expect(page.locator(".slide-canvas .slide-element")).not.toHaveCount(0);

  // Verify native export of imported presentation
  const exportedFile = await exported(page);
  expect(exportedFile.kind).toBe("slide");
  expect(exportedFile.content.slideOrder.length).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});
