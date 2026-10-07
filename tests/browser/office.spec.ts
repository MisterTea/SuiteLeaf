import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { wordFixture, excelFixture } from "../office-fixtures";
async function nativeCopy(page: Page) {
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  return JSON.parse(await readFile((await (await downloaded).path())!, "utf8"));
}
test("DOCX worker import → editing → native copy → reopen", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Office notes.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(await wordFixture()),
  });
  await expect(
    page.getByRole("textbox", { name: "Document content" }),
  ).toContainText("Hello 世界 — مرحبا");
  await expect(page.locator(".document-content h1")).toContainText(
    "Office field notes",
  );
  await expect(page.locator(".document-content table")).toBeVisible();
  await expect(
    page.locator('.document-content a[href^="javascript:"]'),
  ).toHaveCount(0);
  await expect(page.locator(".import-notes")).toContainText("DOCX");
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click();
  await editor.press("ControlOrMeta+End");
  await editor.press("Enter");
  await editor.pressSequentially("Reviewed in SuiteLeaf");
  await expect(page.getByRole("status")).toContainText("Saved");
  const file = await nativeCopy(page);
  expect(file.kind).toBe("doc");
  expect(file.importInfo.sourceFormat).toBe("docx");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Office notes", exact: true }).click();
  await expect(editor).toContainText("Reviewed in SuiteLeaf");
  await page.screenshot({
    path: "test-results/office-docx.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("XLSX worker import → formulas, styles and named ranges → edit and reopen", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Imported budget.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await excelFixture()),
  });
  await page.getByText("Budget", { exact: true }).first().waitFor();
  await expect(page.locator(".import-notes")).toContainText("XLSX");
  let file = await nativeCopy(page);
  let s = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  expect(s.cellData[1][0].v).toBe(200);
  expect(file.content.workbook.dateSystem).toBe("date1904");
  const name = page.locator(".sheet-host input.univer-size-full");
  await name.fill("B1");
  await name.press("Enter");
  await page.keyboard.type("150");
  await page.keyboard.press("Enter");
  file = await nativeCopy(page);
  s = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  expect(s.cellData[1][0].v).toBe(300);
  expect(s.cellData[0][2].v).toBe(300);
  await page.getByRole("button", { name: "Back to files" }).click();
  await page
    .getByRole("link", { name: "Imported budget", exact: true })
    .click();
  await page.getByText("Budget", { exact: true }).first().waitFor();
  const reopened = await nativeCopy(page);
  expect(
    reopened.content.workbook.sheets[reopened.content.workbook.sheetOrder[0]]
      .cellData[1][0].v,
  ).toBe(300);
  await page.screenshot({
    path: "test-results/office-xlsx.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("Office failures are visible and leave existing files intact", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("button", { name: "Open / import" }).waitFor();
  await page.locator("input[type=file]").setInputFiles({
    name: "Broken.docx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("not a ZIP"),
  });
  await expect(page.getByRole("alert")).toContainText("signature");
  await expect(
    page.getByRole("link", { name: "Untitled document", exact: true }),
  ).toBeVisible();
});

import { existsSync } from "node:fs";
const corpusExamples = [
  [
    "Arabic Word",
    "datasets/docx-corpus/files/ar/0006f88ffec621e8fc31b1e843a737e417b92ad189f02104d061ceaadb77f119.docx",
  ],
  [
    "Chinese Word",
    "datasets/docx-corpus/files/zh/000b5cd5204d0b48651ae9a139ddf697c68276d1701567dcba3b4bf1c3fee4b2.docx",
  ],
  [
    "English Word",
    "datasets/docx-corpus/files/en/0000439f0e09bad3cf0ff248690ae45e55120be8bdb42a8533f7e117bc4f7007.docx",
  ],
  ["Real Excel", "datasets/napierone/files/xlsx/0024-xlsx.xlsx"],
  [
    "Excel regression",
    "datasets/apache-poi/files/test-data/spreadsheet/45540_classic_Footer.xlsx",
  ],
];
for (const [label, path] of corpusExamples)
  test(`local corpus: ${label} renders, saves and reopens`, async ({
    page,
  }) => {
    test.skip(!existsSync(path), "Downloaded corpus is local-only.");
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const ext = path.split(".").pop()!;
    await page.goto("/");
    await page.locator("input[type=file]").setInputFiles({
      name: `${label}.${ext}`,
      mimeType: "application/octet-stream",
      buffer: await readFile(path),
    });
    if (ext === "docx") {
      const editor = page.getByRole("textbox", { name: "Document content" });
      await expect(editor).toBeVisible();
      expect((await editor.innerText()).trim().length).toBeGreaterThan(10);
    } else await page.locator(".sheet-host input.univer-size-full").waitFor();
    await expect(page.getByRole("alert")).toHaveCount(0);
    const saved = await nativeCopy(page);
    expect(saved.kind).toBe(ext === "docx" ? "doc" : "sheet");
    await page.getByRole("button", { name: "Back to files" }).click();
    await page.getByRole("link", { name: label, exact: true }).click();
    if (ext === "docx")
      await expect(
        page.getByRole("textbox", { name: "Document content" }),
      ).toBeVisible();
    else await page.locator(".sheet-host input.univer-size-full").waitFor();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

test("local corpus: large workbook remains editable in the browser", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium" ||
      !existsSync("datasets/napierone/files/xlsx/0594-xlsx.xlsx"),
    "Large local stress fixture runs in Chromium only.",
  );
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .locator("input[type=file]")
    .setInputFiles("datasets/napierone/files/xlsx/0594-xlsx.xlsx");
  await page
    .locator(".sheet-host input.univer-size-full")
    .waitFor({ timeout: 150000 });
  await expect(page.getByRole("status")).toContainText("Saved", {
    timeout: 15000,
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByLabel("File title").fill("Large imported workbook");
  await expect(page.getByRole("status")).toContainText("Saved", {
    timeout: 60000,
  });
  expect(errors).toEqual([]);
});
