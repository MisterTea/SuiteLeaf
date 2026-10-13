import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import * as XLSX from "xlsx";
import { createFile, serializeFile } from "../../packages/core/src";
if (process.env.SUITELEAF_FEATURE_URL)
  test.use({ baseURL: process.env.SUITELEAF_FEATURE_URL });
async function native(page: Page) {
  const promise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  return JSON.parse(await readFile((await (await promise).path())!, "utf8"));
}
async function office(page: Page, format: string) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  const promise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: `Export ${format}` }).click();
  const download = await promise;
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(0, 2).toString()).toBe("PK");
}
test("live pagination, page setup, editing, native reopen and DOCX download", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.stack || e.message));
  const file = createFile("doc", "Paginated notes");
  if (file.kind !== "doc") throw new Error();
  file.content = {
    type: "doc",
    content: Array.from({ length: 70 }, (_, i) => ({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: `Paragraph ${i + 1}: A document that flows over several pages as it is edited.`,
        },
      ],
    })),
  };
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "pages.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await expect(page.locator(".doc-page-spacer").first()).toBeAttached();
  expect(await page.locator(".page-furniture-page").count()).toBeGreaterThan(1);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await page.getByLabel("Page header").fill("Confidential");
  await page.getByLabel("Page footer").fill("Working draft");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".page-header").first()).toHaveText("Confidential");
  await page.screenshot({
    path: "test-results/features-pages.png",
    fullPage: true,
  });
  const saved = await native(page);
  expect(saved.content.content).toHaveLength(70);
  expect(saved.content.attrs.pageSettings.header).toBe("Confidential");
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.press("ControlOrMeta+End");
  await editor.press("End");
  await editor.press("Enter");
  await page.keyboard.type("Added after pagination");
  await expect(editor).toContainText("Added after pagination");
  await office(page, "DOCX");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Paginated notes" }).click();
  await expect(page.locator(".page-header").first()).toHaveText("Confidential");
  await expect(editor).toContainText("Added after pagination");
  expect(errors).toEqual([]);
});
test("sheet feature panels, tab grouping and colors persist, XLSX downloads", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.stack || e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Sample budget" }).click();
  await page.getByRole("button", { name: "Sheet tools", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Data validation", exact: true })
    .click();
  await expect(page.locator("body")).toContainText("Data validation");
  await page.getByRole("button", { name: "Sheet tools", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Conditional formatting", exact: true })
    .click();
  await expect(page.locator("body")).toContainText("Conditional Formatting");
  await page.getByRole("button", { name: "Sheet tools", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Tabs and protection…", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Tabs and protection" });
  await dialog.getByPlaceholder("e.g. Quarterly reports").fill("Finance");
  await dialog.getByRole("button", { name: "Assign group" }).click();
  await dialog.getByLabel("Tab color for Sheet1").fill("#ff0000");
  await dialog
    .getByRole("button", { name: "Close tabs and protection" })
    .click();
  const saved = await native(page);
  const sheet =
    saved.content.workbook.sheets[saved.content.workbook.sheetOrder[0]];
  expect(sheet.custom.suiteleafTabGroup).toBe("Finance");
  expect(sheet.tabColor).toBe("#ff0000");
  await office(page, "XLSX");
  expect(errors).toEqual([]);
});
test("cell notes and range protection survive reopen and can be removed", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.stack || e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Sample budget" }).click();
  const box = page.locator(".sheet-host input.univer-size-full");
  await page
    .getByRole("button", { name: "Sheet tools", exact: true })
    .waitFor();
  const initialBounds = await page.locator(".sheet-host").boundingBox();
  if (!initialBounds) throw new Error();
  await page.mouse.click(initialBounds.x + 195, initialBounds.y + 82);
  await expect(box).toHaveValue("B2");
  await page.getByRole("button", { name: "Sheet tools", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add or edit cell note" }).click();
  // Univer focuses the note box once it has loaded the cell's note; text
  // typed before then is discarded.
  const note = page.locator('[data-u-comp="note-textarea"]');
  await expect(note).toBeFocused();
  await note.fill("Review this budget amount");
  await page.getByRole("button", { name: "Sheet tools", exact: true }).click();
  await page.getByRole("menuitem", { name: "Tabs and protection…" }).click();
  const dialog = page.getByRole("dialog", { name: "Tabs and protection" });
  await dialog.getByRole("button", { name: "Protect selected range" }).click();
  await expect(
    dialog.getByRole("button", { name: "Remove protection" }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Close tabs and protection" })
    .click();
  const saved = await native(page);
  const notes = saved.content.workbook.resources.find(
    (r: { name: string }) => r.name === "SHEET_NOTE_PLUGIN",
  );
  expect(notes.data).toContain("Review this budget amount");
  const id = saved.content.workbook.sheetOrder[0],
    before = saved.content.workbook.sheets[id].cellData[1][1].v;
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Quarterly studio budget" }).click();
  await page
    .getByRole("button", { name: "Sheet tools", exact: true })
    .waitFor();
  const bounds = await page.locator(".sheet-host").boundingBox();
  if (!bounds) throw new Error();
  await page.mouse.click(bounds.x + 195, bounds.y + 82);
  await expect(box).toHaveValue("B2");
  await page.keyboard.type("999");
  await page.keyboard.press("Enter");
  expect(
    (await native(page)).content.workbook.sheets[id].cellData[1][1].v,
  ).toBe(before);
  await page.getByRole("button", { name: "Sheet tools", exact: true }).click();
  await page.getByRole("menuitem", { name: "Tabs and protection…" }).click();
  await dialog.getByRole("button", { name: "Remove protection" }).click();
  await expect(
    dialog.getByRole("button", { name: "Remove protection" }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Close tabs and protection" })
    .click();
  await page.mouse.click(bounds.x + 195, bounds.y + 82);
  await expect(box).toHaveValue("B2");
  await page.keyboard.type("999");
  await page.keyboard.press("Enter");
  expect(
    (await native(page)).content.workbook.sheets[id].cellData[1][1].v,
  ).toBe(999);
  expect(errors).toEqual([]);
});
test("cell comment threads can be authored and reopened locally", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.stack || e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Sample budget" }).click();
  await page
    .getByRole("button", { name: "Sheet tools", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Insert comment (Cmd+Option+M)" })
    .click();
  await page.locator("canvas#univer-doc-main-canvas:visible").last().click();
  await page.keyboard.type("Please review this budget");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  const saved = await native(page);
  const resource = saved.content.workbook.resources.find(
    (r: { name: string }) => r.name === "SHEET_UNIVER_THREAD_COMMENT_PLUGIN",
  );
  expect(resource.data).toContain("Please review this budget");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Quarterly studio budget" }).click();
  await page
    .getByRole("button", { name: "Sheet tools", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Comments", exact: true }).click();
  await expect(page.locator("body")).toContainText("Please review this budget");
  expect(errors).toEqual([]);
});
test("an open cell note closes when the name box moves the selection", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sample budget" }).click();
  await page
    .getByRole("button", { name: "Sheet tools", exact: true })
    .waitFor();
  const box = page.locator(".sheet-host input.univer-size-full");
  await box.fill("C3");
  await box.press("Enter");
  await page.getByRole("button", { name: "Sheet tools", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add or edit cell note" }).click();
  const note = page.locator('[data-u-comp="note-textarea"]');
  await expect(note).toBeFocused();
  await note.fill("Includes the September invoice");
  await box.fill("G12");
  await box.press("Enter");
  await expect(note).toBeHidden();
});
test("comments are signed with the local name and keep it on another computer", async ({
  page,
  browser,
  baseURL,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.stack || e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Sample budget" }).click();
  await page
    .getByRole("button", { name: "Sheet tools", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Sheet tools", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Your name on comments…" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Your name on comments" });
  await dialog.getByRole("textbox", { name: "Your name" }).fill("Alex");
  await dialog.getByRole("button", { name: "Save" }).click();
  await page
    .getByRole("button", { name: "Insert comment (Cmd+Option+M)" })
    .click();
  await page.locator("canvas#univer-doc-main-canvas:visible").last().click();
  await page.keyboard.type("Can Research use $600?");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await page.getByRole("button", { name: "Comments", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Sidebar panel" });
  await expect(panel.getByText("Alex", { exact: true })).toBeVisible();
  const saved = await native(page);
  const thread = saved.content.workbook.resources.find(
    (r: { name: string }) => r.name === "SHEET_UNIVER_THREAD_COMMENT_PLUGIN",
  );
  expect(thread.data).toContain('"authorName":"Alex"');

  const other = await browser.newContext({ baseURL });
  const jordan = await other.newPage();
  await jordan.goto("/");
  await jordan.locator("input[type=file]").setInputFiles({
    name: "budget.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(saved)),
  });
  await jordan
    .getByRole("button", { name: "Sheet tools", exact: true })
    .waitFor();
  await jordan.getByRole("button", { name: "Comments", exact: true }).click();
  const jordanPanel = jordan.getByRole("complementary", {
    name: "Sidebar panel",
  });
  await expect(jordanPanel.getByText("Can Research use $600?")).toBeVisible();
  await expect(jordanPanel.getByText("Alex", { exact: true })).toBeVisible();
  await other.close();
  expect(errors).toEqual([]);
});

test("checkbox validation can be created from the Insert menu and reopened", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Sample budget" }).click();
  await page
    .getByRole("button", { name: "Sheet tools", exact: true })
    .waitFor();
  const box = page.locator(".sheet-host input.univer-size-full");
  await box.fill("A8");
  await box.press("Enter");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: "Checkbox", exact: true }).click();
  const saved = await native(page);
  const rule = saved.content.workbook.resources.find(
    (r: { name: string }) => r.name === "SHEET_DATA_VALIDATION_PLUGIN",
  );
  expect(rule.data).toContain('"type":"checkbox"');
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Quarterly studio budget" }).click();
  await page
    .getByRole("button", { name: "Sheet tools", exact: true })
    .waitFor();
  const restored = await native(page);
  expect(
    restored.content.workbook.resources.find(
      (r: { name: string }) => r.name === "SHEET_DATA_VALIDATION_PLUGIN",
    ).data,
  ).toContain('"type":"checkbox"');
  expect(errors).toEqual([]);
});

async function openChecklist(page: Page, resources: unknown[] = []) {
  const file = createFile("sheet", "Bake sale prep");
  if (file.kind !== "sheet") throw new Error();
  const id = file.content.workbook.sheetOrder[0];
  file.content.workbook.sheets[id].cellData = {
    0: { 0: { v: "Done", t: 1 }, 1: { v: "Task", t: 1 } },
    1: { 1: { v: "Book the hall", t: 1 }, 2: { f: "=A2=TRUE" } },
    2: { 1: { v: "Order bags", t: 1 }, 2: { f: "=COUNTIF(A2:A4,FALSE)" } },
    3: { 0: { v: "Skip", t: 1 }, 1: { v: "Print cards", t: 1 } },
  };
  file.content.workbook.resources = resources.map((r) => ({
    ...(r as object),
    data: JSON.stringify({ [id]: (r as { data: unknown }).data }),
  })) as never;
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "checklist.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await page
    .getByRole("button", { name: "Sheet tools", exact: true })
    .waitFor();
  const box = page.locator(".sheet-host input.univer-size-full");
  await box.fill("A2:A4");
  await box.press("Enter");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: "Checkbox", exact: true }).click();
}

/** Default Univer geometry: 46px row header, 100px columns, 24px rows. */
async function cellPoint(page: Page, column: number, row: number) {
  const host = (await page.locator(".sheet-host").boundingBox())!;
  return { x: host.x + 46 + 100 * column + 50, y: host.y + 58 + 24 * row };
}

async function pixel(page: Page, column: number, row: number) {
  const { x, y } = await cellPoint(page, column, row);
  const png = await page.screenshot({
    clip: { x: x + 40, y: y - 8, width: 1, height: 1 },
  });
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

test("Insert › Checkbox stores TRUE/FALSE that formulas, =$A2=TRUE rules and XLSX understand", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const range = { startRow: 1, endRow: 3, startColumn: 0, endColumn: 1 };
  await openChecklist(page, [
    {
      name: "SHEET_CONDITIONAL_FORMATTING_PLUGIN",
      data: [
        {
          cfId: "done",
          ranges: [range],
          stopIfTrue: false,
          rule: {
            type: "highlightCell",
            subType: "formula",
            value: "=$A2=TRUE",
            style: { bg: { rgb: "#00ff00" } },
          },
        },
      ],
    },
  ]);
  let cells = (await native(page)).content.workbook.sheets;
  cells = (Object.values(cells)[0] as { cellData: any }).cellData;
  expect(cells[1][0]).toMatchObject({ v: 0, t: 3 });
  expect(cells[2][0]).toMatchObject({ v: 0, t: 3 });
  expect(cells[3][0].v).toBe("Skip");
  const point = await cellPoint(page, 0, 1);
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => pixel(page, 1, 1)).toEqual([0, 255, 0]);
  expect(await pixel(page, 1, 2)).toEqual([255, 255, 255]);
  const saved = await native(page);
  cells = (Object.values(saved.content.workbook.sheets)[0] as { cellData: any })
    .cellData;
  expect(cells[1][0]).toMatchObject({ v: 1, t: 3 });
  expect(cells[1][2]).toMatchObject({ v: 1, t: 3 });
  expect(cells[2][2].v).toBe(1);
  expect(
    saved.content.workbook.resources.find(
      (r: { name: string }) => r.name === "SHEET_DATA_VALIDATION_PLUGIN",
    ).data,
  ).toContain('"formula1":"TRUE","formula2":"FALSE"');
  await page.getByRole("button", { name: "File", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export XLSX" }).click();
  const xlsx = XLSX.read(await readFile((await (await download).path())!), {
    type: "buffer",
  });
  const sheet = xlsx.Sheets[xlsx.SheetNames[0]];
  expect(sheet.A2).toMatchObject({ t: "b", v: true });
  expect(sheet.A3).toMatchObject({ t: "b", v: false });
  expect(errors).toEqual([]);
});

test("a new conditional formatting rule keeps the text colour and starts with a light green fill", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openChecklist(page);
  const box = page.locator(".sheet-host input.univer-size-full");
  await box.fill("A2:B4");
  await box.press("Enter");
  await page.getByRole("button", { name: "Format", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Conditional formatting", exact: true })
    .click();
  const sidebar = page.locator('[data-u-comp="sidebar"]');
  await sidebar.locator("svg.univerjs-icon-increase-icon").click();
  await sidebar
    .locator('[data-u-comp="select"]')
    .filter({ hasText: "Highlight Cell" })
    .click();
  await page.getByText("Custom Formula", { exact: true }).last().click();
  await sidebar.locator("canvas").nth(1).click();
  await page.keyboard.type("$A2=TRUE");
  await sidebar.getByText("Style Type").click();
  await sidebar.getByRole("button", { name: "Submit" }).click();
  await expect(sidebar.getByText("Custom Formula")).toBeVisible();
  await sidebar.getByRole("button", { name: "Close sidebar" }).click();
  const point = await cellPoint(page, 0, 1);
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => pixel(page, 1, 1)).toEqual([183, 225, 205]);
  const { workbook } = (await native(page)).content;
  const [rule] = JSON.parse(
    workbook.resources.find(
      (r: { name: string }) => r.name === "SHEET_CONDITIONAL_FORMATTING_PLUGIN",
    ).data,
  )[workbook.sheetOrder[0]];
  expect(rule.rule.value).toBe("=$A2=TRUE");
  expect(rule.rule.style).toEqual({ bg: { rgb: "#b7e1cd" } });
  expect(errors).toEqual([]);
});
