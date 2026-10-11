import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
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
  await page
    .locator('[data-u-comp="note-textarea"]')
    .fill("Review this budget amount");
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
